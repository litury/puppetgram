import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import {
    IChannelCommentInfo,
    ICommentCheckOptions,
    ICommentCheckResponse,
    IBulkCommentCheckOptions,
    IBulkCommentCheckResponse
} from '../interfaces';
import {
    isChannel,
    hasLinkedDiscussion,
    determineCommentsPolicy,
    extractLinkedDiscussionInfo,
    generateRecommendations,
    getAccessRequirements,
    generateChannelUrl,
    delay,
    cleanChannelName,
    isValidChannelName
} from '../parts';
import { AdaptiveLimiter, IAdaptiveLimiterOptions } from './adaptiveLimiter';

export class CommentCheckerService {
    private _adaptiveLimiter: AdaptiveLimiter;

    constructor(private readonly client: TelegramClient, limiterOptions?: Partial<IAdaptiveLimiterOptions>) {
        const defaultOptions: IAdaptiveLimiterOptions = {
            initialDelay: 30000,
            minDelay: 30000,
            maxDelay: 30000,
            aggressiveMode: false,
            responseTimeThreshold: 10000
        };
        this._adaptiveLimiter = new AdaptiveLimiter({ ...defaultOptions, ...limiterOptions });
    }

    /**
     * Проверка возможности комментирования одного канала
     */
    async checkChannelComments(options: ICommentCheckOptions): Promise<ICommentCheckResponse> {
        const { channelName, checkRecentActivity = false, activityDays = 7, includeStatistics = false } = options;

        const startTime = Date.now();
        try {
            console.log(`Проверка комментариев для канала: ${channelName}`);

            // Валидация имени канала
            if (!isValidChannelName(channelName)) {
                throw new Error(`Неверный формат имени канала: ${channelName}`);
            }

            // Получение информации о канале
            const channelInfo = await this.getChannelInfo(channelName);

            if (!channelInfo) {
                throw new Error(`Канал ${channelName} не найден или недоступен`);
            }

            // Проверка что это действительно канал
            if (!isChannel(channelInfo)) {
                throw new Error(`${channelName} не является каналом`);
            }

            // Получение связанной дискуссионной группы если есть
            let linkedDiscussionGroup;
            if (hasLinkedDiscussion(channelInfo)) {
                linkedDiscussionGroup = await this.getLinkedDiscussionGroup(channelInfo.linkedChatId);
            }

            // Определение политики комментариев
            const commentsPolicy = determineCommentsPolicy(channelInfo);
            const commentsEnabled = commentsPolicy === 'enabled';

            // Проверка прав пользователя
            const { canPost, canRead } = await this.checkUserCommentPermissions(channelInfo);

            // Создание базовой информации о канале
            const channelCommentInfo: IChannelCommentInfo = {
                channelId: channelInfo.id?.toString() || '',
                channelTitle: channelInfo.title || 'Неизвестный канал',
                channelUsername: channelInfo.username,
                accessHash: channelInfo.accessHash?.toString() || '0',
                commentsEnabled,
                commentsPolicy,
                linkedDiscussionGroup: linkedDiscussionGroup ?
                    extractLinkedDiscussionInfo(linkedDiscussionGroup) : undefined,
                canPostComments: canPost,
                canReadComments: canRead
            };

            // Дополнительная проверка активности и статистики
            if (checkRecentActivity || includeStatistics) {
                await this.enrichWithCommentStatistics(channelCommentInfo, channelInfo, activityDays);
            }

            // Генерация рекомендаций
            const recommendations = generateRecommendations(channelInfo);

            // Записываем успешную метрику
            const responseTime = Date.now() - startTime;
            this._adaptiveLimiter.recordRequest({
                responseTime,
                success: true,
                timestamp: Date.now()
            });

            return {
                channel: channelCommentInfo,
                checkDate: new Date(),
                success: true,
                recommendations
            };

        } catch (error: any) {
            console.error(`Ошибка проверки канала ${channelName}:`, error.message);

            // Записываем метрику ошибки
            const responseTime = Date.now() - startTime;
            const errorType = error.message?.includes('FloodWait') ? 'FLOOD' : 'OTHER';
            this._adaptiveLimiter.recordRequest({
                responseTime,
                success: false,
                timestamp: Date.now(),
                errorType
            });

            return {
                channel: {
                    channelId: '',
                    channelTitle: channelName,
                    commentsEnabled: false,
                    commentsPolicy: 'unknown',
                    canPostComments: false,
                    canReadComments: false
                },
                checkDate: new Date(),
                success: false,
                error: error.message || 'Неизвестная ошибка'
            };
        }
    }

