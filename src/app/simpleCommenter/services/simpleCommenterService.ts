/**
 * Сервис для умного комментирования по usernames
 * Генерирует осмысленные короткие комментарии через AI
 */

import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import {
    ISimpleCommentOptions,
    ISimpleCommentResult,
    ISimpleCommentResponse,
    ISimpleCommenter
} from '../interfaces/ISimpleCommenter';
import { generateSessionId, delayAsync, cleanUsername } from '../parts/simpleCommenterHelpers';
import { extractPostContent } from '../parts/postContentExtractor';
import { AICommentGeneratorService } from '../../aiCommentGenerator';
import { IAICommentGenerator } from '../../aiCommentGenerator/interfaces/IAICommentGenerator';
import { shouldCommentOnPost } from '../../aiCommentGenerator/parts/promptBuilder';
import { DEFAULT_AI_CONFIG } from '../../../config/aiConfig';
import { handleFloodWaitError, isCriticalFloodWait, analyzeFloodWaitError } from '../../../utils/floodWaitHandler';

export class SimpleCommenterService implements ISimpleCommenter {
    private readonly p_client: TelegramClient;
    private p_aiGenerator?: IAICommentGenerator;
    private p_lastRequestTime: number = 0;
    private p_adaptiveDelay: number = 1000; // Начальная адаптивная задержка

    constructor(_client: TelegramClient) {
        this.p_client = _client;

        // Настраиваем оптимальные лимиты для Telegram API
        this.p_client.floodSleepThreshold = 300; // Автоматический сон при FloodWait < 5 минут

        console.log('🛡️ FloodWait защита: автосон до 5 минут');
        console.log('⚡ Адаптивные задержки: включены');
    }

