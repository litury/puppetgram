import { TelegramClient } from "telegram";
import { Api } from "telegram";
import {
  IChannelRecommendation,
  IChannelRecommendationsResponse,
  IRecommendationOptions
} from "../interfaces/IChannelRecommendation";

export class ChannelRecommendationService {
  constructor(private readonly client: TelegramClient) { }

  /**
   * Получение рекомендаций каналов с рекурсивным поиском
   */
  async getChannelRecommendations(
    options: IRecommendationOptions = {}
  ): Promise<IChannelRecommendationsResponse> {
    const {
      sourceChannel,
      limit = 200, // Увеличиваем лимит для рекурсивного поиска
      global = false,
      recursiveSearch = true,
      maxDepth = 5,
      removeDuplicates = true
    } = options;

    try {
      console.log('Начинаем поиск каналов...');
      console.log(`Параметры: recursive=${recursiveSearch}, maxDepth=${maxDepth}, removeDuplicates=${removeDuplicates}`);

      let allChannels: IChannelRecommendation[] = [];
      let searchDepth = 0;
      let duplicatesRemoved = 0;

      if (!global && sourceChannel) {
        // Рекурсивный поиск для конкретного канала
        const result = await this.getRecommendationsRecursive(
          sourceChannel,
          limit,
          recursiveSearch ? maxDepth : 1,
          new Set<string>() // Для отслеживания уже найденных каналов
        );
        allChannels = result.channels;
        searchDepth = result.depth;
      } else {
        // Глобальные рекомендации с рекурсивным поиском
        const initialResult = await this.getGlobalRecommendations(50);
        allChannels = [...initialResult.channels];
        searchDepth = 1;

        if (recursiveSearch && initialResult.channels.length > 0) {
          const visitedChannels = new Set(allChannels.map(c => c.id));

          for (let depth = 2; depth <= maxDepth && allChannels.length < limit; depth++) {
            console.log(`Поиск на глубине ${depth}...`);

            const channelsToSearch = allChannels
              .filter(c => c.username)
              .slice(0, 10); // Берём первые 10 каналов для поиска

            for (const channel of channelsToSearch) {
              if (allChannels.length >= limit) break;

              const subResult = await this.getRecommendationsForChannel(
                channel.username!,
                50
              );

              // Добавляем новые каналы
              for (const newChannel of subResult.channels) {
                if (!visitedChannels.has(newChannel.id) && allChannels.length < limit) {
                  allChannels.push(newChannel);
                  visitedChannels.add(newChannel.id);
                }
              }

              // Небольшая задержка между запросами
              await this.delay(1000);
            }
            searchDepth = depth;
          }
        }
      }

      // Удаление дубликатов если включено
      if (removeDuplicates) {
        const beforeCount = allChannels.length;
        allChannels = this.removeDuplicateChannels(allChannels);
        duplicatesRemoved = beforeCount - allChannels.length;
        console.log(`Удалено дубликатов: ${duplicatesRemoved}`);
      }

      // Ограничиваем результат нужным количеством
      const finalChannels = allChannels.slice(0, limit);

      console.log(`Найдено каналов: ${finalChannels.length}, глубина поиска: ${searchDepth}`);

      return {
        channels: finalChannels,
        totalCount: finalChannels.length,
        hasMore: allChannels.length > limit,
        searchDepth,
        duplicatesRemoved
      };

    } catch (error: any) {
      console.error('Ошибка при получении рекомендаций:', error?.message || error);

      return {
        channels: [],
        totalCount: 0,
        hasMore: false,
        searchDepth: 0,
        duplicatesRemoved: 0
      };
    }
  }

