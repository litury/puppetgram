import { IChannelMessage, IMediaFile } from '../../channelParser/interfaces/IChannelParser';

/**
 * Тип медиа, допустимого к перепосту в ВК
 */
export type VkMediaType = IMediaFile['type'];

/**
 * Структура экспортного файла канала (exports/channel-parser/*.json)
 */
export interface IChannelExportFile {
    metadata?: {
        channel?: {
            username?: string;
            title?: string;
        };
        [key: string]: unknown;
    };
    messages: IChannelMessage[];
}

/**
 * Готовый к публикации в ВК пост (только посты с медиа, текст as-is)
 */
export interface IVkPost {
    /** Идентификатор поста (по первому исходному сообщению) */
    id: string;
    /** Оригинальный текст из Telegram (без изменений) */
    content: string;
    /** Дата исходного поста */
    originalDate: Date | string;
    /** Медиа файлы поста (только допустимых типов) */
    media: IMediaFile[];
    /** ID исходных Telegram-сообщений (несколько для альбома) */
    sourceMessageIds: number[];
    /** Является ли пост объединённым альбомом */
    isAlbum: boolean;
}

/**
 * Конфигурация экспорта
 */
export interface IVkContentExporterConfig {
    /** Какие типы медиа включать. По умолчанию: photo, video, animation */
    allowedMediaTypes?: VkMediaType[];
}

/**
 * Статистика экспорта
 */
export interface IVkExportStats {
    /** Всего сообщений в выгрузке */
    totalMessages: number;
    /** Сообщений с подходящим медиа */
    messagesWithMedia: number;
    /** Сколько сообщений объединено в альбомы */
    albumMessagesMerged: number;
    /** Сколько постов-альбомов получилось */
    albumPosts: number;
    /** Итоговых постов на выходе */
    postsGenerated: number;
    /** Постов с пустой подписью (только медиа) */
    postsWithEmptyText: number;
    /** Всего медиа-файлов в постах */
    mediaFilesTotal: number;
}

/**
 * Сервис экспорта медиа-постов канала для ВК
 */
export interface IVkContentExporter {
    /**
     * Отбирает посты с медиа, объединяет альбомы, сохраняет оригинальный текст
     */
    exportMediaPosts(
        _channelData: IChannelExportFile,
        _config?: IVkContentExporterConfig
    ): { posts: IVkPost[]; stats: IVkExportStats };

    /**
     * Сохраняет посты в JSON (+ TXT для просмотра)
     */
    savePostsToFile(_posts: IVkPost[], _filePath: string): Promise<void>;
}

/**
 * По умолчанию берём пост с ЛЮБЫМ прикреплённым медиа — тип не важен.
 * Чисто текстовые посты без вложений отсекаются (у них media пустой/отсутствует).
 */
export const DEFAULT_ALLOWED_MEDIA_TYPES: VkMediaType[] = [
    'photo', 'video', 'animation', 'document', 'audio', 'voice', 'sticker'
];
