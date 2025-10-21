/**
 * Интерфейс для парсинга каналов Telegram
 */
export interface IChannelParser {
    /**
     * Полный парсинг канала с сохранением всего контента
     */
    parseChannelAsync(_channelName: string, _options?: IChannelParseOptions): Promise<IChannelParseResult>;
}

/**
 * Опции для парсинга канала
 */
export interface IChannelParseOptions {
    /** Сохранять ли медиа файлы локально */
    downloadMedia?: boolean;
    /** Директория для сохранения медиа */
    mediaDirectory?: string;
    /** Максимальный размер медиа файла в MB */
    maxMediaSize?: number;
    /** Типы медиа для скачивания */
    mediaTypes?: ('photo' | 'video' | 'document' | 'audio' | 'voice' | 'animation' | 'sticker')[];
    /** Включать ли удаленные/недоступные сообщения */
    includeDeleted?: boolean;
    /** Лимит сообщений для парсинга (0 = все) */
    messageLimit?: number;
}

/**
 * Результат парсинга канала
 */
export interface IChannelParseResult {
    /** Информация о канале */
    channelInfo: IChannelInfo;
    /** Список сообщений */
    messages: IChannelMessage[];
    /** Статистика парсинга */
    stats: IParseStats;
    /** Пути к экспортированным файлам */
    exportPaths: IExportPaths;
}

/**
 * Информация о канале
 */
export interface IChannelInfo {
    /** ID канала */
    id: string;
    /** Имя канала (@username) */
    username: string;
    /** Название канала */
    title: string;
    /** Описание канала */
    description?: string;
    /** Количество подписчиков */
    participantsCount?: number;
    /** Общее количество сообщений */
    totalMessages: number;
    /** Дата создания канала */
    createdAt?: Date;
    /** Аватар канала */
    avatar?: IMediaFile;
}

/**
 * Сообщение из канала
 */
export interface IChannelMessage {
    /** ID сообщения */
    id: number;
    /** Текст сообщения */
    text: string;
    /** Дата сообщения */
    date: Date;
    /** Дата редактирования */
    editDate?: Date;
    /** Автор сообщения */
    author?: string;
    /** Подпись автора */
    authorSignature?: string;
    /** Количество просмотров */
    views?: number;
    /** Количество пересылок */
    forwards?: number;
    /** Реакции */
    reactions?: IReaction[];
    /** Медиа файлы */
    media?: IMediaFile[];
    /** Ссылки в сообщении */
    links?: IMessageLink[];
    /** Ссылка на оригинальный пост */
    originalUrl: string;
    /** Хэштеги */
    hashtags: string[];
    /** Упоминания */
    mentions: string[];
    /** Является ли частью альбома */
    isPartOfAlbum?: boolean;
    /** ID группы альбома */
    albumId?: string;
    /** Ответ на сообщение */
    replyTo?: number;
    /** Переслано из */
    forwardedFrom?: IForwardInfo;
}

/**
 * Медиа файл
 */
export interface IMediaFile {
    /** Тип медиа */
    type: 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'animation' | 'sticker';
    /** Имя файла */
    filename: string;
    /** Размер файла в байтах */
    size: number;
    /** MIME тип */
    mimeType?: string;
    /** Локальный путь к файлу */
    localPath?: string;
    /** URL для скачивания */
    downloadUrl?: string;
    /** Миниатюра для видео/документов */
    thumbnail?: string;
    /** Длительность для аудио/видео */
    duration?: number;
    /** Размеры для фото/видео */
    dimensions?: {
        width: number;
        height: number;
    };
}

/**
 * Ссылка в сообщении
 */
export interface IMessageLink {
    /** URL ссылки */
    url: string;
    /** Текст ссылки */
    text: string;
    /** Тип ссылки */
    type: 'url' | 'text_link' | 'mention' | 'hashtag' | 'bot_command' | 'email' | 'phone';
    /** Позиция в тексте */
    offset: number;
    /** Длина ссылки */
    length: number;
}

/**
 * Реакция на сообщение
 */
export interface IReaction {
    /** Эмодзи реакции */
    emoji: string;
    /** Количество */
    count: number;
}

/**
 * Информация о пересылке
 */
export interface IForwardInfo {
    /** Откуда переслано */
    fromChannel?: string;
    /** ID оригинального сообщения */
    originalMessageId?: number;
    /** Дата оригинального сообщения */
    originalDate?: Date;
    /** Автор оригинального сообщения */
    originalAuthor?: string;
}

/**
 * Статистика парсинга
 */
export interface IParseStats {
    /** Общее количество сообщений */
    totalMessages: number;
    /** Количество сообщений с медиа */
    messagesWithMedia: number;
    /** Количество скачанных медиа файлов */
    downloadedMedia: number;
    /** Общий размер скачанных файлов в байтах */
    totalMediaSize: number;
    /** Количество ссылок */
    totalLinks: number;
    /** Количество хэштегов */
    totalHashtags: number;
    /** Количество упоминаний */
    totalMentions: number;
    /** Время парсинга */
    parseTime: number;
    /** Ошибки при скачивании */
    errors: string[];
}

/**
 * Пути к экспортированным файлам
 */
export interface IExportPaths {
    /** Основной JSON файл */
    jsonFile: string;
    /** Файл только с текстом */
    textFile: string;
    /** CSV файл */
    csvFile: string;
    /** Директория с медиа */
    mediaDirectory: string;
    /** Файл со статистикой */
    statsFile: string;
} 