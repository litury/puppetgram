/**
 * Основной сервис для автоматического комментирования постов в Telegram каналах
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import { TelegramClient } from "telegram";
import { Api } from "telegram";

import { createLogger } from "../../../shared/utils/logger";
const log = createLogger("CommentPoster");

import {
  ICommentTarget,
  ICommentTargetWithCache,
  ICommentMessage,
  ICommentingOptions,
  ICommentingOptionsWithCache,
  ICommentingOptionsWithAI,
  ICommentingResponse,
  ICommentingResponseWithAI,
  ICommentResult,
  ICommentingSession,
  IBulkCommentingOptions,
  IChannelMembershipInfo,
  ICommentAccessResult,
  IChannelFilteringResponse,
  IUserChannel,
  ISendAsOptions,
  IProgressFileData,
  IContentExtractionTestOptions,
  IContentExtractionTestResult,
  ICommentingResponseWithContent,
  IPostContent,
} from "../interfaces";
import {
  generateSessionId,
  selectRandomComment,
  delayAsync,
  generateRandomDelay,
  cleanChannelUsername,
  calculateErrorStats,
  formatDuration,
  extractPostContent,
  calculateContentStats,
} from "../parts";
import { shouldCommentOnPost } from "../../aiCommentGenerator/parts/promptBuilder";
import { IAICommentResult } from "../../aiCommentGenerator/interfaces";

export class CommentPosterService {
  private readonly p_client: TelegramClient;
  private p_activeSessions: Map<string, ICommentingSession> = new Map();
  private p_dailyCommentCount: number = 0;
  private p_hourlyCommentCount: number = 0;
  private p_lastResetDate: Date = new Date();

  constructor(_client: TelegramClient) {
    this.p_client = _client;
    this.resetCountersIfNeeded();
  }

  /**
   * Загрузка и фильтрация каналов из JSON файла прогресса
   */
  async loadChannelsFromProgressFile(
    _filePath: string,
  ): Promise<ICommentTargetWithCache[]> {
    const fs = await import("fs");
    const path = await import("path");

    log.info(`Loading channels from file: ${path.basename(_filePath)}`);

    try {
      const fileContent = fs.readFileSync(_filePath, "utf-8");
      const progressData: IProgressFileData = JSON.parse(fileContent);

      const commentableChannels = progressData.results
        .filter((result: any) => {
          return (
            result.success &&
            result.channel.commentsEnabled &&
            result.channel.commentsPolicy === "enabled" &&
            result.channel.canPostComments
          );
        })
        .map((result: any) => {
          const channel = result.channel;
          return {
            channelId: channel.channelId,
            accessHash: channel.accessHash,
            channelUsername: channel.channelUsername,
            channelTitle: channel.channelTitle,
            commentsEnabled: channel.commentsEnabled,
            commentsPolicy: channel.commentsPolicy as any,
            linkedDiscussionGroup: channel.linkedDiscussionGroup,
            canPostComments: channel.canPostComments,
            canReadComments: channel.canReadComments,
            isActive: true,
          } as ICommentTargetWithCache;
        });

      log.info(
        `Found ${progressData.results.length} channels, filtered ${commentableChannels.length} commentable`,
      );

      return commentableChannels;
    } catch (error) {
      log.error(`Error loading file ${_filePath}:`, error as Error);
      return [];
    }
  }

  /**
   * Комментирование с использованием кэшированных данных (БЕЗ ResolveUsername!)
   */
  async postCommentsWithCacheAsync(
    _options: ICommentingOptionsWithCache,
  ): Promise<ICommentingResponse> {
    const sessionId = generateSessionId();
    const startTime = new Date();

    const session: ICommentingSession = {
      sessionId,
      startTime,
      targetsProcessed: 0,
      successfulComments: 0,
      failedComments: 0,
      errors: [],
      isActive: true,
    };

    this.p_activeSessions.set(sessionId, session);
    const results: ICommentResult[] = [];

    log.info(
      `Starting session ${sessionId} with ${_options.targets.length} targets`,
    );

    try {
      for (const [index, target] of _options.targets.entries()) {
        if (!session.isActive) break;

        const result = await this.processTargetWithCacheAsync(target, _options);
        results.push(result);

        if (result.success) {
          session.successfulComments++;
          this.p_dailyCommentCount++;
          this.p_hourlyCommentCount++;
        } else {
          session.failedComments++;
          session.errors.push(result.error || "Unknown error");
        }

        session.targetsProcessed++;

        // Задержка между комментариями
        if (index < _options.targets.length - 1) {
          await delayAsync(_options.delayBetweenComments);
        }
      }
    } finally {
      session.isActive = false;
      session.endTime = new Date();
      this.p_activeSessions.delete(sessionId);
    }

    const duration = new Date().getTime() - startTime.getTime();

    const response: ICommentingResponse = {
      sessionId,
      totalTargets: session.targetsProcessed,
      successfulComments: session.successfulComments,
      failedComments: session.failedComments,
      results,
      duration,
      summary: {
        successRate:
          session.targetsProcessed > 0
            ? (session.successfulComments / session.targetsProcessed) * 100
            : 0,
        averageDelay:
          session.targetsProcessed > 1
            ? duration / (session.targetsProcessed - 1)
            : 0,
        errorsByType: calculateErrorStats(session.errors),
      },
    };

    log.info(
      `Session completed: ${session.successfulComments} success, ${session.failedComments} failed`,
    );

    return response;
  }

  /**
   * Основной метод для комментирования постов
   */
  async postCommentsAsync(
    _options: ICommentingOptions,
  ): Promise<ICommentingResponse> {
    const sessionId = generateSessionId();
    const startTime = new Date();

    const session: ICommentingSession = {
      sessionId,
      startTime,
      targetsProcessed: 0,
      successfulComments: 0,
      failedComments: 0,
      errors: [],
      isActive: true,
    };

    this.p_activeSessions.set(sessionId, session);
    const results: ICommentResult[] = [];

    log.info(`🚀 Начинаю сессию: ${sessionId}`);
    log.info(`📋 Целей: ${_options.targets.length}`);
    log.info(`🧪 Тестовый режим: ${_options.dryRun ? "ДА" : "НЕТ"}`);

    try {
      for (const [index, target] of _options.targets.entries()) {
        if (!session.isActive) break;

        log.info(
          `\n[${index + 1}/${_options.targets.length}] ${target.channelUsername}`,
        );

        const result = await this.processTargetAsync(target, _options);
        results.push(result);

        if (result.success) {
          session.successfulComments++;
          this.p_dailyCommentCount++;
          this.p_hourlyCommentCount++;
          log.info(
            `✅ Успешно отправлен комментарий в @${target.channelUsername}`,
          );
        } else {
          session.failedComments++;
          session.errors.push(result.error || "Неизвестная ошибка");
          log.info(`❌ Ошибка в @${target.channelUsername}: ${result.error}`);
        }

        session.targetsProcessed++;

        // Задержка между комментариями
        if (index < _options.targets.length - 1) {
          await delayAsync(_options.delayBetweenComments);
        }
      }
    } finally {
      session.isActive = false;
      session.endTime = new Date();
      this.p_activeSessions.delete(sessionId);
    }

    const duration = new Date().getTime() - startTime.getTime();

    const response: ICommentingResponse = {
      sessionId,
      totalTargets: session.targetsProcessed,
      successfulComments: session.successfulComments,
      failedComments: session.failedComments,
      results,
      duration,
      summary: {
        successRate:
          session.targetsProcessed > 0
            ? (session.successfulComments / session.targetsProcessed) * 100
            : 0,
        averageDelay:
          session.targetsProcessed > 1
            ? duration / (session.targetsProcessed - 1)
            : 0,
        errorsByType: calculateErrorStats(session.errors),
      },
    };

    log.info(`\n✅ Сессия завершена: ${sessionId}`);
    log.info(
      `📊 Успешно: ${session.successfulComments}, Ошибок: ${session.failedComments}`,
    );
    log.info(`⏱️ Длительность: ${formatDuration(duration)}`);

    return response;
  }

  /**
   * Обработка одной цели с кэшированными данными (БЫСТРО!)
   */
  private async processTargetWithCacheAsync(
    _target: ICommentTargetWithCache,
    _options: ICommentingOptionsWithCache,
  ): Promise<ICommentResult> {
    try {
      const selectedMessage = selectRandomComment(_options.messages);
      if (!selectedMessage) {
        throw new Error("Нет доступных сообщений");
      }

      log.info(`💬 Комментарий: "${selectedMessage.text}"`);

      if (_options.dryRun) {
        log.info("🧪 Тестовый режим - комментарий не отправлен");
        return {
          target: _target as any, // Конвертируем для совместимости
          success: true,
          commentText: selectedMessage.text,
          timestamp: new Date(),
          retryCount: 0,
        };
      }

      // Реальная отправка комментария с кэшированными данными
      const messageId = await this.postCommentWithCacheAsync(
        _target,
        selectedMessage.text,
        _options.sendAsOptions,
      );

      return {
        target: _target as any, // Конвертируем для совместимости
        success: true,
        commentText: selectedMessage.text,
        postedMessageId: messageId,
        timestamp: new Date(),
        retryCount: 0,
      };
    } catch (error) {
      log.error(
        `❌ Ошибка обработки @${_target.channelUsername}:`,
        error as Error,
      );
      return {
        target: _target as any, // Конвертируем для совместимости
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
        retryCount: 0,
      };
    }
  }

  /**
   * Обработка одной цели
   */
  private async processTargetAsync(
    _target: ICommentTarget,
    _options: ICommentingOptions,
  ): Promise<ICommentResult> {
    try {
      const selectedMessage = selectRandomComment(_options.messages);
      if (!selectedMessage) {
        throw new Error("Нет доступных сообщений");
      }

      log.info(`💬 Комментарий: "${selectedMessage.text}"`);

      if (_options.dryRun) {
        log.info("🧪 Тестовый режим - комментарий не отправлен");
        return {
          target: _target,
          success: true,
          commentText: selectedMessage.text,
          timestamp: new Date(),
          retryCount: 0,
        };
      }

      // Здесь будет реальная отправка комментария
      const messageId = await this.postCommentAsync(
        _target.channelUsername,
        selectedMessage.text,
        _options.sendAsOptions,
      );

      return {
        target: _target,
        success: true,
        commentText: selectedMessage.text,
        postedMessageId: messageId,
        timestamp: new Date(),
        retryCount: 0,
      };
    } catch (error) {
      log.error(
        `❌ Ошибка обработки @${_target.channelUsername}:`,
        error as Error,
      );
      return {
        target: _target,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
        retryCount: 0,
      };
    }
  }

  /**
   * Отправка комментария с использованием кэшированных данных (БЕЗ ResolveUsername!)
   */
  private async postCommentWithCacheAsync(
    _target: ICommentTargetWithCache,
    _commentText: string,
    _sendAsOptions?: ISendAsOptions,
  ): Promise<number> {
    try {
      // Создаем InputChannel БЕЗ ResolveUsername - используем кэшированные данные!
      const bigInt = await import("big-integer");
      const inputChannel = new Api.InputChannel({
        channelId: bigInt.default(_target.channelId),
        accessHash: bigInt.default(_target.accessHash),
      });

      // Получаем последний пост в канале БЕЗ ResolveUsername
      const messages = await this.p_client.getMessages(inputChannel, {
        limit: 1,
      });

      if (!messages || messages.length === 0) {
        throw new Error(`Нет сообщений в канале @${_target.channelUsername}`);
      }

      const lastMessage = messages[0];

      // Получаем информацию о связанном чате для комментариев БЕЗ ResolveUsername
      const result = await this.p_client.invoke(
        new Api.messages.GetDiscussionMessage({
          peer: inputChannel, // Используем InputChannel напрямую!
          msgId: lastMessage.id,
        }),
      );

      if (!result.messages || result.messages.length === 0) {
        throw new Error(
          `Комментарии недоступны для канала @${_target.channelUsername}`,
        );
      }

      const discussionMessage = result.messages[0];
      const peer = discussionMessage.peerId || inputChannel;

      // Определяем отправителя: канал или профиль
      let sendAsEntity = undefined;
      if (_sendAsOptions?.useChannelAsSender && _sendAsOptions.selectedChannelId) {
        log.info(
          `📺 Отправляю от имени канала: ${_sendAsOptions.selectedChannelTitle}`,
        );
        sendAsEntity = await this.p_client.getEntity(
          _sendAsOptions.selectedChannelId,
        );
      } else {
        log.info(`👤 Отправляю от имени профиля`);
      }

      const sendResult = await this.p_client.invoke(
        new Api.messages.SendMessage({
          peer: peer,
          message: _commentText,
          replyTo: new Api.InputReplyToMessage({
            replyToMsgId: discussionMessage.id,
          }),
          ...(sendAsEntity && { sendAs: sendAsEntity }),
        }),
      );

      // Извлекаем ID сообщения из результата
      if (sendResult && "updates" in sendResult && sendResult.updates) {
        for (const update of sendResult.updates) {
          if (
            "message" in update &&
            update.message &&
            typeof update.message === "object" &&
            "id" in update.message
          ) {
            const messageId = (update.message as any).id;
            return messageId;
          }
        }
      }

      // ID не найден в updates — проверяем наличие комментария через getMessages
      const recentMessages = await this.p_client.getMessages(peer, {
        limit: 3,
        replyTo: discussionMessage.id,
      });

      const ourComment = recentMessages.find(
        (msg) => msg.message === _commentText,
      );

      if (ourComment) {
        log.debug("Комментарий найден после проверки", {
          messageId: ourComment.id,
          channel: _target.channelUsername,
        });
        return ourComment.id;
      }

      // Комментарий не найден — возможно канал модерируется
      throw new Error(
        `COMMENT_MODERATED: Комментарий не найден после отправки в @${_target.channelUsername}`,
      );
    } catch (error: any) {
      // Обработка специфичных ошибок Telegram
      if (
        error.errorMessage === "FLOOD_WAIT" ||
        error.constructor.name === "FloodWaitError"
      ) {
        const waitSeconds = error.seconds || 60;
        throw new Error(`Flood wait: нужно подождать ${waitSeconds} секунд`);
      } else if (error.errorMessage === "SEND_AS_PEER_INVALID") {
        throw new Error(
          `SEND_AS_PEER_INVALID: Не удалось отправить от имени канала "${_sendAsOptions?.selectedChannelTitle}" в @${_target.channelUsername}`,
        );
      } else if (error.errorMessage === "MSG_ID_INVALID") {
        throw new Error(
          `MSG_ID_INVALID: Неверный ID сообщения для канала @${_target.channelUsername}`,
        );
      } else if (error.errorMessage === "CHAT_WRITE_FORBIDDEN") {
        throw new Error(
          `CHAT_WRITE_FORBIDDEN: Нет прав для записи в канале @${_target.channelUsername}`,
        );
      } else if (error.errorMessage === "USER_BANNED_IN_CHANNEL") {
        throw new Error(
          `USER_BANNED_IN_CHANNEL: Пользователь заблокирован в канале @${_target.channelUsername}`,
        );
      } else if (error.errorMessage === "CHAT_GUEST_SEND_FORBIDDEN") {
        throw new Error(
          `CHAT_GUEST_SEND_FORBIDDEN: Нужно вступить в канал @${_target.channelUsername} для комментирования`,
        );
      } else if (error.errorMessage === "CHANNEL_PRIVATE") {
        throw new Error(
          `CHANNEL_PRIVATE: Канал @${_target.channelUsername} приватный или недоступен`,
        );
      } else if (error.errorMessage === "USERNAME_NOT_OCCUPIED") {
        throw new Error(`USERNAME_NOT_OCCUPIED: Канал @${_target.channelUsername} не найден`);
      } else if (error.errorMessage === "CHANNEL_INVALID") {
        throw new Error(`CHANNEL_INVALID: Канал @${_target.channelUsername} не существует`);
      } else if (error.errorMessage === "CHANNEL_BANNED") {
        throw new Error(`CHANNEL_BANNED: Канал забанен в @${_target.channelUsername}`);
      }

      // Сохраняем оригинальный код ошибки если он есть
      const errorCode = error.errorMessage ? `${error.errorMessage}: ` : "";
      throw new Error(
        `${errorCode}Ошибка отправки комментария в @${_target.channelUsername}: ${error.message || error}`,
      );
    }
  }

  /**
   * Отправка комментария в Telegram канал
   */
  private async postCommentAsync(
    _channelUsername: string,
    _commentText: string,
    _sendAsOptions?: ISendAsOptions,
    _targetPostId?: number,
  ): Promise<number> {
    try {
      // Используем переданный ID поста или загружаем последний
      let targetMsgId: number;
      if (_targetPostId) {
        targetMsgId = _targetPostId;
      } else {
        const messages = await this.p_client.getMessages(_channelUsername, {
          limit: 1,
        });
        if (!messages || messages.length === 0) {
          throw new Error(`Нет сообщений в канале @${_channelUsername}`);
        }
        targetMsgId = messages[0].id;
      }

      // Получаем информацию о связанном чате для комментариев
      const result = await this.p_client.invoke(
        new Api.messages.GetDiscussionMessage({
          peer: _channelUsername,
          msgId: targetMsgId,
        }),
      );

      if (!result.messages || result.messages.length === 0) {
        throw new Error(
          `Комментарии недоступны для канала @${_channelUsername}`,
        );
      }

      const discussionMessage = result.messages[0];
      const peer = discussionMessage.peerId || _channelUsername;

      // Определяем отправителя: канал или профиль
      let sendAsEntity = undefined;
      if (_sendAsOptions?.useChannelAsSender && _sendAsOptions.selectedChannelId) {
        sendAsEntity = await this.p_client.getEntity(
          _sendAsOptions.selectedChannelId,
        );
      }

      const sendResult = await this.p_client.invoke(
        new Api.messages.SendMessage({
          peer: peer,
          message: _commentText,
          replyTo: new Api.InputReplyToMessage({
            replyToMsgId: discussionMessage.id,
          }),
          ...(sendAsEntity && { sendAs: sendAsEntity }),
        }),
      );

      // Извлекаем ID сообщения из результата
      if (sendResult && "updates" in sendResult && sendResult.updates) {
        for (const update of sendResult.updates) {
          if (
            "message" in update &&
            update.message &&
            typeof update.message === "object" &&
            "id" in update.message
          ) {
            const messageId = (update.message as any).id;
            return messageId;
          }
        }
      }

      // ID не найден в updates — проверяем наличие комментария через getMessages
      const recentMessages = await this.p_client.getMessages(peer, {
        limit: 3,
        replyTo: discussionMessage.id,
      });

      const ourComment = recentMessages.find(
        (msg) => msg.message === _commentText,
      );

      if (ourComment) {
        log.debug("Комментарий найден после проверки", {
          messageId: ourComment.id,
          channel: _channelUsername,
        });
        return ourComment.id;
      }

      // Комментарий не найден — возможно канал модерируется
      throw new Error(
        `COMMENT_MODERATED: Комментарий не найден после отправки в @${_channelUsername}`,
      );
    } catch (error: any) {
      // Обработка специфичных ошибок Telegram
      if (
        error.errorMessage === "FLOOD_WAIT" ||
        error.constructor.name === "FloodWaitError"
      ) {
        const waitSeconds = error.seconds || 60;
        throw new Error(`Flood wait: нужно подождать ${waitSeconds} секунд`);
      } else if (error.errorMessage === "SEND_AS_PEER_INVALID") {
        throw new Error(
          `SEND_AS_PEER_INVALID: Не удалось отправить от имени канала "${_sendAsOptions?.selectedChannelTitle}" в @${_channelUsername}`,
        );
      } else if (error.errorMessage === "MSG_ID_INVALID") {
        // Пробуем получить более свежие сообщения и отправить от канала
        try {
          const freshMessages = await this.p_client.getMessages(
            _channelUsername,
            { limit: 5 },
          );
          if (freshMessages && freshMessages.length > 0 && _sendAsOptions?.selectedChannelId) {
            const newestMessage = freshMessages[0];
            const result = await this.p_client.invoke(
              new Api.messages.GetDiscussionMessage({
                peer: _channelUsername,
                msgId: newestMessage.id,
              }),
            );

            if (result.messages && result.messages.length > 0) {
              const discussionMessage = result.messages[0];
              const peer = discussionMessage.peerId || _channelUsername;

              const channelEntity = await this.p_client.getEntity(
                _sendAsOptions.selectedChannelId,
              );

              const sendResult = await this.p_client.invoke(
                new Api.messages.SendMessage({
                  peer: peer,
                  message: _commentText,
                  replyTo: new Api.InputReplyToMessage({
                    replyToMsgId: discussionMessage.id,
                  }),
                  sendAs: channelEntity,
                }),
              );

              if (sendResult && "updates" in sendResult && sendResult.updates) {
                for (const update of sendResult.updates) {
                  if (
                    "message" in update &&
                    update.message &&
                    typeof update.message === "object" &&
                    "id" in update.message
                  ) {
                    return (update.message as any).id;
                  }
                }
              }
            }
          }
        } catch (retryError) {
          // Тихо обрабатываем ошибку повтора
        }
        throw new Error(
          `MSG_ID_INVALID: Неверный ID сообщения для канала @${_channelUsername} (все попытки исчерпаны)`,
        );
      } else if (error.errorMessage === "CHAT_WRITE_FORBIDDEN") {
        throw new Error(`CHAT_WRITE_FORBIDDEN: Нет прав для записи в канале @${_channelUsername}`);
      } else if (error.errorMessage === "USER_BANNED_IN_CHANNEL") {
        throw new Error(
          `USER_BANNED_IN_CHANNEL: Пользователь заблокирован в канале @${_channelUsername}`,
        );
      } else if (error.errorMessage === "CHAT_GUEST_SEND_FORBIDDEN") {
        throw new Error(
          `CHAT_GUEST_SEND_FORBIDDEN: Нужно вступить в канал @${_channelUsername} для комментирования`,
        );
      } else if (error.errorMessage === "CHANNEL_PRIVATE") {
        throw new Error(`CHANNEL_PRIVATE: Канал @${_channelUsername} приватный или недоступен`);
      } else if (error.errorMessage === "USERNAME_NOT_OCCUPIED") {
        throw new Error(`USERNAME_NOT_OCCUPIED: Канал @${_channelUsername} не найден`);
      } else if (error.errorMessage === "CHANNEL_INVALID") {
        throw new Error(`CHANNEL_INVALID: Канал @${_channelUsername} не существует`);
      } else if (error.errorMessage === "CHANNEL_BANNED") {
        throw new Error(`CHANNEL_BANNED: Канал забанен в @${_channelUsername}`);
      }

      // Сохраняем оригинальный код ошибки если он есть
      const errorCode = error.errorMessage ? `${error.errorMessage}: ` : "";
      throw new Error(
        `${errorCode}Ошибка отправки комментария в @${_channelUsername}: ${error.message || error}`,
      );
    }
  }

  /**
   * Перемешивание массива (алгоритм Фишера-Йейтса)
   */
  private shuffleArray<T>(_array: T[]): T[] {
    const shuffled = [..._array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Сброс счетчиков если прошел день/час
   */
  private resetCountersIfNeeded(): void {
    const now = new Date();

    // Сброс дневного счетчика
    if (now.getDate() !== this.p_lastResetDate.getDate()) {
      this.p_dailyCommentCount = 0;
      this.p_lastResetDate = now;
    }

    // Сброс часового счетчика
    if (now.getHours() !== this.p_lastResetDate.getHours()) {
      this.p_hourlyCommentCount = 0;
    }
  }

  /**
   * Получение статистики активных сессий
   */
  getActiveSessionsAsync(): ICommentingSession[] {
    return Array.from(this.p_activeSessions.values());
  }

  /**
   * Остановка активной сессии
   */
  stopSessionAsync(_sessionId: string): boolean {
    const session = this.p_activeSessions.get(_sessionId);
    if (session) {
      session.isActive = false;
      log.info(`⏹️ Сессия ${_sessionId} остановлена`);
      return true;
    }
    return false;
  }

  /**
   * Получение текущих лимитов
   */
  getCurrentLimits(): { daily: number; hourly: number } {
    this.resetCountersIfNeeded();
    return {
      daily: this.p_dailyCommentCount,
      hourly: this.p_hourlyCommentCount,
    };
  }

  /**
   * Проверка доступа к комментированию в каналах и фильтрация
   * Разделяет каналы на группы в зависимости от требований к участию
   */
  async filterChannelsByAccessAsync(
    _targets: ICommentTarget[],
  ): Promise<IChannelFilteringResponse> {
    log.info(
      `🔍 Проверка доступа к комментированию в ${_targets.length} каналах...`,
    );

    const accessibleChannels: ICommentTarget[] = [];
    const channelsNeedingJoin: ICommentTarget[] = [];
    const inaccessibleChannels: ICommentTarget[] = [];
    const membershipResults: ICommentAccessResult[] = [];

    for (const [index, target] of _targets.entries()) {
      log.info(
        `[${index + 1}/${_targets.length}] Проверка @${target.channelUsername}`,
      );

      try {
        const membershipInfo = await this.checkChannelMembershipAsync(
          target.channelUsername,
        );
        const accessResult = await this.analyzeCommentAccessAsync(
          target,
          membershipInfo,
        );

        membershipResults.push(accessResult);

        if (accessResult.commentingAllowed) {
          accessibleChannels.push(target);
          log.info(
            `✅ @${target.channelUsername} - доступен для комментирования`,
          );
        } else if (accessResult.needsJoining) {
          channelsNeedingJoin.push(target);
          log.info(`🚪 @${target.channelUsername} - требует вступления`);
        } else {
          inaccessibleChannels.push(target);
          log.info(`❌ @${target.channelUsername} - недоступен`);
        }

        // Задержка между проверками
        if (index < _targets.length - 1) {
          await delayAsync(1000);
        }
      } catch (error) {
        log.info(`❌ @${target.channelUsername} - ошибка: ${error}`);
        inaccessibleChannels.push(target);

        membershipResults.push({
          channel: target,
          membershipInfo: {
            channelUsername: target.channelUsername,
            isMember: false,
            membershipRequired: true,
            accessLevel: "private",
            canJoin: false,
          },
          commentingAllowed: false,
          needsJoining: false,
          errorDetails: error instanceof Error ? error.message : String(error),
        });
      }
    }

    log.info(`\n📊 Результаты фильтрации:`);
    log.info(`✅ Доступны: ${accessibleChannels.length}`);
    log.info(`🚪 Требуют вступления: ${channelsNeedingJoin.length}`);
    log.info(`❌ Недоступны: ${inaccessibleChannels.length}`);

    return {
      accessibleChannels,
      channelsNeedingJoin,
      inaccessibleChannels,
      membershipResults,
    };
  }

  /**
   * Проверка членства в канале
   */
  private async checkChannelMembershipAsync(
    _channelUsername: string,
  ): Promise<IChannelMembershipInfo> {
    try {
      // Получаем информацию о канале
      const channelEntity = await this.p_client.getEntity(_channelUsername);

      // Проверяем участие
      const participant = await this.p_client.invoke(
        new Api.channels.GetParticipant({
          channel: channelEntity,
          participant: new Api.InputPeerSelf(),
        }),
      );

      return {
        channelUsername: _channelUsername,
        isMember: true,
        membershipRequired: false,
        accessLevel: "public",
        canJoin: true,
      };
    } catch (error: any) {
      // Анализируем тип ошибки
      if (error.errorMessage === "USER_NOT_PARTICIPANT") {
        // Не участник, но канал существует
        return {
          channelUsername: _channelUsername,
          isMember: false,
          membershipRequired: true,
          accessLevel: "public",
          canJoin: true,
        };
      } else if (error.errorMessage === "CHANNEL_PRIVATE") {
        return {
          channelUsername: _channelUsername,
          isMember: false,
          membershipRequired: true,
          accessLevel: "private",
          canJoin: false,
          joinError: "Канал приватный",
        };
      } else if (error.errorMessage === "USERNAME_NOT_OCCUPIED") {
        return {
          channelUsername: _channelUsername,
          isMember: false,
          membershipRequired: false,
          accessLevel: "private",
          canJoin: false,
          joinError: "Канал не найден",
        };
      }

      // Другие ошибки
      return {
        channelUsername: _channelUsername,
        isMember: false,
        membershipRequired: true,
        accessLevel: "restricted",
        canJoin: false,
        joinError: error.message || "Неизвестная ошибка",
      };
    }
  }

  /**
   * Анализ возможности комментирования
   */
  private async analyzeCommentAccessAsync(
    _target: ICommentTarget,
    _membershipInfo: IChannelMembershipInfo,
  ): Promise<ICommentAccessResult> {
    // Если участник - проверяем возможность комментирования
    if (_membershipInfo.isMember) {
      try {
        // Пробуем получить последний пост для проверки комментариев
        const messages = await this.p_client.getMessages(
          _membershipInfo.channelUsername,
          { limit: 1 },
        );

        if (messages && messages.length > 0) {
          const lastMessage = messages[0];

          // Проверяем наличие связанной дискуссии
          const result = await this.p_client.invoke(
            new Api.messages.GetDiscussionMessage({
              peer: _membershipInfo.channelUsername,
              msgId: lastMessage.id,
            }),
          );

          if (result.messages && result.messages.length > 0) {
            return {
              channel: _target,
              membershipInfo: _membershipInfo,
              commentingAllowed: true,
              needsJoining: false,
            };
          }
        }
      } catch (error: any) {
        // Анализируем ошибку комментирования
        if (error.errorMessage === "CHAT_GUEST_SEND_FORBIDDEN") {
          return {
            channel: _target,
            membershipInfo: _membershipInfo,
            commentingAllowed: false,
            needsJoining: true,
            errorDetails: "Требуется быть участником для комментирования",
          };
        }
      }
    }

    // Если не участник, но может вступить
    if (!_membershipInfo.isMember && _membershipInfo.canJoin) {
      return {
        channel: _target,
        membershipInfo: _membershipInfo,
        commentingAllowed: false,
        needsJoining: true,
      };
    }

    // Недоступен
    return {
      channel: _target,
      membershipInfo: _membershipInfo,
      commentingAllowed: false,
      needsJoining: false,
      errorDetails: _membershipInfo.joinError || "Комментирование недоступно",
    };
  }

  /**
   * Получение списка каналов которыми управляет пользователь
   * Эти каналы можно использовать для отправки комментариев от их имени
   */
  async getUserChannelsAsync(): Promise<IUserChannel[]> {
    log.info("🔍 Получение списка каналов пользователя...");

    try {
      // Получаем каналы где пользователь является администратором
      const adminChannelsResult = await this.p_client.invoke(
        new Api.channels.GetAdminedPublicChannels({}),
      );

      const userChannels: IUserChannel[] = [];

      if (adminChannelsResult.chats) {
        for (const chat of adminChannelsResult.chats) {
          // Проверяем что это канал и у нас есть права на постинг
          if (chat.className === "Channel" && !chat.megagroup) {
            // Получаем полную информацию о канале
            try {
              // Пропускаем каналы без accessHash
              if (!chat.accessHash) {
                log.warn(`Пропускаем канал ${chat.title} - нет accessHash`);
                continue;
              }

              const fullChannelResult = await this.p_client.invoke(
                new Api.channels.GetFullChannel({
                  channel: new Api.InputChannel({
                    channelId: chat.id,
                    accessHash: chat.accessHash,
                  }),
                }),
              );

              const fullInfo = fullChannelResult.fullChat;

              // Проверяем что это ChannelFull для получения participantsCount
              const participantsCount =
                (fullInfo as any).participantsCount || 0;

              userChannels.push({
                id: chat.id.toString(),
                title: chat.title || "Неизвестный канал",
                username: chat.username,
                participantsCount: participantsCount,
                isChannel: true,
                canPost: true, // Если мы админы, то можем постить
                accessHash: chat.accessHash?.toString(),
              });
            } catch (error) {
              log.warn(
                `Не удалось получить информацию о канале ${chat.title}:`,
                { error },
              );
            }
          }
        }
      }

      log.info(`✅ Найдено каналов: ${userChannels.length}`);
      userChannels.forEach((ch) => {
        log.info(
          `📺 ${ch.title} (@${ch.username || "без username"}) - ${ch.participantsCount || 0} подписчиков`,
        );
      });

      return userChannels;
    } catch (error) {
      log.error("❌ Ошибка получения каналов пользователя:", error as Error);
      return [];
    }
  }

  /**
   * Проверка возможности отправки от имени канала
   */
  async canSendAsChannelAsync(
    _channelId: string,
    _targetChannel: string,
  ): Promise<boolean> {
    try {
      // Получаем доступные варианты отправки для целевого канала
      const sendAsResult = await this.p_client.invoke(
        new Api.channels.GetSendAs({
          peer: _targetChannel,
        }),
      );

      // Проверяем есть ли наш канал в списке доступных
      if (sendAsResult.chats) {
        return sendAsResult.chats.some(
          (chat: any) => chat.id.toString() === _channelId,
        );
      }

      return false;
    } catch (error) {
      log.warn(
        `Не удалось проверить возможность отправки от имени канала в ${_targetChannel}:`,
        { error },
      );
      return false;
    }
  }

  /**
   * Извлечение каналов для вступления из результатов комментирования
   */
  async extractChannelsForJoining(
    _commentingResponse: ICommentingResponse,
  ): Promise<{
    joinTargets: any[];
    savedFile?: string;
    report: string;
  }> {
    const joinTargets: any[] = [];
    const joinErrors = [
      "CHAT_GUEST_SEND_FORBIDDEN",
      "USER_BANNED_IN_CHANNEL",
      "CHANNEL_PRIVATE",
    ];

    // Анализируем результаты комментирования
    for (const result of _commentingResponse.results) {
      if (!result.success && result.error) {
        const needsJoining = joinErrors.some((errorType) =>
          result.error!.includes(errorType),
        );

        if (needsJoining) {
          const channelName = result.target.channelUsername;
          const channelUrl = result.target.channelUrl;

          // Добавляем в список для вступления
          joinTargets.push({
            channelUsername: channelName,
            channelUrl: channelUrl,
            channelTitle: result.target.channelTitle || channelName,
            reason: result.error,
            priority: "high", // Высокий приоритет для каналов с ошибками доступа
          });
        }
      }
    }

    let savedFile: string | undefined;
    let report = "";

    if (joinTargets.length > 0) {
      // Сохраняем файл для модуля вступления
      const fs = await import("fs");
      const path = await import("path");

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `failed_channels_${timestamp}.txt`;
      const filepath = path.join("./input-join-targets", filename);

      // Создаем директорию если не существует
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Формируем содержимое файла
      const fileContent = joinTargets
        .map(
          (target) =>
            `${target.channelUrl} # ${target.channelTitle} - ${target.reason}`,
        )
        .join("\n");

      fs.writeFileSync(filepath, fileContent, "utf-8");
      savedFile = filename;

      report = `
📋 Анализ ошибок комментирования:
• Найдено каналов для вступления: ${joinTargets.length}
• Сохранено в файл: ${filename}
• Расположение: ./input-join-targets/${filename}

🔍 Типы ошибок:
${joinTargets.map((t) => `• ${t.channelTitle}: ${t.reason}`).join("\n")}

💡 Рекомендация: Запустите модуль вступления в каналы:
   npm run join-channels
            `.trim();
    } else {
      report =
        "✅ Все каналы доступны для комментирования, вступление не требуется";
    }

    return {
      joinTargets,
      savedFile,
      report,
    };
  }

  // === НОВЫЕ МЕТОДЫ ДЛЯ РАБОТЫ С КОНТЕНТОМ ПОСТОВ ===

  /**
   * Тестирование извлечения контента постов без комментирования
   */
  async testContentExtractionAsync(
    _options: IContentExtractionTestOptions,
  ): Promise<IContentExtractionTestResult> {
    const sessionId = generateSessionId();
    const startTime = new Date();
    const posts: IPostContent[] = [];
    const errors: string[] = [];
    let successfulExtractions = 0;
    let failedExtractions = 0;

    log.info(`🧪 Начинаю тестирование извлечения контента: ${sessionId}`);
    log.info(`📋 Каналов для анализа: ${_options.targets.length}`);
    log.info(
      `💾 Сохранение результатов: ${_options.saveResults ? "ДА" : "НЕТ"}`,
    );

    try {
      for (const [index, target] of _options.targets.entries()) {
        log.info(
          `\n[${index + 1}/${_options.targets.length}] Анализирую @${target.channelUsername}`,
        );

        try {
          // Создаем InputChannel БЕЗ ResolveUsername
          const bigInt = await import("big-integer");
          const inputChannel = new Api.InputChannel({
            channelId: bigInt.default(target.channelId),
            accessHash: bigInt.default(target.accessHash),
          });

          // Получаем последний пост
          const messages = await this.p_client.getMessages(inputChannel, {
            limit: 1,
          });

          if (!messages || messages.length === 0) {
            throw new Error(
              `Нет сообщений в канале @${target.channelUsername}`,
            );
          }

          const lastMessage = messages[0];

          // Извлекаем контент поста
          const postContent = extractPostContent(
            lastMessage,
            target.channelId,
            target.channelUsername,
            target.channelTitle,
          );

          posts.push(postContent);
          successfulExtractions++;

          log.info(`✅ Контент извлечен:`);
          log.info(
            `   📄 Пост #${postContent.id} от ${postContent.date.toLocaleString("ru-RU")}`,
          );
          log.info(
            `   📝 Текст: "${postContent.text.substring(0, 100)}${postContent.text.length > 100 ? "..." : ""}"`,
          );
          log.info(
            `   📊 Метрики: ${postContent.views} просмотров, ${postContent.forwards} пересылок, ${postContent.reactions} реакций`,
          );
          log.info(
            `   🎬 Медиа: ${postContent.hasMedia ? `Да (${postContent.mediaType})` : "Нет"}`,
          );

          if (postContent.hashtags.length > 0) {
            log.info(`   🏷️ Хэштеги: ${postContent.hashtags.join(", ")}`);
          }
        } catch (error: any) {
          failedExtractions++;
          const errorMessage = `Ошибка извлечения контента из @${target.channelUsername}: ${error.message}`;
          errors.push(errorMessage);
          log.error(`❌ ${errorMessage}`);
        }

        // Небольшая задержка между запросами
        if (index < _options.targets.length - 1) {
          await delayAsync(1000);
        }
      }

      // Вычисляем статистику
      const contentStats = calculateContentStats(posts);
      const duration = new Date().getTime() - startTime.getTime();

      const result: IContentExtractionTestResult = {
        sessionId,
        totalChannels: _options.targets.length,
        successfulExtractions,
        failedExtractions,
        posts,
        contentStats,
        errors,
        duration,
      };

      // Сохраняем результаты если требуется
      if (_options.saveResults && posts.length > 0) {
        result.savedFile = await this.saveContentExtractionResults(
          result,
          _options,
        );
      }

      // Выводим итоговую статистику
      log.info(`\n✅ Тестирование завершено: ${sessionId}`);
      log.info(`📊 Результаты:`);
      log.info(`   • Успешно извлечено: ${successfulExtractions}`);
      log.info(`   • Ошибок: ${failedExtractions}`);
      log.info(`   • Длительность: ${formatDuration(duration)}`);
      log.info(`\n📈 Статистика контента:`);
      log.info(`   • Всего постов: ${contentStats.totalPosts}`);
      log.info(`   • Постов с текстом: ${contentStats.postsWithText}`);
      log.info(`   • Постов с медиа: ${contentStats.postsWithMedia}`);
      log.info(
        `   • Средние просмотры: ${contentStats.averageViews.toLocaleString()}`,
      );
      log.info(
        `   • Средние пересылки: ${contentStats.averageForwards.toLocaleString()}`,
      );
      log.info(
        `   • Средние реакции: ${contentStats.averageReactions.toLocaleString()}`,
      );

      if (contentStats.topHashtags.length > 0) {
        log.info(
          `   • Топ хэштеги: ${contentStats.topHashtags.slice(0, 5).join(", ")}`,
        );
      }

      if (result.savedFile) {
        log.info(`\n💾 Результаты сохранены: ${result.savedFile}`);
      }

      return result;
    } catch (error) {
      log.error("❌ Критическая ошибка тестирования:", error as Error);
      throw error;
    }
  }

  /**
   * Сохранение результатов извлечения контента
   */
  private async saveContentExtractionResults(
    _result: IContentExtractionTestResult,
    _options: IContentExtractionTestOptions,
  ): Promise<string> {
    const fs = await import("fs");
    const path = await import("path");

    // Создаем директорию exports если не существует
    const exportsDir = "./exports";
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `content_extraction_${timestamp}.${_options.outputFormat}`;
    const filepath = path.join(exportsDir, filename);

    let content = "";

    switch (_options.outputFormat) {
      case "json":
        content = JSON.stringify(_result, null, 2);
        break;

      case "csv":
        content = this.formatContentResultsAsCSV(_result, _options);
        break;

      case "txt":
        content = this.formatContentResultsAsText(_result, _options);
        break;
    }

    fs.writeFileSync(filepath, content, "utf-8");
    return filename;
  }

  /**
   * Форматирование результатов в CSV
   */
  private formatContentResultsAsCSV(
    _result: IContentExtractionTestResult,
    _options: IContentExtractionTestOptions,
  ): string {
    const headers = [
      "Канал",
      "ID_Поста",
      "Дата",
      "Просмотры",
      "Пересылки",
      "Реакции",
      "Есть_Медиа",
      "Тип_Медиа",
      "Длина_Текста",
      "Есть_Ссылки",
      "Хэштеги",
      "Упоминания",
    ];

    if (_options.includeFullText) {
      headers.push("Полный_Текст");
    }

    let csv = headers.join(",") + "\n";

    _result.posts.forEach((post: IPostContent) => {
      const row = [
        `@${post.channelUsername}`,
        post.id,
        post.date.toISOString(),
        post.views,
        post.forwards,
        post.reactions,
        post.hasMedia ? "Да" : "Нет",
        post.mediaType || "",
        post.messageLength,
        post.hasLinks ? "Да" : "Нет",
        `"${post.hashtags.join("; ")}"`,
        `"${post.mentions.join("; ")}"`,
      ];

      if (_options.includeFullText) {
        const cleanText = post.text.replace(/"/g, '""').replace(/\n/g, " ");
        row.push(`"${cleanText}"`);
      }

      csv += row.join(",") + "\n";
    });

    return csv;
  }

  /**
   * Форматирование результатов в текстовый формат
   */
  private formatContentResultsAsText(
    _result: IContentExtractionTestResult,
    _options: IContentExtractionTestOptions,
  ): string {
    let text = `# Результаты извлечения контента постов\n\n`;
    text += `Сессия: ${_result.sessionId}\n`;
    text += `Дата: ${new Date().toLocaleString("ru-RU")}\n`;
    text += `Длительность: ${formatDuration(_result.duration)}\n\n`;

    text += `## Статистика\n`;
    text += `- Всего каналов: ${_result.totalChannels}\n`;
    text += `- Успешно обработано: ${_result.successfulExtractions}\n`;
    text += `- Ошибок: ${_result.failedExtractions}\n`;
    text += `- Всего постов: ${_result.contentStats.totalPosts}\n`;
    text += `- Постов с текстом: ${_result.contentStats.postsWithText}\n`;
    text += `- Постов с медиа: ${_result.contentStats.postsWithMedia}\n`;
    text += `- Средние просмотры: ${_result.contentStats.averageViews.toLocaleString()}\n`;
    text += `- Средние пересылки: ${_result.contentStats.averageForwards.toLocaleString()}\n`;
    text += `- Средние реакции: ${_result.contentStats.averageReactions.toLocaleString()}\n\n`;

    if (_result.contentStats.topHashtags.length > 0) {
      text += `## Популярные хэштеги\n`;
      _result.contentStats.topHashtags.forEach((tag: string, index: number) => {
        text += `${index + 1}. ${tag}\n`;
      });
      text += "\n";
    }

    text += `## Посты\n\n`;
    _result.posts.forEach((post: IPostContent, index: number) => {
      text += `### ${index + 1}. @${post.channelUsername} - Пост #${post.id}\n`;
      text += `**Дата:** ${post.date.toLocaleString("ru-RU")}\n`;
      text += `**Метрики:** ${post.views} просмотров, ${post.forwards} пересылок, ${post.reactions} реакций\n`;
      text += `**Медиа:** ${post.hasMedia ? `Да (${post.mediaType})` : "Нет"}\n`;

      if (post.hashtags.length > 0) {
        text += `**Хэштеги:** ${post.hashtags.join(", ")}\n`;
      }

      if (post.mentions.length > 0) {
        text += `**Упоминания:** ${post.mentions.join(", ")}\n`;
      }

      if (_options.includeFullText && post.text.trim()) {
        text += `**Текст:**\n${post.text}\n`;
      } else if (post.text.trim()) {
        const preview =
          post.text.length > 200
            ? post.text.substring(0, 200) + "..."
            : post.text;
        text += `**Превью:** ${preview}\n`;
      }

      text += "\n---\n\n";
    });

    if (_result.errors.length > 0) {
      text += `## Ошибки\n\n`;
      _result.errors.forEach((error: string, index: number) => {
        text += `${index + 1}. ${error}\n`;
      });
    }

    return text;
  }

  /**
   * Упрощенное комментирование с AI генерацией
   */
  async postCommentsWithAIAsync(
    _options: ICommentingOptionsWithAI,
  ): Promise<ICommentingResponseWithAI> {
    const sessionId = `ai_${Date.now()}`;
    const startTime = new Date();

    const session: ICommentingSession = {
      sessionId,
      startTime,
      targetsProcessed: 0,
      successfulComments: 0,
      failedComments: 0,
      errors: [],
      isActive: true,
    };

    this.p_activeSessions.set(sessionId, session);

    const results: ICommentResult[] = [];
    const aiResults: IAICommentResult[] = [];
    let skippedPosts = 0;

    try {
      for (const [index, target] of _options.targets.entries()) {
        if (!session.isActive) {
          break;
        }

        try {
          // Получаем пост
          const postContent = await this.extractPostContentAsync(
            target.channelUsername,
          );

          // Проверяем пригодность поста
          const shouldComment = shouldCommentOnPost(postContent);

          let commentText = "";
          let aiResult: IAICommentResult = {
            comment: "",
            success: false,
            isValid: false,
          };

          // Если пост не подходит для AI комментария → ПРОПУСКАЕМ
          if (!shouldComment.shouldComment) {
            log.info(`⏭️ Пост пропущен (короткий или неинформативный)`, {
              channel: target.channelUsername,
              reason: shouldComment.reason,
              postLength: postContent.text?.length || 0
            });

            // Добавляем результат с ошибкой POST_SKIPPED и пропускаем канал
            results.push({
              target,
              success: false,
              error: `POST_SKIPPED: ${shouldComment.reason}`,
              timestamp: new Date(),
              retryCount: 0,
            });

            session.targetsProcessed++;
            session.failedComments++;
            session.errors.push(`POST_SKIPPED: ${target.channelUsername}`);

            continue; // Переходим к следующему каналу
          } else {
            // Генерируем комментарий через AI
            if (_options.useAI && _options.aiGenerator) {
              aiResult =
                await _options.aiGenerator.generateCommentAsync(postContent);
              if (aiResult.success && aiResult.isValid) {
                commentText = aiResult.comment;
              }
            }

            // Fallback на шаблон
            if (!commentText) {
              const selectedMessage = selectRandomComment(_options.messages);
              commentText = selectedMessage?.text || "Интересно!";
            }
          }

          aiResults.push(aiResult);

          // Отправляем комментарий
          if (_options.dryRun) {
            results.push({
              target,
              success: true,
              commentText,
              postId: postContent.id,
              timestamp: new Date(),
              retryCount: 0,
            });
            session.successfulComments++;
          } else {
            const messageId = await this.postCommentAsync(
              target.channelUsername,
              commentText,
              _options.sendAsOptions,
              postContent.id,
            );
            results.push({
              target,
              success: true,
              commentText,
              postedMessageId: messageId,
              postId: postContent.id,
              timestamp: new Date(),
              retryCount: 0,
            });
            session.successfulComments++;
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          // КРИТИЧНО: Останавливаем выполнение при FloodWaitError для избежания блокировки аккаунта
          if (
            error &&
            (error.constructor.name === "FloodWaitError" ||
              ((error as any).errorMessage &&
                (error as any).errorMessage === "FLOOD") ||
              errorMessage.toLowerCase().includes("flood wait") ||
              errorMessage.toLowerCase().includes("a wait of"))
          ) {
            const waitSeconds = (error as any).seconds || "неизвестно";

            // Добавляем информацию об ошибке в результаты
            results.push({
              target,
              success: false,
              error: `FLOOD_WAIT: Требуется ожидание ${waitSeconds} секунд`,
              timestamp: new Date(),
              retryCount: 0,
            });

            session.errors.push(`FLOOD_WAIT: ${waitSeconds} секунд`);
            session.failedComments++;

            // Прерываем цикл для предотвращения дальнейших запросов
            session.isActive = false;
            break;
          }

          results.push({
            target,
            success: false,
            error: errorMessage,
            timestamp: new Date(),
            retryCount: 0,
          });

          session.errors.push(errorMessage);
          session.failedComments++;
        }

        session.targetsProcessed++;

        // Задержка между целями
        if (index < _options.targets.length - 1) {
          const delay = _options.delayBetweenTargets || 5000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    } finally {
      session.isActive = false;
      this.p_activeSessions.delete(sessionId);
    }

    const duration = new Date().getTime() - startTime.getTime();

    const response: ICommentingResponseWithAI = {
      sessionId,
      totalTargets: session.targetsProcessed,
      successfulComments: session.successfulComments,
      failedComments: session.failedComments,
      results,
      duration,
      summary: {
        successRate:
          session.targetsProcessed > 0
            ? (session.successfulComments / session.targetsProcessed) * 100
            : 0,
        averageDelay:
          session.targetsProcessed > 1
            ? duration / (session.targetsProcessed - 1)
            : 0,
        errorsByType: calculateErrorStats(session.errors),
      },
      aiResults,
      aiSummary: {
        totalAIRequests: aiResults.length,
        successfulAIRequests: aiResults.filter((r) => r.success).length,
        failedAIRequests: aiResults.filter((r) => !r.success).length,
        skippedPosts,
      },
    };

    return response;
  }

  /**
   * Построение IPostContent из сообщения Telegram
   */
  private buildPostContent(
    message: Api.Message,
    channelId: string,
    channelUsername: string,
    channelTitle: string,
  ): IPostContent {
    const text = message.message || "";
    const hasMedia = Boolean(message.media);

    let mediaType:
      | "photo"
      | "video"
      | "document"
      | "audio"
      | "sticker"
      | "voice"
      | "animation"
      | "poll"
      | "contact"
      | "location"
      | undefined;
    if (hasMedia && message.media) {
      if ("poll" in message.media) {
        mediaType = "poll";
      } else if ("photo" in message.media) {
        mediaType = "photo";
      } else if ("document" in message.media) {
        mediaType = "document";
      } else if ("sticker" in message.media) {
        mediaType = "sticker";
      } else {
        mediaType = "document"; // Fallback для других типов
      }
    }

    return {
      id: message.id,
      text,
      date: new Date(message.date * 1000),
      views: message.views || 0,
      forwards: message.forwards || 0,
      reactions:
        message.reactions?.results?.reduce((sum, r) => sum + r.count, 0) || 0,
      hasMedia,
      mediaType,
      channelId,
      channelUsername,
      channelTitle: channelTitle || channelUsername,
      messageLength: text.length,
      hasLinks: text.includes("http") || text.includes("t.me"),
      hashtags: text.match(/#\w+/g) || [],
      mentions: text.match(/@\w+/g) || [],
    };
  }

  /**
   * Извлекает контент поста из канала
   * Проверяет до 5 последних постов — выбирает первый подходящий для комментирования
   */
  private async extractPostContentAsync(
    _channelUsername: string,
  ): Promise<IPostContent> {
    const entity = await this.p_client.getEntity(_channelUsername);
    const messages = await this.p_client.getMessages(entity, { limit: 5 });

    if (!messages || messages.length === 0) {
      throw new Error(`Нет сообщений в канале @${_channelUsername}`);
    }

    const channelTitle = "title" in entity ? entity.title : _channelUsername;
    const channelId = entity.id.toString();

    // Перебираем посты от нового к старому — выбираем первый подходящий
    for (const message of messages) {
      const postContent = this.buildPostContent(message, channelId, _channelUsername, channelTitle);
      if (shouldCommentOnPost(postContent).shouldComment) {
        return postContent;
      }
    }

    // Все 5 не подошли — возвращаем последний (вызовет POST_SKIPPED в вызывающем коде)
    return this.buildPostContent(messages[0], channelId, _channelUsername, channelTitle);
  }

  /**
   * Легковесная отправка комментария (3 запроса вместо 5)
   * Для USA аккаунтов со строгими лимитами
   *
   * Экономит запросы:
   * - Без getEntity для sendAs (комментируем от профиля)
   * - Без проверочного getMessages после отправки
   */
  async postCommentLightAsync(
    channelUsername: string,
    commentText: string
  ): Promise<{ success: boolean; messageId?: number; error?: string }> {
    const cleanUsername = cleanChannelUsername(channelUsername);

    try {
      // 1. Получаем последний пост
      const messages = await this.p_client.getMessages(cleanUsername, { limit: 1 });
      if (!messages?.length) {
        return { success: false, error: "NO_MESSAGES" };
      }

      const lastMessage = messages[0];

      // 2. Получаем чат обсуждения
      const result = await this.p_client.invoke(
        new Api.messages.GetDiscussionMessage({
          peer: cleanUsername,
          msgId: lastMessage.id,
        })
      );

      if (!result.messages?.length) {
        return { success: false, error: "NO_DISCUSSION" };
      }

      const discussionMessage = result.messages[0];
      const peer = discussionMessage.peerId || cleanUsername;

      // 3. Отправляем комментарий (без проверки!)
      const sendResult = await this.p_client.invoke(
        new Api.messages.SendMessage({
          peer: peer,
          message: commentText,
          replyTo: new Api.InputReplyToMessage({
            replyToMsgId: discussionMessage.id,
          }),
        })
      );

      // Извлекаем ID из updates (если есть)
      if (sendResult && "updates" in sendResult && sendResult.updates) {
        for (const update of sendResult.updates) {
          if (
            "message" in update &&
            update.message &&
            typeof update.message === "object" &&
            "id" in update.message
          ) {
            return { success: true, messageId: (update.message as any).id };
          }
        }
      }

      // Считаем успехом если нет ошибки
      return { success: true };
    } catch (error: any) {
      const errorMessage = error.errorMessage || error.message || String(error);

      // Прокидываем FLOOD_WAIT как есть для обработки выше
      if (errorMessage.includes("FLOOD_WAIT") || error.code === 420) {
        throw error;
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Легковесная отправка комментария с AI генерацией (3 запроса вместо 7)
   *
   * Оптимизации:
   * - getMessages используется и для контента и для ID поста (1 запрос вместо 2)
   * - Без getEntity для sendAs
   * - Без проверочного getMessages после отправки
   *
   * @param channelUsername - username канала
   * @param aiGenerator - сервис генерации комментариев
   * @returns Результат с текстом комментария
   */
  async postCommentLightWithAIAsync(
    channelUsername: string,
    aiGenerator: { generateCommentAsync: (content: IPostContent) => Promise<IAICommentResult> }
  ): Promise<{ success: boolean; comment?: string; messageId?: number; error?: string }> {
    const cleanUsername = cleanChannelUsername(channelUsername);

    try {
      // 1. Получаем последний пост (для контента И для ID)
      const messages = await this.p_client.getMessages(cleanUsername, { limit: 1 });
      if (!messages?.length) {
        return { success: false, error: "NO_MESSAGES" };
      }

      const message = messages[0];

      // Извлекаем контент поста для AI
      const postContent: IPostContent = {
        id: message.id,
        text: message.message || "",
        date: new Date(message.date * 1000),
        views: message.views || 0,
        forwards: message.forwards || 0,
        reactions: (message.reactions as any)?.results?.reduce((sum: number, r: any) => sum + r.count, 0) || 0,
        hasMedia: Boolean(message.media),
        mediaType: undefined,
        channelId: "",
        channelUsername: cleanUsername,
        channelTitle: cleanUsername,
        messageLength: (message.message || "").length,
        hasLinks: (message.message || "").includes("http"),
        hashtags: (message.message || "").match(/#\w+/g) || [],
        mentions: (message.message || "").match(/@\w+/g) || [],
      };

      // Проверяем пригодность поста
      const shouldComment = shouldCommentOnPost(postContent);
      if (!shouldComment.shouldComment) {
        return { success: false, error: `POST_SKIPPED: ${shouldComment.reason}` };
      }

      // Генерируем комментарий через AI
      const aiResult = await aiGenerator.generateCommentAsync(postContent);
      if (!aiResult.success || !aiResult.isValid || !aiResult.comment) {
        return { success: false, error: "AI_GENERATION_FAILED" };
      }

      // 2. Получаем чат обсуждения
      const discussionResult = await this.p_client.invoke(
        new Api.messages.GetDiscussionMessage({
          peer: cleanUsername,
          msgId: message.id,
        })
      );

      if (!discussionResult.messages?.length) {
        return { success: false, error: "NO_DISCUSSION" };
      }

      const discussionMessage = discussionResult.messages[0];
      const peer = discussionMessage.peerId || cleanUsername;

      // 3. Отправляем комментарий
      const sendResult = await this.p_client.invoke(
        new Api.messages.SendMessage({
          peer: peer,
          message: aiResult.comment,
          replyTo: new Api.InputReplyToMessage({
            replyToMsgId: discussionMessage.id,
          }),
        })
      );

      // Извлекаем ID из updates
      let messageId: number | undefined;
      if (sendResult && "updates" in sendResult && sendResult.updates) {
        for (const update of sendResult.updates) {
          if (
            "message" in update &&
            update.message &&
            typeof update.message === "object" &&
            "id" in update.message
          ) {
            messageId = (update.message as any).id;
            break;
          }
        }
      }

      return { success: true, comment: aiResult.comment, messageId };
    } catch (error: any) {
      const errorMessage = error.errorMessage || error.message || String(error);

      // Прокидываем FLOOD_WAIT как есть
      if (errorMessage.includes("FLOOD_WAIT") || error.code === 420) {
        throw error;
      }

      return { success: false, error: errorMessage };
    }
  }
}
