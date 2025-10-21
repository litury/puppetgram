/**
 * Вспомогательные функции для работы с диалогами
 */

import { IUserMessage, IChatInfo } from '../interfaces';

/**
 * Генерирует уникальный ID сессии
 */
export function generateDialogSessionId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}_${random}`;
}

/**
 * Форматирует размер файла в читаемый вид
 */
export function formatFileSize(_bytes: number): string {
    if (_bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(_bytes) / Math.log(k));

    return parseFloat((_bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Проверяет валидность даты
 */
export function isValidDate(_date: Date): boolean {
    return _date instanceof Date && !isNaN(_date.getTime());
}

/**
 * Создает краткое описание периода
 */
export function createPeriodDescription(_from: Date, _to: Date): string {
    const diffMs = _to.getTime() - _from.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 1) return 'за день';
    if (diffDays <= 7) return `за ${diffDays} дней`;
    if (diffDays <= 31) return `за ${Math.ceil(diffDays / 7)} недель`;
    if (diffDays <= 365) return `за ${Math.ceil(diffDays / 30)} месяцев`;

    return `за ${Math.ceil(diffDays / 365)} лет`;
}

/**
 * Группирует сообщения по дням
 */
export function groupMessagesByDay(_messages: IUserMessage[]): { [day: string]: IUserMessage[] } {
    const grouped: { [day: string]: IUserMessage[] } = {};

    for (const message of _messages) {
        const day = message.date.toISOString().split('T')[0]; // YYYY-MM-DD
        if (!grouped[day]) {
            grouped[day] = [];
        }
        grouped[day].push(message);
    }

    return grouped;
}

/**
 * Находит самые активные часы пользователя
 */
export function findMostActiveHours(_messages: IUserMessage[]): { hour: number; count: number }[] {
    const hourCounts: { [hour: number]: number } = {};

    for (const message of _messages) {
        const hour = message.date.getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }

    return Object.entries(hourCounts)
        .map(([hour, count]) => ({ hour: parseInt(hour), count }))
        .sort((a, b) => b.count - a.count);
}

/**
 * Вычисляет среднюю длину сообщений по чатам
 */
export function calculateAverageMessageLengthByChat(_messages: IUserMessage[]): { [chatId: string]: number } {
    const chatStats: { [chatId: string]: { total: number; count: number } } = {};

    for (const message of _messages) {
        if (!chatStats[message.chatId]) {
            chatStats[message.chatId] = { total: 0, count: 0 };
        }
        chatStats[message.chatId].total += message.text.length;
        chatStats[message.chatId].count += 1;
    }

    const averages: { [chatId: string]: number } = {};
    for (const [chatId, stats] of Object.entries(chatStats)) {
        averages[chatId] = Math.round(stats.total / stats.count);
    }

    return averages;
}

/**
 * Создает краткую статистику для консоли
 */
export function createQuickStats(_messages: IUserMessage[], _chats: IChatInfo[]): string {
    if (_messages.length === 0) return 'Нет сообщений для анализа';

    const totalChars = _messages.reduce((sum, msg) => sum + msg.text.length, 0);
    const avgLength = Math.round(totalChars / _messages.length);
    const repliesCount = _messages.filter(msg => msg.replyToMessageId).length;
    const mediaCount = _messages.filter(msg => msg.hasMedia).length;
    const editedCount = _messages.filter(msg => msg.isEdited).length;

    const replyRate = Math.round((repliesCount / _messages.length) * 100);
    const mediaRate = Math.round((mediaCount / _messages.length) * 100);
    const editRate = Math.round((editedCount / _messages.length) * 100);

    return `📊 Краткая статистика:
  • Сообщений: ${_messages.length}
  • Чатов: ${_chats.length}
  • Средняя длина: ${avgLength} симв.
  • Ответов: ${replyRate}%
  • С медиа: ${mediaRate}%
  • Отредактированных: ${editRate}%`;
}

/**
 * Валидирует конфигурацию экспорта
 */
export function validateExportConfig(_config: any): string[] {
    const errors: string[] = [];

    if (!_config.formats || _config.formats.length === 0) {
        errors.push('Не выбраны форматы экспорта');
    }

    if (_config.formats && !Array.isArray(_config.formats)) {
        errors.push('Форматы должны быть массивом');
    }

    if (_config.formats) {
        const validFormats = ['json', 'txt', 'csv'];
        const invalidFormats = _config.formats.filter((f: string) => !validFormats.includes(f));
        if (invalidFormats.length > 0) {
            errors.push(`Неподдерживаемые форматы: ${invalidFormats.join(', ')}`);
        }
    }

    if (_config.maxMessagesPerFile && (_config.maxMessagesPerFile < 1 || _config.maxMessagesPerFile > 1000000)) {
        errors.push('Неверное значение maxMessagesPerFile (1-1000000)');
    }

    return errors;
}

/**
 * Создает безопасное имя файла из названия чата
 */
export function createSafeFileName(_chatTitle: string): string {
    return _chatTitle
        .replace(/[^\w\s-]/g, '') // Убираем специальные символы
        .replace(/\s+/g, '_') // Заменяем пробелы на подчеркивания
        .replace(/_+/g, '_') // Убираем множественные подчеркивания
        .toLowerCase()
        .substring(0, 50); // Ограничиваем длину
}

/**
 * Определяет наиболее подходящий формат даты для отображения
 */
export function formatDateForDisplay(_date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - _date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'сегодня';
    if (diffDays === 1) return 'вчера';
    if (diffDays < 7) return `${diffDays} дней назад`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} недель назад`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} месяцев назад`;

    return _date.toLocaleDateString();
} 