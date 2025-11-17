/**
 * Простой автокомментатор с ротацией
 * Минимальный код, максимальная ясность
 *
 * npm run comment:simple-rotation
 */

import * as dotenv from "dotenv";
dotenv.config();

import { GramClient } from "../../telegram/adapters/gramClient";
import {
  CommentPosterService,
  ICommentTarget,
  ICommentingOptionsWithAI,
} from "../../app/commentPoster";
import { AICommentGeneratorService } from "../../app/aiCommentGenerator";
import { AccountRotatorService } from "../../app/accountRotator/services/accountRotatorService";
import { IAccountInfo } from "../../app/accountRotator/interfaces/IAccountRotator";
import { SpamChecker } from "../../shared/services/spamChecker";
import { createLogger } from "../../shared/utils/logger";
import * as fs from "fs";
import { randomUUID } from "crypto";

// Конфигурация
const CONFIG = {
  targetChannel: process.env.TARGET_CHANNEL || "", // Канал от имени которого комментируем
  commentsPerAccount: 190, // Лимит комментариев на аккаунт
  delayBetweenComments: 3000, // Задержка между комментариями (мс)
  channelsFile: "./input-channels/channels.txt",
  successfulFile: "./input-channels/successful-channels.txt",
  aiEnabled: !!process.env.DEEPSEEK_API_KEY,
};

/**
 * Простой класс автокомментирования
 */
class SimpleAutoCommenter {
  private client!: GramClient;
  private commentPoster!: CommentPosterService;
  private accountRotator: AccountRotatorService;
  private aiGenerator: AICommentGeneratorService;
  private spamChecker: SpamChecker;
  private log: ReturnType<typeof createLogger>;
  private sessionId: string;

  private targetChannelOwner: IAccountInfo | null = null;
  private targetChannelInfo: any = null;

  constructor() {
    // Генерируем уникальный sessionId для трекинга
    this.sessionId = randomUUID();

    // Инициализация логера с sessionId
    this.log = createLogger("AutoCommentSimple", { sessionId: this.sessionId });

    // Инициализация сервисов
    this.accountRotator = new AccountRotatorService({
      maxCommentsPerAccount: CONFIG.commentsPerAccount,
      delayBetweenRotations: 5,
      saveProgress: false,
    });

    this.aiGenerator = new AICommentGeneratorService({
      apiKey: process.env.DEEPSEEK_API_KEY || "",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      enabled: CONFIG.aiEnabled,
    });

    this.spamChecker = new SpamChecker();

    this.log.info("Автокомментатор инициализирован", {
      accountsCount: this.accountRotator.getAllAccounts().length,
      commentLimit: CONFIG.commentsPerAccount,
      aiEnabled: CONFIG.aiEnabled,
      targetChannel: CONFIG.targetChannel,
    });
  }

