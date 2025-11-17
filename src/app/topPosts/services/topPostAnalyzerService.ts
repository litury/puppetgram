/**
 * Сервис для анализа лучших постов в Telegram каналах
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import { TelegramClient } from "telegram";
import { Api } from "telegram";
import { IMessage } from "../../../interfaces/IMessage";
import {
  ITopPostAnalyzer,
  ITopPostAnalysisOptions,
  ITopPostAnalysisResponse,
  IChannelTopPostsResult,
  IPostAnalysisCriteria,
  IPostAnalysisResult,
} from "../interfaces";

export class TopPostAnalyzerService implements ITopPostAnalyzer {
  private client: TelegramClient;

  constructor(client: TelegramClient) {
    this.client = client;
  }

  /**
   * Анализирует топ посты по указанным каналам
   */
  async analyzeTopPostsAsync(
    options: ITopPostAnalysisOptions,
  ): Promise<ITopPostAnalysisResponse> {
    console.log(
      `🔍 Начинаю анализ топ постов для ${options.channels.length} каналов...`,
    );

    const channelResults: IChannelTopPostsResult[] = [];
    let totalMessagesAnalyzed = 0;

    // Анализируем каждый канал
    for (const channelName of options.channels) {
      try {
        console.log(`📊 Анализирую канал: ${channelName}`);

        const channelResult = await this.analyzeChannelPostsAsync(
          channelName,
          options.criteria,
          options.messageLimit,
        );

        channelResults.push(channelResult);
        totalMessagesAnalyzed += channelResult.totalMessagesAnalyzed;
      } catch (error: any) {
        console.error(
          `❌ Ошибка анализа канала ${channelName}:`,
          error.message,
        );
        // Добавляем пустой результат для неудавшихся каналов
        channelResults.push({
          channelName,
          channelTitle: channelName,
          totalMessagesAnalyzed: 0,
          topPosts: [],
          averageMetrics: {
            avgViews: 0,
            avgForwards: 0,
            avgReactions: 0,
            avgEngagement: 0,
          },
        });
      }
    }

    // Собираем все топ посты и сортируем глобально
    const allTopPosts: IPostAnalysisResult[] = [];
    channelResults.forEach((channel) => {
      allTopPosts.push(...channel.topPosts);
    });

    // Сортируем и ограничиваем результат
    const sortedAllPosts = this.sortPostResults(
      allTopPosts,
      options.criteria.sortBy,
    );
    const overallTopPosts = sortedAllPosts.slice(0, options.limit || 20);

    // Обновляем ранги для общего топа
    overallTopPosts.forEach((post, index) => {
      post.rank = index + 1;
    });

    const result: ITopPostAnalysisResponse = {
      channels: channelResults,
      overallTopPosts,
      analysisDate: new Date(),
      criteria: options.criteria,
      totalChannels: channelResults.length,
      totalMessagesAnalyzed,
    };

    console.log(
      `✅ Анализ завершен! Обработано ${totalMessagesAnalyzed} сообщений из ${channelResults.length} каналов`,
    );

    return result;
  }

  /**
   * Анализирует посты одного канала
   */
  async analyzeChannelPostsAsync(
    channelName: string,
    criteria: IPostAnalysisCriteria,
    messageLimit: number = 100,
  ): Promise<IChannelTopPostsResult> {
    // Получаем информацию о канале
    const channelInfo = await this.getChannelInfo(channelName);

    // Получаем сообщения канала
    const messages = await this.fetchChannelMessages(channelName, messageLimit);

    // Фильтруем сообщения по критериям
    const filteredMessages = this.filterMessages(messages, criteria);

    // Создаем результаты анализа для каждого поста
    const postResults: IPostAnalysisResult[] = filteredMessages.map(
      (message) => {
        const metrics = this.extractMetrics(message);
        const score = this.calculateScore(message, criteria.sortBy);

        return {
          message,
          score,
          metrics,
          rank: 0, // Будет установлен после сортировки
        };
      },
    );

    // Сортируем посты
    const sortedPosts = this.sortPostResults(postResults, criteria.sortBy);

    // Устанавливаем ранги
    sortedPosts.forEach((post, index) => {
      post.rank = index + 1;
    });

    // Вычисляем средние метрики
    const averageMetrics = this.calculateAverageMetrics(filteredMessages);

    return {
      channelName,
      channelTitle: channelInfo?.title || channelName,
      totalMessagesAnalyzed: messages.length,
      topPosts: sortedPosts,
      averageMetrics,
    };
  }

  /**
   * Получает информацию о канале
   */
  private async getChannelInfo(channelName: string): Promise<any> {
    try {
      const cleanName = channelName.replace("@", "");
      const resolved: any = await this.client.invoke(
        new Api.contacts.ResolveUsername({ username: cleanName }),
      );
      return resolved.chats?.[0];
    } catch (error) {
      console.warn(`Не удалось получить информацию о канале ${channelName}`);
      return null;
    }
  }

  /**
   * Получает сообщения канала с расширенными метриками
   */
  private async fetchChannelMessages(
    channelName: string,
    limit: number,
  ): Promise<IMessage[]> {
    const messages = await this.client.getMessages(channelName, { limit });

    return messages.map((msg) => this.convertTelegramMessage(msg));
  }

  /**
   * Конвертирует сообщение Telegram API в наш формат
   */
  private convertTelegramMessage(msg: any): IMessage {
    const reactions = msg.reactions ? this.countReactions(msg.reactions) : 0;
    const replies = msg.replies ? msg.replies.replies || 0 : 0;
    const hasMedia = !!(
      msg.media && msg.media.className !== "MessageMediaEmpty"
    );
    const messageLength = (msg.message || "").length;

    const message: IMessage = {
      id: msg.id,
      text: msg.message || "",
      message: msg.message || "",
      date: new Date(msg.date * 1000),
      views: msg.views || 0,
      forwards: msg.forwards || 0,
      reactions,
      replies,
      editDate: msg.editDate ? new Date(msg.editDate * 1000) : undefined,
      postAuthor: msg.postAuthor,
      mediaGroupId: msg.groupedId?.toString(),
      fromId: msg.fromId,
      peerId: msg.peerId,
      hasMedia,
      messageLength,
    };

    // Вычисляем показатель вовлеченности
    message.engagement = this.calculateEngagement(message);

    return message;
  }

  /**
   * Подсчитывает общее количество реакций
   */
  private countReactions(reactions: any): number {
    if (!reactions || !reactions.results) return 0;

    return reactions.results.reduce((total: number, reaction: any) => {
      return total + (reaction.count || 0);
    }, 0);
  }

  /**
   * Вычисляет показатель вовлеченности для поста
   */
  calculateEngagement(message: IMessage): number {
    const views = message.views || 0;
    if (views === 0) return 0;

    const forwards = message.forwards || 0;
    const reactions =
      typeof message.reactions === "number" ? message.reactions : 0;
    const replies = typeof message.replies === "number" ? message.replies : 0;

    // Формула вовлеченности: (пересылки * 3 + реакции * 2 + ответы * 4) / просмотры * 100
    const engagementScore =
      ((forwards * 3 + reactions * 2 + replies * 4) / views) * 100;

    return Math.round(engagementScore * 100) / 100; // Округляем до 2 знаков
  }

  /**
   * Фильтрует сообщения по критериям
   */
  filterMessages(
    messages: IMessage[],
    criteria: IPostAnalysisCriteria,
  ): IMessage[] {
    return messages.filter((message) => {
      // Фильтр по минимальным метрикам
      if (criteria.minViews && (message.views || 0) < criteria.minViews)
        return false;
      if (
        criteria.minForwards &&
        (message.forwards || 0) < criteria.minForwards
      )
        return false;
      if (
        criteria.minReactions &&
        typeof message.reactions === "number" &&
        message.reactions < criteria.minReactions
      )
        return false;

      // Фильтр по датам
      if (criteria.dateFrom && message.date < criteria.dateFrom) return false;
      if (criteria.dateTo && message.date > criteria.dateTo) return false;

      // Фильтр по медиа
      if (criteria.includeWithMedia === true && !message.hasMedia) return false;
      if (criteria.excludeWithMedia === true && message.hasMedia) return false;

      // Фильтр по длине текста
      const textLength = message.messageLength || 0;
      if (criteria.minTextLength && textLength < criteria.minTextLength)
        return false;
      if (criteria.maxTextLength && textLength > criteria.maxTextLength)
        return false;

      return true;
    });
  }

  /**
   * Сортирует сообщения по указанному критерию
   */
  sortMessages(
    messages: IMessage[],
    sortBy: IPostAnalysisCriteria["sortBy"],
  ): IMessage[] {
    return [...messages].sort((a, b) => {
      switch (sortBy) {
        case "views":
          return (b.views || 0) - (a.views || 0);
        case "forwards":
          return (b.forwards || 0) - (a.forwards || 0);
        case "engagement":
          return (b.engagement || 0) - (a.engagement || 0);
        case "reactions":
          const aReactions = typeof a.reactions === "number" ? a.reactions : 0;
          const bReactions = typeof b.reactions === "number" ? b.reactions : 0;
          return bReactions - aReactions;
        case "replies":
          const aReplies = typeof a.replies === "number" ? a.replies : 0;
          const bReplies = typeof b.replies === "number" ? b.replies : 0;
          return bReplies - aReplies;
        case "combined":
          return (
            this.calculateCombinedScore(b) - this.calculateCombinedScore(a)
          );
        default:
          return (b.engagement || 0) - (a.engagement || 0);
      }
    });
  }

  /**
   * Сортирует результаты анализа постов
   */
  private sortPostResults(
    results: IPostAnalysisResult[],
    sortBy: IPostAnalysisCriteria["sortBy"],
  ): IPostAnalysisResult[] {
    return [...results].sort((a, b) => b.score - a.score);
  }

  /**
   * Вычисляет оценку для поста по выбранному критерию
   */
  private calculateScore(
    message: IMessage,
    sortBy: IPostAnalysisCriteria["sortBy"],
  ): number {
    switch (sortBy) {
      case "views":
        return message.views || 0;
      case "forwards":
        return message.forwards || 0;
      case "engagement":
        return message.engagement || 0;
      case "reactions":
        return typeof message.reactions === "number" ? message.reactions : 0;
      case "replies":
        return typeof message.replies === "number" ? message.replies : 0;
      case "combined":
        return this.calculateCombinedScore(message);
      default:
        return message.engagement || 0;
    }
  }

  /**
   * Вычисляет комбинированную оценку поста
   */
  private calculateCombinedScore(message: IMessage): number {
    const views = message.views || 0;
    const forwards = message.forwards || 0;
    const reactions =
      typeof message.reactions === "number" ? message.reactions : 0;
    const replies = typeof message.replies === "number" ? message.replies : 0;
    const engagement = message.engagement || 0;

    // Комбинированная формула с весами
    return (
      views * 0.2 +
      forwards * 0.3 +
      reactions * 0.2 +
      replies * 0.2 +
      engagement * 0.1
    );
  }

  /**
   * Извлекает метрики из сообщения
   */
  private extractMetrics(message: IMessage) {
    return {
      views: message.views || 0,
      forwards: message.forwards || 0,
      reactions: typeof message.reactions === "number" ? message.reactions : 0,
      replies: typeof message.replies === "number" ? message.replies : 0,
      engagement: message.engagement || 0,
      textLength: message.messageLength || 0,
      hasMedia: message.hasMedia || false,
    };
  }

  /**
   * Вычисляет средние метрики для списка сообщений
   */
  private calculateAverageMetrics(messages: IMessage[]) {
    if (messages.length === 0) {
      return {
        avgViews: 0,
        avgForwards: 0,
        avgReactions: 0,
        avgEngagement: 0,
      };
    }

    const totals = messages.reduce(
      (acc, msg) => {
        acc.views += msg.views || 0;
        acc.forwards += msg.forwards || 0;
        acc.reactions += typeof msg.reactions === "number" ? msg.reactions : 0;
        acc.engagement += msg.engagement || 0;
        return acc;
      },
      { views: 0, forwards: 0, reactions: 0, engagement: 0 },
    );

    const count = messages.length;

    return {
      avgViews: Math.round(totals.views / count),
      avgForwards: Math.round(totals.forwards / count),
      avgReactions: Math.round(totals.reactions / count),
      avgEngagement: Math.round((totals.engagement / count) * 100) / 100,
    };
  }
}
