/**
 * Простой автокомментатор с ротацией
 * Минимальный код, максимальная ясность
 *
 * npm run comment:simple-rotation
 */

import * as dotenv from "dotenv";
dotenv.config();

import { GramClient } from "../../../telegram/adapters/gramClient";
import {
  CommentPosterService,
  ICommentTarget,
  ICommentingOptionsWithAI,
} from "../../commentPoster";
import { AICommentGeneratorService } from "../../aiCommentGenerator";
import { AccountRotatorService } from "../../accountRotator/services/accountRotatorService";
import { IAccountInfo } from "../../accountRotator/interfaces/IAccountRotator";
import { SpamChecker } from "../../../shared/services/spamChecker";
import { createLogger } from "../../../shared/utils/logger";
import { CommentsRepository, SessionsRepository, TargetChannelsRepository, AccountFloodWaitRepository } from "../../../shared/database";
import { ReporterService, IReportStats, IAccountStats } from "../../reporter";
import { randomUUID } from "crypto";
import { Api } from "telegram";

// Конфигурация
const CONFIG = {
  targetChannel: process.env.TARGET_CHANNEL || "",
  commentsPerAccount: 200,
  delayBetweenComments: 3000,
  batchSize: 500, // Сколько каналов загружать из БД за раз
  aiEnabled: !!process.env.DEEPSEEK_API_KEY,
  operationTimeoutMs: 60000,
};

