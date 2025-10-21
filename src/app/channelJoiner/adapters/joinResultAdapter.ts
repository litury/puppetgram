/**
 * Адаптер для форматирования результатов вступления в каналы
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import { IJoinSessionResult, IJoinAttemptResult } from '../interfaces';
import { formatJoinDuration, createJoinSummary } from '../parts';

export class JoinResultAdapter {

    /**
     * Форматирование результатов сессии вступления для отображения
     */
    static formatSessionResults(_result: IJoinSessionResult): string {
        let output = `\n🎯 Результаты сессии вступления в каналы\n`;
        output += `═══════════════════════════════════════\n\n`;

        // Информация о сессии
        output += `📋 Информация о сессии:\n`;
        output += `   🆔 ID сессии: ${_result.sessionId}\n`;
        output += `   ⏱️ Длительность: ${formatJoinDuration(_result.duration)}\n`;
        output += `   🎯 Обработано каналов: ${_result.totalTargets}\n\n`;

        // Статистика вступления
        output += `📊 Статистика вступления:\n`;
        output += `   ✅ Успешно вступил: ${_result.successfulJoins}\n`;
        output += `   👤 Уже состоял: ${_result.alreadyJoined}\n`;
        output += `   ❌ Ошибок: ${_result.failedJoins}\n`;
        output += `   ⏭️ Пропущено: ${_result.skippedChannels}\n`;
        output += `   📈 Успешность: ${_result.summary.successRate.toFixed(1)}%\n`;
        output += `   ⏱️ Средняя задержка: ${_result.summary.averageDelay}мс\n\n`;

        // Ошибки по типам
        if (Object.keys(_result.summary.errorsByType).length > 0) {
            output += `⚠️ Ошибки по типам:\n`;
            Object.entries(_result.summary.errorsByType)
                .sort((a, b) => b[1] - a[1])
                .forEach(([type, count]) => {
                    const emoji = this.getErrorTypeEmoji(type);
                    output += `   ${emoji} ${type}: ${count}\n`;
                });
            output += '\n';
        }

        // Детальные результаты
        output += `📋 Детальные результаты:\n`;
        output += `─────────────────────────\n\n`;

        _result.results.forEach((result, index) => {
            const status = this.getResultStatusEmoji(result);
            const time = result.timestamp.toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
            });

            output += `${index + 1}. ${status} @${result.target.channelUsername}\n`;

            if (result.success) {
                if (result.joined) {
                    output += `   ✅ Успешно вступил\n`;
                } else if (result.alreadyMember) {
                    output += `   👤 Уже состоял в канале\n`;
                }
            } else {
                output += `   🚫 Ошибка: ${result.errorMessage}\n`;
                if (result.retryAfter) {
                    output += `   ⏰ Повтор через: ${result.retryAfter}с\n`;
                }
            }

            output += `   🕐 Время: ${time}\n\n`;
        });

        // Рекомендации
        output += this.generateRecommendations(_result);

        return output;
    }

    /**
     * Создание краткой сводки результатов
     */
    static formatBriefSummary(_result: IJoinSessionResult): string {
        const successRate = _result.summary.successRate.toFixed(1);

        return `📊 Сессия завершена: вступил в ${_result.successfulJoins}/${_result.totalTargets} каналов (${successRate}%), ошибок: ${_result.failedJoins}`;
    }

    /**
     * Форматирование результата одного вступления
     */
    static formatSingleResult(_result: IJoinAttemptResult): string {
        const status = this.getResultStatusEmoji(_result);
        let output = `${status} @${_result.target.channelUsername}\n`;

        if (_result.success) {
            if (_result.joined) {
                output += `✅ Успешно вступил в канал`;
            } else if (_result.alreadyMember) {
                output += `👤 Уже состоял в канале`;
            }
        } else {
            output += `❌ Ошибка: ${_result.errorMessage}`;
            if (_result.retryAfter) {
                output += `\n⏰ Повтор возможен через ${_result.retryAfter} секунд`;
            }
        }

        return output;
    }

    /**
     * Форматирование списка каналов для повтора
     */
    static formatRetryChannels(_result: IJoinSessionResult): string {
        if (_result.summary.channelsNeedingRetry.length === 0) {
            return '✅ Нет каналов, требующих повтора';
        }

        let output = `🔄 КАНАЛЫ ДЛЯ ПОВТОРА\n`;
        output += `═══════════════════════\n\n`;
        output += `📊 Найдено каналов: ${_result.summary.channelsNeedingRetry.length}\n\n`;

        _result.summary.channelsNeedingRetry.forEach((target, index) => {
            output += `${index + 1}. @${target.channelUsername}`;
            if (target.channelTitle) {
                output += ` (${target.channelTitle})`;
            }
            output += ` - ${target.priority} приоритет\n`;
        });

        output += `\n💡 Рекомендуется повторить попытку позже`;

        return output;
    }

    /**
     * Экспорт результатов в CSV формат
     */
    static exportToCSV(_result: IJoinSessionResult): string {
        let csv = 'Channel,Status,Success,Joined,AlreadyMember,Error,Timestamp,Priority\n';

        _result.results.forEach(result => {
            const row = [
                result.target.channelUsername,
                result.success ? 'SUCCESS' : 'FAILED',
                result.success ? 'true' : 'false',
                result.joined ? 'true' : 'false',
                result.alreadyMember ? 'true' : 'false',
                result.errorMessage || '',
                result.timestamp.toISOString(),
                result.target.priority
            ];

            csv += row.map(field => `"${field}"`).join(',') + '\n';
        });

        return csv;
    }

    /**
     * Получение emoji для статуса результата
     */
    private static getResultStatusEmoji(_result: IJoinAttemptResult): string {
        if (_result.success) {
            return _result.joined ? '✅' : '👤';
        } else {
            if (_result.errorCode === 'FLOOD_WAIT') return '⏰';
            if (_result.errorCode === 'BANNED') return '❌';
            if (_result.errorCode === 'PRIVATE_CHANNEL') return '🔒';
            if (_result.errorCode === 'REQUIRES_APPROVAL') return '📝';
            return '❌';
        }
    }

    /**
     * Получение emoji для типа ошибки
     */
    private static getErrorTypeEmoji(_errorType: string): string {
        const emojiMap: { [key: string]: string } = {
            'FLOOD_WAIT': '⏰',
            'BANNED': '❌',
            'CHANNEL_NOT_FOUND': '🔍',
            'PRIVATE_CHANNEL': '🔒',
            'REQUIRES_APPROVAL': '📝',
            'JOIN_LIMIT_REACHED': '🚫',
            'NETWORK_ERROR': '🌐',
            'ALREADY_MEMBER': '👤',
            'OTHER': '❓'
        };

        return emojiMap[_errorType] || '❓';
    }

    /**
     * Генерация рекомендаций на основе результатов
     */
    private static generateRecommendations(_result: IJoinSessionResult): string {
        let recommendations = `💡 Рекомендации:\n`;

        const successRate = _result.summary.successRate;
        const hasFloodWait = _result.summary.errorsByType['FLOOD_WAIT'] > 0;
        const hasPrivateChannels = _result.summary.errorsByType['PRIVATE_CHANNEL'] > 0;
        const hasApprovalRequired = _result.summary.errorsByType['REQUIRES_APPROVAL'] > 0;

        if (successRate < 30) {
            recommendations += `   ⚠️ Низкая успешность вступления. Проверьте настройки аккаунта\n`;
        } else if (successRate < 70) {
            recommendations += `   🟡 Средняя успешность. Возможны ограничения Telegram\n`;
        } else {
            recommendations += `   ✅ Хорошая успешность вступления\n`;
        }

        if (hasFloodWait) {
            recommendations += `   ⏰ Обнаружены ограничения по времени. Увеличьте задержки\n`;
        }

        if (hasPrivateChannels) {
            recommendations += `   🔒 Есть приватные каналы. Требуются инвайт-ссылки\n`;
        }

        if (hasApprovalRequired) {
            recommendations += `   📝 Некоторые каналы требуют одобрения администратора\n`;
        }

        if (_result.summary.channelsNeedingRetry.length > 0) {
            recommendations += `   🔄 ${_result.summary.channelsNeedingRetry.length} каналов требуют повтора\n`;
        }

        if (_result.failedJoins > _result.successfulJoins) {
            recommendations += `   🔍 Проверьте корректность списка каналов\n`;
        }

        return recommendations;
    }
} 
 
 
 
 