/**
 * Интерфейсы для модуля управления профилем пользователя
 * Следует стандартам компании согласно frontend-coding-standards.mdc
 */

/**
 * Данные профиля пользователя
 */
export interface IUserProfile {
    /** ID пользователя */
    userId: number;

    /** Username (без @) */
    username?: string;

    /** Имя пользователя */
    firstName?: string;

    /** Фамилия пользователя */
    lastName?: string;

    /** Описание профиля (bio) */
    bio?: string;

    /** Номер телефона */
    phoneNumber?: string;

    /** URL аватара */
    profilePhotoUrl?: string;

    /** Является ли аккаунт премиум */
    isPremium: boolean;

    /** Является ли аккаунт верифицированным */
    isVerified: boolean;
}

/**
 * Запрос на обновление username
 */
export interface IUsernameUpdateRequest {
    /** Строка сессии пользователя */
    sessionString: string;

    /** Новый username (без @) */
    newUsername: string;
}

/**
 * Запрос на обновление профиля
 */
export interface IProfileUpdateRequest {
    /** Строка сессии пользователя */
    sessionString: string;

    /** Новое имя */
    firstName?: string;

    /** Новая фамилия */
    lastName?: string;

    /** Новое описание профиля */
    bio?: string;
}

/**
 * Запрос на обновление фото профиля
 */
export interface IProfilePhotoUpdateRequest {
    /** Строка сессии пользователя */
    sessionString: string;

    /** Путь к файлу изображения */
    photoPath: string;
}

/**
 * Запрос на установку пароля 2FA
 */
export interface I2FASetupRequest {
    /** Строка сессии пользователя */
    sessionString: string;

    /** Новый пароль для 2FA */
    password: string;

    /** Подсказка для пароля (опционально) */
    hint?: string;
}

/**
 * Запрос на изменение пароля 2FA
 */
export interface I2FAChangeRequest {
    /** Строка сессии пользователя */
    sessionString: string;

    /** Текущий пароль 2FA */
    currentPassword: string;

    /** Новый пароль для 2FA */
    newPassword: string;

    /** Подсказка для нового пароля (опционально) */
    hint?: string;
}

/**
 * Информация о статусе 2FA
 */
export interface I2FAStatus {
    /** Включен ли 2FA */
    isEnabled: boolean;

    /** Подсказка для пароля */
    hint?: string;

    /** Email для восстановления */
    recoveryEmail?: string;
}

/**
 * Результат операции обновления профиля
 */
export interface IProfileUpdateResult {
    /** Успешность операции */
    success: boolean;

    /** Обновленная информация о профиле */
    profileInfo?: IUserProfile;

    /** Сообщение об ошибке */
    error?: string;

    /** Подробности операции */
    details?: string;
}

/**
 * Опции для операций с профилем
 */
export interface IProfileManagerOptions {
    /** Таймаут операции в миллисекундах */
    timeout?: number;

    /** Количество попыток при ошибках */
    retryAttempts?: number;

    /** Задержка между попытками в миллисекундах */
    retryDelay?: number;
}

/**
 * Основной интерфейс сервиса управления профилем
 */
export interface IProfileManager {
    /**
     * Обновление username пользователя
     */
    updateUsernameAsync(_request: IUsernameUpdateRequest, _options?: IProfileManagerOptions): Promise<IProfileUpdateResult>;

    /**
     * Обновление основной информации профиля
     */
    updateProfileAsync(_request: IProfileUpdateRequest, _options?: IProfileManagerOptions): Promise<IProfileUpdateResult>;

    /**
     * Обновление фото профиля
     */
    updateProfilePhotoAsync(_request: IProfilePhotoUpdateRequest, _options?: IProfileManagerOptions): Promise<IProfileUpdateResult>;

    /**
     * Получение текущей информации о профиле
     */
    getProfileInfoAsync(_sessionString: string): Promise<IUserProfile>;

    /**
     * Проверка доступности username
     */
    checkUsernameAvailabilityAsync(_username: string, _sessionString: string): Promise<boolean>;

    /**
     * Установка пароля двухфакторной аутентификации
     */
    setup2FAAsync(_request: I2FASetupRequest, _options?: IProfileManagerOptions): Promise<IProfileUpdateResult>;

    /**
     * Изменение пароля двухфакторной аутентификации
     */
    change2FAAsync(_request: I2FAChangeRequest, _options?: IProfileManagerOptions): Promise<IProfileUpdateResult>;

    /**
     * Получение статуса двухфакторной аутентификации
     */
    get2FAStatusAsync(_sessionString: string): Promise<I2FAStatus>;

    /**
     * Отключение двухфакторной аутентификации
     */
    disable2FAAsync(_sessionString: string, _currentPassword: string): Promise<IProfileUpdateResult>;

    // === УПРАВЛЕНИЕ ИМЕНЕМ И ФАМИЛИЕЙ ===

