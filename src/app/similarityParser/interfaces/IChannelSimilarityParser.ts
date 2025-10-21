/**
 * Интерфейсы для модуля парсинга похожих каналов
 * Следует стандартам компании согласно frontend-coding-standards.md
 */

/**
 * Информация о похожем канале
 */
export interface ISimilarChannel {
    /** Уникальный ID канала */
    id: string;
    /** Название канала */
    title: string;
    /** Username канала (без @) */
    username?: string;
    /** Описание канала */
    description?: string;
    /** Количество подписчиков */
    subscribersCount?: number;
    /** Верифицирован ли канал */
    isVerified?: boolean;
    /** Глубина поиска, на которой найден канал */
    searchDepth?: number;
}

/**
 * Опции для парсинга похожих каналов
 */
export interface ISimilarityParsingOptions {
    /** Исходный канал для поиска (@channel_name) */
    sourceChannel: string;
    /** Точное количество каналов, которое нужно получить */
    targetChannelCount: number;
    /** Максимальное количество результатов с первого уровня (по умолчанию 100) */
    firstLevelLimit?: number;
    /** Удалять дубликаты (по умолчанию true) */
    removeDuplicates?: boolean;
    /** Минимальное количество подписчиков для фильтрации (по умолчанию 0) */
    minSubscribers?: number;
    /** Максимальное количество подписчиков для фильтрации (по умолчанию без ограничений) */
    maxSubscribers?: number;
}

/**
 * Результат парсинга похожих каналов
 */
export interface ISimilarityParsingResult {
    /** Найденные похожие каналы */
    channels: ISimilarChannel[];
    /** Общее количество найденных каналов */
    totalCount: number;
    /** Исходный канал */
    sourceChannel: string;
    /** Максимальная глубина поиска */
    searchDepth: number;
    /** Количество удаленных дубликатов */
    duplicatesRemoved?: number;
    /** Время выполнения в миллисекундах */
    processingTimeMs: number;
    /** Детальная статистика по уровням */
    depthStatistics?: {
        [depth: number]: {
            channelsFound: number;
            channelsProcessed: number;
            sourceChannels: string[];
        };
    };
    /** Достигнуто ли целевое количество каналов */
    targetReached: boolean;
}

/**
 * Основной интерфейс парсера похожих каналов
 */
export interface IChannelSimilarityParser {
    /**
     * Парсинг похожих каналов для указанного канала
     * @param _options - опции парсинга
     * @returns Promise с результатами парсинга
     * @throws Error если канал не найден или недоступен
     */
    parseSimilarChannelsAsync(_options: ISimilarityParsingOptions): Promise<ISimilarityParsingResult>;

    /**
     * Проверка доступности канала
     * @param _channelName - имя канала (@channel_name)
     * @returns Promise<boolean> - доступен ли канал
     */
    validateChannelAccessAsync(_channelName: string): Promise<boolean>;
}

/**
 * Интерфейс для работы с Telegram API
 */
export interface ITelegramApiAdapter {
    /**
     * Получение рекомендаций для канала
     * @param _channelName - имя канала
     * @param _limit - лимит результатов
     * @returns Promise с сырыми данными API
     */
    getChannelRecommendationsAsync(_channelName: string, _limit: number): Promise<any>;

    /**
     * Резолв канала по имени
     * @param _channelName - имя канала
     * @returns Promise с InputChannel или null
     */
    resolveChannelAsync(_channelName: string): Promise<any | null>;
}