  /**
   * Рекурсивный поиск рекомендаций для канала
   */
  private async getRecommendationsRecursive(
    sourceChannel: string,
    targetLimit: number,
    maxDepth: number,
    visitedChannels: Set<string>,
    currentDepth: number = 1
  ): Promise<{ channels: IChannelRecommendation[], depth: number }> {
    console.log(`Поиск на глубине ${currentDepth} для канала: ${sourceChannel}`);

    const channels: IChannelRecommendation[] = [];

    // Получаем рекомендации для текущего канала
    const currentResult = await this.getRecommendationsForChannel(sourceChannel, 50);

    // Добавляем новые каналы
    for (const channel of currentResult.channels) {
      if (!visitedChannels.has(channel.id) && channels.length < targetLimit) {
        channels.push(channel);
        visitedChannels.add(channel.id);
      }
    }

    // Если достигли максимальной глубины или лимита, возвращаем результат
    if (currentDepth >= maxDepth || channels.length >= targetLimit) {
      return { channels, depth: currentDepth };
    }

    // Рекурсивно ищем по найденным каналам
    const channelsForNextSearch = channels
      .filter(c => c.username)
      .slice(0, 5); // Берём первые 5 каналов для следующего уровня

    for (const channel of channelsForNextSearch) {
      if (channels.length >= targetLimit) break;

      await this.delay(1500); // Задержка между запросами

      const subResult = await this.getRecommendationsRecursive(
        channel.username!,
        targetLimit - channels.length,
        maxDepth,
        visitedChannels,
        currentDepth + 1
      );

      channels.push(...subResult.channels);
    }

    return { channels, depth: currentDepth };
  }

  /**
   * Удаление дубликатов каналов
   */
  private removeDuplicateChannels(channels: IChannelRecommendation[]): IChannelRecommendation[] {
    const uniqueChannels = new Map<string, IChannelRecommendation>();
    const usernameMap = new Map<string, IChannelRecommendation>();

    for (const channel of channels) {
      // Удаляем дубликаты по ID
      if (!uniqueChannels.has(channel.id)) {
        uniqueChannels.set(channel.id, channel);
      }

      // Удаляем дубликаты по username
      if (channel.username && !usernameMap.has(channel.username.toLowerCase())) {
        usernameMap.set(channel.username.toLowerCase(), channel);
      }
    }

    // Объединяем результаты, отдавая приоритет каналам с username
    const result: IChannelRecommendation[] = [];
    const addedIds = new Set<string>();

    // Сначала добавляем каналы с username
    for (const channel of usernameMap.values()) {
      if (!addedIds.has(channel.id)) {
        result.push(channel);
        addedIds.add(channel.id);
      }
    }

    // Затем добавляем оставшиеся каналы без username
    for (const channel of uniqueChannels.values()) {
      if (!addedIds.has(channel.id)) {
        result.push(channel);
        addedIds.add(channel.id);
      }
    }

    return result;
  }

  /**
   * Задержка для избежания rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Получение глобальных рекомендаций через channels.getChannelRecommendations
   */
  async getGlobalRecommendations(limit: number = 50): Promise<IChannelRecommendationsResponse> {
    try {
      console.log('Запрос глобальных рекомендаций...');

      const result: any = await this.client.invoke(
        new Api.channels.GetChannelRecommendations({})
      );

      return this.processRecommendationsResult(result, limit);

    } catch (error: any) {
      console.error('Ошибка получения глобальных рекомендаций:', error?.message || error);
      return await this.fallbackGlobalSearch(limit);
    }
  }

  /**
   * Получение рекомендаций для конкретного канала
   */
  async getRecommendationsForChannel(
    channelName: string,
    limit: number = 50
  ): Promise<IChannelRecommendationsResponse> {
    try {
      console.log(`Поиск рекомендаций для канала: ${channelName}`);

      // Сначала нужно получить InputChannel для указанного канала
      const inputChannel = await this.resolveChannel(channelName);

      if (!inputChannel) {
        throw new Error(`Канал ${channelName} не найден`);
      }

      // Вызываем РЕАЛЬНЫЙ API метод с указанием канала
      const result: any = await this.client.invoke(
        new Api.channels.GetChannelRecommendations({
          channel: inputChannel
        })
      );

      return this.processRecommendationsResult(result, limit);

    } catch (error: any) {
      console.error(`Ошибка получения рекомендаций для канала ${channelName}:`, error?.message || error);

      // Fallback: пробуем поиск по ключевым словам
      return await this.fallbackChannelSearch(channelName, limit);
    }
  }

  /**
   * Резолв канала в InputChannel
   */
  private async resolveChannel(channelName: string): Promise<Api.InputChannel | null> {
    try {
      const cleanName = channelName.replace('@', '');

      // Пробуем найти канал через contacts.resolveUsername
      const resolved: any = await this.client.invoke(
        new Api.contacts.ResolveUsername({
          username: cleanName
        })
      );

      if (resolved.chats && resolved.chats.length > 0) {
        const chat = resolved.chats[0];
        if (chat && chat.className === 'Channel') {
          return new Api.InputChannel({
            channelId: chat.id,
            accessHash: chat.accessHash
          });
        }
      }

      return null;
    } catch (error: any) {
      console.error(`Ошибка резолва канала ${channelName}:`, error?.message || error);
      return null;
    }
  }

