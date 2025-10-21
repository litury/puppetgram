/**
 * Модуль ротации аккаунтов для автоматического комментирования
 * Управляет переключением между аккаунтами после достижения лимита комментариев
 */

export * from './interfaces/IAccountRotator';
export * from './services/accountRotatorService';
export * from './adapters/rotationStateAdapter';
