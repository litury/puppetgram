/**
 * Вспомогательные функции для модуля автоматического вступления в каналы
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { IJoinTarget, IJoinAttemptResult, IJoinSessionResult } from '../interfaces';

/**
 * Парсинг файла с каналами для вступления
 * Поддерживает различные форматы: @username, https://t.me/username, username
 */
export function parseJoinTargetsFromFile(_fileContent: string): IJoinTarget[] {
    const targets: IJoinTarget[] = [];
    const lines = _fileContent.split('\n');

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Пропускаем пустые строки и комментарии
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            continue;
        }

        const target = parseJoinTargetFromLine(trimmedLine);
        if (target) {
            targets.push(target);
        }
    }

    return targets;
}

/**
 * Парсинг одной строки с каналом
 */
export function parseJoinTargetFromLine(_line: string): IJoinTarget | null {
    try {
        let channelUsername = _line.trim();
        let priority: 'high' | 'medium' | 'low' = 'medium';
        let source: 'comment_error' | 'manual' | 'recommendation' = 'manual';

        // Обработка приоритета в конце строки (например: @channel !high)
        const priorityMatch = channelUsername.match(/\s+!(high|medium|low)$/i);
        if (priorityMatch) {
            priority = priorityMatch[1].toLowerCase() as 'high' | 'medium' | 'low';
            channelUsername = channelUsername.replace(/\s+!(high|medium|low)$/i, '');
        }

        // Обработка источника (например: @channel #error)
        const sourceMatch = channelUsername.match(/\s+#(error|manual|recommendation)$/i);
        if (sourceMatch) {
            const sourceMap = {
                'error': 'comment_error' as const,
                'manual': 'manual' as const,
                'recommendation': 'recommendation' as const
            };
            source = sourceMap[sourceMatch[1].toLowerCase() as keyof typeof sourceMap];
            channelUsername = channelUsername.replace(/\s+#(error|manual|recommendation)$/i, '');
        }

        // Извлекаем username из различных форматов
        if (channelUsername.startsWith('https://t.me/')) {
            channelUsername = channelUsername.replace('https://t.me/', '');
        } else if (channelUsername.startsWith('t.me/')) {
            channelUsername = channelUsername.replace('t.me/', '');
        }

        // Убираем @ если есть
        if (channelUsername.startsWith('@')) {
            channelUsername = channelUsername.substring(1);
        }

        // Проверяем валидность username
        if (!isValidChannelUsername(channelUsername)) {
            console.warn(`Неверный формат канала: ${_line}`);
            return null;
        }

        return {
            channelUsername: channelUsername,
            channelUrl: `https://t.me/${channelUsername}`,
            priority: priority,
            source: source,
            isActive: true,
            addedAt: new Date()
        };

    } catch (error) {
        console.warn(`Ошибка парсинга строки "${_line}": ${error}`);
        return null;
    }
}

/**
 * Валидация username канала
 */
export function isValidChannelUsername(_username: string): boolean {
    // Username должен содержать только буквы, цифры и подчеркивания
    // Длина от 5 до 32 символов
    const usernameRegex = /^[a-zA-Z0-9_]{5,32}$/;
    return usernameRegex.test(_username);
}

/**
 * Создание случайной задержки в заданном диапазоне
 */
export function generateRandomJoinDelay(_minMs: number, _maxMs: number): number {
    return Math.floor(Math.random() * (_maxMs - _minMs + 1)) + _minMs;
}

/**
 * Создание задержки (Promise)
 */
export function delayJoinAsync(_ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, _ms));
}

/**
 * Генерация уникального ID сессии вступления
 */
export function generateJoinSessionId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `join-session-${timestamp}-${random}`;
}

/**
 * Форматирование длительности в читаемый вид
 */
