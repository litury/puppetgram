/**
 * Простой модуль проверки спама через @SpamBot
 * Минимальный технический долг, гибкая поддержка
 */

import { createLogger } from '../utils/logger';

const log = createLogger('SpamChecker');

export interface ISpamCheckResult {
  isSpammed: boolean;
  canSendMessages: boolean;
  accountName: string;
  checkDate: Date;
  rawResponse?: string;
  floodWait?: boolean;
  checkSkipped?: boolean;
}

export class SpamChecker {
  /**
   * Проверка аккаунта на спам через @SpamBot
   */
  async checkAccountSpamStatus(
    telegramClient: any,
    accountName: string,
  ): Promise<ISpamCheckResult> {
    try {
      log.info(`🕵️ Проверяю спам-статус аккаунта ${accountName}...`);

      // Отправляем /start боту @SpamBot
      const spamBotUsername = "SpamBot";
      const startMessage = "/start";

      try {
        await telegramClient.sendMessage(spamBotUsername, {
          message: startMessage,
        });
      } catch (sendError: any) {
        if (sendError.message && sendError.message.includes("FLOOD_WAIT")) {
          log.info(
            `⏳ FLOOD_WAIT при отправке сообщения @SpamBot для ${accountName}`,
          );
          const floodError = new Error(
            `FLOOD_WAIT_DETECTED: Аккаунт ${accountName} исчерпал лимит API запросов при отправке`,
          );
          (floodError as any).isFloodWait = true;
          (floodError as any).accountName = accountName;
          throw floodError;
        }
        throw sendError;
      }

      // Ждем ответ (небольшая задержка)
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Получаем последние сообщения от @SpamBot
      let messages;
      try {
        messages = await telegramClient.getMessages(spamBotUsername, {
          limit: 3,
        });
      } catch (getError: any) {
        if (getError.message && getError.message.includes("FLOOD_WAIT")) {
          log.info(
            `⏳ FLOOD_WAIT при получении сообщений от @SpamBot для ${accountName}`,
          );
          const floodError = new Error(
            `FLOOD_WAIT_DETECTED: Аккаунт ${accountName} исчерпал лимит API запросов при получении`,
          );
          (floodError as any).isFloodWait = true;
          (floodError as any).accountName = accountName;
          throw floodError;
        }
        throw getError;
      }

      if (!messages || messages.length === 0) {
        log.info(
          `⚠️ Не удалось получить ответ от @SpamBot для ${accountName}`,
        );
        return {
          isSpammed: false,
          canSendMessages: true, // По умолчанию считаем что можно
          accountName,
          checkDate: new Date(),
        };
      }

      // Анализируем последнее сообщение от бота
      const lastMessage = messages[0];
      const messageText = lastMessage.message?.toLowerCase() || "";

      log.info(
        `📋 Ответ @SpamBot для ${accountName}: "${messageText.substring(0, 100)}..."`,
      );

      // Проверяем сообщение "Ваш аккаунт свободен от каких-либо ограничений"
      const cleanAccountMessage =
        "ваш аккаунт свободен от каких-либо ограничений";
      const isCleanAccount = messageText.includes(cleanAccountMessage);

      // Ключевые слова которые указывают на спам/ограничения
      const spamKeywords = [
        "restricted",
        "limited",
        "spam",
        "спам",
        "ограничен",
        "заблокирован",
        "нарушение",
        "violation",
        "ограничени", // частичное совпадение для разных форм
        "блокирован",
        "запрещен",
      ];

      // Определяем статус спама
      let isSpammed: boolean;
      if (isCleanAccount) {
        // Если аккаунт чистый - точно не спам
        isSpammed = false;
      } else {
        // Проверяем на ключевые слова спама
        isSpammed = spamKeywords.some((keyword) =>
          messageText.includes(keyword),
        );
      }

      const result: ISpamCheckResult = {
        isSpammed,
        canSendMessages: !isSpammed,
        accountName,
        checkDate: new Date(),
        rawResponse: messageText,
      };

      if (isSpammed) {
        log.info(`🚫 Аккаунт ${accountName} в спаме!`);
      } else {
        log.info(`✅ Аккаунт ${accountName} чистый`);
      }

      return result;
    } catch (error: any) {
      log.info(`❌ Ошибка проверки спама для ${accountName}: ${error}`);

      const errorMessage = (error?.message || error?.toString() || "").toLowerCase();
      const constructorName = error?.constructor?.name || "";

      // 1) FLOOD_WAIT — временный rate-limit. У gramjs error.message = "A wait of N seconds is required",
      // слова "FLOOD_WAIT" в нём нет — поэтому надёжнее проверять по коду / классу / regex.
      const isFloodWait =
        error?.code === 420 ||
        constructorName === "FloodWaitError" ||
        /a wait of|flood.?wait/i.test(errorMessage);

      if (isFloodWait) {
        // FLOOD_WAIT — временный лимит API, не спам. Возвращаем checkSkipped=true
        // вместо throw — внешний код (findTargetChannel) не оборачивает spam-check
        // в try/catch, и throw приводит к падению скрипта. Бот пойдёт пытаться
        // комментировать, на первой попытке поймает FLOOD_WAIT и корректно
        // отработает через handleOwnerFloodWait (передача канала другому).
        log.info(
          `⏳ FLOOD_WAIT в spam-check для ${accountName} — пропускаем проверку, recovery через handleOwnerFloodWait`,
        );
        return {
          isSpammed: false,
          canSendMessages: true,
          accountName,
          checkDate: new Date(),
          checkSkipped: true,
          floodWait: true,
          rawResponse: `FLOOD_WAIT (skipped): ${errorMessage.substring(0, 200)}`,
        };
      }

      // 2) Терминальные ошибки — аккаунт мёртв (бан/удалён/разлогинен).
      // Помечаем как isSpammed=true — это попадёт в spammedAccounts Set,
      // и больше использовать этот аккаунт не будем.
      const isDead =
        /auth_key_(unregistered|invalid)|user_deactivated|session_(revoked|expired)|phone_number_banned/i.test(
          errorMessage,
        );

      if (isDead) {
        log.info(
          `💀 Аккаунт ${accountName} мёртв (${errorMessage.substring(0, 100)})`,
        );
        return {
          isSpammed: true,
          canSendMessages: false,
          accountName,
          checkDate: new Date(),
          rawResponse: `DEAD: ${errorMessage.substring(0, 200)}`,
        };
      }

      // 3) Сетевые / неизвестные — считаем чистым (текущее поведение),
      // но логируем для последующего разбора если что-то новое всплывает.
      const isNetwork = /timeout|econnreset|enotfound|socket|network/i.test(
        errorMessage,
      );
      if (!isNetwork) {
        log.info(
          `❓ Неизвестная ошибка spam-check для ${accountName}: ${errorMessage.substring(0, 200)}`,
        );
      }

      return {
        isSpammed: false,
        canSendMessages: true,
        accountName,
        checkDate: new Date(),
        checkSkipped: true,
        rawResponse: `Ошибка: ${errorMessage.substring(0, 200)}`,
      };
    }
  }

