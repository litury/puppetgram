/**
 * Сервис для управления каналами после комментирования
 * Удаление, архивирование и создание баз для повторной обработки
 */

import fs from 'fs';
import path from 'path';
import {
    IChannelManagementAction,
    IChannelManagementOptions,
    IChannelManagementResult,
    ICommentResult,
    ICommentTarget,
    ICommentTargetWithCache,
    IPostContent,
    IProgressFileData,
    ChannelManagementReason
} from '../interfaces';

export class ChannelManagementService {
    private p_defaultOptions: IChannelManagementOptions = {
        removeAfterSuccess: true,
        archiveMediaOnlyChannels: true,
        createRetryDatabase: true,
        maxRetries: 3,
        retryIntervalHours: 24,
        saveActionLogs: true,
        archivePath: './archives',
        logsPath: './logs'
    };

    /**
     * Обработка каналов после комментирования
     */
    async processChannelsAfterCommenting(
        sessionId: string,
        originalJsonPath: string,
        commentResults: ICommentResult[],
        postContents: Map<string, IPostContent>,
        options: Partial<IChannelManagementOptions> = {}
    ): Promise<IChannelManagementResult> {
        const finalOptions = { ...this.p_defaultOptions, ...options };
        
        console.log('\n🔄 === УПРАВЛЕНИЕ КАНАЛАМИ ПОСЛЕ КОММЕНТИРОВАНИЯ ===');
        console.log(`📁 Исходный JSON: ${path.basename(originalJsonPath)}`);
        console.log(`📊 Результатов комментирования: ${commentResults.length}`);

        // Создаем необходимые директории
        this.ensureDirectories(finalOptions);

        // Загружаем исходный JSON
        const originalData = await this.loadOriginalJson(originalJsonPath);
        if (!originalData) {
            throw new Error('Не удалось загрузить исходный JSON файл');
        }

        const actions: IChannelManagementAction[] = [];
        const channelsToRemove: string[] = [];
        const channelsToArchive: ICommentTargetWithCache[] = [];
        const channelsToRetry: ICommentTargetWithCache[] = [];
        const channelsToKeep: ICommentTargetWithCache[] = [];

        // Анализируем результаты комментирования
        for (const result of commentResults) {
            const channelUsername = result.target.channelUsername;
            const originalChannel = originalData.results.find(
                r => r.channel.channelUsername === channelUsername
            );

            if (!originalChannel) continue;

            const action = this.determineChannelAction(
                result,
                postContents.get(channelUsername),
                finalOptions
            );

            actions.push({
                channelId: originalChannel.channel.channelId,
                channelUsername: channelUsername,
                channelTitle: originalChannel.channel.channelTitle,
                action: action.action,
                reason: action.reason,
                timestamp: new Date(),
                sessionId,
                postContent: postContents.get(channelUsername),
                commentResult: result,
                retryAfter: action.retryAfter,
                metadata: action.metadata
            });

            // Распределяем каналы по действиям
            const channelWithCache = this.convertToChannelWithCache(originalChannel);
            
            switch (action.action) {
                case 'remove':
                    channelsToRemove.push(channelUsername);
                    break;
                case 'move_to_archive':
                    channelsToArchive.push(channelWithCache);
                    break;
                case 'move_to_retry':
                    channelsToRetry.push(channelWithCache);
                    break;
                case 'keep_active':
                    channelsToKeep.push(channelWithCache);
                    break;
            }
        }

        // Выполняем действия
        const createdFiles = await this.executeActions(
            originalJsonPath,
            originalData,
            channelsToRemove,
            channelsToArchive,
            channelsToRetry,
            actions,
            finalOptions
        );

        // Формируем результат
        const result: IChannelManagementResult = {
            sessionId,
            totalChannels: commentResults.length,
            removedChannels: channelsToRemove.length,
            archivedChannels: channelsToArchive.length,
            retryChannels: channelsToRetry.length,
            keptChannels: channelsToKeep.length,
            actions,
            createdFiles,
            summary: this.calculateSummary(actions)
        };

        // Логируем результаты
        this.logResults(result, finalOptions);

        return result;
    }

