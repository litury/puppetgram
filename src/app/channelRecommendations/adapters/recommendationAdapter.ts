import { ChannelRecommendationService } from "../services/channelRecommendationService";
import { IChannelRecommendation, IChannelRecommendationsResponse } from "../interfaces/IChannelRecommendation";

export class RecommendationAdapter {
  constructor(private readonly recommendationService: ChannelRecommendationService) { }

  /**
   * Получить рекомендации с форматированием для консольного вывода
   */
  async getFormattedRecommendations(
    channelName?: string,
    limit: number = 50
  ): Promise<string[]> {
    try {
      let response: IChannelRecommendationsResponse;

      if (channelName) {
        response = await this.recommendationService.getRecommendationsForChannel(channelName, limit);
      } else {
        response = await this.recommendationService.getGlobalRecommendations(limit);
      }

      return response.channels.map((channel, index) =>
        this.formatChannelForDisplay(channel, index + 1)
      );

    } catch (error) {
      console.error('Ошибка при получении форматированных рекомендаций:', error);
      return [];
    }
  }

  /**
   * Получить рекомендации в виде простого списка имен каналов
   */
  async getChannelNames(channelName?: string, limit: number = 50): Promise<string[]> {
    try {
      let response: IChannelRecommendationsResponse;

      if (channelName) {
        response = await this.recommendationService.getRecommendationsForChannel(channelName, limit);
      } else {
        response = await this.recommendationService.getGlobalRecommendations(limit);
      }

      return response.channels
        .filter(channel => channel.username)
        .map(channel => `@${channel.username}`);

    } catch (error) {
      console.error('Ошибка при получении имен каналов:', error);
      return [];
    }
  }

  /**
   * Получить рекомендации в виде ссылок для экспорта
   */
  async getChannelLinks(channelName?: string, limit: number = 50): Promise<string[]> {
    try {
      let response: IChannelRecommendationsResponse;

      if (channelName) {
        response = await this.recommendationService.getRecommendationsForChannel(channelName, limit);
      } else {
        response = await this.recommendationService.getGlobalRecommendations(limit);
      }

      return response.channels
        .filter(channel => channel.username)
        .map(channel => `https://t.me/${channel.username}`);

    } catch (error) {
      console.error('Ошибка при получении ссылок каналов:', error);
      return [];
    }
  }

  /**
   * Получить детальную информацию о каналах для экспорта
   */
  async getDetailedChannelInfo(channelName?: string, limit: number = 50): Promise<string[]> {
    try {
      let response: IChannelRecommendationsResponse;

      if (channelName) {
        response = await this.recommendationService.getRecommendationsForChannel(channelName, limit);
      } else {
        response = await this.recommendationService.getGlobalRecommendations(limit);
      }

      return response.channels.map(channel => {
        const link = channel.username ? `https://t.me/${channel.username}` : 'Нет ссылки';
        const subscribers = channel.subscribersCount
          ? `${channel.subscribersCount.toLocaleString()} подписчиков`
          : 'Неизвестно';
        const verified = channel.isVerified ? '✅ Верифицирован' : '';

        return `${channel.title} ${verified}\n${link}\n${subscribers}\n${channel.description || 'Нет описания'}`;
      });

    } catch (error) {
      console.error('Ошибка при получении детальной информации:', error);
      return [];
    }
  }

  /**
   * Извлечение ключевых слов из имени канала для поиска
   */
  private extractKeywordsFromChannelName(channelName: string): string[] {
    // Убираем @ и разбиваем по _ или другим разделителям
    const cleanName = channelName.replace('@', '').toLowerCase();
    const keywords = cleanName.split(/[_\-\s]+/).filter(word => word.length > 2);

    // Добавляем общие ключевые слова
    keywords.push('канал', 'новости');

    return keywords.slice(0, 5); // Ограничиваем количество ключевых слов
  }

  /**
   * Форматирование канала для отображения
   */
  private formatChannelForDisplay(channel: IChannelRecommendation, index: number): string {
    const username = channel.username ? `@${channel.username}` : 'Без username';
    const link = channel.username ? `https://t.me/${channel.username}` : '';
    const subscribers = channel.subscribersCount
      ? `(${channel.subscribersCount.toLocaleString()} подписчиков)`
      : '';
    const verified = channel.isVerified ? '✅' : '';

    return `${index}. ${channel.title} ${verified}\n   ${username} ${subscribers}\n   ${link}`;
  }

  /**
   * Форматирование детального вывода каналов
   */
  formatDetailedChannels(response: IChannelRecommendationsResponse): string {
    if (!response.channels || response.channels.length === 0) {
      return 'Каналы не найдены.';
    }

    let output = `=== Найдено ${response.channels.length} каналов ===\n`;

    if (response.searchDepth) {
      output += `Глубина поиска: ${response.searchDepth} уровней\n`;
    }

    if (response.duplicatesRemoved && response.duplicatesRemoved > 0) {
      output += `Удалено дубликатов: ${response.duplicatesRemoved}\n`;
    }

    output += '\n';

    response.channels.forEach((channel, index) => {
      output += `${index + 1}. ${channel.title} ${channel.isVerified ? '✓' : ''}\n`;

      if (channel.username) {
        output += `   @${channel.username} (${channel.subscribersCount?.toLocaleString() || 'неизвестно'} подписчиков)\n`;
        output += `   https://t.me/${channel.username}\n`;
      } else {
        output += `   ID: ${channel.id} (${channel.subscribersCount?.toLocaleString() || 'неизвестно'} подписчиков)\n`;
      }

      if (channel.description) {
        output += `   ${channel.description.substring(0, 100)}${channel.description.length > 100 ? '...' : ''}\n`;
      }

      output += '\n';
    });

    if (response.hasMore) {
      output += '\n(Показаны не все результаты)\n';
    }

    return output;
  }
}
