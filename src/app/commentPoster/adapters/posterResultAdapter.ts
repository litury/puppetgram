/**
 * Адаптер для форматирования результатов автоматического комментирования
 * Следует стандартам компании согласно proj-struct-guideline.md
 */

import { ICommentingResponse, ICommentResult } from '../interfaces';
import { formatDuration } from '../parts';

export class PosterResultAdapter {

    /**
     * Форматирование результатов сессии комментирования
     */
    formatSessionResults(_response: ICommentingResponse): string {
        let output = `🎯 Результаты сессии комментирования\n`;
        output += `═══════════════════════════════════\n\n`;

        // Общая информация
        output += `📋 Информация о сессии:\n`;
        output += `   🆔 ID сессии: ${_response.sessionId}\n`;
        output += `   ⏱️ Длительность: ${formatDuration(_response.duration)}\n`;
        output += `   🎯 Обработано целей: ${_response.totalTargets}\n\n`;

        // Статистика
        output += `📊 Статистика комментирования:\n`;
        output += `   ✅ Успешно: ${_response.successfulComments}\n`;
        output += `   ❌ Ошибок: ${_response.failedComments}\n`;
        output += `   📈 Успешность: ${_response.summary.successRate.toFixed(1)}%\n`;
        output += `   ⏱️ Средняя задержка: ${Math.round(_response.summary.averageDelay)}мс\n\n`;

        // Ошибки по типам
        if (Object.keys(_response.summary.errorsByType).length > 0) {
            output += `⚠️ Ошибки по типам:\n`;
            for (const [errorType, count] of Object.entries(_response.summary.errorsByType)) {
                output += `   ${this.getErrorIcon(errorType)} ${errorType}: ${count}\n`;
            }
            output += `\n`;
        }

        // Детальные результаты
        output += `📋 Детальные результаты:\n`;
        output += `─────────────────────────\n`;

        _response.results.forEach((result, index) => {
            output += `\n${index + 1}. `;

            if (result.success) {
                output += `✅ @${result.target.channelUsername}`;
                output += `\n   💬 Комментарий: "${result.commentText}"`;
                if (result.postedMessageId) {
                    output += `\n   🆔 ID сообщения: ${result.postedMessageId}`;
                }
            } else {
                output += `❌ @${result.target.channelUsername}`;
                output += `\n   🚫 Ошибка: ${result.error}`;
            }

            output += `\n   🕐 Время: ${result.timestamp.toLocaleTimeString('ru-RU')}`;
        });

        return output;
    }

    /**
     * Краткий отчет для быстрого просмотра
     */
    formatBriefSummary(_response: ICommentingResponse): string {
        const successRate = _response.summary.successRate;
        const statusIcon = successRate >= 80 ? '🟢' : successRate >= 50 ? '🟡' : '🔴';

        let output = `${statusIcon} Сессия: ${_response.sessionId}\n`;
        output += `📊 ${_response.successfulComments}/${_response.totalTargets} успешно (${successRate.toFixed(1)}%)\n`;
        output += `⏱️ ${formatDuration(_response.duration)}\n`;

        if (_response.failedComments > 0) {
            output += `⚠️ Ошибок: ${_response.failedComments}\n`;
        }

        return output;
    }

    /**
     * Экспорт в CSV формат
     */
    generateCsvReport(_response: ICommentingResponse): string {
        const headers = [
            'Номер',
            'Канал',
            'Статус',
            'Комментарий',
            'ID сообщения',
            'Ошибка',
            'Время',
            'Попытки'
        ];

        let csvContent = headers.join(',') + '\n';

        _response.results.forEach((result, index) => {
            const row = [
                index + 1,
                `@${result.target.channelUsername}`,
                result.success ? 'Успешно' : 'Ошибка',
                result.commentText ? `"${result.commentText.replace(/"/g, '""')}"` : '',
                result.postedMessageId || '',
                result.error ? `"${result.error.replace(/"/g, '""')}"` : '',
                result.timestamp.toISOString(),
                result.retryCount
            ];

            csvContent += row.join(',') + '\n';
        });

        return csvContent;
    }

    /**
     * Экспорт в JSON формат с детальной информацией
     */
    generateJsonReport(_response: ICommentingResponse): string {
        const reportData = {
            session: {
                id: _response.sessionId,
                duration: _response.duration,
                durationFormatted: formatDuration(_response.duration),
                timestamp: new Date().toISOString()
            },
            statistics: {
                totalTargets: _response.totalTargets,
                successfulComments: _response.successfulComments,
                failedComments: _response.failedComments,
                successRate: _response.summary.successRate,
                averageDelay: _response.summary.averageDelay,
                errorsByType: _response.summary.errorsByType
            },
            results: _response.results.map((result, index) => ({
                index: index + 1,
                target: {
                    username: result.target.channelUsername,
                    url: result.target.channelUrl,
                    isActive: result.target.isActive
                },
                result: {
                    success: result.success,
                    commentText: result.commentText,
                    postedMessageId: result.postedMessageId,
                    error: result.error,
                    retryCount: result.retryCount,
                    timestamp: result.timestamp.toISOString()
                }
            }))
        };

        return JSON.stringify(reportData, null, 2);
    }

    /**
     * Рекомендации на основе результатов
     */
    generateRecommendations(_response: ICommentingResponse): string[] {
        const recommendations: string[] = [];
        const successRate = _response.summary.successRate;

        // Рекомендации по успешности
        if (successRate < 50) {
            recommendations.push('⚠️ Низкая успешность комментирования. Проверьте права доступа к каналам');
            recommendations.push('🔍 Убедитесь что у каналов включены комментарии');
        } else if (successRate >= 90) {
            recommendations.push('✨ Отличные результаты! Можно увеличить количество целей');
        }

        // Рекомендации по ошибкам
        const errorTypes = _response.summary.errorsByType;
        if (errorTypes['FLOOD_WAIT'] > 0) {
            recommendations.push('⏰ Обнаружены ограничения Telegram. Увеличьте задержки между комментариями');
        }

        if (errorTypes['PERMISSION_DENIED'] > 0) {
            recommendations.push('🔒 Проблемы с правами доступа. Убедитесь что бот состоит в каналах');
        }

        if (errorTypes['COMMENTS_DISABLED'] > 0) {
            recommendations.push('💬 В некоторых каналах отключены комментарии. Обновите список целей');
        }

        // Рекомендации по производительности
        if (_response.summary.averageDelay > 10000) {
            recommendations.push('🐌 Высокие задержки. Оптимизируйте настройки сети');
        }

        if (recommendations.length === 0) {
            recommendations.push('✅ Все хорошо! Продолжайте в том же духе');
        }

        return recommendations;
    }

    /**
     * Получение иконки для типа ошибки
     */
    private getErrorIcon(_errorType: string): string {
        const iconMap: { [key: string]: string } = {
            'FLOOD_WAIT': '⏰',
            'BANNED': '🚫',
            'CHANNEL_NOT_FOUND': '🔍',
            'PERMISSION_DENIED': '🔒',
            'PRIVATE_CHANNEL': '🔐',
            'NETWORK_ERROR': '🌐',
            'COMMENTS_DISABLED': '💬',
            'OTHER': '❓'
        };

        return iconMap[_errorType] || '❓';
    }

    /**
     * Форматирование времени в читаемый вид
     */
    private formatTime(_date: Date): string {
        return _date.toLocaleString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
} 