import { IMessage } from '../../../interfaces/IMessage';

/**
 * Критерии для анализа лучших постов
 */
export interface IPostAnalysisCriteria {
    sortBy: 'views' | 'forwards' | 'engagement' | 'reactions' | 'replies' | 'combined';
    minViews?: number;
    minForwards?: number;
    minReactions?: number;
    dateFrom?: Date;
    dateTo?: Date;
    includeWithMedia?: boolean;
    excludeWithMedia?: boolean;
    minTextLength?: number;
    maxTextLength?: number;
}

/**
 * Результат анализа поста
 */
export interface IPostAnalysisResult {
    message: IMessage;
    score: number;
    metrics: {
        views: number;
        forwards: number;
        reactions: number;
        replies: number;
        engagement: number;
        textLength: number;
        hasMedia: boolean;
    };
    rank: number;
}

/**
 * Опции для анализа топ постов
 */
export interface ITopPostAnalysisOptions {
    channels: string[];
    criteria: IPostAnalysisCriteria;
    limit?: number;
    messageLimit?: number; // Сколько последних сообщений анализировать из каждого канала
    exportResults?: boolean;
}

/**
 * Результат анализа топ постов для канала
 */
export interface IChannelTopPostsResult {
    channelName: string;
    channelTitle: string;
    totalMessagesAnalyzed: number;
    topPosts: IPostAnalysisResult[];
    averageMetrics: {
        avgViews: number;
        avgForwards: number;
        avgReactions: number;
        avgEngagement: number;
    };
}

/**
 * Общий результат анализа по всем каналам
 */
export interface ITopPostAnalysisResponse {
    channels: IChannelTopPostsResult[];
    overallTopPosts: IPostAnalysisResult[];
    analysisDate: Date;
    criteria: IPostAnalysisCriteria;
    totalChannels: number;
    totalMessagesAnalyzed: number;
}

/**
 * Основной интерфейс сервиса анализа топ постов
 */
export interface ITopPostAnalyzer {
    /**
     * Анализирует топ посты по указанным каналам
     */
    analyzeTopPostsAsync(options: ITopPostAnalysisOptions): Promise<ITopPostAnalysisResponse>;

    /**
     * Анализирует посты одного канала
     */
    analyzeChannelPostsAsync(
        channelName: string,
        criteria: IPostAnalysisCriteria,
        messageLimit?: number
    ): Promise<IChannelTopPostsResult>;

    /**
     * Вычисляет показатель вовлеченности для поста
     */
    calculateEngagement(message: IMessage): number;

    /**
     * Фильтрует сообщения по критериям
     */
    filterMessages(messages: IMessage[], criteria: IPostAnalysisCriteria): IMessage[];

    /**
     * Сортирует сообщения по указанному критерию
     */
    sortMessages(messages: IMessage[], sortBy: IPostAnalysisCriteria['sortBy']): IMessage[];
} 