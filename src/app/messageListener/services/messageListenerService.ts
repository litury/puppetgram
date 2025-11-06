import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Logger } from "telegram/extensions";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { IConvertedSessionData, IListenerConfig } from "../interfaces/listenerConfig.interface";
import { IMessageData } from "../interfaces/messageEvent.interface";
import { MessageFormatterAdapter } from "../adapters/messageFormatterAdapter";

/**
 * Сервис для прослушивания входящих сообщений
 */
export class MessageListenerService {
  private client: TelegramClient | null = null;
  private sessionData: IConvertedSessionData | null = null;
  private config: IListenerConfig;
  private messageCount: number = 0;
  private startTime: Date = new Date();
  private isRunning: boolean = false;

  constructor(config: IListenerConfig = {}) {
    this.config = {
      privateOnly: config.privateOnly ?? true,
      incomingOnly: config.incomingOnly ?? true,
      ...config,
    };
  }

  /**
   * Подключается к Telegram с использованием StringSession
   */
  async connect(sessionData: IConvertedSessionData): Promise<void> {
    this.sessionData = sessionData;

    console.log(`\nПодключение к Telegram...`);
    console.log(`Аккаунт: ${sessionData.phone}`);

    // Создаем StringSession
    const session = new StringSession(sessionData.sessionString);

    // Создаем клиента
    const logger = new Logger("none" as any);
    this.client = new TelegramClient(
      session,
      sessionData.app_id,
      sessionData.app_hash,
      {
        connectionRetries: 5,
        baseLogger: logger,
        autoReconnect: true,
      }
    );

    // Подключаемся
    await this.client.connect();

    // Проверяем авторизацию
    const isAuthorized = await this.client.isUserAuthorized();

    if (!isAuthorized) {
      throw new Error("Сессия не авторизована");
    }

    // Получаем информацию о себе
    const me = await this.client.getMe();
    console.log(`✓ Подключено как: ${me.firstName} (@${me.username || "N/A"})`);
  }

  /**
   * Запускает прослушивание входящих сообщений
   */
  async startListening(): Promise<void> {
    if (!this.client) {
      throw new Error("Клиент не подключен. Вызовите connect() сначала");
    }

    this.isRunning = true;
    this.startTime = new Date();
    this.messageCount = 0;

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  Прослушивание входящих сообщений");
    console.log("═══════════════════════════════════════════════════════");

    if (this.config.privateOnly) {
      console.log("Фильтр: Только личные сообщения");
    }
    if (this.config.groupsOnly) {
      console.log("Фильтр: Только группы");
    }
    if (this.config.channelsOnly) {
      console.log("Фильтр: Только каналы");
    }

    console.log("\nОжидание сообщений...");
    console.log("(Нажмите Ctrl+C для остановки)\n");

    // Добавляем обработчик входящих сообщений
    this.client.addEventHandler(
      this.handleNewMessage.bind(this),
      new NewMessage({ incoming: this.config.incomingOnly })
    );

    // Настраиваем обработку Ctrl+C
    this.setupGracefulShutdown();

    // Держим процесс активным
    await this.keepAlive();
  }

  /**
   * Обработчик новых сообщений
   */
  private async handleNewMessage(event: NewMessageEvent): Promise<void> {
    try {
      const message = event.message;

      // Применяем фильтры
      if (!this.shouldProcessMessage(event)) {
        return;
      }

      // Получаем информацию об отправителе
      const sender = await message.getSender();

      // Формируем данные сообщения
      const messageData: IMessageData = {
        id: message.id,
        text: message.text || undefined,
        date: new Date(message.date * 1000),
        sender: {
          id: sender?.id?.toJSNumber() || 0,
          username: (sender as any)?.username || undefined,
          firstName: (sender as any)?.firstName || undefined,
          lastName: (sender as any)?.lastName || undefined,
          phone: (sender as any)?.phone || undefined,
          isBot: (sender as any)?.bot || false,
        },
        chatId: message.chatId?.toJSNumber() || 0,
        isPrivate: event.isPrivate || false,
        isGroup: event.isGroup || false,
        isChannel: event.isChannel || false,
        hasMedia: !!message.media,
        mediaType: message.media?.className,
      };

      // Увеличиваем счетчик
      this.messageCount++;

      // Форматируем и выводим сообщение
      const formatted = MessageFormatterAdapter.formatMessage(messageData);
      console.log(formatted);
    } catch (error) {
      console.error("Ошибка при обработке сообщения:", error);
    }
  }

  /**
   * Проверяет, нужно ли обрабатывать сообщение согласно фильтрам
   */
  private shouldProcessMessage(event: NewMessageEvent): boolean {
    // Фильтр: только личные
    if (this.config.privateOnly && !event.isPrivate) {
      return false;
    }

    // Фильтр: только группы
    if (this.config.groupsOnly && !event.isGroup) {
      return false;
    }

    // Фильтр: только каналы
    if (this.config.channelsOnly && !event.isChannel) {
      return false;
    }

    // Фильтр: по паттерну текста
    if (this.config.textPattern && event.message.text) {
      if (!this.config.textPattern.test(event.message.text)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Настраивает graceful shutdown
   */
  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      if (this.isRunning) {
        console.log("\n\nПолучен сигнал остановки...");
        await this.stop();
        process.exit(0);
      }
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  /**
   * Останавливает прослушивание
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    console.log("\nОстановка прослушивания...");

    // Выводим статистику
    const stats = MessageFormatterAdapter.formatStats(
      this.messageCount,
      this.startTime
    );
    console.log(stats);

    // Отключаемся
    if (this.client) {
      await this.client.disconnect();
      console.log("✓ Отключено от Telegram");
    }
  }

  /**
   * Держит процесс активным
   */
  private async keepAlive(): Promise<void> {
    return new Promise(() => {
      // Процесс будет активен до получения SIGINT/SIGTERM
    });
  }
}