    /**
     * Обновление только имени пользователя
     */
    updateFirstNameAsync(_request: IFirstNameUpdateRequest): Promise<IProfileUpdateResult>;

    /**
     * Обновление только фамилии пользователя
     */
    updateLastNameAsync(_request: ILastNameUpdateRequest): Promise<IProfileUpdateResult>;

    /**
     * Обновление полного имени (имя + фамилия) одновременно
     */
    updateFullNameAsync(_request: IFullNameUpdateRequest): Promise<IProfileUpdateResult>;

    /**
     * Обновление биографии профиля
     */
    updateBioAsync(_request: IBioUpdateRequest): Promise<IProfileUpdateResult>;

    // === УПРАВЛЕНИЕ ФОТОГРАФИЕЙ ПРОФИЛЯ ===

    /**
     * Загрузка новой фотографии профиля
     */
    uploadProfilePhotoAsync(_request: IProfilePhotoUpdateRequest): Promise<IProfileUpdateResult & { photo?: IUploadedPhoto }>;

    /**
     * Удаление текущей фотографии профиля
     */
    deleteProfilePhotoAsync(_request: IProfilePhotoDeleteRequest): Promise<IProfileUpdateResult>;

    // === УПРАВЛЕНИЕ НАСТРОЙКАМИ ПРИВАТНОСТИ ===

    /**
     * Обновление настроек приватности
     */
    updatePrivacySettingsAsync(_request: IPrivacyUpdateRequest): Promise<IProfileUpdateResult>;

    /**
     * Получение текущих настроек приватности
     */
    getPrivacySettingsAsync(_sessionString: string, _ruleType: PrivacyRuleType): Promise<PrivacyLevel>;

    // === ДОПОЛНИТЕЛЬНЫЕ УТИЛИТЫ ===

    /**
     * Получение полной информации о профиле
     */
    getFullProfileAsync(_sessionString: string): Promise<IUserProfile>;

    /**
     * Экспорт данных профиля в JSON
     */
    exportProfileDataAsync(_sessionString: string): Promise<string>;
}

/**
 * Запрос на обновление только имени
 */
export interface IFirstNameUpdateRequest {
    /** Строка сессии пользователя */
    sessionString: string;

    /** Новое имя */
    firstName: string;
}

/**
 * Запрос на обновление только фамилии
 */
export interface ILastNameUpdateRequest {
    /** Строка сессии пользователя */
    sessionString: string;

    /** Новая фамилия */
    lastName: string;
}

/**
 * Запрос на обновление полного имени (имя + фамилия одновременно)
 */
export interface IFullNameUpdateRequest {
    /** Строка сессии пользователя */
    sessionString: string;

    /** Новое имя */
    firstName: string;

    /** Новая фамилия */
    lastName: string;
}

/**
 * Запрос на обновление биографии профиля
 */
export interface IBioUpdateRequest {
    /** Строка сессии пользователя */
    sessionString: string;

    /** Новая биография (максимум 70 символов) */
    bio: string;
}

/**
 * Типы настроек приватности
 */
export enum PrivacyRuleType {
    /** Видимость номера телефона */
    PHONE_NUMBER = 'phoneNumber',
    /** Видимость статуса "в сети" */
    LAST_SEEN = 'lastSeen',
    /** Возможность писать в личные сообщения */
    CHAT_INVITE = 'chatInvite',
    /** Возможность звонить */
    PHONE_CALL = 'phoneCall',
    /** Видимость пересылаемых сообщений */
    FORWARDS = 'forwards',
    /** Видимость фото профиля */
    PROFILE_PHOTO = 'profilePhoto'
}

/**
 * Уровни приватности
 */
export enum PrivacyLevel {
    /** Доступно всем */
    EVERYBODY = 'everybody',
    /** Только контакты */
    CONTACTS = 'contacts',
    /** Никто */
    NOBODY = 'nobody'
}

/**
 * Запрос на обновление настроек приватности
 */
export interface IPrivacyUpdateRequest {
    /** Строка сессии пользователя */
    sessionString: string;

    /** Тип настройки приватности */
    ruleType: PrivacyRuleType;

    /** Уровень приватности */
    level: PrivacyLevel;

    /** Исключения - пользователи для которых правило не применяется */
    exceptions?: number[];
}

/**
 * Запрос на удаление фото профиля
 */
export interface IProfilePhotoDeleteRequest {
    /** Строка сессии пользователя */
    sessionString: string;
}

/**
 * Информация о загруженном фото
 */
export interface IUploadedPhoto {
    /** ID файла в Telegram */
    fileId: string;

    /** Локальный путь к файлу */
    localPath: string;

    /** Размер файла в байтах */
    fileSize: number;

    /** MIME тип файла */
    mimeType: string;

    /** Дата загрузки */
    uploadedAt: Date;
} 