    /**
     * Массовая проверка комментариев в нескольких каналах
     */
    async checkMultipleChannels(options: IBulkCommentCheckOptions & {
        autoSaveResults?: boolean;
        progressFilePath?: string;
        sourceFilePath?: string;
    }): Promise<IBulkCommentCheckResponse> {
        const {
            channels,
            exportResults = false,
            parallelLimit = 1, // ТОЛЬКО 1 поток - никогда не больше!
            delayBetweenRequests = 10000, // МИНИМУМ 10 секунд между запросами
            autoSaveResults = true,
            progressFilePath,
            sourceFilePath
        } = options;

        console.log(`Начинается массовая проверка ${channels.length} каналов...`);
        console.log(`Параметры: параллельность ${parallelLimit}, задержка ${delayBetweenRequests}мс`);

        const results: ICommentCheckResponse[] = [];
        const summary = {
            enabledComments: 0,
            disabledComments: 0,
            restrictedComments: 0,
            membersOnlyComments: 0,
            approvalRequiredComments: 0,
            withDiscussionGroups: 0
        };

        // Обработка каналов порциями
        try {
            for (let i = 0; i < channels.length; i += parallelLimit) {
                const batch = channels.slice(i, i + parallelLimit);

                console.log(`Обработка каналов ${i + 1}-${Math.min(i + parallelLimit, channels.length)} из ${channels.length}`);

                // Последовательная обработка порции для избежания FloodWait
                const batchResults: ICommentCheckResponse[] = [];

                for (const channelName of batch) {
                    try {
                        // ПРОСТАЯ задержка перед КАЖДЫМ запросом (включая первый!)
                        if (results.length > 0 || batchResults.length > 0) {
                            await this._adaptiveLimiter.waitForNext();
                        }

                        // Показываем простую статистику каждые 10 каналов
                        if ((results.length + batchResults.length) % 10 === 0 && (results.length + batchResults.length) > 0) {
                            const stats = this._adaptiveLimiter.getPerformanceStats();
                            console.log(stats);
                        }

                        const result = await this.checkChannelComments({
                            channelName,
                            checkRecentActivity: true,
                            includeStatistics: true
                        });

                        // КРИТИЧЕСКАЯ ПРОВЕРКА: если результат содержит FloodWait - НЕМЕДЛЕННО ОСТАНОВКА!
                        if (!result.success && result.error && result.error.includes('FloodWait')) {
                            console.error(`\n🛑 КРИТИЧЕСКАЯ ОШИБКА: FloodWait обнаружен для канала "${channelName}"!`);
                            console.error(`⏰ ${result.error}`);
                            console.error(`📊 Успешно обработано каналов: ${results.length + batchResults.length} из ${channels.length}`);
                            console.error(`\n❌ ОСТАНОВКА ВСЕХ ОПЕРАЦИЙ!`);
                            console.error(`🚫 Канал "${channelName}" НЕ удаляется из файла - он НЕ был обработан!`);
                            console.error(`💡 Рекомендация: подождите указанное время и перезапустите скрипт`);

                            // НЕ добавляем неудачный канал в результаты!
                            // НЕ вызываем saveProgressAndUpdateSource!

                            // Добавляем только успешные результаты из текущей порции
                            results.push(...batchResults);

                            // Создаем аварийное сохранение только для успешных каналов
                            if (autoSaveResults && results.length > 0) {
                                console.log(`\n💾 Аварийное сохранение ${results.length} успешно обработанных каналов...`);

                                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                                const emergencyFile = `./exports/emergency_stop_${timestamp}.json`;

                                try {
                                    await this.saveEmergencyProgress(results, channels.length, emergencyFile);
                                    console.log(`✅ Аварийное сохранение: ${emergencyFile}`);
                                } catch (saveError) {
                                    console.error(`❌ Ошибка аварийного сохранения:`, saveError);
                                }
                            }

                            // НЕМЕДЛЕННЫЙ ВЫХОД через исключение
                            throw new Error(`EMERGENCY_STOP_FLOOD_WAIT: ${result.error}`);
                        }

                        batchResults.push(result);

                        // Автосохранение прогресса ТОЛЬКО для успешных результатов
                        if (autoSaveResults && result.success) {
                            await this.saveProgressAndUpdateSource(
                                [...results, ...batchResults],
                                channelName,
                                channels,
                                progressFilePath,
                                sourceFilePath
                            );
                        } else if (autoSaveResults && !result.success) {
                            console.log(`⚠️ Канал ${channelName} не обработан успешно - пропускаю автосохранение`);
                        }

                    } catch (error: any) {
                        // Если это аварийная остановка FloodWait - пробрасываем исключение дальше
                        if (error.message && error.message.includes('EMERGENCY_STOP_FLOOD_WAIT')) {
                            throw error; // Пробрасываем дальше для полной остановки
                        }

                        // Для других ошибок продолжаем обработку
                        batchResults.push({
                            channel: {
                                channelId: '',
                                channelTitle: channelName,
                                commentsEnabled: false,
                                commentsPolicy: 'unknown',
                                canPostComments: false,
                                canReadComments: false
                            },
                            checkDate: new Date(),
                            success: false,
                            error: error.message || 'Неизвестная ошибка'
                        });
                    }
                }

                results.push(...batchResults);

                // Обновление статистики
                batchResults.forEach(result => {
                    if (result.success) {
                        switch (result.channel.commentsPolicy) {
                            case 'enabled':
                                summary.enabledComments++;
                                break;
                            case 'disabled':
                                summary.disabledComments++;
                                break;
                            case 'restricted':
                                summary.restrictedComments++;
                                break;
                            case 'members_only':
                                summary.membersOnlyComments++;
                                break;
                            case 'approval_required':
                                summary.approvalRequiredComments++;
                                break;
                        }

                        if (result.channel.linkedDiscussionGroup) {
                            summary.withDiscussionGroups++;
                        }
                    }
                });

                // Задержка между порциями
                if (i + parallelLimit < channels.length) {
                    await delay(delayBetweenRequests * 2);
                }
            }

            const successfulChecks = results.filter(r => r.success).length;
            const failedChecks = results.length - successfulChecks;

            console.log(`Проверка завершена: ${successfulChecks} успешно, ${failedChecks} ошибок`);

            return {
                results,
                totalChecked: channels.length,
                successfulChecks,
                failedChecks,
                summary
            };

        } catch (error: any) {
            // Обработка аварийной остановки FloodWait
            if (error.message && error.message.includes('EMERGENCY_STOP_FLOOD_WAIT')) {
                console.error(`\n🛑 АВАРИЙНАЯ ОСТАНОВКА: ${error.message}`);
                console.error(`\n✅ Скрипт завершен. Перезапустите после окончания FloodWait.`);

                const successfulChecks = results.filter(r => r.success).length;
                const failedChecks = results.length - successfulChecks;

                return {
                    results,
                    totalChecked: results.length, // Только обработанные каналы
                    successfulChecks,
                    failedChecks,
                    summary,
                    emergencyStop: true,
                    stopReason: "FloodWait обнаружен"
                } as any;
            }

            // Другие ошибки
            throw error;
        }
    }