    /**
     * Определение действия для канала
     */
    private determineChannelAction(
        result: ICommentResult,
        postContent?: IPostContent,
        options: IChannelManagementOptions = this.p_defaultOptions
    ): {
        action: 'remove' | 'move_to_retry' | 'move_to_archive' | 'keep_active';
        reason: ChannelManagementReason;
        retryAfter?: Date;
        metadata?: any;
    } {
        // Успешное комментирование
        if (result.success) {
            if (options.removeAfterSuccess) {
                return {
                    action: 'remove',
                    reason: 'successful_comment'
                };
            } else {
                return {
                    action: 'keep_active',
                    reason: 'successful_comment'
                };
            }
        }

        // Анализ ошибок
        if (result.error) {
            const errorLower = result.error.toLowerCase();

            // FloodWait - повторить позже
            if (errorLower.includes('flood') || errorLower.includes('wait')) {
                return {
                    action: 'move_to_retry',
                    reason: 'flood_wait',
                    retryAfter: new Date(Date.now() + options.retryIntervalHours * 60 * 60 * 1000)
                };
            }

            // Канал не найден или недоступен
            if (errorLower.includes('not found') || errorLower.includes('private')) {
                return {
                    action: 'move_to_archive',
                    reason: 'channel_not_found'
                };
            }

            // Комментарии отключены
            if (errorLower.includes('comment') && errorLower.includes('disabled')) {
                return {
                    action: 'move_to_archive',
                    reason: 'comments_disabled'
                };
            }

            // Нет доступа
            if (errorLower.includes('access') || errorLower.includes('forbidden')) {
                return {
                    action: 'move_to_retry',
                    reason: 'access_denied',
                    retryAfter: new Date(Date.now() + options.retryIntervalHours * 60 * 60 * 1000)
                };
            }

            // Общая ошибка комментирования
            return {
                action: 'move_to_retry',
                reason: 'comment_failed',
                retryAfter: new Date(Date.now() + options.retryIntervalHours * 60 * 60 * 1000)
            };
        }

        // Пост только с медиа
        if (postContent && postContent.hasMedia && postContent.messageLength < 10) {
            if (options.archiveMediaOnlyChannels) {
                return {
                    action: 'move_to_archive',
                    reason: 'media_only_post',
                    metadata: {
                        mediaType: postContent.mediaType,
                        views: postContent.views
                    }
                };
            }
        }

        // По умолчанию оставляем активным
        return {
            action: 'keep_active',
            reason: 'successful_comment'
        };
    }

    /**
     * Выполнение действий с каналами
     */
    private async executeActions(
        originalJsonPath: string,
        originalData: IProgressFileData,
        channelsToRemove: string[],
        channelsToArchive: ICommentTargetWithCache[],
        channelsToRetry: ICommentTargetWithCache[],
        actions: IChannelManagementAction[],
        options: IChannelManagementOptions
    ): Promise<{
        originalUpdated?: string;
        archiveDatabase?: string;
        retryDatabase?: string;
        actionLog?: string;
    }> {
        const createdFiles: any = {};

        // 1. Обновляем исходный JSON (удаляем обработанные каналы)
        if (channelsToRemove.length > 0) {
            const updatedData = {
                ...originalData,
                results: originalData.results.filter(
                    r => !channelsToRemove.includes(r.channel.channelUsername)
                ),
                lastUpdate: new Date().toISOString()
            };
            updatedData.processedChannels = updatedData.results.length;

            fs.writeFileSync(originalJsonPath, JSON.stringify(updatedData, null, 2));
            createdFiles.originalUpdated = originalJsonPath;
            
            console.log(`✅ Удалено ${channelsToRemove.length} каналов из исходного JSON`);
        }

        // 2. Создаем архивную базу
        if (channelsToArchive.length > 0) {
            const archiveFile = this.createArchiveDatabase(channelsToArchive, options);
            createdFiles.archiveDatabase = archiveFile;
            
            console.log(`📦 Создана архивная база: ${archiveFile} (${channelsToArchive.length} каналов)`);
        }

        // 3. Создаем базу для повторной обработки
        if (channelsToRetry.length > 0 && options.createRetryDatabase) {
            const retryFile = this.createRetryDatabase(channelsToRetry, options);
            createdFiles.retryDatabase = retryFile;
            
            console.log(`🔄 Создана база для повтора: ${retryFile} (${channelsToRetry.length} каналов)`);
        }

        // 4. Сохраняем лог действий
        if (options.saveActionLogs) {
            const logFile = this.saveActionLog(actions, options);
            createdFiles.actionLog = logFile;
            
            console.log(`📝 Сохранен лог действий: ${logFile}`);
        }

        return createdFiles;
    }

    /**
     * Создание архивной базы данных
     */
    private createArchiveDatabase(
        channels: ICommentTargetWithCache[],
        options: IChannelManagementOptions
    ): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `archive_channels_${timestamp}.json`;
        const filepath = path.join(options.archivePath, filename);

        const archiveData = {
            createdAt: new Date().toISOString(),
            type: 'archive',
            totalChannels: channels.length,
            channels: channels.map(ch => ({
                channelId: ch.channelId,
                channelUsername: ch.channelUsername,
                channelTitle: ch.channelTitle,
                accessHash: ch.accessHash,
                reason: 'archived_after_commenting'
            }))
        };