    /**
     * Умное комментирование по usernames с AI
     */
    async postCommentsAsync(_options: ISimpleCommentOptions): Promise<ISimpleCommentResponse> {
        const sessionId = generateSessionId();
        const startTime = new Date();
        let totalApiCalls = 0;

        console.log(`🚀 === УМНОЕ КОММЕНТИРОВАНИЕ ===`);
        console.log(`📝 Сессия: ${sessionId}`);
        console.log(`🎯 Каналов: ${_options.channels.length}`);
        console.log(`🤖 AI: ${_options.useAI ? 'Включен' : 'Выключен'}`);
        console.log(`🧪 Тестовый режим: ${_options.dryRun ? 'ДА' : 'НЕТ'}`);

        // Инициализируем AI генератор
        if (_options.useAI) {
            const aiConfig = _options.aiConfig || DEFAULT_AI_CONFIG;
            this.p_aiGenerator = new AICommentGeneratorService(aiConfig);

            // Проверяем доступность AI
            const aiAvailable = await this.p_aiGenerator.checkHealthAsync();
            if (!aiAvailable) {
                console.log('⚠️ AI сервис недоступен, комментирование невозможно');
                throw new Error('AI сервис недоступен для генерации комментариев');
            }
        } else {
            throw new Error('Базовые комментарии удалены. Используйте AI режим (useAI: true)');
        }

        const results: ISimpleCommentResult[] = [];
        let successfulComments = 0;
        let failedComments = 0;
        let totalAIRequests = 0;
        let successfulAIRequests = 0;
        let failedAIRequests = 0;

        try {
            for (const [index, channelUsername] of _options.channels.entries()) {
                const cleanedUsername = cleanUsername(channelUsername);
                console.log(`\n[${index + 1}/${_options.channels.length}] @${cleanedUsername}`);

                try {
                    // Применяем адаптивную задержку перед запросом
                    await this.applyAdaptiveDelayAsync();

                    const result = await this.postCommentToChannelAsync(
                        cleanedUsername,
                        _options.dryRun,
                        _options.sendAsChannelId
                    );

                    results.push(result);
                    totalApiCalls += result.apiCalls;

                    // Обновляем AI статистику
                    if (result.usedAI) {
                        totalAIRequests++;
                        if (result.success && !result.aiError) {
                            successfulAIRequests++;
                        } else {
                            failedAIRequests++;
                        }
                    }

                    // Проверяем на FloodWait
                    if (result.error && result.error.includes('Flood wait')) {
                        this.increaseAdaptiveDelay();
                        console.log(`🛡️ FloodWait обнаружен, увеличиваю задержки до ${this.p_adaptiveDelay}мс`);
                    } else if (result.success) {
                        this.decreaseAdaptiveDelay();
                    }

                    if (result.success) {
                        successfulComments++;
                        const aiTag = result.usedAI ? '🤖' : '📝';
                        console.log(`✅ [${index + 1}/${_options.channels.length}] ${aiTag} @${cleanedUsername} - Успешно`);
                        console.log(`💬 "${result.commentText}"`);
                    } else {
                        failedComments++;
                        console.log(`❌ [${index + 1}/${_options.channels.length}] @${cleanedUsername} - ${result.error}`);
                    }

                } catch (error) {
                    failedComments++;
                    const errorMessage = error instanceof Error ? error.message : String(error);

                    // Проверяем на критический FloodWait
                    if (isCriticalFloodWait(error)) {
                        const analysis = analyzeFloodWaitError(error);
                        console.error(`\n🛑 КРИТИЧЕСКИЙ FLOODWAIT в канале @${cleanedUsername}!`);
                        console.error(`⏰ Требуется ожидание: ${analysis.hours} часов`);
                        console.error(`📊 Успешно обработано: ${successfulComments}/${index + 1} каналов`);
                        console.error(`\n❌ ОСТАНОВКА УМНОГО КОММЕНТИРОВАНИЯ!`);

                        // Добавляем текущий результат как неудачный
                        results.push({
                            channelUsername: cleanedUsername,
                            success: false,
                            error: `КРИТИЧЕСКИЙ FloodWait: ${analysis.seconds} секунд`,
                            timestamp: new Date(),
                            apiCalls: 0,
                            usedAI: false
                        });

                        // Прерываем цикл
                        break;
                    }

                    console.log(`❌ [${index + 1}/${_options.channels.length}] @${cleanedUsername} - ${errorMessage}`);

                    // Проверяем на обычный FloodWait
                    const floodAnalysis = analyzeFloodWaitError(error);
                    if (floodAnalysis.isFloodWait) {
                        this.increaseAdaptiveDelay();
                        console.log(`🛡️ FloodWait обнаружен, увеличиваю задержки до ${this.p_adaptiveDelay}мс`);
                    }

                    results.push({
                        channelUsername: cleanedUsername,
                        success: false,
                        error: errorMessage,
                        timestamp: new Date(),
                        apiCalls: 0,
                        usedAI: false
                    });
                }

                // Основная задержка между комментариями
                if (index < _options.channels.length - 1) {
                    const totalDelay = Math.max(_options.delayBetweenComments, this.p_adaptiveDelay);
                    console.log(`⏱️ Ожидание ${totalDelay / 1000}с до следующего канала...`);
                    await delayAsync(totalDelay);
                }
            }

        } catch (error) {
            console.error('❌ Критическая ошибка сессии:', error);
            throw error;
        }

        const duration = Date.now() - startTime.getTime();

        console.log(`\n🏁 === ИТОГИ СЕССИИ ===`);
        console.log(`📊 Успешно: ${successfulComments}/${_options.channels.length}`);
        console.log(`❌ Ошибок: ${failedComments}/${_options.channels.length}`);
        console.log(`🤖 AI запросов: ${totalAIRequests} (успешно: ${successfulAIRequests})`);
        console.log(`📡 API вызовов: ${totalApiCalls}`);
        console.log(`⏱️ Время: ${(duration / 1000).toFixed(1)}с`);

        return {
            sessionId,
            totalChannels: _options.channels.length,
            successfulComments,
            failedComments,
            results,
            totalApiCalls,
            duration,
            aiStats: {
                totalAIRequests,
                successfulAIRequests,
                failedAIRequests
            }
        };
    }

    /**
     * Применяет адаптивную задержку для избежания FloodWait
     */
    private async applyAdaptiveDelayAsync(): Promise<void> {
        const now = Date.now();
        const timeSinceLastRequest = now - this.p_lastRequestTime;

        if (timeSinceLastRequest < this.p_adaptiveDelay) {
            const remainingDelay = this.p_adaptiveDelay - timeSinceLastRequest;
            await delayAsync(remainingDelay);
        }

        this.p_lastRequestTime = Date.now();
    }

    /**
     * Увеличивает адаптивную задержку при обнаружении FloodWait
     */
    private increaseAdaptiveDelay(): void {
        this.p_adaptiveDelay = Math.min(this.p_adaptiveDelay * 2, 30000); // Максимум 30 секунд
    }

    /**
     * Уменьшает адаптивную задержку при успешных запросах
     */
    private decreaseAdaptiveDelay(): void {
        this.p_adaptiveDelay = Math.max(this.p_adaptiveDelay * 0.9, 1000); // Минимум 1 секунда
    }