    /**
     * Получение полной информации о канале через GetFullChannel
     * Это более эффективный способ получения всех настроек канала включая linked_chat_id
     */
    private async getChannelInfo(channelName: string): Promise<any> {
        const cleanName = cleanChannelName(channelName);

        try {
            // Сначала резолвим username для получения InputChannel
            const resolved: any = await this.client.invoke(
                new Api.contacts.ResolveUsername({
                    username: cleanName
                })
            );

            if (!resolved.chats || resolved.chats.length === 0) {
                return null;
            }

            const basicChannelInfo = resolved.chats[0];

            // Теперь получаем ПОЛНУЮ информацию через GetFullChannel
            // Это даст нам linked_chat_id и все остальные настройки
            const fullChannelResult: any = await this.client.invoke(
                new Api.channels.GetFullChannel({
                    channel: new Api.InputChannel({
                        channelId: basicChannelInfo.id,
                        accessHash: basicChannelInfo.accessHash
                    })
                })
            );

            const fullChannelInfo = fullChannelResult.fullChat;

            // Объединяем базовую и полную информацию
            return {
                ...basicChannelInfo,
                // Ключевые поля из GetFullChannel:
                linkedChatId: fullChannelInfo.linkedChatId, // ЭТО ГЛАВНОЕ!
                participantsCount: fullChannelInfo.participantsCount,
                about: fullChannelInfo.about,
                canViewStats: fullChannelInfo.canViewStats,
                hasScheduled: fullChannelInfo.hasScheduled,
                availableReactions: fullChannelInfo.availableReactions,
                // Добавляем полную информацию для дальнейшего использования
                fullInfo: fullChannelInfo
            };

        } catch (error: any) {
            // Обработка FloodWait ошибок
            if (error.errorMessage === 'FLOOD') {
                const waitTime = error.seconds || 60;
                console.error(`⚠️ FloodWait для ${channelName}: ожидание ${waitTime} секунд`);
                console.error(`❌ Рекомендуется остановить проверку и подождать ${Math.round(waitTime / 3600)} часов`);
                throw new Error(`FloodWait: требуется ожидание ${waitTime} секунд`);
            }

            console.error(`Ошибка получения информации о канале ${channelName}:`, error);

            // Если GetFullChannel не удался, пробуем базовый способ
            try {
                const resolved: any = await this.client.invoke(
                    new Api.contacts.ResolveUsername({
                        username: cleanName
                    })
                );

                if (resolved.chats && resolved.chats.length > 0) {
                    return resolved.chats[0];
                }
            } catch (fallbackError: any) {
                // Обработка FloodWait в fallback
                if (fallbackError.errorMessage === 'FLOOD') {
                    const waitTime = fallbackError.seconds || 60;
                    console.error(`⚠️ FloodWait fallback для ${channelName}: ожидание ${waitTime} секунд`);
                    throw new Error(`FloodWait: требуется ожидание ${waitTime} секунд`);
                }
                console.error(`Fallback ошибка для ${channelName}:`, fallbackError);
            }

            return null;
        }
    }

