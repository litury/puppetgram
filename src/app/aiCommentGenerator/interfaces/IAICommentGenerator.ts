/**
 * Интерфейсы для AI генерации осмысленных коротких комментариев
 * Следует стандартам компании согласно proj-struct-guideline.md
 */

import { IPostContent } from '../../commentPoster/interfaces';

/**
 * Основной интерфейс для AI генератора комментариев
 */
export interface IAICommentGenerator {
    /**
     * Генерирует осмысленный короткий комментарий на основе контента поста
     */
    generateCommentAsync(_postContent: IPostContent): Promise<IAICommentResult>;

    /**
     * Проверяет доступность AI сервиса
     */
    checkHealthAsync(): Promise<boolean>;
}

/**
 * Проверка пригодности поста для комментирования
 */
export interface IPostSuitabilityCheck {
    shouldComment: boolean;
    reason?: string;
}

/**
 * Результат генерации комментария
 */
export interface IAICommentResult {
    comment: string;
    success: boolean;
    error?: string;
    isValid: boolean;
}

/**
 * Конфигурация AI сервиса
 */
export interface IAIServiceConfig {
    enabled: boolean;
    apiKey: string;
    baseUrl?: string;
    model?: string;
    timeout?: number;
}



