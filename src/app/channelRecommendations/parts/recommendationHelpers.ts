import { IChannelRecommendation } from "../interfaces/IChannelRecommendation";

/**
 * Вспомогательные функции для работы с рекомендациями каналов
 */
export class RecommendationHelpers {
  /**
   * Фильтрация каналов по количеству подписчиков
   */
  static filterBySubscribers(
    channels: IChannelRecommendation[], 
    minSubscribers: number
  ): IChannelRecommendation[] {
    return channels.filter(channel => 
      channel.subscribersCount && channel.subscribersCount >= minSubscribers
    );
  }

  /**
   * Фильтрация только верифицированных каналов
   */
  static filterVerified(channels: IChannelRecommendation[]): IChannelRecommendation[] {
    return channels.filter(channel => channel.isVerified);
  }

  /**
   * Сортировка каналов по количеству подписчиков (по убыванию)
   */
  static sortBySubscribers(channels: IChannelRecommendation[]): IChannelRecommendation[] {
    return [...channels].sort((a, b) => {
      const aCount = a.subscribersCount || 0;
      const bCount = b.subscribersCount || 0;
      return bCount - aCount;
    });
  }

  /**
   * Поиск каналов по ключевым словам в названии или описании
   */
  static searchByKeywords(
    channels: IChannelRecommendation[], 
    keywords: string[]
  ): IChannelRecommendation[] {
    const lowerKeywords = keywords.map(k => k.toLowerCase());
    
    return channels.filter(channel => {
      const title = channel.title.toLowerCase();
      const description = (channel.description || '').toLowerCase();
      
      return lowerKeywords.some(keyword => 
        title.includes(keyword) || description.includes(keyword)
      );
    });
  }

  /**
   * Создание краткой статистики по рекомендациям
   */
  static getRecommendationStats(channels: IChannelRecommendation[]): {
    total: number;
    verified: number;
    withUsernames: number;
    averageSubscribers: number;
  } {
    const verified = channels.filter(c => c.isVerified).length;
    const withUsernames = channels.filter(c => c.username).length;
    const totalSubscribers = channels.reduce((sum, c) => sum + (c.subscribersCount || 0), 0);
    const averageSubscribers = channels.length > 0 ? Math.round(totalSubscribers / channels.length) : 0;

    return {
      total: channels.length,
      verified,
      withUsernames,
      averageSubscribers
    };
  }
}