    /**
     * Получение информации о связанной дискуссионной группе
     */
    private async getLinkedDiscussionGroup(linkedChatId: any): Promise<any> {
        try {
            const result: any = await this.client.invoke(
                new Api.channels.GetChannels({
                    id: [linkedChatId] // Используем linkedChatId напрямую
                })
            );

            if (result.chats && result.chats.length > 0) {
                return result.chats[0];
            }

            return null;
        } catch (error) {
            console.error('Ошибка получения связанной дискуссионной группы:', error);
            return null;
        }
    }

    /**
     * Проверка прав пользователя на комментирование
     */
    private async checkUserCommentPermissions(channelInfo: any): Promise<{ canPost: boolean; canRead: boolean }> {
        try {
            // Проверяем права через GetParticipant
            const result: any = await this.client.invoke(
                new Api.channels.GetParticipant({
                    channel: new Api.InputChannel({
                        channelId: channelInfo.id,
                        accessHash: channelInfo.accessHash
                    }),
                    participant: new Api.InputPeerSelf()
                })
            );

            const participant = result.participant;

            // Определяем права на основе типа участника
            let canPost = false;
            let canRead = true;

            if (participant) {
                // Если пользователь является администратором или создателем
                if (participant.className === 'ChannelParticipantCreator' ||
                    participant.className === 'ChannelParticipantAdmin') {
                    canPost = true;
                }
                // Обычный участник - проверяем ограничения канала
                else if (participant.className === 'ChannelParticipant') {
                    canPost = !channelInfo.defaultBannedRights?.sendMessages;
                }
            }

            return { canPost, canRead };
        } catch (error) {
            // Если ошибка получения участника, пробуем определить через публичные настройки
            return {
                canPost: !channelInfo.defaultBannedRights?.sendMessages || hasLinkedDiscussion(channelInfo),
                canRead: true
            };
        }
    }

    /**
     * Обогащение информации статистикой комментариев
     */
    private async enrichWithCommentStatistics(
        channelInfo: IChannelCommentInfo,
        originalChannelInfo: any,
        activityDays: number
    ): Promise<void> {
        try {
            // Если есть связанная дискуссионная группа, получаем статистику из неё
            if (channelInfo.linkedDiscussionGroup) {
                const stats = await this.getDiscussionGroupStatistics(
                    channelInfo.linkedDiscussionGroup.id,
                    activityDays
                );

                channelInfo.totalComments = stats.totalMessages;
                channelInfo.recentCommentsCount = stats.recentMessages;
                channelInfo.lastCommentDate = stats.lastMessageDate;
            }
            // Иначе пробуем получить статистику из самого канала
            else {
                const stats = await this.getChannelStatistics(originalChannelInfo, activityDays);
                channelInfo.totalComments = stats.totalMessages;
                channelInfo.recentCommentsCount = stats.recentMessages;
                channelInfo.lastCommentDate = stats.lastMessageDate;
            }
        } catch (error) {
            console.error('Ошибка получения статистики комментариев:', error);
            // Продолжаем без статистики
        }
    }

    /**
     * Получение статистики дискуссионной группы
     */
    private async getDiscussionGroupStatistics(groupId: string, days: number): Promise<{
        totalMessages: number;
        recentMessages: number;
        lastMessageDate?: Date;
    }> {
        // Здесь можно реализовать получение статистики из дискуссионной группы
        // Пока возвращаем заглушку
        return {
            totalMessages: 0,
            recentMessages: 0
        };
    }

