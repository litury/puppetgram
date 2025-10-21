/**
 * Интерфейсы для модуля автоматического вступления в каналы Telegram
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

export interface IJoinTarget {
    channelUsername: string;
    channelUrl?: string;
    channelTitle?: string;
    priority: 'high' | 'medium' | 'low'; // Приоритет вступления
    source: 'comment_error' | 'manual' | 'recommendation'; // Источник добавления
    isActive: boolean;
    addedAt: Date;
}

export interface IJoinAttemptResult {
    target: IJoinTarget;
    success: boolean;
    joined: boolean;
    alreadyMember: boolean;
    inviteRequestSent?: boolean; // Заявка на вступление отправлена
    errorCode?: string;
    errorMessage?: string;
    timestamp: Date;
    retryAfter?: number; // Секунды до следующей попытки
}

export interface IJoinSessionOptions {
    targets: IJoinTarget[];
    delayBetweenJoins: number; // мс между вступлениями
    maxJoinsPerSession: number; // Лимит вступлений за сессию
    randomizeOrder: boolean; // Случайный порядок обработки
    skipAlreadyJoined: boolean; // Пропускать уже вступившие
    dryRun: boolean; // Тестовый режим без реального вступления
    retryFailedChannels: boolean; // Повторять неудачные попытки
    maxRetries: number; // Максимум повторов
}

export interface IJoinSessionResult {
    sessionId: string;
    totalTargets: number;
    successfulJoins: number;
    failedJoins: number;
    alreadyJoined: number;
    skippedChannels: number;
    duration: number; // мс
    results: IJoinAttemptResult[];
    summary: {
        successRate: number;
        averageDelay: number;
        errorsByType: { [key: string]: number };
        channelsNeedingRetry: IJoinTarget[];
    };
}

export interface IChannelAccessInfo {
    channelUsername: string;
    channelTitle?: string;
    isPrivate: boolean;
    requiresApproval: boolean;
    isJoinable: boolean;
    memberCount?: number;
    description?: string;
    hasJoinRequest: boolean;
}

export interface IBulkJoinOptions {
    inputFiles: string[]; // Пути к файлам с каналами
    sessionSettings: {
        maxJoinsPerSession: number;
        delayRange: { min: number; max: number }; // Случайная задержка
        parallelSessions: boolean;
        pauseBetweenSessions: number; // мс между сессиями
    };
    safetyLimits: {
        maxJoinsPerHour: number;
        maxJoinsPerDay: number;
        respectFloodWait: boolean;
    };
    filters: {
        skipPrivateChannels: boolean;
        skipChannelsRequiringApproval: boolean;
        onlyHighPriorityChannels: boolean;
    };
}

export interface IChannelJoiner {
    joinChannel(target: IJoinTarget): Promise<IJoinAttemptResult>;
    joinMultipleChannels(options: IJoinSessionOptions): Promise<IJoinSessionResult>;
    bulkJoinChannels(options: IBulkJoinOptions): Promise<IJoinSessionResult[]>;
    checkChannelAccess(channelUsername: string): Promise<IChannelAccessInfo>;
    leaveChannel(channelUsername: string): Promise<boolean>;
}

export interface IChannelJoinStorage {
    saveJoinResults(results: IJoinSessionResult, filename?: string): Promise<string>;
    loadJoinResults(filename: string): Promise<IJoinSessionResult>;
    saveFailedChannels(targets: IJoinTarget[], filename?: string): Promise<string>;
    loadFailedChannels(filename: string): Promise<IJoinTarget[]>;
    getJoinHistory(): Promise<string[]>;
}

export interface IJoinSession {
    sessionId: string;
    startTime: Date;
    endTime?: Date;
    totalTargets: number;
    processedTargets: number;
    successfulJoins: number;
    failedJoins: number;
    isActive: boolean;
    currentTarget?: IJoinTarget;
    options: IJoinSessionOptions;
}

export interface IChannelJoinAnalyzer {
    analyzeJoinResults(results: IJoinSessionResult[]): Promise<IJoinAnalysisReport>;
    generateRetryTargets(results: IJoinSessionResult[]): Promise<IJoinTarget[]>;
    categorizeFailures(results: IJoinAttemptResult[]): Promise<{ [category: string]: IJoinAttemptResult[] }>;
}

export interface IJoinAnalysisReport {
    totalSessions: number;
    totalChannels: number;
    overallSuccessRate: number;
    commonErrors: { [error: string]: number };
    recommendedRetryChannels: IJoinTarget[];
    channelsToAvoid: string[];
    bestTimeSlots: string[];
    summary: string;
} 
 
 
 
 