/**
 * Обёртка для добавления таймаута к Promise
 * Предотвращает зависание скрипта при потере соединения
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
  // Map: имя аккаунта -> время разблокировки (Date)
  private floodWaitAccounts: Map<string, Date> = new Map();

  // Кэш спам-статуса аккаунтов (чтобы не проверять повторно)
  private spammedAccounts: Set<string> = new Set();

  // Флаг для предотвращения двойной отправки отчёта
  private reportSent: boolean = false;

  // Database и Reporter
  private commentsRepo: CommentsRepository;
  private sessionsRepo: SessionsRepository;
  private targetChannelsRepo: TargetChannelsRepository;
  private floodWaitRepo: AccountFloodWaitRepository;
  private reporter: ReporterService;

  // Статистика сессии
  private initialSuccessfulCount: number = 0;
  private successfulCount: number = 0;
  private failedCount: number = 0;
  private usedAccounts: Set<string> = new Set();
  private sessionStartTime: number = 0; // Время начала сессии (для отчёта при Ctrl+C)

  // Heartbeat интервал
  private heartbeatInterval: NodeJS.Timeout | null = null;

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

    // Фильтруем специализированные аккаунты:
    // - SESSION_STRING_PROFILE_* используются только в comment:profile
    // - SESSION_STRING_USA_* используются только в comment:usa
    const allAccounts = this.accountRotator.getAllAccounts();
    const mainAccounts = allAccounts.filter(account =>
      !account.sessionKey.startsWith('SESSION_STRING_PROFILE_') &&
      !account.sessionKey.startsWith('SESSION_STRING_USA_')
    );

    if (mainAccounts.length === 0) {
      throw new Error('Не найдено ни одного основного аккаунта. PROFILE и USA аккаунты используются в отдельных скриптах');
    }

    // Переинициализируем список аккаунтов (только основные)
    (this.accountRotator as any).accounts = mainAccounts.map((account: any, index: number) => ({
      ...account,
      isActive: index === 0,
      commentsCount: 0
    }));
    (this.accountRotator as any).rotationState.totalAccounts = mainAccounts.length;
    (this.accountRotator as any).currentAccountIndex = 0;

    this.aiGenerator = new AICommentGeneratorService({
      apiKey: process.env.DEEPSEEK_API_KEY || "",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      enabled: CONFIG.aiEnabled,
    });

    this.spamChecker = new SpamChecker();

    // Инициализация базы данных и reporter
    this.commentsRepo = new CommentsRepository();
    this.sessionsRepo = new SessionsRepository();
    this.targetChannelsRepo = new TargetChannelsRepository();
    this.floodWaitRepo = new AccountFloodWaitRepository();
    this.reporter = new ReporterService();

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
    this.sessionStartTime = startTime; // Сохраняем для использования при Ctrl+C
    this.log.operationStart("CommentingSession", {
      targetChannel: CONFIG.targetChannel,
      commentLimit: CONFIG.commentsPerAccount,
    });

    try {
      // Считаем начальное количество успешных каналов
      this.initialSuccessfulCount = await this.countSuccessfulChannels();
      this.log.info("Начальное количество успешных каналов", {
        count: this.initialSuccessfulCount,
      });

      // Создаём сессию в БД
      await this.sessionsRepo.start(this.sessionId, CONFIG.targetChannel);
      this.log.info("Сессия создана в БД", { sessionId: this.sessionId });

      // Загрузить активные FLOOD_WAIT из БД (персистентность между перезапусками)
      const activeFloodWaits = await this.floodWaitRepo.getActiveFloodWaits();
      for (const fw of activeFloodWaits) {
        this.floodWaitAccounts.set(fw.accountName, fw.unlockAt);
      }
      if (activeFloodWaits.length > 0) {
        this.log.info("Загружены активные FLOOD_WAIT из БД", {
          count: activeFloodWaits.length,
          accounts: activeFloodWaits.map(fw => fw.accountName),
        });
      }

      // Запускаем heartbeat
      this.startHeartbeat();

      await this.findTargetChannel();

      if (!this.targetChannelOwner || !this.targetChannelInfo) {
        throw new Error(`Канал ${CONFIG.targetChannel} не найден`);
      }

      // Цикл по батчам каналов
      let batchNumber = 0;
      while (true) {
        batchNumber++;
        const channels = await this.loadChannels();

        // Если каналов больше нет — выходим
        if (channels.length === 0) {
          this.log.info("Все каналы обработаны, завершаем сессию");
          break;
        }

        this.log.info(`Батч #${batchNumber}: загружено ${channels.length} каналов`, {
          batchNumber,
          totalChannels: channels.length,
          source: "PostgreSQL (target_channels)",
        });

        await this.processChannels(channels);

        // Проверяем есть ли ещё доступные аккаунты
        if (!this.hasAvailableAccounts()) {
          this.log.info("Нет доступных аккаунтов для продолжения, завершаем сессию");
          break;
        }

        this.log.info("Загружаем следующий батч каналов...");
      }

      // Отправляем отчёт
      await this.sendFinalReport(startTime);

      this.log.operationEnd("CommentingSession", startTime, {
        status: "completed",
      });
    } catch (error: any) {
      this.log.error("Критическая ошибка в сессии", error, {
        targetChannel: CONFIG.targetChannel,
        currentAccount: this.accountRotator.getCurrentAccount()?.name,
      });

      // Пытаемся отправить отчёт даже при ошибке
      try {
        await this.sendFinalReport(startTime);
      } catch {
        this.log.warn("Не удалось отправить отчёт при ошибке");
      }

      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Считает количество успешных каналов (status='done') из БД
   */
  private async countSuccessfulChannels(): Promise<number> {
    const stats = await this.targetChannelsRepo.getStats();
    return stats.done;
  }

  /**
   * Отправляет финальный отчёт
   */
  private async sendFinalReport(startTime: number): Promise<void> {
    // Предотвращаем двойную отправку
    if (this.reportSent) {
      this.log.debug("Отчёт уже был отправлен, пропускаем");
      return;
    }

    const finishedAt = new Date();
    const durationMinutes = Math.round((Date.now() - startTime) / 1000 / 60);
    const newChannelsCount = (await this.countSuccessfulChannels()) - this.initialSuccessfulCount;
    const total = this.successfulCount + this.failedCount;
    const successRate = total > 0 ? Math.round((this.successfulCount / total) * 100) : 0;

    // Собираем статистику аккаунтов
    const allAccounts = this.accountRotator.getAllAccounts();
    const accountStats: IAccountStats[] = allAccounts
      .filter(acc => this.usedAccounts.has(acc.name))
      .map(acc => ({
        name: acc.name,
        commentsCount: acc.commentsCount,
        maxComments: acc.maxCommentsPerSession,
        isCurrentOwner: acc.name === this.targetChannelOwner?.name,
      }));

    // Финализируем сессию в БД
    await this.sessionsRepo.finish(this.sessionId, {
      successfulCount: this.successfulCount,
      failedCount: this.failedCount,
      newChannelsCount,
      accountsUsed: Array.from(this.usedAccounts),
    });

    // Подготавливаем информацию о FLOOD_WAIT аккаунтах
    const now = Date.now();
    const floodWaitInfo = [...this.floodWaitAccounts.entries()]
      .sort((a, b) => a[1].getTime() - b[1].getTime())
      .map(([name, unlockTime]) => ({
        name,
        unlockAt: this.formatUnlockTime(unlockTime),
        waitTime: this.formatWaitTime(Math.max(0, Math.floor((unlockTime.getTime() - now) / 1000))),
      }));

    // Формируем отчёт
    const stats: IReportStats = {
      sessionId: this.sessionId,
      targetChannel: CONFIG.targetChannel,
      successfulCount: this.successfulCount,
      failedCount: this.failedCount,
      processedCount: total,
      newChannelsCount,
      startedAt: new Date(startTime),
      finishedAt,
      durationMinutes,
      accountsUsed: accountStats,
      totalAccounts: allAccounts.length,
      successRate,
      floodWaitAccounts: floodWaitInfo.length > 0 ? floodWaitInfo : undefined,
      spammedAccounts: this.spammedAccounts.size > 0 ? Array.from(this.spammedAccounts) : undefined,
    };

    // Отправляем
    const sent = await this.reporter.sendReport(stats);
    if (sent) {
      this.reportSent = true;
      this.log.info("Отчёт отправлен в Telegram");
    }
  }

  /**
   * Загрузка каналов из БД (status='new')
   */
  private async loadChannels(): Promise<ICommentTarget[]> {
    const channels = await this.targetChannelsRepo.getNextBatch(CONFIG.batchSize);

    if (channels.length === 0) {
      this.log.info("Нет каналов для комментирования (все обработаны)");
      return [];
    }

    this.log.info(`Загружено ${channels.length} каналов из БД`);

    return channels.map((ch) => ({
      channelUsername: ch.username,
      channelUrl: `https://t.me/${ch.username}`,
      isActive: true,
    }));
  }

  /**
   * Проверяет есть ли доступные аккаунты для продолжения комментирования
   * Аккаунт считается доступным если он:
   * - Не в спаме
   * - Не в FLOOD_WAIT (или FLOOD_WAIT истёк)
   * - Не достиг лимита комментариев
   */
  private hasAvailableAccounts(): boolean {
    const accounts = this.accountRotator.getAllAccounts();
    const now = Date.now();

    // Очищаем истекшие FLOOD_WAIT
    for (const [name, unlockTime] of this.floodWaitAccounts.entries()) {
      if (unlockTime.getTime() <= now) {
        this.floodWaitAccounts.delete(name);
        this.log.debug("FLOOD_WAIT истёк, аккаунт доступен", { account: name });
      }
    }

    for (const account of accounts) {
      // Пропускаем спамленные аккаунты
      if (this.spammedAccounts.has(account.name)) {
        continue;
      }

      // Пропускаем аккаунты в FLOOD_WAIT (если время не истекло)
      const floodWaitUntil = this.floodWaitAccounts.get(account.name);
      if (floodWaitUntil && floodWaitUntil.getTime() > now) {
        continue;
      }

      // Пропускаем аккаунты достигшие лимита
      if (account.commentsCount >= account.maxCommentsPerSession) {
        continue;
      }

      // Нашли доступный аккаунт
      return true;
    }

    return false;
  }

  /**
   * Запуск heartbeat - отправка статуса каждые 5 минут
   */
  private startHeartbeat(): void {
    // Отправляем heartbeat каждые 5 минут
    this.heartbeatInterval = setInterval(async () => {
      try {
        const currentAccount = this.accountRotator.getCurrentAccount();
        const uptimeMinutes = Math.round((Date.now() - this.sessionStartTime) / 1000 / 60);
        const uptimeStr = uptimeMinutes >= 60
          ? `${Math.floor(uptimeMinutes / 60)}ч ${uptimeMinutes % 60}м`
          : `${uptimeMinutes}м`;

        await this.reporter.sendHeartbeat({
          sessionId: this.sessionId,
          successCount: this.successfulCount,
          failedCount: this.failedCount,
          currentAccount: currentAccount?.name,
          uptime: uptimeStr,
        });

        this.log.debug("Heartbeat отправлен", { uptime: uptimeStr });
      } catch (error: any) {
        this.log.warn("Ошибка отправки heartbeat", { error: error.message });
      }
    }, 5 * 60 * 1000); // 5 минут

    this.log.info("Heartbeat запущен (каждые 5 минут)");
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
        // Удаляем из tracking ДО отключения, чтобы избежать утечки памяти
        const index = this.activeClients.indexOf(this.client);
        if (index > -1) {
          this.activeClients.splice(index, 1);
          this.log.debug("Старый клиент удалён из tracking", {
            remainingClients: this.activeClients.length,
          });
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

        // Сохраняем комментарий в БД
        await this.commentsRepo.save({
          channelUsername: channel.channelUsername,
          commentText: result.commentText,
          postId: result.postId,
          commentId: result.commentId,
          accountName: currentAccount.name,
          targetChannel: CONFIG.targetChannel,
          sessionId: this.sessionId,
        });

        // Обновляем статистику
        this.successfulCount++;
        this.usedAccounts.add(currentAccount.name);

        channelLog.info("Комментарий успешно опубликован", {
          account: currentAccount.name,
          commentsCount: currentAccount.commentsCount,
          maxComments: currentAccount.maxCommentsPerSession,
          commentText:
            result.commentText.length > 150 ? result.commentText.substring(0, 150) + "..." : result.commentText,
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
            // Помечаем как skipped чтобы не обрабатывать повторно
            await this.targetChannelsRepo.markSkipped(channel.channelUsername, "FLOOD_WAIT при комментировании");
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

        // Обновляем статистику ошибок
        this.failedCount++;
        this.usedAccounts.add(currentAccount.name);

        channelLog.warn("Ошибка при комментировании", {
          account: currentAccount.name,
          commentsCount: currentAccount.commentsCount,
          maxComments: currentAccount.maxCommentsPerSession,
          error: this.simplifyError(errorMsg),
          errorCode: error.code,
          duration: Date.now() - startTime,
        });

        // Проверяем на спам (только при USER_BANNED_IN_CHANNEL)
        // CHAT_GUEST_SEND_FORBIDDEN — это требование канала, не связано со спамом аккаунта
        if (errorMsg.includes("USER_BANNED_IN_CHANNEL")) {
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

        // POST_SKIPPED — пост слишком короткий, помечаем как skipped (не error)
        if (errorMsg.includes("POST_SKIPPED")) {
          await this.targetChannelsRepo.markSkipped(channel.channelUsername, errorMsg.substring(0, 500));
        } else {
          // Сохраняем ошибку в БД
          await this.saveFailedChannel(channel.channelUsername, errorMsg.substring(0, 500));
        }
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
  private async commentChannel(channel: ICommentTarget): Promise<{ commentText: string; postId?: number; commentId?: number }> {
    if (!this.targetChannelInfo) {
      throw new Error("Целевой канал не установлен");
    }

    // Проверяем существующие комментарии перед отправкой
    const hasExisting = await this.checkExistingComment(
      channel.channelUsername,
    );
    if (hasExisting) {
      await this.saveSuccessfulChannel(channel.channelUsername);
      return { commentText: "Уже есть", postId: undefined, commentId: undefined };
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

    const result = await withTimeout(
      this.commentPoster.postCommentsWithAIAsync(options),
      CONFIG.operationTimeoutMs,
      "OPERATION_TIMEOUT: Превышено время ожидания комментария (60 сек)",
    );

    if (result.successfulComments === 0) {
      if (!result.results[0]) {
        throw new Error("BUG: results[0] is undefined - комментирование не записало результат");
      }
      if (!result.results[0].error) {
        throw new Error("BUG: error field is empty - ошибка не была записана");
      }
      throw new Error(result.results[0].error);
    }

    // Возвращаем полные данные комментария
    return {
      commentText: result.results[0]?.commentText || "",
      postId: result.results[0]?.postId,
      commentId: result.results[0]?.postedMessageId,
    };
  }

  /**
   * Проверка существующих комментариев от целевого канала
   * Проверяет по НАЗВАНИЮ канала (title), а не по channelId
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
            limit: 100,  // Увеличено с 50 до 100
          });

        if (discussion && discussion.length > 0) {
          // Проверяем по НАЗВАНИЮ канала (а не по channelId)
          const targetChannelTitle = this.targetChannelInfo?.title;

          if (!targetChannelTitle) {
            this.log.warn("targetChannelInfo.title не установлен", {
              channel: channelUsername,
            });
            return false;
          }

          const hasOurComment = discussion.some((comment) => {
            // Проверяем только комментарии от каналов
            if (!comment.sender || !(comment.sender instanceof Api.Channel)) {
              return false;
            }

            const channelSender = comment.sender as Api.Channel;
            const senderTitle = channelSender.title;

            // Сравниваем НАЗВАНИЕ канала
            if (senderTitle === targetChannelTitle) {
              return true;  // Комментарий от канала с таким же названием
            }

            return false;
          });

          if (hasOurComment) {
            this.log.info("Комментарий уже существует", {
              channel: channelUsername,
              targetChannelTitle,
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
   * Ожидает разблокировки ближайшего аккаунта из FLOOD_WAIT
   * Вместо завершения работы - спим до разблокировки
   */
  private async waitForAccountUnlock(): Promise<IAccountInfo | null> {
    if (this.floodWaitAccounts.size === 0) {
      return null;
    }

    const now = Date.now();

    // Находим аккаунт с минимальным временем ожидания
    let nearestUnlock: [string, Date] | null = null;
    let minWaitTime = Infinity;

    for (const [name, unlockTime] of this.floodWaitAccounts.entries()) {
      const waitMs = unlockTime.getTime() - now;
      if (waitMs > 0 && waitMs < minWaitTime) {
        minWaitTime = waitMs;
        nearestUnlock = [name, unlockTime];
      }
    }

    if (!nearestUnlock) {
      return null;
    }

    const [accountName, unlockTime] = nearestUnlock;
    const waitSeconds = Math.max(0, Math.ceil((unlockTime.getTime() - now) / 1000));
    const bufferSeconds = 60; // Буфер для гарантии разблокировки
    const totalWaitSeconds = waitSeconds + bufferSeconds;

    this.log.info("Ожидание разблокировки аккаунта", {
      account: accountName,
      unlockAt: this.formatUnlockTime(unlockTime),
      waitTime: this.formatWaitTime(totalWaitSeconds),
      totalFloodWaitAccounts: this.floodWaitAccounts.size,
    });

    // Логируем каждые 5 минут для heartbeat
    const logInterval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((unlockTime.getTime() - Date.now()) / 1000));
      this.log.info("Продолжаем ожидание", {
        account: accountName,
        remainingTime: this.formatWaitTime(remaining + bufferSeconds),
      });
    }, 5 * 60 * 1000);

    // Ждём разблокировки
    await new Promise(resolve => setTimeout(resolve, totalWaitSeconds * 1000));

    clearInterval(logInterval);

    // Удаляем из FLOOD_WAIT списка
    this.floodWaitAccounts.delete(accountName);

    // Удалить из БД (аккаунт разблокирован)
    await this.floodWaitRepo.removeFloodWait(accountName);

    this.log.info("Аккаунт разблокирован", { account: accountName });

    // Возвращаем разблокированный аккаунт
    const account = this.accountRotator.getAllAccounts().find(a => a.name === accountName);
    return account || null;
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

    // Добавляем текущий аккаунт в список с FLOOD_WAIT (с временем разблокировки)
    const unlockTime = new Date(Date.now() + waitSeconds * 1000);
    this.floodWaitAccounts.set(currentOwner.name, unlockTime);

    // Сохранить в БД для персистентности между перезапусками
    await this.floodWaitRepo.setFloodWait(currentOwner.name, unlockTime, "FLOOD_WAIT при комментировании");

    this.log.info("Аккаунт добавлен в FLOOD_WAIT список", {
      account: currentOwner.name,
      unlockAt: this.formatUnlockTime(unlockTime),
      waitTime: this.formatWaitTime(waitSeconds),
      totalFloodWaitAccounts: this.floodWaitAccounts.size,
    });

    // Ищем аккаунт без FLOOD_WAIT
    const accounts = this.accountRotator.getAllAccounts();
    let availableAccount = await this.findAccountWithoutFloodWait(
      accounts,
      currentOwner,
    );

    if (!availableAccount) {
      // Выводим детальную сводку
      this.logFloodWaitSummary();

      this.log.warn("Все аккаунты в FLOOD_WAIT, ожидаем разблокировки ближайшего", {
        totalAccounts: accounts.length,
        floodWaitCount: this.floodWaitAccounts.size,
      });

      // Ждём разблокировки вместо завершения
      const unlockedAccount = await this.waitForAccountUnlock();

      if (!unlockedAccount) {
        this.log.error("Не удалось дождаться разблокировки аккаунтов", new Error("No accounts unlocked"));
        throw new Error("Все аккаунты недоступны после ожидания");
      }

      this.log.info("Продолжаем работу с разблокированным аккаунтом", {
        account: unlockedAccount.name,
      });

      availableAccount = unlockedAccount;
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
          const unlockTime = new Date(Date.now() + seconds * 1000);
          this.log.warn("FLOOD_WAIT при проверке спама", {
            account: account.name,
            waitTime: this.formatWaitTime(seconds),
            unlockAt: this.formatUnlockTime(unlockTime),
          });

          // Добавляем в список FLOOD_WAIT с временем разблокировки
          this.floodWaitAccounts.set(account.name, unlockTime);
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

    // Если не найден чистый аккаунт, но есть аккаунты в FLOOD_WAIT → ждать
    if (this.floodWaitAccounts.size > 0) {
      this.log.info("Все проверенные аккаунты заблокированы, ожидаем разблокировки");
      return await this.waitForAccountUnlock();
    }

    // Сводка уже выведена в handleOwnerFloodWait
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
        "../../ownershipRotator/services/channelOwnershipRotatorService"
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
        client: this.client.getClient(), // Передаём существующий клиент вместо sessionString
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
   * Сохранение успешного канала (status='done' в БД)
   */
  private async saveSuccessfulChannel(channelUsername: string): Promise<void> {
    try {
      const cleanUsername = channelUsername.replace("@", "");
      await this.targetChannelsRepo.markDone(cleanUsername);
      this.log.debug("Канал помечен как done", { channel: cleanUsername });
    } catch (error) {
      this.log.warn("Ошибка сохранения успешного канала", {
        channel: channelUsername,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Сохранение неудачного канала (status='error' в БД)
   */
  private async saveFailedChannel(channelUsername: string, errorMessage?: string): Promise<void> {
    try {
      const cleanUsername = channelUsername.replace("@", "");
      await this.targetChannelsRepo.markError(cleanUsername, errorMessage || "Unknown error");
      this.log.debug("Канал помечен как error", { channel: cleanUsername, errorMessage });
    } catch (error) {
      this.log.warn("Ошибка сохранения неудачного канала", {
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
   * Форматирует время ожидания в человекочитаемый формат
   * @example 75660 -> "21ч 1м"
   */
  private formatWaitTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}ч ${minutes}м`;
    }
    return `${minutes}м`;
  }

  /**
   * Форматирует время разблокировки в локальное время
   * @example Date -> "15:30"
   */
  private formatUnlockTime(date: Date): string {
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Выводит сводку всех аккаунтов в FLOOD_WAIT
   */
  private logFloodWaitSummary(): void {
    if (this.floodWaitAccounts.size === 0) return;

    const now = Date.now();

    // Сортируем по времени разблокировки
    const sorted = [...this.floodWaitAccounts.entries()]
      .sort((a, b) => a[1].getTime() - b[1].getTime());

    // Выводим заголовок
    console.log('');
    console.log(`⏳ FLOOD_WAIT сводка (${this.floodWaitAccounts.size} аккаунтов):`);
    console.log('─'.repeat(50));

    for (const [name, unlockTime] of sorted) {
      const remainingMs = unlockTime.getTime() - now;
      const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
      console.log(`  • ${name.padEnd(15)} → ${this.formatUnlockTime(unlockTime)} (через ${this.formatWaitTime(remainingSec)})`);
    }

    console.log('─'.repeat(50));

    // Находим ближайшее время разблокировки
    const nextUnlock = sorted[0];
    const nextUnlockIn = Math.max(0, Math.floor((nextUnlock[1].getTime() - now) / 1000));
    console.log(`🔜 Ближайшая разблокировка: ${nextUnlock[0]} через ${this.formatWaitTime(nextUnlockIn)}`);
    console.log('');
  }

  /**
   * Очистка ресурсов - закрытие всех клиентов
   */
  private async cleanup(): Promise<void> {
    this.log.info("Начало cleanup", {
      totalClients: this.activeClients.length,
    });

    // Останавливаем heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this.log.debug("Heartbeat остановлен");
    }

    // Финализируем сессию и отправляем отчёт (если сессия была начата)
    if (this.sessionStartTime > 0) {
      try {
        this.log.info("Финализация сессии перед закрытием...");
        await this.sendFinalReport(this.sessionStartTime);
      } catch (error) {
        this.log.warn("Не удалось отправить отчёт при cleanup", {
          error: (error as Error).message,
        });
      }
    }

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