  /**
   * Обработка результата API рекомендаций
   */
  private processRecommendationsResult(
    result: any,
    limit: number
  ): IChannelRecommendationsResponse {
    const channels: IChannelRecommendation[] = [];

    // Проверяем наличие чатов в результате
    if (result && result.chats && Array.isArray(result.chats)) {
      for (const chat of result.chats.slice(0, limit)) {
        if (chat && chat.className === 'Channel') {
          channels.push({
            id: chat.id ? chat.id.toString() : '',
            title: chat.title || 'Без названия',
            username: chat.username || '',
            description: '', // У Channel нет поля about в обычных случаях
            subscribersCount: chat.participantsCount || 0,
            isVerified: chat.verified || false
          });
        }
      }
    }

    return {
      channels,
      totalCount: channels.length,
      hasMore: result && result.chats ? result.chats.length > limit : false
    };
  }

  /**
   * Fallback поиск через messages.searchGlobal
   */
  private async fallbackGlobalSearch(limit: number): Promise<IChannelRecommendationsResponse> {
    try {
      console.log('Используем fallback поиск...');

      const result: any = await this.client.invoke(
        new Api.messages.SearchGlobal({
          q: 'канал', // Поисковый запрос
          offsetRate: 0,
          offsetPeer: new Api.InputPeerEmpty(),
          offsetId: 0,
          limit: limit
        })
      );

      const channels: IChannelRecommendation[] = [];

      // Проверяем результат поиска
      if (result && result.chats && Array.isArray(result.chats)) {
        for (const chat of result.chats) {
          if (chat && chat.className === 'Channel' && chat.broadcast) {
            channels.push({
              id: chat.id ? chat.id.toString() : '',
              title: chat.title || 'Без названия',
              username: chat.username || '',
              description: '',
              subscribersCount: chat.participantsCount || 0,
              isVerified: chat.verified || false
            });
          }
        }
      }

      return {
        channels: channels.slice(0, limit),
        totalCount: channels.length,
        hasMore: channels.length >= limit
      };

    } catch (error: any) {
      console.error('Ошибка fallback поиска:', error?.message || error);

      return {
        channels: [],
        totalCount: 0,
        hasMore: false
      };
    }
  }

  /**
   * Fallback поиск для конкретного канала
   */
  private async fallbackChannelSearch(
    channelName: string,
    limit: number
  ): Promise<IChannelRecommendationsResponse> {
    const keywords = this.extractKeywordsFromChannelName(channelName);
    const searchQuery = keywords.join(' ');

    try {
      const result: any = await this.client.invoke(
        new Api.messages.SearchGlobal({
          q: searchQuery,
          offsetRate: 0,
          offsetPeer: new Api.InputPeerEmpty(),
          offsetId: 0,
          limit: limit
        })
      );

      const channels: IChannelRecommendation[] = [];

      if (result && result.chats && Array.isArray(result.chats)) {
        for (const chat of result.chats) {
          if (chat && chat.className === 'Channel' && chat.broadcast) {
            channels.push({
              id: chat.id ? chat.id.toString() : '',
              title: chat.title || 'Без названия',
              username: chat.username || '',
              description: '',
              subscribersCount: chat.participantsCount || 0,
              isVerified: chat.verified || false
            });
          }
        }
      }

      return {
        channels: channels.slice(0, limit),
        totalCount: channels.length,
        hasMore: channels.length >= limit
      };

    } catch (error: any) {
      console.error('Ошибка fallback поиска для канала:', error?.message || error);

      return {
        channels: [],
        totalCount: 0,
        hasMore: false
      };
    }
  }

  /**
   * Извлечение ключевых слов из имени канала
   */
  private extractKeywordsFromChannelName(channelName: string): string[] {
    const cleanName = channelName.replace('@', '').toLowerCase();
    const words = cleanName.split(/[_\-\s]+/).filter(word => word.length > 2);

    return words.slice(0, 3);
  }
}