  /**
   * Главный метод запуска
   */
  async start(): Promise<void> {
    const startTime = Date.now();
    this.log.operationStart("CommentingSession", {
      targetChannel: CONFIG.targetChannel,
      commentLimit: CONFIG.commentsPerAccount,
    });

    try {
      const channels = await this.loadChannels();
      this.log.info("Каналы загружены", {
        totalChannels: channels.length,
        source: CONFIG.channelsFile,
      });

      await this.findTargetChannel();

      if (!this.targetChannelOwner || !this.targetChannelInfo) {
        throw new Error(`Канал ${CONFIG.targetChannel} не найден`);
      }

      await this.processChannels(channels);

      this.log.operationEnd("CommentingSession", startTime, {
        status: "completed",
      });
    } catch (error: any) {
      this.log.error("Критическая ошибка в сессии", error, {
        targetChannel: CONFIG.targetChannel,
        currentAccount: this.accountRotator.getCurrentAccount()?.name,
      });
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Загрузка каналов из файла
   */
  private async loadChannels(): Promise<ICommentTarget[]> {
    if (!fs.existsSync(CONFIG.channelsFile)) {
      throw new Error("Файл channels.txt не найден");
    }

    const content = fs.readFileSync(CONFIG.channelsFile, "utf-8");
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    return lines.map((username) => ({
      channelUsername: username.replace("@", ""),
      channelUrl: `https://t.me/${username.replace("@", "")}`,
      isActive: true,
    }));
  }

  /**
   * Поиск канала целевого канала среди аккаунтов
   */
  private async findTargetChannel(): Promise<void> {
    this.log.info("Поиск целевого канала", {
      targetChannel: CONFIG.targetChannel,
      totalAccounts: this.accountRotator.getAllAccounts().length,
    });

    const accounts = this.accountRotator.getAllAccounts();

    for (const account of accounts) {
      this.log.debug("Проверка аккаунта", { account: account.name });

      // Подключаемся БЕЗ проверки спама
      await this.connectAccount(account, true);

      // Ищем канал
      const channels = await this.commentPoster.getUserChannelsAsync();
      const targetChannel = channels.find(
        (ch) =>
          ch.username?.toLowerCase() ===
          CONFIG.targetChannel.replace("@", "").toLowerCase(),
      );

      if (targetChannel) {
        this.log.info("Целевой канал найден", {
          account: account.name,
          channel: CONFIG.targetChannel,
          channelId: targetChannel.id,
        });

        // Теперь проверяем спам
        const isSpammed = await this.spamChecker.isAccountSpammedReliable(
          this.client.getClient(),
          account.name,
        );

        if (isSpammed) {
          this.log.warn("Владелец канала в спаме", {
            account: account.name,
            action: "searching_clean_account",
          });

          const cleanAccount = await this.findCleanAccount(accounts, account);
          if (!cleanAccount) {
            throw new Error("Все аккаунты в спаме");
          }

          this.log.info("Передача канала чистому аккаунту", {
            from: account.name,
            to: cleanAccount.name,
            reason: "spam_detected",
          });
          await this.transferChannel(account, cleanAccount);

          await this.connectAccount(cleanAccount, false);
          this.targetChannelOwner = cleanAccount;
          this.targetChannelInfo = targetChannel;
        } else {
          this.targetChannelOwner = account;
          this.targetChannelInfo = targetChannel;
        }

        this.accountRotator.setActiveAccount(this.targetChannelOwner.name);
        this.log.info("Целевой канал настроен", {
          owner: this.targetChannelOwner.name,
          channel: CONFIG.targetChannel,
        });
        return;
      }
    }
  }

  /**
   * Подключение к аккаунту
   */
  private async connectAccount(
    account: IAccountInfo,
    skipSpamCheck = false,
  ): Promise<void> {
    this.log.debug("Подключение к аккаунту", {
      account: account.name,
      skipSpamCheck,
    });

    // Отключаем старый клиент
    if (this.client) {
      await this.client.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Подключаем новый
    process.env.SESSION_STRING = account.sessionValue;
    this.client = new GramClient();
    await this.client.connect();
    this.commentPoster = new CommentPosterService(this.client.getClient());

    // Проверка спама только если нужно
    if (!skipSpamCheck) {
      const isSpammed = await this.spamChecker.isAccountSpammedReliable(
        this.client.getClient(),
        account.name,
      );

      if (isSpammed) {
        this.log.error("Аккаунт в спаме", new Error("Account spammed"), {
          account: account.name,
        });
        throw new Error(`Аккаунт ${account.name} в спаме`);
      }
    }

    this.log.info("Аккаунт подключен", { account: account.name });
  }

  /**
   * Обработка каналов с комментированием
   */
  private async processChannels(channels: ICommentTarget[]): Promise<void> {
    this.log.info("Начало комментирования", {
      totalChannels: channels.length,
    });

    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];
      const channelLog = this.log.child({
        channelUsername: channel.channelUsername,
        channelIndex: i + 1,
        totalChannels: channels.length,
      });

      // Проверяем необходимость ротации
      if (this.accountRotator.shouldRotate()) {
        await this.rotateToNextAccount();
      }

      const currentAccount = this.accountRotator.getCurrentAccount();

      this.accountRotator.incrementCommentCount();

      const startTime = Date.now();

      try {
        const result = await this.commentChannel(channel);

        await this.saveSuccessfulChannel(channel.channelUsername);

        channelLog.info("Комментарий успешно опубликован", {
          account: currentAccount.name,
          commentsCount: currentAccount.commentsCount,
          maxComments: currentAccount.maxCommentsPerSession,
          commentText:
            result.length > 150 ? result.substring(0, 150) + "..." : result,
          duration: Date.now() - startTime,
        });
      } catch (error: any) {
        const errorMsg = error.message || error;

        if (
          error.code === 420 ||
          errorMsg.includes("FloodWaitError") ||
          errorMsg.includes("FLOOD")
        ) {
          const seconds =
            error.seconds || this.extractSecondsFromError(errorMsg);
          this.log.error("FloodWait обнаружен - остановка работы", error, {
            account: currentAccount.name,
            channel: channel.channelUsername,
            waitSeconds: seconds,
          });
          await this.cleanup();
          process.exit(1);
        }

        channelLog.warn("Ошибка при комментировании", {
          account: currentAccount.name,
          commentsCount: currentAccount.commentsCount,
          maxComments: currentAccount.maxCommentsPerSession,
          error: this.simplifyError(errorMsg),
          errorCode: error.code,
          duration: Date.now() - startTime,
        });

        // Проверяем на спам
        if (
          errorMsg.includes("USER_BANNED_IN_CHANNEL") ||
          errorMsg.includes("CHAT_GUEST_SEND_FORBIDDEN")
        ) {
          const isSpammed = await this.spamChecker.isAccountSpammedReliable(
            this.client.getClient(),
            currentAccount.name,
          );

          if (
            isSpammed &&
            currentAccount.name === this.targetChannelOwner?.name
          ) {
            this.log.warn("Владелец канала обнаружен в спаме", {
              account: currentAccount.name,
              action: "handling_owner_spam",
            });
            await this.handleOwnerSpam();
          }
        }
      }

      // Удаляем из файла
      await this.removeChannelFromFile(channel.channelUsername);

      // Задержка
      await new Promise((resolve) =>
        setTimeout(resolve, CONFIG.delayBetweenComments),
      );
    }
  }

  /**
   * Комментирование одного канала с проверкой существующих комментариев
   */
  private async commentChannel(channel: ICommentTarget): Promise<string> {
    if (!this.targetChannelInfo) {
      throw new Error("Целевой канал не установлен");
    }

    // Проверяем существующие комментарии перед отправкой
    const hasExisting = await this.checkExistingComment(
      channel.channelUsername,
    );
    if (hasExisting) {
      await this.saveSuccessfulChannel(channel.channelUsername);
      return "Уже есть";
    }

    const options: ICommentingOptionsWithAI = {
      targets: [channel],
      messages: [],
      delayBetweenComments: 0,
      maxCommentsPerSession: 1,
      randomizeOrder: false,
      skipRecentlyCommented: false,
      dryRun: false,
      useAI: CONFIG.aiEnabled,
      aiGenerator: this.aiGenerator,
      sendAsOptions: {
        useChannelAsSender: true,
        selectedChannelId: this.targetChannelInfo.username,
        selectedChannelTitle: this.targetChannelInfo.title,
      },
    };

    const result = await this.commentPoster.postCommentsWithAIAsync(options);

    if (result.successfulComments === 0) {
      throw new Error(result.results[0]?.error || "Не удалось");
    }

    // Возвращаем полный комментарий для лога
    return result.results[0]?.commentText || "";
  }

  /**
   * Проверка существующих комментариев от целевого канала
   */
  private async checkExistingComment(
    channelUsername: string,
  ): Promise<boolean> {
    try {
      // Получаем последний пост канала
      const messages = await this.client
        .getClient()
        .getMessages(channelUsername, { limit: 1 });
      if (!messages || messages.length === 0) {
        this.log.debug("Нет сообщений в канале", { channel: channelUsername });
        return false;
      }

      const lastMessage = messages[0];
      if (!lastMessage.id) {
        return false;
      }

      // Получаем комментарии к посту
      try {
        const discussion = await this.client
          .getClient()
          .getMessages(channelUsername, {
            replyTo: lastMessage.id,
            limit: 50,
          });

        if (discussion && discussion.length > 0) {
          // Проверяем комментарии от нашего канала
          const hasOurComment = discussion.some((comment) => {
            const fromId = comment.fromId;
            return (
              fromId &&
              fromId.className === "PeerChannel" &&
              fromId.channelId &&
              this.targetChannelInfo?.id &&
              fromId.channelId.toString() ===
                this.targetChannelInfo.id.toString()
            );
          });

          if (hasOurComment) {
            this.log.info("Комментарий уже существует", {
              channel: channelUsername,
              targetChannel: CONFIG.targetChannel,
            });
          }

          return hasOurComment;
        }
      } catch (error) {
        this.log.debug("Ошибка получения комментариев", {
          channel: channelUsername,
          error: (error as Error).message,
        });
        return false;
      }

      return false;
    } catch (error) {
      this.log.debug("Ошибка проверки существующего комментария", {
        channel: channelUsername,
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Ротация на следующий аккаунт
   */
  private async rotateToNextAccount(): Promise<void> {
    const currentAccount = this.accountRotator.getCurrentAccount();
    const rotationResult = await this.accountRotator.rotateToNextAccount();

    if (!rotationResult.success) {
      this.log.error("Ошибка ротации аккаунта", new Error("Rotation failed"), {
        currentAccount: currentAccount.name,
      });
      throw new Error("Не удалось выполнить ротацию");
    }

    const newAccount = rotationResult.newAccount;

    if (currentAccount.name === this.targetChannelOwner?.name) {
      this.log.info("Ротация с передачей владения каналом", {
        from: currentAccount.name,
        to: newAccount.name,
        reason: "comment_limit_reached",
        targetChannel: CONFIG.targetChannel,
      });
      await this.transferChannel(currentAccount, newAccount);
      this.targetChannelOwner = newAccount;
    } else {
      this.log.info("Ротация аккаунта", {
        from: currentAccount.name,
        to: newAccount.name,
        reason: "comment_limit_reached",
        currentComments: currentAccount.commentsCount,
      });
    }

    await this.connectAccount(newAccount);
  }

  /**
   * Обработка спама владельца канала
   */
  private async handleOwnerSpam(): Promise<void> {
    if (!this.targetChannelOwner) return;

    this.log.warn("Обработка спама владельца канала", {
      owner: this.targetChannelOwner.name,
      channel: CONFIG.targetChannel,
    });

    const accounts = this.accountRotator.getAllAccounts();
    const cleanAccount = await this.findCleanAccount(
      accounts,
      this.targetChannelOwner,
    );

    if (!cleanAccount) {
      this.log.error(
        "Все аккаунты в спаме",
        new Error("No clean accounts available"),
        {
          totalAccounts: accounts.length,
          spammedOwner: this.targetChannelOwner.name,
        },
      );
      throw new Error("Все аккаунты в спаме, работа невозможна");
    }

    this.log.info("Передача канала из-за спама владельца", {
      from: this.targetChannelOwner.name,
      to: cleanAccount.name,
      reason: "owner_spam_detected",
    });
    await this.transferChannel(this.targetChannelOwner, cleanAccount);

    this.targetChannelOwner = cleanAccount;
    this.accountRotator.setActiveAccount(cleanAccount.name);

    await this.connectAccount(cleanAccount);
  }

  /**
   * Поиск чистого аккаунта
   */
  private async findCleanAccount(
    accounts: IAccountInfo[],
    exclude: IAccountInfo,
  ): Promise<IAccountInfo | null> {
    this.log.debug("Поиск чистого аккаунта", {
      totalAccounts: accounts.length,
      excludeAccount: exclude.name,
    });

    for (const account of accounts) {
      if (account.name === exclude.name) continue;

      this.log.debug("Проверка аккаунта на спам", { account: account.name });

      await this.connectAccount(account, true);
      const isSpammed = await this.spamChecker.isAccountSpammedReliable(
        this.client.getClient(),
        account.name,
      );

      if (!isSpammed) {
        this.log.info("Найден чистый аккаунт", { account: account.name });
        return account;
      } else {
        this.log.debug("Аккаунт в спаме", { account: account.name });
      }
    }

    this.log.warn("Чистый аккаунт не найден", {
      checkedAccounts: accounts.length,
    });
    return null;
  }

  /**
   * Передача канала между аккаунтами с валидацией
   */
  private async transferChannel(
    from: IAccountInfo,
    to: IAccountInfo,
  ): Promise<void> {
    const transferLog = this.log.child({
      operation: "channel_transfer",
      from: from.name,
      to: to.name,
      channel: CONFIG.targetChannel,
    });

    transferLog.info("Начало передачи канала");

    // Шаг 1: Валидация владения каналом
    transferLog.debug("Валидация владения каналом");
    try {
      await this.connectAccount(from, true);
      const userChannels = await this.commentPoster.getUserChannelsAsync();
      const hasChannel = userChannels.some(
        (ch) =>
          ch.username?.toLowerCase() ===
          CONFIG.targetChannel.replace("@", "").toLowerCase(),
      );

      if (!hasChannel) {
        transferLog.warn("Аккаунт не владеет каналом", {
          account: from.name,
          action: "searching_real_owner",
        });
        await this.findTargetChannel();
        return;
      }

      transferLog.debug("Владение каналом подтверждено");
    } catch (validationError) {
      transferLog.error("Ошибка валидации владения", validationError as Error);
      return;
    }

    // Шаг 2: Выполнение передачи
    const startTime = Date.now();
    try {
      const { ChannelOwnershipRotatorService } = await import(
        "../../app/ownershipRotator/services/channelOwnershipRotatorService"
      );

      const password =
        process.env[
          `PASSWORD_${from.sessionKey.replace("SESSION_STRING_", "")}`
        ];
      if (!password) {
        throw new Error(`Пароль 2FA не найден для ${from.name}`);
      }

      if (!to.username) {
        throw new Error(`Username не найден для ${to.name}`);
      }

      transferLog.info("Инициализация передачи владения");
      const service = new ChannelOwnershipRotatorService();
      const result = await service.transferOwnershipAsync({
        sessionString: from.sessionValue,
        channelIdentifier: CONFIG.targetChannel.replace("@", ""),
        targetUserIdentifier: to.username.replace("@", ""),
        password,
      });

      if (!result.success) {
        // Детальная обработка ошибок
        const errorMsg = result.error || "Неизвестная ошибка";

        transferLog.error("Ошибка передачи владения", new Error(errorMsg), {
          errorType: errorMsg.includes("CHAT_ADMIN_REQUIRED")
            ? "not_admin"
            : errorMsg.includes("PASSWORD_HASH_INVALID")
              ? "invalid_password"
              : errorMsg.includes("USER_NOT_MUTUAL_CONTACT")
                ? "not_mutual_contact"
                : "unknown",
          duration: Date.now() - startTime,
        });
        throw new Error(errorMsg);
      }

      transferLog.info("Передача владения успешно завершена", {
        duration: Date.now() - startTime,
        newOwner: to.name,
      });

      // Обновляем владельца
      this.targetChannelOwner = to;
      this.accountRotator.setActiveAccount(to.name);
    } catch (error: any) {
      transferLog.error("Критическая ошибка передачи канала", error, {
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Сохранение успешного канала с проверкой дубликатов
   */
  private async saveSuccessfulChannel(channelUsername: string): Promise<void> {
    try {
      const cleanUsername = channelUsername.replace("@", "");

      // Создаем файл если его нет
      if (!fs.existsSync(CONFIG.successfulFile)) {
        fs.writeFileSync(
          CONFIG.successfulFile,
          "# Успешные каналы (автоматически пополняется)\n",
          "utf-8",
        );
        this.log.debug("Создан файл успешных каналов", {
          file: CONFIG.successfulFile,
        });
      }

      // Проверяем, есть ли уже канал в файле
      const existingContent = fs.readFileSync(CONFIG.successfulFile, "utf-8");
      if (existingContent.includes(cleanUsername)) {
        this.log.debug("Канал уже в списке успешных", {
          channel: cleanUsername,
        });
        return; // Канал уже сохранен
      }

      // Добавляем новый канал
      const content = `@${cleanUsername}\n`;
      fs.appendFileSync(CONFIG.successfulFile, content, "utf-8");
      this.log.debug("Канал добавлен в успешные", {
        channel: cleanUsername,
        file: CONFIG.successfulFile,
      });
    } catch (error) {
      this.log.warn("Ошибка сохранения в успешные", {
        channel: channelUsername,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Удаление канала из файла
   */
  private async removeChannelFromFile(channelUsername: string): Promise<void> {
    try {
      const content = fs.readFileSync(CONFIG.channelsFile, "utf-8");
      const lines = content.split("\n");
      const beforeCount = lines.filter(
        (l) => l.trim() && !l.startsWith("#"),
      ).length;

      const filtered = lines.filter((line) => {
        const clean = line.trim().replace("@", "");
        return clean !== channelUsername.replace("@", "");
      });

      const afterCount = filtered.filter(
        (l) => l.trim() && !l.startsWith("#"),
      ).length;

      fs.writeFileSync(CONFIG.channelsFile, filtered.join("\n"), "utf-8");

      this.log.info("Канал удален из очереди", {
        channel: channelUsername,
        file: CONFIG.channelsFile,
        remainingChannels: afterCount,
        operation: "delete",
      });
    } catch (error) {
      this.log.warn("Ошибка удаления канала из файла", {
        channel: channelUsername,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Извлечение секунд из сообщения об ошибке
   */
  private extractSecondsFromError(errorMsg: string): number {
    // Просто ищем любое число в сообщении об ошибке
    const match = errorMsg.match(/\d+/);
    return match ? parseInt(match[0]) : 0;
  }

  /**
   * Упрощение текста ошибки для лучшей читаемости
   */
  private simplifyError(errorMsg: string): string {
    if (errorMsg.includes("CHAT_GUEST_SEND_FORBIDDEN")) {
      return "Нужно вступить в канал";
    }
    if (errorMsg.includes("MSG_ID_INVALID")) {
      return "Неверный ID сообщения";
    }
    if (errorMsg.includes("USER_BANNED_IN_CHANNEL")) {
      return "Аккаунт забанен в канале";
    }
    if (errorMsg.includes("CHANNELS_TOO_MUCH")) {
      return "Превышен лимит каналов";
    }

    // Возвращаем первые 50 символов для других ошибок
    return errorMsg.length > 50 ? errorMsg.substring(0, 50) + "..." : errorMsg;
  }

  /**
   * Очистка ресурсов
   */
  private async cleanup(): Promise<void> {
    try {
      await this.client?.disconnect();
    } catch {}
  }
}

// Запуск
async function main() {
  const commenter = new SimpleAutoCommenter();
  await commenter.start();
}

main().catch((error) => {
  console.error("💥 Критическая ошибка:", error);
  process.exit(1);
});
