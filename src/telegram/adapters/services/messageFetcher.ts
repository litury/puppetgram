import { TelegramClient } from "telegram";
import { IMessage } from "../../../interfaces/IMessage";
import { GramClient } from "../gramClient";

export interface IChannelInfo {
  title: string;
  totalMessages: number;
}

export interface IDateRange {
  startDate?: Date;
  endDate?: Date;
}

export class MessageFetcher {
  constructor(
    private readonly client: TelegramClient,
    private readonly gramClient?: GramClient
  ) { }

  async getChannelInfo(channelName: string): Promise<IChannelInfo> {
    try {
      const channel = await this.client.getEntity(channelName);
      const messages = await this.client.getMessages(channelName, {
        limit: 1,
      });

      return {
        title: (channel as any).title || channelName,
        totalMessages: messages.total || 0,
      };
    } catch (error) {
      console.error(
        `Ошибка при получении информации о канале ${channelName}:`,
        error
      );
      throw error;
    }
  }

  async fetchMessages(channelName: string, limit: number): Promise<IMessage[]> {
    try {
      const messages = await this.client.getMessages(channelName, {
        limit: limit,
      });

      return messages.map((msg) => ({
        id: msg.id,
        message: msg.message || "",
        date: new Date(msg.date * 1000),
      }));
    } catch (error) {
      console.error(
        `Ошибка при получении сообщений из канала ${channelName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Получение полных сообщений с медиа данными для парсинга каналов
   */
  async fetchFullMessages(channelName: string, limit: number): Promise<any[]> {
    try {
      const messages = await this.client.getMessages(channelName, {
        limit: limit,
      });

      // Возвращаем полные объекты сообщений
      return messages;
    } catch (error) {
      console.error(
        `Ошибка при получении полных сообщений из канала ${channelName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Получение пакета сообщений с offset для постепенного получения всех сообщений
   */
  async fetchFullMessagesBatch(channelName: string, limit: number, offsetId: number = 0): Promise<any[]> {
    const operation = async () => {
      const options: any = {
        limit: limit,
      };

      // Если указан offset, получаем сообщения старше этого ID
      if (offsetId > 0) {
        options.offsetId = offsetId;
      }

      const messages = await this.client.getMessages(channelName, options);
      return messages;
    };

    try {
      // Используем безопасное выполнение с повторными попытками если доступно
      if (this.gramClient) {
        return await this.gramClient.executeWithRetry(operation, 3);
      } else {
        return await operation();
      }
    } catch (error) {
      console.error(
        `Ошибка при получении пакета сообщений из канала ${channelName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Получение сообщений за определенный период
   */
  async fetchMessagesByDateRange(
    channelName: string,
    dateRange: IDateRange,
    limit?: number
  ): Promise<IMessage[]> {
    try {
      const options: any = {};

      if (limit) {
        options.limit = limit;
      }

      // Если указана начальная дата, получаем сообщения до этой даты
      if (dateRange.startDate) {
        options.offsetDate = Math.floor(dateRange.startDate.getTime() / 1000);
      }

      const messages = await this.client.getMessages(channelName, options);

      let filteredMessages = messages.map((msg) => ({
        id: msg.id,
        message: msg.message || "",
        date: new Date(msg.date * 1000),
      }));

      // Фильтруем по диапазону дат
      if (dateRange.startDate || dateRange.endDate) {
        filteredMessages = filteredMessages.filter((msg) => {
          if (dateRange.startDate && msg.date < dateRange.startDate) {
            return false;
          }
          if (dateRange.endDate && msg.date > dateRange.endDate) {
            return false;
          }
          return true;
        });
      }

      return filteredMessages;
    } catch (error) {
      console.error(
        `Ошибка при получении сообщений из канала ${channelName} за период:`,
        error
      );
      throw error;
    }
  }

  /**
   * Получение сообщений за последние N дней
   */
  async fetchMessagesLastDays(
    channelName: string,
    days: number,
    limit?: number
  ): Promise<IMessage[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.fetchMessagesByDateRange(
      channelName,
      { startDate, endDate },
      limit
    );
  }
}
