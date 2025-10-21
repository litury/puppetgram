/**
 * Интерфейсы для парсера диалогов пользователя
 * Модуль для экспорта сообщений конкретного пользователя из чатов и групп
 */

/**
 * Информация о сообщении пользователя в чате
 */
export interface IUserMessage {
    id: number;
    text: string;
    date: Date;
    chatId: string;
    chatTitle: string;
    chatType: 'private' | 'group' | 'supergroup' | 'channel';
    userId: number;
    username?: string;
    firstName?: string;
    lastName?: string;
    replyToMessageId?: number;
    replyToText?: string;
    replyToUsername?: string;
    forwardedFrom?: string;
    hasMedia: boolean;
    mediaType?: 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'sticker' | 'animation';
    mediaCaption?: string;
    editDate?: Date;
    isEdited: boolean;
}

/**
 * Информация о пользователе в чате
 */
export interface IChatUserInfo {
    id: number;
    username?: string;
    firstName?: string;
    lastName?: string;
    fullName: string;
    messageCount: number;
    firstMessageDate?: Date;
    lastMessageDate?: Date;
    isBot: boolean;
    isDeleted: boolean;
}

/**
 * Результат парсинга всех пользователей чата
 */
export interface IChatUsersParseResult {
    chatId: string;
    chatTitle: string;
    chatType: 'private' | 'group' | 'supergroup' | 'channel';
    totalMessages: number;
    totalUsers: number;
    users: IChatUserInfo[];
    userMessages: { [userId: number]: IUserMessage[] };
    dateRange: {
        from: Date;
        to: Date;
    };
    filters: IDialogFilters;
    exportConfig: IDialogExportConfig;
    exportPath: string;
}

/**
 * Опции для парсинга конкретного чата
 */
export interface IChatParseOptions {
    chatId: string;
    filters: IDialogFilters;
    exportConfig: IDialogExportConfig;
    limit?: number;
    minMessagesPerUser?: number; // Минимум сообщений от пользователя для включения
    excludeBots?: boolean;
    exportByUsers?: boolean; // Создавать отдельные файлы для каждого пользователя
}

/**
 * Опции для парсинга всех пользователей чата  
 */
export interface IAllUsersParseOptions {
    chatId: string;
    limit?: number;
    minMessagesPerUser?: number;
    excludeBots?: boolean;
    filters?: IDialogFilters;
    exportConfig?: IDialogExportConfig;
}

/**
 * Опции для парсинга конкретного пользователя в чате
 */
export interface IUserInChatParseOptions {
    chatId: string;
    targetUsername?: string;  // @username без @
    targetName?: string;      // Имя или фамилия для поиска
    targetUserId?: number;    // Прямой ID пользователя
    limit?: number;
    filters?: IDialogFilters;
    exportConfig?: IDialogExportConfig;
}

/**
 * Информация о найденном пользователе
 */
export interface IFoundUserInfo {
    id: number;
    username: string;
    firstName: string;
    lastName: string;
    fullName: string;
    isBot: boolean;
    isDeleted: boolean;
    messageCount: number;
}

/**
 * Результат парсинга пользователя в чате
 */
export interface IUserInChatParseResult {
    chatId: string;
    chatTitle: string;
    chatType: 'private' | 'group' | 'supergroup' | 'channel';
    targetUser: IFoundUserInfo;
    messages: IUserMessage[];
    totalMessages: number;
    dateRange: {
        from: Date;
        to: Date;
    };
    filters?: IDialogFilters;
    exportConfig?: IDialogExportConfig;
    exportPath: string;
}

/**
 * Информация о чате/группе
 */
export interface IChatInfo {
    id: string;
    title: string;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    username?: string;
    participantsCount?: number;
    description?: string;
    isActive: boolean;
    lastMessageDate?: Date;
    userMessageCount: number; // количество сообщений пользователя в этом чате
}

/**
 * Фильтры для поиска сообщений
 */
export interface IDialogFilters {
    dateFrom?: Date;
    dateTo?: Date;
    chatTypes?: ('private' | 'group' | 'supergroup' | 'channel')[];
    minMessageLength?: number;
    excludeForwarded?: boolean;
    excludeEdited?: boolean;
    excludeMedia?: boolean;
    includeReplies?: boolean;
    keywords?: string[];
    excludeKeywords?: string[];
}

/**
 * Результат поиска сообщений пользователя
 */
export interface IDialogParseResult {
    userId: number;
    username?: string;
    fullName: string;
    totalMessages: number;
    totalChats: number;
    messages: IUserMessage[];
    chats: IChatInfo[];
    dateRange: {
        from: Date;
        to: Date;
    };
    filters: IDialogFilters;
    exportConfig: IDialogExportConfig;
    exportPath: string;
}

/**
 * Конфигурация экспорта
 */
export interface IDialogExportConfig {
    formats: ('json' | 'txt' | 'csv')[];
    includeMetadata: boolean;
    groupByChats: boolean;
    sortBy: 'date' | 'chat' | 'length';
    sortOrder: 'asc' | 'desc';
    maxMessagesPerFile?: number;
    splitByPeriod?: 'day' | 'week' | 'month' | 'year';
    exportByUsers?: boolean; // Создавать отдельные файлы для каждого пользователя (для чатов)
}

/**
 * Опции для парсинга диалогов
 */
export interface IDialogParseOptions {
    targetUserId?: number;
    targetUsername?: string;
    filters: IDialogFilters;
    exportConfig: IDialogExportConfig;
    includePrivateChats: boolean;
    includeGroups: boolean;
    includeSupergroups: boolean;
    includeChannels: boolean;
    limit?: number;
}

/**
 * Основной интерфейс сервиса парсинга диалогов
 */
export interface IDialogParser {
    /**
     * Получает список чатов пользователя
     */
    getUserChatsAsync(_userId?: number): Promise<IChatInfo[]>;

    /**
     * Парсит диалоги пользователя
     */
    parseUserDialogsAsync(_options: IDialogParseOptions): Promise<IDialogParseResult>;

    /**
     * Парсит всех пользователей конкретного чата
     */
    parseChatUsersAsync(_options: IChatParseOptions): Promise<IChatUsersParseResult>;

    /**
     * Парсит сообщения конкретного пользователя в чате
     */
    parseUserInChatAsync(_options: IUserInChatParseOptions): Promise<IUserInChatParseResult>;

    /**
     * Экспортирует результаты в файлы
     */
    exportDialogsAsync(_result: IDialogParseResult): Promise<string[]>;

    /**
     * Экспортирует результаты парсинга чата
     */
    exportChatUsersAsync(_result: IChatUsersParseResult): Promise<string[]>;

    /**
     * Экспортирует результаты парсинга пользователя в чате
     */
    exportUserInChatAsync(_result: IUserInChatParseResult): Promise<string[]>;
}

/**
 * Статистика сообщений пользователя
 */
export interface IUserMessageStats {
    totalMessages: number;
    averageMessageLength: number;
    mostActiveChat: string;
    mostActivePeriod: string;
    messagesByHour: { [hour: number]: number };
    messagesByDay: { [day: string]: number };
    messagesByChat: { [chatId: string]: number };
    replyRate: number; // процент сообщений-ответов
    mediaRate: number; // процент сообщений с медиа
    editRate: number; // процент отредактированных сообщений
} 