    /**
     * Отправка умного комментария в один канал
     */
    private async postCommentToChannelAsync(
        _channelUsername: string,
        _dryRun: boolean,
        _sendAsChannelId?: string
    ): Promise<ISimpleCommentResult> {
        let apiCalls = 0;
        let usedAI = false;
        let aiError: string | undefined;

        try {
            // 1. Получаем контент поста для AI анализа
            console.log(`📥 Анализирую пост из @${_channelUsername}...`);
            const postContent = await extractPostContent(this.p_client, _channelUsername);
            apiCalls++; // getMessages внутри extractPostContent

            // 2. Проверяем пригодность поста
            const shouldComment = shouldCommentOnPost(postContent);
            if (!shouldComment.shouldComment) {
                throw new Error(`Пост не подходит для комментирования: ${shouldComment.reason}`);
            }

            // 3. Генерируем комментарий через AI
            let commentText = '';

            if (this.p_aiGenerator) {
                console.log(`🤖 Генерирую осмысленный комментарий...`);
                const aiResult = await this.p_aiGenerator.generateCommentAsync(postContent);
                usedAI = true;

                if (aiResult.success && aiResult.comment) {
                    commentText = aiResult.comment;
                    console.log(`💬 Комментарий готов: "${commentText}"`);
                } else {
                    aiError = aiResult.error || 'AI не смог сгенерировать комментарий';
                    throw new Error(`AI ошибка: ${aiError}`);
                }
            } else {
                throw new Error('AI недоступен для генерации комментариев');
            }

            if (_dryRun) {
                console.log('🧪 Тестовый режим - комментарий не отправлен');
                return {
                    channelUsername: _channelUsername,
                    success: true,
                    commentText,
                    timestamp: new Date(),
                    apiCalls,
                    usedAI,
                    aiError
                };
            }

            // 4. Получаем информацию о дискуссионной группе
            console.log(`🗨️ Получаю дискуссионную группу...`);
            const messages = await this.p_client.getMessages(_channelUsername, { limit: 1 });
            const lastMessage = messages[0];

            const discussionResult = await this.p_client.invoke(new Api.messages.GetDiscussionMessage({
                peer: _channelUsername,
                msgId: lastMessage.id,
            }));
            apiCalls++;

            if (!discussionResult.messages || discussionResult.messages.length === 0) {
                throw new Error('Комментарии недоступны для этого канала');
            }

            const discussionMessage = discussionResult.messages[0];
            const peer = discussionMessage.peerId || _channelUsername;

            // 5. Отправляем комментарий
            console.log(`💬 Отправляю комментарий...`);
            let sentMessage: any;

            if (_sendAsChannelId) {
                // От имени канала
                console.log(`📺 Отправляю от имени канала: ${_sendAsChannelId}`);
                const channelEntity = await this.p_client.getEntity(_sendAsChannelId);
                apiCalls++;

                const sendResult = await this.p_client.invoke(new Api.messages.SendMessage({
                    peer: peer,
                    message: commentText,
                    replyTo: new Api.InputReplyToMessage({
                        replyToMsgId: discussionMessage.id
                    }),
                    fromId: new Api.InputPeerChannel({
                        channelId: (channelEntity as any).id,
                        accessHash: (channelEntity as any).accessHash
                    })
                }));
                sentMessage = sendResult;
            } else {
                // От имени пользователя
                sentMessage = await this.p_client.sendMessage(peer, {
                    message: commentText,
                    replyTo: discussionMessage.id
                });
            }
            apiCalls++;

            console.log(`✅ Комментарий отправлен успешно`);

            return {
                channelUsername: _channelUsername,
                success: true,
                commentText,
                messageId: sentMessage.id,
                timestamp: new Date(),
                apiCalls,
                usedAI,
                aiError
            };

        } catch (error: any) {
            const errorMessage = error.message || String(error);

            // Проверяем на критический FloodWait и выбрасываем его наверх
            if (isCriticalFloodWait(error)) {
                console.error(`🛑 Критический FloodWait в канале @${_channelUsername}!`);
                throw error; // Перебрасываем критический FloodWait
            }

            console.log(`❌ Ошибка: ${errorMessage}`);

            return {
                channelUsername: _channelUsername,
                success: false,
                error: errorMessage,
                timestamp: new Date(),
                apiCalls,
                usedAI,
                aiError
            };
        }
    }
} 