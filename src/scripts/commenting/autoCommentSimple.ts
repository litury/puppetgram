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
  commentsPerAccount: 200, // Лимит комментариев на аккаунт
  delayBetweenComments: 3000, // Задержка между комментариями (мс)
  channelsFile: "./input-channels/channels.txt",
  successfulFile: "./input-channels/successful-channels.txt",
  unavailableFile: "./input-channels/unavailable-channels.txt",
  bannedFilePrefix: "./input-channels/banned-for-",
  moderatedFile: "./input-channels/moderated-channels.txt",
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

  // Для tracking клиентов и предотвращения memory leaks
  private activeClients: GramClient[] = [];

  // Трекинг аккаунтов, словивших FLOOD_WAIT при комментировании
  private floodWaitAccounts: Set<string> = new Set();

  // Кэш спам-статуса аккаунтов (чтобы не проверять повторно)
  private spammedAccounts: Set<string> = new Set();

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
          // Добавляем в кэш спама
          this.spammedAccounts.add(account.name);

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

        if (this.targetChannelOwner) {
          this.accountRotator.setActiveAccount(this.targetChannelOwner.name);
          this.log.info("Целевой канал настроен", {
            owner: this.targetChannelOwner.name,
            channel: CONFIG.targetChannel,
          });
        }
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

    // Отключаем старый клиент с гарантированным cleanup
    if (this.client) {
      try {
        await this.disconnectClient(this.client);
      } catch (error) {
        this.log.warn("Ошибка отключения старого клиента", { error });
      }
    }

    // Подключаем новый
    process.env.SESSION_STRING = account.sessionValue;
    this.client = new GramClient();
    await this.client.connect();

    // Добавляем в tracking
    this.activeClients.push(this.client);
    this.log.debug("Клиент добавлен в tracking", {
      totalActiveClients: this.activeClients.length,
    });

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
   * Обновление информации о целевом канале с новым accessHash
   * Вызывается после передачи канала новому владельцу
   */
  private async refreshTargetChannelInfo(): Promise<void> {
    if (!this.targetChannelInfo) {
      this.log.warn("Нет targetChannelInfo для обновления");
      return;
    }

    this.log.debug("Обновление информации о канале", {
      channelId: this.targetChannelInfo.id,
    });

    const channels = await this.commentPoster.getUserChannelsAsync();
    const updatedChannel = channels.find(
      (ch) => ch.id === this.targetChannelInfo?.id,
    );

    if (updatedChannel) {
      this.targetChannelInfo = updatedChannel;
      this.log.info("Информация о канале обновлена", {
        channelId: updatedChannel.id,
        hasAccessHash: !!updatedChannel.accessHash,
      });
    } else {
      this.log.warn("Канал не найден при обновлении", {
        channelId: this.targetChannelInfo.id,
      });
    }
  }

  /**
   * Отключение одного клиента с таймаутом
   */
  private async disconnectClient(client: GramClient): Promise<void> {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.log.warn("Disconnect timeout, форсируем завершение");
        resolve();
      }, 3000); // 3 секунды на disconnect

      client
        .disconnect()
        .then(() => {
          clearTimeout(timeout);
          resolve();
        })
        .catch((error) => {
          this.log.warn("Ошибка при disconnect", { error });
          clearTimeout(timeout);
          resolve();
        });
    });
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

          // Проверяем, является ли текущий аккаунт владельцем канала
          if (currentAccount.name === this.targetChannelOwner?.name) {
            this.log.warn("FLOOD_WAIT владельца канала, передаём другому", {
              account: currentAccount.name,
              channel: channel.channelUsername,
              waitSeconds: seconds,
            });

            // Передаём канал другому аккаунту и продолжаем
            await this.handleOwnerFloodWait(seconds);

            // После передачи канала пропускаем текущий канал и идём к следующему
            // (т.к. на этом канале уже был FLOOD_WAIT)
            await this.removeChannelFromFile(channel.channelUsername);
            continue;
          } else {
            // Если не владелец, то останавливаем работу (нестандартная ситуация)
            this.log.error(
              "FLOOD_WAIT на не-владельце канала (необычная ситуация)",
              error,
              {
                account: currentAccount.name,
                owner: this.targetChannelOwner?.name,
                channel: channel.channelUsername,
                waitSeconds: seconds,
              },
            );
            await this.cleanup();
            process.exit(1);
          }
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

        // Классификация и сохранение ошибки канала
        const shouldRemoveChannel = this.handleChannelError(channel.channelUsername, errorMsg);
        if (shouldRemoveChannel) {
          this.removeFromSuccessful(channel.channelUsername);
          // Удаляем из файла только если handleChannelError вернула true
          await this.removeChannelFromFile(channel.channelUsername);
        }
        // Если shouldRemoveChannel === false (например POST_SKIPPED) — канал остаётся в очереди
      }

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
      if (!result.results[0]) {
        throw new Error("BUG: results[0] is undefined - комментирование не записало результат");
      }
      if (!result.results[0].error) {
        throw new Error("BUG: error field is empty - ошибка не была записана");
      }
      throw new Error(result.results[0].error);
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
      throw new Error(`ROTATION_FAILED: Ошибка ротации с аккаунта ${currentAccount.name}`);
    }

    const newAccount = rotationResult.newAccount;

    const wasChannelOwner = currentAccount.name === this.targetChannelOwner?.name;

    if (wasChannelOwner) {
      this.log.info("Ротация с передачей владения каналом", {
        from: currentAccount.name,
        to: newAccount.name,
        reason: "comment_limit_reached",
        targetChannel: CONFIG.targetChannel,
      });
      await this.transferChannel(currentAccount, newAccount);
      this.targetChannelOwner = newAccount;

      // Сбрасываем счётчик комментариев нового владельца (предотвращает бесконечный цикл)
      this.accountRotator.resetAccountComments(newAccount.name);
    } else {
      this.log.info("Ротация аккаунта", {
        from: currentAccount.name,
        to: newAccount.name,
        reason: "comment_limit_reached",
        currentComments: currentAccount.commentsCount,
      });
    }

    await this.connectAccount(newAccount);

    // Обновляем информацию о канале с новым accessHash (если была передача)
    if (wasChannelOwner) {
      await this.refreshTargetChannelInfo();
    }
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

    // Сбрасываем счётчик комментариев нового владельца (предотвращает бесконечный цикл)
    this.accountRotator.resetAccountComments(cleanAccount.name);

    await this.connectAccount(cleanAccount);

    // Обновляем информацию о канале с новым accessHash
    await this.refreshTargetChannelInfo();
  }

  /**
   * Обработка FLOOD_WAIT владельца канала
   *
   * Когда текущий владелец канала словил FLOOD_WAIT при комментировании:
   * 1. Добавляет аккаунт в floodWaitAccounts
   * 2. Находит аккаунт без FLOOD_WAIT
   * 3. Передаёт канал новому владельцу
   * 4. Продолжает работу с новым аккаунтом
   */
  private async handleOwnerFloodWait(waitSeconds: number): Promise<void> {
    if (!this.targetChannelOwner) {
      throw new Error("Целевой канал не имеет владельца");
    }

    const currentOwner = this.targetChannelOwner;

    this.log.warn("Обработка FLOOD_WAIT владельца канала", {
      owner: currentOwner.name,
      channel: CONFIG.targetChannel,
      waitSeconds,
    });

    // Добавляем текущий аккаунт в список с FLOOD_WAIT
    this.floodWaitAccounts.add(currentOwner.name);
    this.log.info("Аккаунт добавлен в FLOOD_WAIT список", {
      account: currentOwner.name,
      totalFloodWaitAccounts: this.floodWaitAccounts.size,
    });

    // Ищем аккаунт без FLOOD_WAIT
    const accounts = this.accountRotator.getAllAccounts();
    const availableAccount = await this.findAccountWithoutFloodWait(
      accounts,
      currentOwner,
    );

    if (!availableAccount) {
      this.log.error(
        "Все аккаунты в FLOOD_WAIT",
        new Error("No available accounts"),
        {
          totalAccounts: accounts.length,
          floodWaitAccounts: Array.from(this.floodWaitAccounts),
        },
      );
      throw new Error(
        `Все ${accounts.length} аккаунтов словили FLOOD_WAIT, работа невозможна`,
      );
    }

    this.log.info("Передача канала из-за FLOOD_WAIT владельца", {
      from: currentOwner.name,
      to: availableAccount.name,
      reason: "owner_flood_wait",
      waitSeconds,
    });

    // Передаём канал новому аккаунту
    await this.transferChannel(currentOwner, availableAccount);

    // Обновляем состояние
    this.targetChannelOwner = availableAccount;
    this.accountRotator.setActiveAccount(availableAccount.name);

    // Сбрасываем счётчик комментариев нового владельца (предотвращает бесконечный цикл)
    this.accountRotator.resetAccountComments(availableAccount.name);

    // Подключаемся к новому аккаунту (без проверки спама, т.к. уже в FLOOD_WAIT)
    await this.connectAccount(availableAccount, true);

    // Обновляем информацию о канале с новым accessHash
    await this.refreshTargetChannelInfo();

    this.log.info("Канал успешно передан, продолжаем работу", {
      newOwner: availableAccount.name,
      remainingAccounts: accounts.length - this.floodWaitAccounts.size,
    });
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

    let floodWaitCount = 0;

    for (const account of accounts) {
      if (account.name === exclude.name) continue;

      // Проверяем кэш спама (избегаем повторных проверок)
      if (this.spammedAccounts.has(account.name)) {
        this.log.debug("Аккаунт в спаме (кэш)", { account: account.name });
        continue;
      }

      this.log.debug("Проверка аккаунта на спам", { account: account.name });

      try {
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
          // Добавляем в кэш спама
          this.spammedAccounts.add(account.name);
        }
      } catch (error: any) {
        const errorMsg = error.message || error.toString();

        // Обрабатываем FLOOD_WAIT как non-fatal ошибку
        if (
          errorMsg.includes("FLOOD_WAIT") ||
          errorMsg.includes("FloodWaitError") ||
          error.code === 420
        ) {
          floodWaitCount++;
          const seconds = error.seconds || this.extractSecondsFromError(errorMsg);

          this.log.warn("FLOOD_WAIT при проверке спама, пропускаем аккаунт", {
            account: account.name,
            waitSeconds: seconds,
            floodWaitCount,
          });

          // Если слишком много FLOOD_WAIT, делаем паузу
          if (floodWaitCount >= 3) {
            this.log.warn("Слишком много FLOOD_WAIT, пауза 10 секунд");
            await new Promise((resolve) => setTimeout(resolve, 10000));
            floodWaitCount = 0; // Сбрасываем счётчик
          }

          continue; // Пропускаем этот аккаунт, идём к следующему
        }

        // Для других ошибок логируем и продолжаем
        this.log.warn("Ошибка при проверке аккаунта, пропускаем", {
          account: account.name,
          error: errorMsg,
        });
        continue;
      }
    }

    this.log.warn("Чистый аккаунт не найден", {
      checkedAccounts: accounts.length,
      floodWaitErrors: floodWaitCount,
    });
    return null;
  }

  /**
   * Поиск аккаунта без FLOOD_WAIT для передачи канала
   *
   * В отличие от findCleanAccount(), этот метод:
   * - Проверяет спам-статус аккаунта (критически важно!)
   * - Использует Set floodWaitAccounts для исключения
   * - Возвращает первый чистый аккаунт без FLOOD_WAIT
   */
  private async findAccountWithoutFloodWait(
    accounts: IAccountInfo[],
    currentAccount: IAccountInfo,
  ): Promise<IAccountInfo | null> {
    this.log.debug("Поиск аккаунта без FLOOD_WAIT и спама", {
      totalAccounts: accounts.length,
      currentAccount: currentAccount.name,
      floodWaitAccounts: Array.from(this.floodWaitAccounts),
    });

    for (const account of accounts) {
      // Пропускаем текущий аккаунт
      if (account.name === currentAccount.name) {
        continue;
      }

      // Пропускаем аккаунты с FLOOD_WAIT
      if (this.floodWaitAccounts.has(account.name)) {
        this.log.debug("Аккаунт уже в FLOOD_WAIT, пропускаем", {
          account: account.name,
        });
        continue;
      }

      // Проверяем кэш спама (избегаем повторных проверок)
      if (this.spammedAccounts.has(account.name)) {
        this.log.debug("Аккаунт в спаме (кэш), пропускаем", {
          account: account.name,
        });
        continue;
      }

      // Проверяем спам-статус
      try {
        this.log.debug("Проверка спам-статуса аккаунта", {
          account: account.name,
        });

        await this.connectAccount(account, true);
        const isSpammed = await this.spamChecker.isAccountSpammedReliable(
          this.client.getClient(),
          account.name,
        );

        if (isSpammed) {
          this.log.warn("Аккаунт в спаме, пропускаем", {
            account: account.name,
          });
          // Добавляем в кэш спама
          this.spammedAccounts.add(account.name);
          continue;
        }

        // Найден чистый аккаунт без FLOOD_WAIT и без спама
        this.log.info("Найден чистый аккаунт без FLOOD_WAIT", {
          account: account.name,
        });
        return account;
      } catch (error: any) {
        const errorMsg = error.message || error.toString();

        // Если при проверке спама случился FLOOD_WAIT - добавляем в список
        if (
          errorMsg.includes("FLOOD_WAIT") ||
          errorMsg.includes("FloodWaitError") ||
          error.code === 420
        ) {
          const seconds = error.seconds || this.extractSecondsFromError(errorMsg);
          this.log.warn("FLOOD_WAIT при проверке спама", {
            account: account.name,
            waitSeconds: seconds,
          });

          // Добавляем в список FLOOD_WAIT
          this.floodWaitAccounts.add(account.name);
          continue;
        }

        // Другие ошибки - просто пропускаем аккаунт
        this.log.warn("Ошибка при проверке аккаунта", {
          account: account.name,
          error: errorMsg,
        });
        continue;
      }
    }

    this.log.error(
      "Все аккаунты в FLOOD_WAIT или в спаме",
      new Error("No clean accounts available"),
      {
        totalAccounts: accounts.length,
        floodWaitAccounts: Array.from(this.floodWaitAccounts),
      },
    );
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

    // Задержка перед передачей для защиты от FLOOD_WAIT на channels.EditCreator
    transferLog.info("⏳ Задержка перед передачей канала (защита от rate limit)...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    transferLog.info("Начало передачи канала");

    // Сохраняем оригинальное состояние для отката
    const originalOwner = this.targetChannelOwner;
    const originalActiveAccount = this.accountRotator.getCurrentAccount();

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

      // Используем userId если доступен, иначе username
      const targetIdentifier = to.userId || to.username;
      if (!targetIdentifier) {
        throw new Error(`Ни userId, ни username не найдены для ${to.name}`);
      }

      transferLog.info("Инициализация передачи владения", {
        targetIdentifier: to.userId ? `ID:${to.userId}` : `@${to.username}`,
        useUserId: !!to.userId,
        channelId: this.targetChannelInfo?.id?.toString(),
        hasAccessHash: !!this.targetChannelInfo?.accessHash,
      });
      const service = new ChannelOwnershipRotatorService();
      const result = await service.transferOwnershipAsync({
        sessionString: from.sessionValue,
        channelIdentifier: CONFIG.targetChannel.replace("@", ""),
        targetUserIdentifier: targetIdentifier.replace("@", ""),
        password,
        channelId: this.targetChannelInfo?.id?.toString(),
        channelAccessHash: this.targetChannelInfo?.accessHash?.toString(),
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

      // Обновляем владельца ТОЛЬКО после успешной передачи
      this.targetChannelOwner = to;
      this.accountRotator.setActiveAccount(to.name);

      transferLog.info("State обновлён", {
        newOwner: to.name,
        previousOwner: from.name,
      });
    } catch (error: any) {
      transferLog.error("Критическая ошибка передачи канала", error, {
        duration: Date.now() - startTime,
      });

      // ROLLBACK: Восстанавливаем оригинальное состояние
      this.targetChannelOwner = originalOwner;
      if (originalActiveAccount) {
        this.accountRotator.setActiveAccount(originalActiveAccount.name);
      }

      transferLog.warn("State восстановлен (rollback)", {
        restoredOwner: originalOwner?.name,
        restoredActiveAccount: originalActiveAccount?.name,
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
   * Обработка ошибки канала: классификация и сохранение в нужный файл
   * @returns true если канал нужно удалить из successful
   */
  private handleChannelError(channelUsername: string, errorMsg: string): boolean {
    const cleanUsername = channelUsername.replace("@", "");

    // Глобально недоступен (удалён)
    const globalErrors = ["CHANNEL_INVALID", "USERNAME_INVALID", "USERNAME_NOT_OCCUPIED", "No user has"];
    if (globalErrors.some((e) => errorMsg.includes(e))) {
      this.appendToFile(CONFIG.unavailableFile, cleanUsername, "# Глобально недоступные каналы\n");
      return true;
    }

    // Забанен для нашего канала (или канал не разрешает комментарии от нашего канала)
    const banErrors = ["CHANNEL_BANNED", "USER_BANNED_IN_CHANNEL", "SEND_AS_PEER_INVALID"];
    if (banErrors.some((e) => errorMsg.includes(e))) {
      const file = `${CONFIG.bannedFilePrefix}${CONFIG.targetChannel.replace("@", "")}.txt`;
      this.appendToFile(file, cleanUsername, `# Забанен для @${CONFIG.targetChannel.replace("@", "")}\n`);
      return true;
    }

    // Модерируемые каналы (комментарии удаляются/скрываются)
    const moderatedErrors = ["COMMENT_MODERATED"];
    if (moderatedErrors.some((e) => errorMsg.includes(e))) {
      this.appendToFile(CONFIG.moderatedFile, cleanUsername, "# Каналы с модерацией комментариев\n");
      return true;
    }

    // POST_SKIPPED — канал остаётся в очереди (текущий пост не подходит, но канал доступен)

    return false; // Временная ошибка или POST_SKIPPED — не сохраняем
  }

  /**
   * Добавить канал в файл (с проверкой дубликатов)
   */
  private appendToFile(filePath: string, username: string, header: string): void {
    try {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, header, "utf-8");
      }
      const content = fs.readFileSync(filePath, "utf-8");
      if (!content.includes(username)) {
        fs.appendFileSync(filePath, `@${username}\n`, "utf-8");
        this.log.info("Канал добавлен в список", { channel: username, file: filePath });
      }
    } catch (error) {
      this.log.warn("Ошибка записи в файл", { file: filePath, error: (error as Error).message });
    }
  }

  /**
   * Удалить канал из successful-channels.txt
   */
  private removeFromSuccessful(channelUsername: string): void {
    try {
      if (!fs.existsSync(CONFIG.successfulFile)) return;
      const cleanUsername = channelUsername.replace("@", "");
      const content = fs.readFileSync(CONFIG.successfulFile, "utf-8");
      const filtered = content.split("\n").filter((line) => line.trim().replace("@", "") !== cleanUsername);
      fs.writeFileSync(CONFIG.successfulFile, filtered.join("\n"), "utf-8");
    } catch (error) {
      this.log.warn("Ошибка удаления из successful", { channel: channelUsername, error: (error as Error).message });
    }
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
   * Очистка ресурсов - закрытие всех клиентов
   */
  private async cleanup(): Promise<void> {
    this.log.info("Начало cleanup", {
      totalClients: this.activeClients.length,
    });

    // Закрываем все активные клиенты параллельно
    const disconnectPromises = this.activeClients.map(async (client, index) => {
      try {
        this.log.debug(`Отключение клиента ${index + 1}/${this.activeClients.length}`);
        await this.disconnectClient(client);
      } catch (error) {
        this.log.warn(`Ошибка отключения клиента ${index + 1}`, { error });
      }
    });

    await Promise.allSettled(disconnectPromises);

    this.activeClients = [];
    this.log.info("Cleanup завершён", { closedClients: disconnectPromises.length });
  }
}

// Запуск
async function main() {
  const commenter = new SimpleAutoCommenter();

  // Graceful shutdown при Ctrl+C или SIGTERM
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Получен сигнал ${signal}, graceful shutdown...`);
    try {
      await (commenter as any).cleanup();
      console.log("✅ Cleanup завершён");
      process.exit(0);
    } catch (error) {
      console.error("❌ Ошибка при cleanup:", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await commenter.start();
}

main().catch((error) => {
  console.error("💥 Критическая ошибка:", error);
  process.exit(1);
});