export function formatJoinDuration(_ms: number): string {
    const seconds = Math.floor(_ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}ч ${minutes % 60}м ${seconds % 60}с`;
    } else if (minutes > 0) {
        return `${minutes}м ${seconds % 60}с`;
    } else {
        return `${seconds}с`;
    }
}

/**
 * Категоризация ошибок для статистики
 */
export function categorizeJoinError(_error: string): string {
    const lowerError = _error.toLowerCase();

    if (lowerError.includes('flood')) return 'FLOOD_WAIT';
    if (lowerError.includes('banned') || lowerError.includes('restricted')) return 'BANNED';
    if (lowerError.includes('not found') || lowerError.includes('username')) return 'CHANNEL_NOT_FOUND';
    if (lowerError.includes('private')) return 'PRIVATE_CHANNEL';
    if (lowerError.includes('invite') || lowerError.includes('join_request')) return 'REQUIRES_APPROVAL';
    if (lowerError.includes('limit') || lowerError.includes('too many')) return 'JOIN_LIMIT_REACHED';
    if (lowerError.includes('timeout') || lowerError.includes('network')) return 'NETWORK_ERROR';
    if (lowerError.includes('already') || lowerError.includes('participant')) return 'ALREADY_MEMBER';

    return 'OTHER';
}

/**
 * Вычисление статистики ошибок
 */
export function calculateJoinErrorStats(_results: IJoinAttemptResult[]): { [key: string]: number } {
    const errorStats: { [key: string]: number } = {};

    _results.forEach(result => {
        if (!result.success && result.errorMessage) {
            const category = categorizeJoinError(result.errorMessage);
            errorStats[category] = (errorStats[category] || 0) + 1;
        }
    });

    return errorStats;
}

/**
 * Чтение и парсинг файла с каналами для вступления
 */
export function loadJoinTargetsFromFile(_filePath: string): IJoinTarget[] {
    try {
        if (!fs.existsSync(_filePath)) {
            throw new Error(`Файл не найден: ${_filePath}`);
        }

        const fileContent = fs.readFileSync(_filePath, 'utf-8');
        return parseJoinTargetsFromFile(fileContent);
    } catch (error) {
        throw new Error(`Ошибка при чтении файла ${_filePath}: ${error}`);
    }
}

/**
 * Сохранение списка каналов в файл
 */
export function saveJoinTargetsToFile(_targets: IJoinTarget[], _filePath: string): void {
    try {
        const dirPath = path.dirname(_filePath);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        const content = _targets.map(target => {
            let line = `@${target.channelUsername}`;
            if (target.priority !== 'medium') {
                line += ` !${target.priority}`;
            }
            if (target.source !== 'manual') {
                const sourceMap = {
                    'comment_error': 'error',
                    'recommendation': 'recommendation'
                };
                line += ` #${sourceMap[target.source] || target.source}`;
            }
            return line;
        }).join('\n');

        fs.writeFileSync(_filePath, content, 'utf-8');
    } catch (error) {
        throw new Error(`Ошибка сохранения файла ${_filePath}: ${error}`);
    }
}

/**
 * Фильтрация каналов по приоритету
 */
export function filterTargetsByPriority(
    _targets: IJoinTarget[],
    _priority: 'high' | 'medium' | 'low'
): IJoinTarget[] {
    return _targets.filter(target => target.priority === _priority);
}

/**
 * Сортировка каналов по приоритету
 */
export function sortTargetsByPriority(_targets: IJoinTarget[]): IJoinTarget[] {
    const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };

    return [..._targets].sort((a, b) => {
        return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
}

/**
 * Перемешивание массива каналов (алгоритм Фишера-Йейтса)
 */
export function shuffleJoinTargets(_targets: IJoinTarget[]): IJoinTarget[] {
    const shuffled = [..._targets];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Извлечение каналов, требующих повтора
 */
export function extractRetryableChannels(_results: IJoinAttemptResult[]): IJoinTarget[] {
    return _results
        .filter(result =>
            !result.success &&
            !result.alreadyMember &&
            result.errorCode !== 'CHANNEL_NOT_FOUND' &&
            result.errorCode !== 'BANNED' &&
            result.errorCode !== 'PRIVATE_CHANNEL'
        )
        .map(result => ({
            ...result.target,
            priority: 'high' as const, // Повышаем приоритет для повтора
            source: 'comment_error' as const,
            addedAt: new Date()
        }));
}

/**
 * Создание сводки результатов вступления
 */
export function createJoinSummary(_result: IJoinSessionResult): string {
    const successRate = (_result.successfulJoins / _result.totalTargets * 100).toFixed(1);

    let summary = `Сессия вступления завершена:\n`;
    summary += `• Обработано каналов: ${_result.totalTargets}\n`;
    summary += `• Успешно вступил: ${_result.successfulJoins}\n`;
    summary += `• Уже состоял: ${_result.alreadyJoined}\n`;
    summary += `• Ошибок: ${_result.failedJoins}\n`;
    summary += `• Успешность: ${successRate}%\n`;
    summary += `• Длительность: ${formatJoinDuration(_result.duration)}`;

    return summary;
}

/**
 * Проверка лимитов безопасности
 */
export function checkJoinSafetyLimits(
    _currentJoins: number,
    _hourlyLimit: number,
    _dailyLimit: number
): { canJoin: boolean; reason?: string } {
    if (_currentJoins >= _dailyLimit) {
        return { canJoin: false, reason: 'Достигнут дневной лимит вступлений' };
    }

    if (_currentJoins >= _hourlyLimit) {
        return { canJoin: false, reason: 'Достигнут часовой лимит вступлений' };
    }

    return { canJoin: true };
}

/**
 * Генерация имени файла для неудачных каналов
 */
export function generateFailedChannelsFilename(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `failed_channels_${timestamp}.txt`;
} 
 
 
 
 