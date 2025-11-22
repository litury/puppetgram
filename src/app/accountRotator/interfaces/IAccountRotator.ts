/**
 * Интерфейсы для модуля ротации аккаунтов
 */

export interface IAccountInfo {
    sessionKey: string;
    sessionValue: string;
    name: string;
    username?: string;
    userId?: string;
    password?: string;
    commentsCount: number;
    isActive: boolean;
    lastUsed?: Date;
    maxCommentsPerSession: number;
}

export interface IRotationState {
    currentAccountIndex: number;
    totalAccounts: number;
    totalCommentsPosted: number;
    sessionStartTime: Date;
    lastRotationTime?: Date;
    cycleCount: number;
    isRotationEnabled: boolean;
}

export interface IRotationConfig {
    maxCommentsPerAccount: number;
    delayBetweenRotations: number; // в секундах
    resetCountersDaily: boolean;
    saveProgress: boolean;
    progressFilePath?: string;
}

export interface IRotationResult {
    success: boolean;
    previousAccount: IAccountInfo;
    newAccount: IAccountInfo;
    reason: string;
    rotationTime: Date;
}

export interface IAccountRotationSummary {
    totalAccountsUsed: number;
    totalCommentsPosted: number;
    totalRotations: number;
    sessionDuration: number; // в миллисекундах
    averageCommentsPerAccount: number;
    completeCycles: number;
}

export interface IAccountRotator {
    /**
     * Получить текущий активный аккаунт
     */
    getCurrentAccount(): IAccountInfo;
    
    /**
     * Проверить нужна ли ротация
     */
    shouldRotate(): boolean;
    
    /**
     * Выполнить ротацию к следующему аккаунту
     */
    rotateToNextAccount(): Promise<IRotationResult>;
    
    /**
     * Увеличить счетчик комментариев для текущего аккаунта
     */
    incrementCommentCount(): void;
    
    /**
     * Получить статус ротации
     */
    getRotationState(): IRotationState;
    
    /**
     * Получить итоговую статистику
     */
    getRotationSummary(): IAccountRotationSummary;
    
    /**
     * Сохранить состояние ротации
     */
    saveRotationState(): Promise<void>;
    
    /**
     * Загрузить состояние ротации
     */
    loadRotationState(): Promise<void>;
    
    /**
     * Сбросить счетчики аккаунтов
     */
    resetAccountCounters(): void;
}
