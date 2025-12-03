import { IChannelMessage } from '../../channelParser/interfaces/IChannelParser';

/**
 * Интерфейс для генерации Twitter контента из Telegram постов
 */
export interface ITwitterContentGenerator {
    /**
     * Генерирует Twitter-посты из данных канала
     */
    generateTwitterPosts(
        _channelData: IChannelData,
        _config: ITwitterContentGeneratorConfig,
        _batchSize?: number,
        _onBatchSave?: (_posts: ITwitterPost[]) => Promise<void> | void
    ): Promise<{ posts: ITwitterPost[]; stats: IGenerationStats }>;

    /**
     * Оценивает параметры генерации без выполнения
     */
    estimateGeneration(_channelData: IChannelData): Promise<IGenerationStats>;

    /**
     * Сохраняет посты в файл
     */
    savePostsToFile(_posts: ITwitterPost[], _filePath: string): Promise<void>;
}

/**
 * Данные Telegram канала для генерации Twitter контента
 */
export interface IChannelData {
    /** Информация о канале */
    channelInfo: {
        id: string;
        username: string;
        title: string;
        description?: string;
        participantsCount?: number;
        totalMessages: number;
    };
    /** Сообщения канала */
    messages: IChannelMessage[];
}

/**
 * Конфигурация генератора Twitter контента
 */
export interface ITwitterContentGeneratorConfig {
    /** API ключ DeepSeek */
    apiKey: string;
    /** Базовый URL API (по умолчанию DeepSeek) */
    baseUrl?: string;
    /** Модель для генерации */
    model?: string;
    /** Максимальная длина Twitter поста */
    maxPostLength: number;
    /** Максимальное количество токенов для ответа */
    maxTokens?: number;
    /** Temperature для генерации */
    temperature?: number;
    /** Удалять ли эмодзи из постов */
    removeEmojis: boolean;
    /** Пропускать ли посты с медиа */
    skipMediaPosts: boolean;
}

/**
 * Twitter пост
 */
export interface ITwitterPost {
    /** Уникальный ID поста */
    id: string;
    /** Содержимое поста */
    content: string;
    /** ID оригинального сообщения из Telegram */
    originalMessageId: number;
    /** Дата оригинального сообщения */
    originalDate: Date;
    /** Медиа из исходного сообщения */
    media?: import("../../channelParser/interfaces/IChannelParser").IMediaFile[];
    /** Количество символов */
    characterCount: number;
    /** Является ли частью треда */
    isPartOfThread: boolean;
    /** Индекс в треде */
    threadIndex?: number;
    /** Общее количество частей в треде */
    totalThreadParts?: number;
}

/**
 * Статистика генерации
 */
export interface IGenerationStats {
    /** Общее количество сообщений */
    totalMessages: number;
    /** Сообщений с текстом */
    messagesWithText: number;
    /** Пропущенных сообщений */
    messagesSkipped: number;
    /** Создано постов */
    postsGenerated: number;
    /** Создано тредов */
    threadsCreated: number;
    /** Оценка количества токенов */
    estimatedTokens: number;
    /** Оценка стоимости в USD */
    estimatedCost: number;
}
