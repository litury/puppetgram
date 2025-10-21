/**
 * Интерфейсы для простого комментирования по username
 */

import { IAIServiceConfig } from '../../aiCommentGenerator/interfaces';

export interface ISimpleCommentOptions {
    /** Usernames каналов (без @, t.me/ и т.д.) */
    channels: string[];
    /** Задержка между комментариями (мс) */
    delayBetweenComments: number;
    /** Тестовый режим */
    dryRun: boolean;
    /** Отправлять от имени канала */
    sendAsChannelId?: string;
    /** Использовать AI для генерации комментариев */
    useAI?: boolean;
    /** AI конфигурация (опционально, по умолчанию из config/aiConfig) */
    aiConfig?: IAIServiceConfig;
}

export interface ISimpleCommentResult {
    /** Username канала */
    channelUsername: string;
    /** Успешность */
    success: boolean;
    /** Текст комментария */
    commentText?: string;
    /** ID отправленного сообщения */
    messageId?: number;
    /** Ошибка */
    error?: string;
    /** Время отправки */
    timestamp: Date;
    /** Количество API запросов */
    apiCalls: number;
    /** Был ли использован AI */
    usedAI: boolean;
    /** AI ошибка */
    aiError?: string;
}

export interface ISimpleCommentResponse {
    /** ID сессии */
    sessionId: string;
    /** Всего каналов */
    totalChannels: number;
    /** Успешных комментариев */
    successfulComments: number;
    /** Неудачных комментариев */
    failedComments: number;
    /** Результаты */
    results: ISimpleCommentResult[];
    /** Общее количество API запросов */
    totalApiCalls: number;
    /** Длительность */
    duration: number;
    /** AI статистика */
    aiStats: {
        totalAIRequests: number;
        successfulAIRequests: number;
        failedAIRequests: number;
    };
}

export interface ISimpleCommenter {
    /**
     * Простое комментирование по usernames
     */
    postCommentsAsync(_options: ISimpleCommentOptions): Promise<ISimpleCommentResponse>;
} 