    /**
     * Получение статистики канала
     */
    private async getChannelStatistics(channelInfo: any, days: number): Promise<{
        totalMessages: number;
        recentMessages: number;
        lastMessageDate?: Date;
    }> {
        // Здесь можно реализовать получение статистики канала
        // Пока возвращаем заглушку
        return {
            totalMessages: 0,
            recentMessages: 0
        };
    }

    /**
     * Создание частичных результатов при остановке из-за FloodWait
     */
    private createPartialResults(
        results: ICommentCheckResponse[],
        totalChannels: number,
        summary: any,
        stopReason?: string
    ): IBulkCommentCheckResponse {
        // Пересчитываем статистику для частичных результатов
        const updatedSummary = {
            enabledComments: 0,
            disabledComments: 0,
            restrictedComments: 0,
            membersOnlyComments: 0,
            approvalRequiredComments: 0,
            withDiscussionGroups: 0
        };

        results.forEach(result => {
            if (result.success) {
                switch (result.channel.commentsPolicy) {
                    case 'enabled':
                        updatedSummary.enabledComments++;
                        break;
                    case 'disabled':
                        updatedSummary.disabledComments++;
                        break;
                    case 'restricted':
                        updatedSummary.restrictedComments++;
                        break;
                    case 'members_only':
                        updatedSummary.membersOnlyComments++;
                        break;
                    case 'approval_required':
                        updatedSummary.approvalRequiredComments++;
                        break;
                }

                if (result.channel.linkedDiscussionGroup) {
                    updatedSummary.withDiscussionGroups++;
                }
            }
        });

        const successfulChecks = results.filter(r => r.success).length;
        const failedChecks = results.length - successfulChecks;

        console.log(`⚠️ Частичные результаты: ${successfulChecks} успешно, ${failedChecks} ошибок из ${results.length} обработанных`);

        return {
            results,
            totalChecked: results.length,
            successfulChecks,
            failedChecks,
            summary: updatedSummary
        };
    }

    /**
     * Аварийное сохранение при FloodWait (только успешные результаты)
     */
    private async saveEmergencyProgress(
        results: ICommentCheckResponse[],
        totalChannels: number,
        filePath: string
    ): Promise<void> {
        const fs = await import('fs');
        const path = await import('path');

        // Создаем папку если её нет
        const exportsDir = './exports';
        if (!fs.existsSync(exportsDir)) {
            fs.mkdirSync(exportsDir, { recursive: true });
        }

        const progressData = {
            lastUpdate: new Date().toISOString(),
            processedChannels: results.length,
            totalChannels: totalChannels,
            lastProcessedChannel: results.length > 0 ? results[results.length - 1].channel.channelTitle : null,
            emergencyStop: true,
            stopReason: "FloodWait обнаружен",
            results: results
        };

        fs.writeFileSync(filePath, JSON.stringify(progressData, null, 2));
    }

    /**
     * Сохранение прогресса и обновление исходного файла
     */
    private async saveProgressAndUpdateSource(
        results: ICommentCheckResponse[],
        processedChannel: string,
        allChannels: string[],
        progressFilePath?: string,
        sourceFilePath?: string
    ): Promise<void> {
        const fs = require('fs').promises;
        const path = require('path');

        try {
            // Сохраняем прогресс результатов
            if (progressFilePath) {
                const progressData = {
                    lastUpdate: new Date().toISOString(),
                    processedChannels: results.length,
                    totalChannels: allChannels.length,
                    lastProcessedChannel: processedChannel,
                    results: results
                };

                await fs.writeFile(progressFilePath, JSON.stringify(progressData, null, 2), 'utf8');
                console.log(`💾 Прогресс сохранен: ${results.length}/${allChannels.length} каналов`);
            }

            // Обновляем исходный файл, удаляя обработанный канал
            if (sourceFilePath) {
                const sourceContent = await fs.readFile(sourceFilePath, 'utf8');
                const lines = sourceContent.split('\n');

                // Удаляем строку с обработанным каналом
                const updatedLines = lines.filter((line: string) => {
                    const cleanLine = line.trim().toLowerCase();
                    const cleanChannel = processedChannel.toLowerCase().replace('@', '');

                    return !cleanLine.includes(cleanChannel) &&
                        !cleanLine.includes(`@${cleanChannel}`) &&
                        !cleanLine.includes(`t.me/${cleanChannel}`);
                });

                await fs.writeFile(sourceFilePath, updatedLines.join('\n'), 'utf8');
                console.log(`🗑️ Канал ${processedChannel} удален из ${path.basename(sourceFilePath)}`);
            }

        } catch (error) {
            console.error('⚠️ Ошибка сохранения прогресса:', error);
            // Не прерываем выполнение из-за ошибки сохранения
        }
    }
} 