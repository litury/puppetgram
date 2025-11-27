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

      // Проверяем, является ли ошибка FLOOD_WAIT
      const errorMessage = error?.message || error?.toString() || "";
      const isFloodWait = errorMessage.includes("FLOOD_WAIT");

      if (isFloodWait) {
        log.info(
          `⏳ Аккаунт ${accountName} имеет FLOOD_WAIT - требуется передача канала`,
        );
        // Выбрасываем специальную ошибку для FLOOD_WAIT, чтобы основной скрипт мог её обработать
        const floodError = new Error(
          `FLOOD_WAIT_DETECTED: Аккаунт ${accountName} исчерпал лимит API запросов`,
        );
        (floodError as any).isFloodWait = true;
        (floodError as any).accountName = accountName;
        throw floodError;
      }

      // В случае других ошибок считаем аккаунт чистым
      return {
        isSpammed: false,
        canSendMessages: true,
        accountName,
        checkDate: new Date(),
        checkSkipped: true,
        rawResponse: `Ошибка: ${errorMessage}`,
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
    log.info(`🔍 Двойная проверка спама для ${accountName}...`);

    // Первая проверка
    const first = await this.isAccountSpammed(telegramClient, accountName);

    // Вторая проверка через 2 секунды (для точности)
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const second = await this.isAccountSpammed(telegramClient, accountName);

    // Спам только если обе проверки показали спам (первая может быть ложноположительной)
    const result = first && second;
    log.info(`📊 Результат: 1-я=${first}, 2-я=${second}, итого=${result}`);
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
