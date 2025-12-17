/**
 * Автокомментатор от профиля с ротацией
 * Комментирует от имени личного профиля (не от канала)
 *
 * npm run comment:profile
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
import { EnvAccountsParser } from "../../shared/utils/envAccountsParser";
import * as fs from "fs";
import { randomUUID } from "crypto";
import { Api } from "telegram";

// Конфигурация
const CONFIG = {
  profileDisplayName: process.env.PROFILE_DISPLAY_NAME || "Джун на фронте | IT Dev Log", // Отображаемое имя профиля для проверки дубликатов
  commentsPerAccount: Number(process.env.MAX_COMMENTS_PER_ACCOUNT) || 100, // Ротация каждые 100 комментариев (защита от shadowban)
  delayBetweenComments: 3000, // Задержка между комментариями (мс)
  maxFloodWaitSeconds: 600, // 10 минут максимум для ожидания FLOOD_WAIT (если больше → краш)
  channelsFile: "./input-channels/profile-channels/channels.txt",
  successfulFile: "./input-channels/profile-channels/successful-channels.txt",
  unavailableFile: "./input-channels/profile-channels/unavailable-channels.txt",
  bannedFilePrefix: "./input-channels/profile-channels/banned-for-",
  moderatedFile: "./input-channels/profile-channels/moderated-channels.txt",
  subscriptionRequiredFile: "./input-channels/profile-channels/subscription-required-channels.txt",
  aiEnabled: !!process.env.DEEPSEEK_API_KEY,
  operationTimeoutMs: 60000, // 60 секунд максимум на одну операцию
};

/**
 * Обёртка для добавления таймаута к Promise
 */
