import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Logger } from "telegram/extensions";
import * as dotenv from "dotenv";

dotenv.config();

export class GramClient {
  private client: TelegramClient;
  private session: StringSession;

  constructor() {
    this.session = new StringSession(process.env.SESSION_STRING || "");

    if (!process.env.API_ID || !process.env.API_HASH) {
      throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
    }

    // Создаем тихий логгер для подавления TIMEOUT ошибок из updates loop
    const logger = new Logger("none" as any);

    this.client = new TelegramClient(
      this.session,
      Number(process.env.API_ID),
      process.env.API_HASH,
      {
        connectionRetries: 5,
        useWSS: false,
        baseLogger: logger,
        requestRetries: 3,
        autoReconnect: true,
        deviceModel: "Desktop",
        systemVersion: "macOS 14.5.0",
        appVersion: "1.0.0",
        langCode: "ru",
        systemLangCode: "ru",
      }
    );
  }

  async connect(): Promise<void> {
    try {
      console.log("Подключение к Telegram...");
      await this.client.connect();

      // Проверяем авторизацию
      const authorized = await this.client.isUserAuthorized();
      if (!authorized) {
        throw new Error(
          "Пользователь не авторизован. Запустите скрипт авторизации (npm run auth)"
        );
      }

      console.log("Успешно подключено к Telegram");
    } catch (error) {
      console.error("Ошибка подключения:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
    } catch (error) {
      console.error("Ошибка при отключении:", error);
    }
  }

  getClient(): TelegramClient {
    return this.client;
  }

  /**
   * Безопасное выполнение операций с повторными попытками при ошибках соединения
   */
  async executeWithRetry<T>(operation: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;

        console.warn(`⚠️ Попытка ${attempt}/${maxRetries} не удалась:`, error.message);

        // Проверяем, является ли ошибка связанной с соединением
        if (this.isConnectionError(error)) {
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Экспоненциальная задержка
            console.log(`⏳ Ожидание ${delay}ms перед повторной попыткой...`);
            await new Promise(resolve => setTimeout(resolve, delay));

            // Пытаемся переподключиться
            try {
              if (!this.client.connected) {
                console.log('🔄 Переподключение к Telegram...');
                await this.client.connect();
              }
            } catch (reconnectError) {
              console.warn('⚠️ Ошибка переподключения:', reconnectError);
            }
          }
        } else {
          // Если ошибка не связана с соединением, сразу прокидываем её
          throw error;
        }
      }
    }

    throw lastError!;
  }

  /**
   * Проверяет, является ли ошибка связанной с соединением
   */
  private isConnectionError(error: any): boolean {
    const connectionErrorMessages = [
      'TIMEOUT',
      'CONNECTION_DEVICE_ERROR',
      'NETWORK_ERROR',
      'Socket connection failed',
      'Connection closed',
      'connection closed',
      'ECONNRESET',
      'ENOTFOUND',
      'ETIMEDOUT'
    ];

    const errorMessage = error.message || error.toString();
    return connectionErrorMessages.some(msg =>
      errorMessage.includes(msg)
    );
  }
}
