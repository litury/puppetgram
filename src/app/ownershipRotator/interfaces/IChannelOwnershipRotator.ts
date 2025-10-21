/**
 * Интерфейсы для модуля передачи владения каналами
 */

/**
 * Запрос на передачу владения каналом
 */
export interface IOwnershipTransferRequest {
    /** Строка сессии Telegram пользователя-владельца */
    sessionString: string;

    /** Идентификатор канала (username или ID) */
    channelIdentifier: string;

    /** Идентификатор целевого пользователя (username или ID) */
    targetUserIdentifier: string;

    /** Пароль двухфакторной аутентификации */
    password: string;
}

/**
 * Дополнительные опции для передачи владения
 */
export interface IOwnershipTransferOptions {
    /** Таймаут операции в миллисекундах (по умолчанию 30000) */
    timeout?: number;

    /** Количество попыток при ошибках (по умолчанию 3) */
    retryAttempts?: number;

    /** Валидировать канал перед передачей (по умолчанию true) */
    validateChannel?: boolean;

    /** Валидировать целевого пользователя (по умолчанию true) */
    validateTargetUser?: boolean;
}

/**
 * Результат передачи владения каналом
 */
export interface IOwnershipTransferResult {
    /** Успешность операции */
    success: boolean;

    /** Название канала */
    channelTitle: string;

    /** ID канала */
    channelId: string;

    /** Информация о передающем пользователе */
    fromUser: IUserInfo;

    /** Информация о получающем пользователе */
    toUser: IUserInfo;

    /** Время передачи владения */
    transferredAt: Date;

    /** Сообщение об ошибке (если success = false) */
    error?: string;

    /** Детали ошибки для отладки */
    errorDetails?: string;
}

/**
 * Информация о канале
 */
export interface IChannelInfo {
    /** ID канала */
    id: number;

    /** Название канала */
    title: string;

    /** Username канала (если есть) */
    username?: string;

    /** Количество участников */
    participantsCount: number;

    /** Является ли канал публичным */
    isPublic?: boolean;
}

/**
 * Информация о пользователе
 */
export interface IUserInfo {
    /** ID пользователя */
    id: number;

    /** Username пользователя (если есть) */
    username?: string;

    /** Имя пользователя */
    firstName?: string;

    /** Фамилия пользователя */
    lastName?: string;

    /** Является ли пользователь ботом */
    isBot?: boolean;
}

/**
 * Основной интерфейс сервиса передачи владения каналами
 */
export interface IChannelOwnershipRotator {
    /**
     * Передает владение каналом другому пользователю
     * @param _request - данные для передачи владения
     * @param _options - дополнительные опции
     * @returns Promise с результатом передачи
     */
    transferOwnershipAsync(
        _request: IOwnershipTransferRequest,
        _options?: IOwnershipTransferOptions
    ): Promise<IOwnershipTransferResult>;
} 