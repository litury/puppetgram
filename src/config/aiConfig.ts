/**
 * Упрощенная конфигурация AI сервиса
 */

import { IAIServiceConfig } from '../app/aiCommentGenerator/interfaces';

/**
 * Конфигурация по умолчанию для AI сервиса
 */
export const DEFAULT_AI_CONFIG: IAIServiceConfig = {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    timeout: parseInt(process.env.DEEPSEEK_TIMEOUT || '30000'),
    enabled: process.env.DEEPSEEK_ENABLED !== 'false'
};

/**
 * Валидация конфигурации AI
 */
export function validateAIConfig(_config: IAIServiceConfig): string[] {
    const errors: string[] = [];

    if (!_config.apiKey) {
        errors.push('API ключ обязателен');
    }

    if (_config.timeout && _config.timeout < 1000) {
        errors.push('Timeout должен быть не менее 1000мс');
    }

    return errors;
}

/**
 * Создает конфигурацию из переменных окружения
 */
export function createConfigFromEnv(): IAIServiceConfig {
    const config: IAIServiceConfig = {
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseUrl: process.env.DEEPSEEK_BASE_URL,
        model: process.env.DEEPSEEK_MODEL,
        enabled: process.env.DEEPSEEK_ENABLED !== 'false'
    };

    if (process.env.DEEPSEEK_TIMEOUT) {
        config.timeout = parseInt(process.env.DEEPSEEK_TIMEOUT);
    }

    return config;
}

/**
 * Конфигурации для разных сред
 */
export const AI_CONFIGS = {
    development: {
        ...DEFAULT_AI_CONFIG,
        timeout: 10000,
        enabled: true
    },

    testing: {
        ...DEFAULT_AI_CONFIG,
        timeout: 5000,
        enabled: false
    },

    production: {
        ...DEFAULT_AI_CONFIG,
        timeout: 30000,
        enabled: true
    }
};
