/**
 * Интерфейсы для модуля генерации сессий Telegram
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

/**
 * Опции для генерации сессии
 */
export interface ISessionGenerationOptions {
    /**
     * API ID от my.telegram.org
     */
    apiId: number;

    /**
     * API Hash от my.telegram.org
     */
    apiHash: string;

    /**
     * Модель устройства
     */
    deviceModel?: string;

    /**
     * Версия системы
     */
    systemVersion?: string;

    /**
     * Версия приложения
     */
    appVersion?: string;

    /**
     * Количество попыток подключения
     */
    connectionRetries?: number;

    /**
     * Таймаут подключения в мс
     */
    timeout?: number;
}

/**
 * Результат генерации сессии
 */
export interface ISessionGenerationResult {
    /**
     * Строка сессии для использования в коде
     */
    sessionString: string;

    /**
     * Номер телефона
     */
    phoneNumber: string;

    /**
     * ID пользователя
     */
    userId?: number;

    /**
     * Username пользователя
     */
    username?: string;

    /**
     * Имя пользователя
     */
    firstName?: string;

    /**
     * Фамилия пользователя
     */
    lastName?: string;

    /**
     * Дата генерации сессии
     */
    generatedAt: Date;

    /**
     * Действительность сессии
     */
    isValid: boolean;
}

/**
 * Информация о сессии
 */
export interface ISessionInfo {
    /**
     * ID пользователя
     */
    userId: number;

    /**
     * Username пользователя
     */
    username?: string;

    /**
     * Имя пользователя
     */
    firstName?: string;

    /**
     * Фамилия пользователя
     */
    lastName?: string;

    /**
     * Номер телефона
     */
    phoneNumber?: string;

    /**
     * Является ли ботом
     */
    isBot: boolean;

    /**
     * Премиум аккаунт
     */
    isPremium: boolean;

    /**
     * Верифицированный аккаунт
     */
    isVerified: boolean;
}

/**
 * Учетные данные для авторизации
 */
export interface IAuthCredentials {
    /**
     * Номер телефона
     */
    phoneNumber: string;

    /**
     * Код подтверждения
     */
    phoneCode?: string;

    /**
     * Пароль двухфакторной аутентификации
     */
    password?: string;
}

/**
 * Интерфейс для интерактивной авторизации
 */
export interface IInteractiveAuthHandler {
    /**
     * Запрос номера телефона
     */
    requestPhoneNumber(): Promise<string>;

    /**
     * Запрос кода подтверждения
     */
    requestPhoneCode(): Promise<string>;

    /**
     * Запрос пароля двухфакторной аутентификации
     */
    requestPassword(): Promise<string>;

    /**
     * Отображение сообщения
     */
    displayMessage(message: string): void;

    /**
     * Отображение ошибки
     */
    displayError(error: string): void;

    /**
     * Отображение успешного результата
     */
    displaySuccess(message: string): void;
}

/**
 * Интерфейс для хранения сессий
 */
export interface ISessionStorage {
    /**
     * Сохранение сессии
     */
    saveSession(result: ISessionGenerationResult, filename?: string): Promise<string>;

    /**
     * Загрузка сессии
     */
    loadSession(filename: string): Promise<ISessionGenerationResult>;

    /**
     * Список сохраненных сессий
     */
    listSessions(): Promise<string[]>;

    /**
     * Удаление сессии
     */
    deleteSession(filename: string): Promise<boolean>;

    /**
     * Очистка всех сессий
     */
    clearAllSessions(): Promise<number>;

    /**
     * Информация о хранилище
     */
    getStorageInfo(): {
        directory: string;
        totalSessions: number;
    };
}

/**
 * Основной интерфейс генератора сессий
 */
export interface ISessionGenerator {
    /**
     * Генерация новой сессии
     */
    generateSession(options: ISessionGenerationOptions): Promise<ISessionGenerationResult>;

    /**
     * Валидация существующей сессии
     */
    validateExistingSession(sessionString: string): Promise<boolean>;

    /**
     * Получение информации о сессии
     */
    getSessionInfo(sessionString: string): Promise<ISessionInfo>;
} 