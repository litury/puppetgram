/**
 * Интерфейсы для конвертации TData в Session String
 * Основано на анализе реальной структуры TData и улучшенном коде конвертации
 * Следует стандартам компании согласно project-structure.mdc и frontend-coding-standards.mdc
 */

/**
 * Запрос на конвертацию TData в Session String
 */
export interface ITdataConversionRequest {
    /** Путь к папке tdata */
    tdataPath: string;

    /** Пароль для расшифровки (опционально) */
    password?: string;

    /** Индекс аккаунта (для множественных аккаунтов, по умолчанию 0) */
    accountIndex?: number;

    /** Имя ключа данных (по умолчанию "data") */
    dataName?: string;

    /** Формат выходного файла (session, json, both) */
    outputFormat?: 'session' | 'json' | 'both';
}

/**
 * Результат конвертации TData
 */
export interface ITdataConversionResult {
    /** Успешность операции */
    success: boolean;

    /** Session string для GramJS */
    sessionString?: string;

    /** Информация об аккаунте */
    accountInfo?: IAccountInfo;

    /** Путь к созданному session файлу */
    sessionFilePath?: string;

    /** Путь к созданному JSON файлу */
    jsonFilePath?: string;

    /** Ошибка, если операция неудачна */
    error?: string;

    /** Дополнительная информация */
    details?: {
        tdataPath: string;
        accountsCount: number;
        accountIndex: number;
        convertedAt: Date;
        tdesktopVersion?: number;
    };
}

/**
 * Информация об аккаунте
 */
export interface IAccountInfo {
    /** Номер телефона */
    phoneNumber: string;

    /** ID пользователя */
    userId: number;

    /** Username */
    username?: string;

    /** Датацентр */
    dcId: number;

    /** Auth ключ (заполняется при конвертации) */
    authKey: string;

    /** Данные сессии (заполняются при конвертации) */
    sessionData: string;

    /** Дополнительные метаданные из JSON */
    additionalMetadata?: {
        /** Application ID */
        appId?: number;
        /** Application Hash */
        appHash?: string;
        /** Версия приложения */
        appVersion?: string;
        /** SDK информация */
        sdk?: string;
        /** Устройство */
        device?: string;
        /** Языковой пакет */
        langPack?: string;
        /** Системный языковой пакет */
        systemLangPack?: string;
        /** 2FA статус */
        twoFA?: boolean | null;
        /** Роль */
        role?: string;
    };
}

/**
 * Опции для конвертации
 */
export interface ITdataConversionOptions {
    /** Проверять MD5 хеши файлов */
    validateMd5?: boolean;

    /** Максимальное количество попыток */
    maxRetries?: number;

    /** Логировать подробности процесса */
    verbose?: boolean;

    /** Создавать резервные копии */
    createBackup?: boolean;

    /** Директория для сохранения результатов */
    outputDirectory?: string;
}

/**
 * Данные о TData файле
 */
export interface ITdataFileInfo {
    /** Путь к файлу */
    filePath: string;

    /** Версия TDesktop */
    version: number;

    /** Magic number */
    magic: string;

    /** MD5 хеш */
    md5Hash: string;

    /** Размер файла */
    fileSize: number;

    /** Дата модификации */
    lastModified: Date;
}

/**
 * Информация о множественных аккаунтах в TData
 */
export interface IMultiAccountInfo {
    /** Общее количество найденных аккаунтов */
    accountCount: number;
    /** Список папок аккаунтов (MD5 имена) */
    accountFolders: string[];
    /** Список файлов данных аккаунтов (MD5 + 's') */
    accountDataFiles: string[];
    /** Метаданные аккаунтов из JSON файлов */
    accountsMetadata: IAccountInfo[];
    /** Есть ли множественные аккаунты */
    hasMultipleAccounts: boolean;
    /** Версия key_datas файла */
    keyDatasVersion: number;
}

/**
 * Краткая информация об аккаунте
 */
export interface IAccountSummary {
    /** Индекс аккаунта */
    index: number;

    /** ID пользователя (если доступен) */
    userId?: number;

    /** Номер телефона (если доступен) */
    phone?: string;

    /** Имя (если доступно) */
    displayName?: string;

    /** Папка данных аккаунта */
    dataFolder: string;
}

/**
 * Валидационный результат TData
 */
export interface ITdataValidationResult {
    /** Валидность TData */
    isValid: boolean;

    /** Найденные файлы ключей */
    keyFiles: string[];

    /** Найденные папки аккаунтов */
    accountFolders: string[];

    /** Ошибки валидации */
    errors: string[];

    /** Предупреждения */
    warnings: string[];
}

/**
 * Основной интерфейс конвертера TData
 */
export interface ITdataSessionConverter {
    /**
     * Конвертирует TData в Session String
     * @param _request - параметры конвертации
     * @param _options - дополнительные опции
     * @returns Promise с результатом конвертации
     */
    convertTdataToSessionAsync(_request: ITdataConversionRequest, _options?: ITdataConversionOptions): Promise<ITdataConversionResult>;

    /**
     * Проверяет валидность TData папки
     * @param _tdataPath - путь к папке tdata
     * @returns Promise с детальным результатом валидации
     */
    validateTdataAsync(_tdataPath: string): Promise<ITdataValidationResult>;

    /**
     * Получает информацию о TData файлах
     * @param _tdataPath - путь к папке tdata
     * @returns Promise с информацией о файлах
     */
    getTdataInfoAsync(_tdataPath: string): Promise<ITdataFileInfo[]>;

    /**
     * Получает информацию о множественных аккаунтах
     * @param _tdataPath - путь к папке tdata
     * @param _password - пароль для расшифровки (опционально)
     * @returns Promise с информацией об аккаунтах
     */
    getMultiAccountInfoAsync(_tdataPath: string, _password?: string): Promise<IMultiAccountInfo>;

    /**
     * Извлекает метаданные аккаунта из JSON файлов
     * @param _tdataPath - путь к папке tdata
     * @returns Promise с метаданными найденных аккаунтов
     */
    extractAccountMetadataAsync(_tdataPath: string): Promise<IAccountInfo[]>;
} 