        fs.writeFileSync(filepath, JSON.stringify(archiveData, null, 2));
        return filepath;
    }

    /**
     * Создание базы для повторной обработки
     */
    private createRetryDatabase(
        channels: ICommentTargetWithCache[],
        options: IChannelManagementOptions
    ): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `retry_channels_${timestamp}.json`;
        const filepath = path.join(options.archivePath, filename);

        const retryData: IProgressFileData = {
            lastUpdate: new Date().toISOString(),
            processedChannels: channels.length,
            totalChannels: channels.length,
            lastProcessedChannel: channels[channels.length - 1]?.channelUsername || '',
            results: channels.map(ch => ({
                channel: {
                    channelId: ch.channelId,
                    channelTitle: ch.channelTitle,
                    channelUsername: ch.channelUsername,
                    accessHash: ch.accessHash,
                    commentsEnabled: ch.commentsEnabled,
                    commentsPolicy: ch.commentsPolicy,
                    linkedDiscussionGroup: ch.linkedDiscussionGroup,
                    canPostComments: ch.canPostComments,
                    canReadComments: ch.canReadComments
                },
                success: true
            }))
        };

        fs.writeFileSync(filepath, JSON.stringify(retryData, null, 2));
        return filepath;
    }

    /**
     * Сохранение лога действий
     */
    private saveActionLog(
        actions: IChannelManagementAction[],
        options: IChannelManagementOptions
    ): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `channel_actions_${timestamp}.json`;
        const filepath = path.join(options.logsPath, filename);

        const logData = {
            timestamp: new Date().toISOString(),
            totalActions: actions.length,
            actions: actions.map(action => ({
                channelUsername: action.channelUsername,
                channelTitle: action.channelTitle,
                action: action.action,
                reason: action.reason,
                timestamp: action.timestamp,
                sessionId: action.sessionId,
                hasPostContent: !!action.postContent,
                commentSuccess: action.commentResult?.success || false,
                commentError: action.commentResult?.error,
                retryAfter: action.retryAfter,
                metadata: action.metadata
            }))
        };

        fs.writeFileSync(filepath, JSON.stringify(logData, null, 2));
        return filepath;
    }

    /**
     * Вспомогательные методы
     */
    private ensureDirectories(options: IChannelManagementOptions): void {
        [options.archivePath, options.logsPath].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    private async loadOriginalJson(filePath: string): Promise<IProgressFileData | null> {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            console.error('Ошибка загрузки JSON:', error);
            return null;
        }
    }

    private convertToChannelWithCache(originalChannel: any): ICommentTargetWithCache {
        return {
            channelId: originalChannel.channel.channelId,
            accessHash: originalChannel.channel.accessHash,
            channelUsername: originalChannel.channel.channelUsername,
            channelTitle: originalChannel.channel.channelTitle,
            commentsEnabled: originalChannel.channel.commentsEnabled,
            commentsPolicy: originalChannel.channel.commentsPolicy,
            linkedDiscussionGroup: originalChannel.channel.linkedDiscussionGroup,
            canPostComments: originalChannel.channel.canPostComments,
            canReadComments: originalChannel.channel.canReadComments,
            isActive: true
        };
    }

    private calculateSummary(actions: IChannelManagementAction[]): { [reason: string]: number } {
        const summary: { [reason: string]: number } = {};
        actions.forEach(action => {
            summary[action.reason] = (summary[action.reason] || 0) + 1;
        });
        return summary;
    }

    private logResults(result: IChannelManagementResult, options: IChannelManagementOptions): void {
        console.log('\n📊 === РЕЗУЛЬТАТЫ УПРАВЛЕНИЯ КАНАЛАМИ ===');
        console.log(`📺 Всего каналов: ${result.totalChannels}`);
        console.log(`🗑️ Удалено: ${result.removedChannels}`);
        console.log(`📦 Архивировано: ${result.archivedChannels}`);
        console.log(`🔄 Для повтора: ${result.retryChannels}`);
        console.log(`✅ Оставлено: ${result.keptChannels}`);
        
        console.log('\n📋 Причины действий:');
        Object.entries(result.summary).forEach(([reason, count]) => {
            console.log(`  • ${reason}: ${count}`);
        });

        if (Object.keys(result.createdFiles).length > 0) {
            console.log('\n📁 Созданные файлы:');
            Object.entries(result.createdFiles).forEach(([type, file]) => {
                if (file) {
                    console.log(`  • ${type}: ${path.basename(file)}`);
                }
            });
        }
    }
}
