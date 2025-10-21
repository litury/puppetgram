/**
 * Сервис для извлечения каналов с ошибками комментирования
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { IJoinTarget } from '../interfaces';
import { ICommentResult } from '../../commentPoster/interfaces';
import { saveJoinTargetsToFile, generateFailedChannelsFilename } from '../parts';

export class CommentErrorExtractor {

    /**
     * Извлечение каналов с ошибками доступа из результатов комментирования
     */
    static extractChannelsNeedingJoin(_commentResults: ICommentResult[]): IJoinTarget[] {
        const joinTargets: IJoinTarget[] = [];
        const accessErrorCodes = [
            'CHAT_GUEST_SEND_FORBIDDEN',
            'USER_NOT_PARTICIPANT',
            'CHANNEL_PRIVATE',
            'CHAT_WRITE_FORBIDDEN'
        ];

        _commentResults.forEach(result => {
            if (!result.success && result.error) {
                const errorMessage = result.error.toLowerCase();
                const needsJoin = accessErrorCodes.some(code =>
                    errorMessage.includes(code.toLowerCase()) ||
                    errorMessage.includes('guest') ||
                    errorMessage.includes('not participant') ||
                    errorMessage.includes('forbidden')
                );

                if (needsJoin) {
                    const target: IJoinTarget = {
                        channelUsername: result.target.channelUsername,
                        channelUrl: result.target.channelUrl,
                        channelTitle: result.target.channelTitle,
                        priority: 'high', // Высокий приоритет для каналов с ошибками комментирования
                        source: 'comment_error',
                        isActive: true,
                        addedAt: new Date()
                    };

                    // Проверяем что канал еще не добавлен
                    const exists = joinTargets.some(existing =>
                        existing.channelUsername === target.channelUsername
                    );

                    if (!exists) {
                        joinTargets.push(target);
                    }
                }
            }
        });

        return joinTargets;
    }

    /**
 * Сохранение каналов, требующих вступления, в файл
 */
    static async saveChannelsNeedingJoin(
        _targets: IJoinTarget[],
        _outputDir: string = './input-join-targets'
    ): Promise<string> {
        try {
            // Создаем директорию если не существует
            if (!fs.existsSync(_outputDir)) {
                fs.mkdirSync(_outputDir, { recursive: true });
            }

            const filename = generateFailedChannelsFilename();
            const filePath = path.join(_outputDir, filename);

            saveJoinTargetsToFile(_targets, filePath);

            console.log(`💾 Сохранено ${_targets.length} каналов для вступления: ${filename}`);
            return filename;

        } catch (error) {
            throw new Error(`Ошибка сохранения каналов для вступления: ${error}`);
        }
    }

    /**
     * Создание отчета о каналах, требующих вступления
     */
    static createJoinReport(_targets: IJoinTarget[]): string {
        if (_targets.length === 0) {
            return '✅ Все каналы доступны для комментирования';
        }

        let report = `🚪 КАНАЛЫ, ТРЕБУЮЩИЕ ВСТУПЛЕНИЯ\n`;
        report += `═══════════════════════════════════\n\n`;
        report += `📊 Найдено каналов: ${_targets.length}\n\n`;

        // Группируем по приоритету
        const byPriority = {
            high: _targets.filter(t => t.priority === 'high'),
            medium: _targets.filter(t => t.priority === 'medium'),
            low: _targets.filter(t => t.priority === 'low')
        };

        if (byPriority.high.length > 0) {
            report += `🔴 Высокий приоритет (${byPriority.high.length}):\n`;
            byPriority.high.forEach((target, index) => {
                report += `   ${index + 1}. @${target.channelUsername}`;
                if (target.channelTitle) {
                    report += ` (${target.channelTitle})`;
                }
                report += '\n';
            });
            report += '\n';
        }

        if (byPriority.medium.length > 0) {
            report += `🟡 Средний приоритет (${byPriority.medium.length}):\n`;
            byPriority.medium.forEach((target, index) => {
                report += `   ${index + 1}. @${target.channelUsername}`;
                if (target.channelTitle) {
                    report += ` (${target.channelTitle})`;
                }
                report += '\n';
            });
            report += '\n';
        }

        if (byPriority.low.length > 0) {
            report += `🟢 Низкий приоритет (${byPriority.low.length}):\n`;
            byPriority.low.forEach((target, index) => {
                report += `   ${index + 1}. @${target.channelUsername}`;
                if (target.channelTitle) {
                    report += ` (${target.channelTitle})`;
                }
                report += '\n';
            });
            report += '\n';
        }

        report += `💡 Рекомендации:\n`;
        report += `   1. Используйте модуль вступления в каналы\n`;
        report += `   2. Начните с каналов высокого приоритета\n`;
        report += `   3. После вступления повторите комментирование\n`;
        report += `   4. Проверьте настройки приватности каналов\n`;

        return report;
    }

    /**
     * Анализ типов ошибок доступа
     */
    static analyzeAccessErrors(_commentResults: ICommentResult[]): {
        totalErrors: number;
        accessErrors: number;
        errorTypes: { [key: string]: number };
        channelsNeedingJoin: string[];
    } {
        const analysis = {
            totalErrors: 0,
            accessErrors: 0,
            errorTypes: {} as { [key: string]: number },
            channelsNeedingJoin: [] as string[]
        };

        _commentResults.forEach(result => {
            if (!result.success && result.error) {
                analysis.totalErrors++;

                const errorMessage = result.error.toLowerCase();

                // Определяем тип ошибки
                let errorType = 'OTHER';
                if (errorMessage.includes('guest') || errorMessage.includes('forbidden')) {
                    errorType = 'ACCESS_DENIED';
                    analysis.accessErrors++;
                    analysis.channelsNeedingJoin.push(result.target.channelUsername);
                } else if (errorMessage.includes('not participant')) {
                    errorType = 'NOT_MEMBER';
                    analysis.accessErrors++;
                    analysis.channelsNeedingJoin.push(result.target.channelUsername);
                } else if (errorMessage.includes('private')) {
                    errorType = 'PRIVATE_CHANNEL';
                    analysis.accessErrors++;
                } else if (errorMessage.includes('flood')) {
                    errorType = 'FLOOD_WAIT';
                } else if (errorMessage.includes('banned')) {
                    errorType = 'BANNED';
                }

                analysis.errorTypes[errorType] = (analysis.errorTypes[errorType] || 0) + 1;
            }
        });

        // Убираем дубликаты каналов
        analysis.channelsNeedingJoin = [...new Set(analysis.channelsNeedingJoin)];

        return analysis;
    }

    /**
     * Создание сводного отчета об ошибках доступа
     */
    static createAccessErrorSummary(_commentResults: ICommentResult[]): string {
        const analysis = this.analyzeAccessErrors(_commentResults);

        if (analysis.accessErrors === 0) {
            return '✅ Проблем с доступом к каналам не обнаружено';
        }

        let summary = `🚫 АНАЛИЗ ОШИБОК ДОСТУПА\n`;
        summary += `═══════════════════════════\n\n`;
        summary += `📊 Общая статистика:\n`;
        summary += `   • Всего ошибок: ${analysis.totalErrors}\n`;
        summary += `   • Ошибок доступа: ${analysis.accessErrors}\n`;
        summary += `   • Каналов требуют вступления: ${analysis.channelsNeedingJoin.length}\n\n`;

        if (Object.keys(analysis.errorTypes).length > 0) {
            summary += `📋 Типы ошибок:\n`;
            Object.entries(analysis.errorTypes)
                .sort((a, b) => b[1] - a[1])
                .forEach(([type, count]) => {
                    const emoji = this.getErrorTypeEmoji(type);
                    summary += `   ${emoji} ${type}: ${count}\n`;
                });
            summary += '\n';
        }

        if (analysis.channelsNeedingJoin.length > 0) {
            summary += `🚪 Каналы для вступления:\n`;
            analysis.channelsNeedingJoin.slice(0, 10).forEach((channel, index) => {
                summary += `   ${index + 1}. @${channel}\n`;
            });

            if (analysis.channelsNeedingJoin.length > 10) {
                summary += `   ... и еще ${analysis.channelsNeedingJoin.length - 10} каналов\n`;
            }
        }

        return summary;
    }

    /**
     * Получение emoji для типа ошибки
     */
    private static getErrorTypeEmoji(_errorType: string): string {
        const emojiMap: { [key: string]: string } = {
            'ACCESS_DENIED': '🚫',
            'NOT_MEMBER': '👤',
            'PRIVATE_CHANNEL': '🔒',
            'FLOOD_WAIT': '⏰',
            'BANNED': '❌',
            'OTHER': '❓'
        };

        return emojiMap[_errorType] || '❓';
    }

    /**
     * Интеграция с результатами комментирования - полный процесс
     */
    static async processCommentingResults(
        _commentResults: ICommentResult[],
        _autoSave: boolean = true
    ): Promise<{
        joinTargets: IJoinTarget[];
        savedFile?: string;
        report: string;
        summary: string;
    }> {
        // Извлекаем каналы для вступления
        const joinTargets = this.extractChannelsNeedingJoin(_commentResults);

        // Создаем отчеты
        const report = this.createJoinReport(joinTargets);
        const summary = this.createAccessErrorSummary(_commentResults);

        let savedFile: string | undefined;

        // Автоматически сохраняем если есть каналы и включено автосохранение
        if (_autoSave && joinTargets.length > 0) {
            try {
                savedFile = await this.saveChannelsNeedingJoin(joinTargets);
            } catch (error) {
                console.warn('Предупреждение: не удалось сохранить каналы для вступления:', error);
            }
        }

        return {
            joinTargets,
            savedFile,
            report,
            summary
        };
    }
} 
 
 
 
 