  /**
   * Быстрая проверка - аккаунт в спаме или нет
   */
  async isAccountSpammed(
    telegramClient: any,
    accountName: string,
  ): Promise<boolean> {
    const result = await this.checkAccountSpamStatus(
      telegramClient,
      accountName,
    );
    return result.isSpammed;
  }

  /**
   * Надежная проверка с двойной проверкой (решает проблему неточного первого ответа)
   */
  async isAccountSpammedReliable(
    telegramClient: any,
    accountName: string,
  ): Promise<boolean> {
    log.info(`🔍 Проверка спама для ${accountName}...`);

    // Первая проверка
    const first = await this.isAccountSpammed(telegramClient, accountName);

    // Если первая показала «не спам» — доверяем (Telegram API детерминирован).
    // Вторая проверка нужна только для подтверждения положительного результата
    // (исторически бывали ложные срабатывания на «спам»). Экономит ~50% запросов
    // к @SpamBot для чистых аккаунтов.
    if (!first) {
      log.info(`✅ Аккаунт ${accountName} чистый (1 проверка)`);
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
    const second = await this.isAccountSpammed(telegramClient, accountName);

    const result = first && second;
    log.info(`📊 Подтверждение спама: 1-я=true, 2-я=${second}, итого=${result}`);
    return result;
  }

  /**
   * Анализ ошибки - может ли это быть спам
   */
  static analyzeError(error: any): {
    mightBeSpam: boolean;
    shouldCheckSpam: boolean;
  } {
    const errorMessage = (error?.message || error || "")
      .toString()
      .toLowerCase();

    // Ошибки которые могут указывать на спам
    const spamIndicators = [
      "chat_guest_send_forbidden",
      "user_banned_in_channel",
      "chat_restricted",
      "user_restricted",
      "peer_flood",
    ];

    // Ошибки которые точно НЕ спам (FloodWait и прочие)
    const notSpamErrors = ["flood_wait", "flood", "timeout", "network"];

    const mightBeSpam = spamIndicators.some((indicator) =>
      errorMessage.includes(indicator),
    );
    const definitelyNotSpam = notSpamErrors.some((notSpam) =>
      errorMessage.includes(notSpam),
    );

    return {
      mightBeSpam: mightBeSpam && !definitelyNotSpam,
      shouldCheckSpam: mightBeSpam && !definitelyNotSpam,
    };
  }
}