async function withTimeout<T>(
  _promise: Promise<T>,
  _timeoutMs: number,
  _errorMessage: string,
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(_errorMessage)), _timeoutMs);
  });

  return Promise.race([_promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
 * Класс автокомментирования от профиля
 */
class ProfileAutoCommenter {
  private client!: GramClient;
  private commentPoster!: CommentPosterService;
  private accountRotator: AccountRotatorService;
  private aiGenerator: AICommentGeneratorService;
  private spamChecker: SpamChecker;
  private log: ReturnType<typeof createLogger>;
  private sessionId: string;

  private activeClients: GramClient[] = [];
  private spammedAccounts: Set<string> = new Set();
  private consecutiveNoUserErrors: number = 0;

  constructor() {
    this.sessionId = randomUUID();
    this.log = createLogger("AutoCommentProfile", { sessionId: this.sessionId });

    // Инициализация ротатора с профильными аккаунтами
    const parser = new EnvAccountsParser();
    const profileAccounts = parser.getAvailableAccounts('PROFILE');

    if (profileAccounts.length === 0) {
      throw new Error('Не найдено ни одного профильного аккаунта (SESSION_STRING_PROFILE_*)');
    }

    this.accountRotator = new AccountRotatorService({
      maxCommentsPerAccount: CONFIG.commentsPerAccount,
      delayBetweenRotations: 5,
      saveProgress: false,
    });

    // Переинициализируем аккаунты ротатора с профильными аккаунтами
    (this.accountRotator as any).accounts = profileAccounts.map((account, index) => ({
      sessionKey: account.sessionKey,
      sessionValue: account.sessionValue || '',
      name: account.name,
      username: account.username ? account.username.replace('@', '') : undefined,
      userId: account.username, // Для профильных аккаунтов используем username
      password: account.password,
      commentsCount: 0,
      isActive: index === 0,
      lastUsed: undefined,
      maxCommentsPerSession: CONFIG.commentsPerAccount
    }));

    (this.accountRotator as any).rotationState.totalAccounts = profileAccounts.length;

    this.aiGenerator = new AICommentGeneratorService({
      apiKey: process.env.DEEPSEEK_API_KEY || "",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      enabled: CONFIG.aiEnabled,
    });

    this.spamChecker = new SpamChecker();

    this.log.info("Автокомментатор от профиля инициализирован", {
      accountsCount: this.accountRotator.getAllAccounts().length,
      commentLimit: CONFIG.commentsPerAccount,
      aiEnabled: CONFIG.aiEnabled,
      profileDisplayName: CONFIG.profileDisplayName,
    });
  }

  /**
   * Главный метод запуска
   */
  async start(): Promise<void> {
    const startTime = Date.now();
    this.log.operationStart("ProfileCommentingSession", {
      profileDisplayName: CONFIG.profileDisplayName,
      commentLimit: CONFIG.commentsPerAccount,
    });

    try {
      const channels = await this.loadChannels();
      this.log.info("Каналы загружены", {
        totalChannels: channels.length,
        source: CONFIG.channelsFile,
      });

      // Подключаем первый аккаунт
      const firstAccount = this.accountRotator.getCurrentAccount();
      await this.connectAccount(firstAccount);

      await this.processChannels(channels);

      this.log.operationEnd("ProfileCommentingSession", startTime, {
        status: "completed",
      });
    } catch (error: any) {
      this.log.error("Критическая ошибка в сессии", error, {
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
      try {
        const index = this.activeClients.indexOf(this.client);
        if (index > -1) {
          this.activeClients.splice(index, 1);
        }
        await this.disconnectClient(this.client);
      } catch (error) {
        this.log.warn("Ошибка отключения старого клиента", { error });
      }
    }

    // Подключаем новый
    process.env.SESSION_STRING = account.sessionValue;
    this.client = new GramClient();
    await this.client.connect();

    this.activeClients.push(this.client);
    this.commentPoster = new CommentPosterService(this.client.getClient());

    // Проверка спама
    if (!skipSpamCheck) {
      const isSpammed = await this.spamChecker.isAccountSpammedReliable(
        this.client.getClient(),
        account.name,
      );

      if (isSpammed) {
        this.spammedAccounts.add(account.name);
        this.log.error("Аккаунт в спаме", new Error("Account spammed"), {
          account: account.name,
        });
        throw new Error(`Аккаунт ${account.name} в спаме`);
      }
    }

    this.log.info("Аккаунт подключен", { account: account.name });
  }

  /**
   * Отключение клиента с таймаутом
   */
  private async disconnectClient(client: GramClient): Promise<void> {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.log.warn("Disconnect timeout, форсируем завершение");
        resolve();
      }, 3000);

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
        // Проверяем, все ли аккаунты достигли лимита
        if (this.accountRotator.isFullCycleComplete()) {
          this.log.info("🎯 Все аккаунты достигли лимита комментариев");

          // Выводим итоговую статистику
          const summary = this.accountRotator.getRotationSummary();
          const accountsStats = this.accountRotator.getAccountsDetailedStats();

          this.log.info("📊 ИТОГОВАЯ СТАТИСТИКА:");
          this.log.info(`   ✅ Всего комментариев: ${summary.totalCommentsPosted}`);
          this.log.info(`   👥 Использовано аккаунтов: ${summary.totalAccountsUsed}/${this.accountRotator.getAllAccounts().length}`);
          this.log.info(`   🔄 Количество ротаций: ${summary.totalRotations}`);
          this.log.info(`   ⏱️ Длительность сессии: ${Math.round(summary.sessionDuration / 1000 / 60)} минут`);

          this.log.info("\n📋 СТАТУС АККАУНТОВ:");
          accountsStats.forEach(stat => {
            this.log.info(`   ${stat.account.name}: ${stat.account.commentsCount}/${stat.account.maxCommentsPerSession} (${Math.round(stat.percentage)}%)`);
          });

          this.log.info("\n🛑 Останавливаю скрипт: все доступные аккаунты исчерпаны");
          this.log.info("💡 Подождите несколько часов перед следующим запуском");

          // Останавливаем обработку
          break;
        }

        await this.rotateToNextAccount();
      }

      const currentAccount = this.accountRotator.getCurrentAccount();
      this.accountRotator.incrementCommentCount();

      const startTime = Date.now();

      try {
        const result = await this.commentChannel(channel);

        await this.saveSuccessfulChannel(channel.channelUsername);
        await this.removeChannelFromFile(channel.channelUsername);

        channelLog.info("✅ Комментарий добавлен", {
          account: currentAccount.name,
          commentsCount: currentAccount.commentsCount,
          maxComments: currentAccount.maxCommentsPerSession,
          comment: result.substring(0, 50) + "...",
          duration: Date.now() - startTime,
        });

        // Сбрасываем счётчик при успешном комментарии
        this.consecutiveNoUserErrors = 0;
      } catch (error: any) {
        const errorMsg = error.message || error.toString();

        // SHADOWBAN обработка
        if (errorMsg.includes("SHADOWBAN_DETECTED")) {
          channelLog.warn("🔄 Shadowban детектирован, переключаюсь на следующий аккаунт...", {
            account: currentAccount.name,
          });

          // Ротация на следующий аккаунт
          await this.rotateToNextAccount();

          // Повторяем попытку с новым аккаунтом
          i--; // Вернёмся к этому каналу с новым аккаунтом
          continue;
        }

        // FLOOD_WAIT обработка
        if (
          errorMsg.includes("FLOOD_WAIT") ||
          errorMsg.includes("FloodWaitError") ||
          error.code === 420
        ) {
          const seconds = error.seconds || this.extractSecondsFromError(errorMsg);

          channelLog.warn("⏳ FLOOD_WAIT обнаружен, ротация аккаунта", {
            account: currentAccount.name,
            waitSeconds: seconds,
            action: "rotating_account",
          });

          // Простая ротация при FLOOD_WAIT (MVP подход)
          await this.rotateToNextAccount(seconds);

          // Повторяем попытку с новым аккаунтом
          i--; // Вернёмся к этому каналу с новым аккаунтом
          continue;
        }

        channelLog.warn("Ошибка при комментировании", {
          account: currentAccount.name,
          commentsCount: currentAccount.commentsCount,
          maxComments: currentAccount.maxCommentsPerSession,
          error: this.simplifyError(errorMsg),
          errorCode: error.code,
          duration: Date.now() - startTime,
        });

        // Классификация и сохранение ошибки канала
        try {
          const shouldRemoveChannel = await this.handleChannelError(channel.channelUsername, errorMsg);
          if (shouldRemoveChannel) {
            this.removeFromSuccessful(channel.channelUsername);
            await this.removeChannelFromFile(channel.channelUsername);
          }
        } catch (shadowbanError: any) {
          // Обрабатываем SHADOWBAN_DETECTED если handleChannelError() его выбросил
          const shadowbanMsg = shadowbanError.message || shadowbanError.toString();

          if (shadowbanMsg.includes("SHADOWBAN_DETECTED")) {
            channelLog.warn("🔄 Shadowban детектирован в handleChannelError, переключаюсь на следующий аккаунт...", {
              account: currentAccount.name,
            });

            // Ротация на следующий аккаунт
            await this.rotateToNextAccount();

            // Повторяем попытку с новым аккаунтом
            i--;
            continue;
          }

          // Если это не SHADOWBAN_DETECTED, пробрасываем ошибку дальше
          throw shadowbanError;
        }
      }

      // Задержка
      await new Promise((resolve) =>
        setTimeout(resolve, CONFIG.delayBetweenComments),
      );
    }
  }

  /**
   * Комментирование одного канала с проверкой дубликатов по display name
   */
  private async commentChannel(channel: ICommentTarget): Promise<string> {
    // Проверяем существующие комментарии по display name
    const hasExisting = await this.checkExistingCommentByDisplayName(
      channel.channelUsername,
      CONFIG.profileDisplayName,
    );

    if (hasExisting) {
      await this.saveSuccessfulChannel(channel.channelUsername);
      return "Уже есть комментарий от этого профиля/канала";
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
        useChannelAsSender: false, // ⚠️ ВАЖНО: Комментируем от ПРОФИЛЯ, не от канала
        selectedChannelId: undefined,
        selectedChannelTitle: undefined,
      },
    };

    const result = await withTimeout(
      this.commentPoster.postCommentsWithAIAsync(options),
      CONFIG.operationTimeoutMs,
      "OPERATION_TIMEOUT: Превышено время ожидания комментария (60 сек)",
    );

    if (result.successfulComments === 0) {
      if (!result.results[0]) {
        throw new Error("BUG: results[0] is undefined");
      }
      if (!result.results[0].error) {
        throw new Error("BUG: error field is empty");
      }
      throw new Error(result.results[0].error);
    }

    return result.results[0]?.commentText || "";
  }

  /**
   * Проверка существующих комментариев по display name
   *
   * Проверяет комментарии как от канала (title), так и от профиля (firstName + lastName)
   * Если найден комментарий с display name "Джун на фронте | IT Dev Log" — возвращает true
   */
  private async checkExistingCommentByDisplayName(
    channelUsername: string,
    displayName: string,
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
            limit: 100, // Проверяем до 100 комментариев
          });

        if (discussion && discussion.length > 0) {
          // Проверяем каждый комментарий
          for (const comment of discussion) {
            if (!comment.sender) continue;

            // Проверка 1: Комментарий от канала — сравниваем title
            if (comment.sender instanceof Api.Channel) {
              const channelTitle = (comment.sender as Api.Channel).title;
              if (channelTitle === displayName) {
                this.log.info("Найден комментарий от канала с таким же именем", {
                  channel: channelUsername,
                  displayName,
                  channelTitle,
                });
                return true;
              }
            }

            // Проверка 2: Комментарий от профиля — сравниваем firstName + lastName
            if (comment.sender instanceof Api.User) {
              const user = comment.sender as Api.User;
              const fullName = [user.firstName, user.lastName]
                .filter(Boolean)
                .join(' ');

              if (fullName === displayName) {
                this.log.info("Найден комментарий от профиля с таким же именем", {
                  channel: channelUsername,
                  displayName,
                  profileName: fullName,
                });
                return true;
              }
            }
          }
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
   * Ротация на следующий аккаунт (упрощённая версия без передачи канала)
   * Автоматически пропускает аккаунты в спаме
   * @param floodWaitSeconds - время ожидания при FLOOD_WAIT
   */
  private async rotateToNextAccount(floodWaitSeconds?: number): Promise<void> {
    const currentAccount = this.accountRotator.getCurrentAccount();

    // Пытаемся найти чистый аккаунт (максимум 10 попыток для безопасности)
    const maxAttempts = 10;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;

      const rotationResult = await this.accountRotator.rotateToNextAccount();

      if (!rotationResult.success) {
        // Только 1 аккаунт доступен
        if (rotationResult.reason === 'Только один аккаунт доступен для ротации') {
          const waitTime = floodWaitSeconds || 60;

          if (waitTime > CONFIG.maxFloodWaitSeconds) {
            const errorMsg =
              `FLOOD_WAIT_TOO_LONG: Аккаунт ${currentAccount.name} заблокирован на ${Math.round(waitTime / 60)} минут. ` +
              `Максимально допустимое ожидание: ${CONFIG.maxFloodWaitSeconds / 60} минут.`;
            this.log.error(errorMsg, new Error(errorMsg), {
              waitSeconds: waitTime,
              maxAllowedSeconds: CONFIG.maxFloodWaitSeconds,
            });
            throw new Error(errorMsg);
          }

          // Ожидание
          this.log.warn(`⏳ Только 1 аккаунт, ожидание ${waitTime} секунд...`, {
            account: currentAccount.name,
            waitSeconds: waitTime,
          });

          await new Promise(resolve => setTimeout(resolve, waitTime * 1000));

          this.log.info("✅ Ожидание завершено, продолжаем с тем же аккаунтом", {
            account: currentAccount.name,
          });

          return;
        }

        // Другая ошибка
        this.log.error("Ошибка ротации аккаунта", new Error("Rotation failed"), {
          currentAccount: currentAccount.name,
          reason: rotationResult.reason,
        });
        throw new Error(`ROTATION_FAILED: ${rotationResult.reason}`);
      }

      const newAccount = rotationResult.newAccount;

      try {
        // Пытаемся подключить новый аккаунт
        await this.connectAccount(newAccount);

        // Успешное подключение
        this.log.info("Ротация профильного аккаунта", {
          from: currentAccount.name,
          to: newAccount.name,
          reason: "comment_limit_or_flood_wait",
          attempt: attempt,
        });

        return; // ✅ Успех, выходим из цикла

      } catch (error) {
        const errorMsg = (error as Error).message;

        // Если аккаунт в спаме → пробуем следующий
        if (errorMsg.includes("Account spammed") || errorMsg.includes("Аккаунт в спаме")) {
          this.log.warn(`⚠️ Аккаунт ${newAccount.name} в спаме, пробую следующий (попытка ${attempt}/${maxAttempts})...`, {
            spammedAccount: newAccount.name,
            attempt: attempt,
          });

          // Проверяем, есть ли ещё аккаунты
          const totalAccounts = this.accountRotator.getAllAccounts().length;
          if (attempt >= totalAccounts) {
            // Прошли все аккаунты - все в спаме
            this.log.error("Все аккаунты в спаме", new Error("All accounts spammed"), {
              totalAccounts: totalAccounts,
              attempts: attempt,
            });
            throw new Error(`ALL_ACCOUNTS_SPAMMED: Все ${totalAccounts} аккаунтов в спаме`);
          }

          // Продолжаем цикл → пробуем следующий аккаунт
          continue;
        }

        // Другая ошибка → крашимся
        this.log.error("Ошибка подключения аккаунта", error as Error, {
          account: newAccount.name,
        });
        throw error;
      }
    }

    // Достигли максимума попыток (защита от бесконечного цикла)
    throw new Error(`ROTATION_FAILED: Не удалось найти чистый аккаунт за ${maxAttempts} попыток`);
  }

  /**
   * Обработка ошибок канала
   */
  private async handleChannelError(channelUsername: string, errorMsg: string): Promise<boolean> {
    const unavailableFile = CONFIG.unavailableFile;
    const subscriptionRequiredFile = CONFIG.subscriptionRequiredFile;

    // MSG_ID_INVALID — канал без комментируемых постов (постоянная проблема)
    if (errorMsg.includes('MSG_ID_INVALID') || errorMsg.includes('Неверный ID сообщения')) {
      this.moveChannelToFile(channelUsername, unavailableFile);
      return true;
    }

    // SEND_AS_REQUIRED — требуется комментирование от канала (не от профиля)
    if (errorMsg.includes('SEND_AS_REQUIRED')) {
      const channelOnlyFile = './input-channels/profile-channels/channel-only-comments.txt';
      this.moveChannelToFile(channelUsername, channelOnlyFile);
      return true;
    }

    // CHAT_ADMIN_REQUIRED — только админы могут комментировать
    if (errorMsg.includes('CHAT_ADMIN_REQUIRED')) {
      const adminOnlyFile = './input-channels/profile-channels/admin-only-channels.txt';
      this.moveChannelToFile(channelUsername, adminOnlyFile);
      return true;
    }

    // Канал заблокировал комментарии
    if (
      errorMsg.includes("CHAT_WRITE_FORBIDDEN") ||
      errorMsg.includes("комментарии запрещены")
    ) {
      this.moveChannelToFile(channelUsername, unavailableFile);
      return true;
    }

    // Модерация комментариев
    if (
      errorMsg.includes("CHAT_GUEST_SEND_FORBIDDEN") ||
      errorMsg.includes("требуется подписка")
    ) {
      this.moveChannelToFile(channelUsername, subscriptionRequiredFile);
      return true;
    }

    // Аккаунт забанен в канале
    if (errorMsg.includes("USER_BANNED_IN_CHANNEL")) {
      const bannedFile = `${CONFIG.bannedFilePrefix}${this.accountRotator.getCurrentAccount().name}.txt`;
      this.moveChannelToFile(channelUsername, bannedFile);
      return true;
    }

    // POST_SKIPPED — пост слишком короткий или неинформативный
    // Сохраняем в отдельный файл для последующей работы
    if (errorMsg.includes("POST_SKIPPED") || errorMsg.includes("Пост пропущен")) {
      const shortPostFile = './input-channels/profile-channels/short-posts.txt';
      this.moveChannelToFile(channelUsername, shortPostFile);
      this.log.info("📝 Короткий пост, канал перемещён для будущей работы", {
        channel: channelUsername,
        file: shortPostFile
      });
      return true; // Удаляем из очереди
    }

    // Канал не существует или изменил username (ДЕТЕКТ SHADOWBAN!)
    if (errorMsg.includes("No user has") || errorMsg.includes("as username")) {
      this.consecutiveNoUserErrors++;

      this.log.warn(`⚠️ Канал не найден`, {
        channel: channelUsername,
        consecutiveErrors: this.consecutiveNoUserErrors,
      });

      // Если 3 подряд ошибок "No user" → ПРОВЕРЯЕМ через @SpamBot
      if (this.consecutiveNoUserErrors >= 3) {
        this.log.warn(
          "⚠️ 3 подряд ошибок 'No user' - проверяю через @SpamBot...",
          {
            account: this.accountRotator.getCurrentAccount().name,
            consecutiveNoUserErrors: this.consecutiveNoUserErrors,
          }
        );

        // ПРОВЕРКА через @SpamBot для точного диагноза
        const isSpammed = await this.spamChecker.isAccountSpammedReliable(
          this.client.getClient(),
          this.accountRotator.getCurrentAccount().name
        );

        if (isSpammed) {
          // ТОЧНО SHADOWBAN - аккаунт в спаме
          this.log.error(
            "🚫 SHADOWBAN ПОДТВЕРЖДЁН через @SpamBot!",
            new Error("Shadowban confirmed"),
            {
              account: this.accountRotator.getCurrentAccount().name,
              consecutiveNoUserErrors: this.consecutiveNoUserErrors,
            }
          );

          // Сбрасываем счётчик для следующего аккаунта
          this.consecutiveNoUserErrors = 0;

          // Триггерим ротацию аккаунта
          throw new Error(
            `SHADOWBAN_DETECTED: Аккаунт ${this.accountRotator.getCurrentAccount().name} в спаме (подтверждено через @SpamBot)`
          );
        } else {
          // НЕ shadowban - просто несуществующие каналы
          this.log.info(
            "✅ Аккаунт чистый (проверено через @SpamBot) - это просто несуществующие каналы",
            {
              account: this.accountRotator.getCurrentAccount().name,
            }
          );

          // Сбрасываем счётчик и продолжаем работу
          this.consecutiveNoUserErrors = 0;
        }
      }

      const notFoundFile = './input-channels/profile-channels/not-found-channels.txt';
      this.moveChannelToFile(channelUsername, notFoundFile);
      return true; // Удаляем из очереди
    }

    // Сбрасываем счётчик при любой другой ошибке (не shadowban)
    this.consecutiveNoUserErrors = 0;

    // Неизвестные ошибки — не удаляем
    return false;
  }

  /**
   * Перемещение канала в файл ошибок
   */
  private moveChannelToFile(channelUsername: string, targetFile: string): void {
    try {
      let content = "";
      if (fs.existsSync(targetFile)) {
        content = fs.readFileSync(targetFile, "utf-8");
      }

      if (!content.includes(channelUsername)) {
        fs.appendFileSync(targetFile, `${channelUsername}\n`, "utf-8");
        this.log.debug("Канал добавлен в файл", {
          channel: channelUsername,
          file: targetFile,
        });
      }
    } catch (error) {
      this.log.warn("Ошибка при перемещении канала", {
        channel: channelUsername,
        file: targetFile,
        error,
      });
    }
  }

  /**
   * Сохранение успешного канала
   */
  private async saveSuccessfulChannel(channelUsername: string): Promise<void> {
    try {
      let content = "";
      if (fs.existsSync(CONFIG.successfulFile)) {
        content = fs.readFileSync(CONFIG.successfulFile, "utf-8");
      }

      if (!content.includes(channelUsername)) {
        fs.appendFileSync(CONFIG.successfulFile, `${channelUsername}\n`, "utf-8");
      }
    } catch (error) {
      this.log.warn("Ошибка сохранения успешного канала", { error });
    }
  }

  /**
   * Удаление канала из successful файла
   */
  private removeFromSuccessful(channelUsername: string): void {
    try {
      if (!fs.existsSync(CONFIG.successfulFile)) return;

      const content = fs.readFileSync(CONFIG.successfulFile, "utf-8");
      const lines = content.split("\n").filter((line) => {
        const cleaned = line.trim().replace("@", "");
        return cleaned && cleaned !== channelUsername.replace("@", "");
      });

      fs.writeFileSync(CONFIG.successfulFile, lines.join("\n") + "\n", "utf-8");
    } catch (error) {
      this.log.warn("Ошибка удаления из successful", { error });
    }
  }

  /**
   * Удаление канала из исходного файла
   */
  private async removeChannelFromFile(channelUsername: string): Promise<void> {
    try {
      if (!fs.existsSync(CONFIG.channelsFile)) return;

      const content = fs.readFileSync(CONFIG.channelsFile, "utf-8");
      const lines = content.split("\n").filter((line) => {
        const cleaned = line.trim().replace("@", "");
        return cleaned && cleaned !== channelUsername.replace("@", "");
      });

      fs.writeFileSync(CONFIG.channelsFile, lines.join("\n") + "\n", "utf-8");
    } catch (error) {
      this.log.warn("Ошибка удаления канала из файла", { error });
    }
  }

  /**
   * Извлечение секунд из FLOOD_WAIT ошибки
   */
  private extractSecondsFromError(errorMsg: string): number {
    const match = errorMsg.match(/FLOOD_WAIT_(\d+)/);
    return match ? parseInt(match[1], 10) : 60;
  }

  /**
   * Упрощение текста ошибки для логов
   */
  private simplifyError(errorMsg: string): string {
    if (errorMsg.includes("CHAT_WRITE_FORBIDDEN")) return "Комментарии запрещены";
    if (errorMsg.includes("CHAT_GUEST_SEND_FORBIDDEN")) return "Требуется подписка";
    if (errorMsg.includes("USER_BANNED_IN_CHANNEL")) return "Аккаунт забанен";
    if (errorMsg.includes("MSG_ID_INVALID")) return "Неверный ID сообщения";
    if (errorMsg.includes("SEND_AS_REQUIRED")) return "Требуется комментирование от канала";
    if (errorMsg.includes("CHAT_ADMIN_REQUIRED")) return "Только админы могут комментировать";
    if (errorMsg.includes("FLOOD_WAIT")) return "FLOOD_WAIT";
    if (errorMsg.includes("POST_SKIPPED")) return "Пост пропущен";
    return errorMsg.substring(0, 100);
  }

  /**
   * Cleanup перед выходом
   */
  private async cleanup(): Promise<void> {
    this.log.info("Cleanup: Отключение всех клиентов", {
      totalClients: this.activeClients.length,
    });

    for (const client of this.activeClients) {
      try {
        await this.disconnectClient(client);
      } catch (error) {
        this.log.warn("Ошибка при cleanup клиента", { error });
      }
    }

    this.activeClients = [];
  }
}

// Запуск
const commenter = new ProfileAutoCommenter();
commenter.start().catch((error) => {
  console.error("Фатальная ошибка:", error);
  process.exit(1);
});
