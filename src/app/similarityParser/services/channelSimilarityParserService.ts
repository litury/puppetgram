/**
 * Основной сервис для парсинга похожих каналов Telegram
 * Реализует многоуровневый поиск в ширину (BFS)
 */

import {
    ISimilarityParsingResult,
    ISimilarChannel,
    ITelegramApiAdapter,
    ISimilarityParsingOptions
} from '../interfaces';
import {
    validateParsingOptions,
    normalizeChannelName,
    removeDuplicateChannels,
    calculateDuplicatesRemoved,
    delayAsync,
    generateRandomDelay,
    processApiResult
} from '../parts';
import { handleFloodWaitError, isCriticalFloodWait } from '../../../shared/utils/floodWaitHandler';
import { SimilarityResultAdapter } from '../adapters';
import { loadExclusionFilters, filterDuplicateChannels, addToExclusionList } from '../utils/duplicateFilter';
import * as fs from 'fs';
import * as path from 'path';

class TelegramApiAdapter implements ITelegramApiAdapter {
    constructor(private readonly p_telegramClient: any) { }

    async getChannelRecommendationsAsync(_channelName: string, _limit: number): Promise<any> {
        try {
            const inputChannel = await this.resolveChannelAsync(_channelName);
            if (!inputChannel) throw new Error(`Канал ${_channelName} не найден или недоступен`);
            const { Api } = await import('telegram');
            return await this.p_telegramClient.invoke(new Api.channels.GetChannelRecommendations({ channel: inputChannel }));
        } catch (error: any) {
            if (isCriticalFloodWait(error)) handleFloodWaitError(error, `Получение рекомендаций для ${_channelName}`);
            throw new Error(`Ошибка получения рекомендаций: ${error.message}`);
        }
    }

    async resolveChannelAsync(_channelName: string): Promise<any | null> {
        try {
            const normalizedName = normalizeChannelName(_channelName);
            const { Api } = await import('telegram');
            const result = await this.p_telegramClient.invoke(new Api.contacts.ResolveUsername({ username: normalizedName }));
            if (result?.chats?.length > 0) {
                const chat = result.chats[0];
                return new Api.InputChannel({ channelId: chat.id, accessHash: chat.accessHash });
            }
            return null;
        } catch (error: any) {
            if (isCriticalFloodWait(error)) handleFloodWaitError(error, `Резолв канала ${_channelName}`);
            console.error(`Ошибка резолва канала ${_channelName}:`, error.message);
            return null;
        }
    }
}

export class ChannelSimilarityParserService implements IChannelSimilarityParser {
    private readonly p_apiAdapter: TelegramApiAdapter;

    constructor(_telegramClient: any) {
        this.p_apiAdapter = new TelegramApiAdapter(_telegramClient);
    }

    async parseSimilarChannelsAsync(_options: ISimilarityParsingOptions): Promise<ISimilarityParsingResult> {
        const startTime = Date.now();
        let partialChannels: ISimilarChannel[] = [];

        try {
            const validatedOptions = validateParsingOptions(_options);
            console.log(`\n🎯 Цель: ${validatedOptions.targetChannelCount} каналов`);
            console.log(`🔍 Источник: ${validatedOptions.sourceChannel}`);
            console.log(`📋 Фильтр: ${validatedOptions.minSubscribers}-${validatedOptions.maxSubscribers} подписчиков`);

            const exclusionFilters = loadExclusionFilters();

            const context = {
                foundChannels: new Map<string, ISimilarChannel>(),
                visitedSources: new Set<string>(),
                depthStatistics: {} as { [depth: number]: { channelsFound: number; channelsProcessed: number; sourceChannels: string[]; } }
            };

            // Шаг 1: Начинаем с исходного канала
            let queue = [validatedOptions.sourceChannel];
            let currentLevel = 1;

            // Шаг 2: Многоуровневый поиск в ширину (BFS)
            while (context.foundChannels.size < validatedOptions.targetChannelCount && queue.length > 0) {
                console.log(`\n📡 Уровень ${currentLevel}: Обработка ${queue.length} каналов-источников...`);
                const nextQueue: string[] = [];
                context.depthStatistics[currentLevel] = { channelsFound: 0, channelsProcessed: 0, sourceChannels: [] };

                for (const sourceChannel of queue) {
                    if (context.foundChannels.size >= validatedOptions.targetChannelCount) break;
                    if (context.visitedSources.has(sourceChannel)) continue;

                    context.visitedSources.add(sourceChannel);
                    context.depthStatistics[currentLevel].channelsProcessed++;
                    context.depthStatistics[currentLevel].sourceChannels.push(sourceChannel);

                    try {
                        const recommended = await this.performBasicSearch(
                            sourceChannel,
                            100, // Всегда берем максимум
                            0, // Без фильтра, чтобы получить больше потенциальных источников
                            Number.MAX_SAFE_INTEGER
                        );

                        let newChannelsFromSource = 0;
                        for (const channel of recommended) {
                            if (channel.username && !context.foundChannels.has(channel.id)) {
                                // Добавляем в очередь для следующего уровня
                                nextQueue.push(`@${channel.username}`);

                                // Проверяем фильтры и добавляем в результат
                                const subscribers = channel.subscribersCount || 0;
                                if (subscribers >= validatedOptions.minSubscribers && subscribers <= validatedOptions.maxSubscribers) {
                                    context.foundChannels.set(channel.id, channel);
                                    context.depthStatistics[currentLevel].channelsFound++;
                                    newChannelsFromSource++;
                                    if (context.foundChannels.size >= validatedOptions.targetChannelCount) break;
                                }
                            }
                        }
                        console.log(`   - Из @${normalizeChannelName(sourceChannel)}: найдено ${newChannelsFromSource} новых релевантных каналов`);

                        // Сразу обновляем список для аварийного сохранения
                        partialChannels = Array.from(context.foundChannels.values());

                        await delayAsync(generateRandomDelay(1500, 3000));

                    } catch (error: any) {
                        console.error(`   - ❌ Ошибка при обработке @${normalizeChannelName(sourceChannel)}: ${error.message}`);
                        // Если ошибка критическая, пробрасываем ее наверх, чтобы сработало сохранение
                        if (isCriticalFloodWait(error)) {
                            throw error;
                        }
                    }
                }
                queue = nextQueue;
                currentLevel++;
            }

            console.log('\n✅ Поиск завершен.');
            let finalChannels = Array.from(context.foundChannels.values());

            // Шаг 3: Финальная обработка и логирование
            if (finalChannels.length > validatedOptions.targetChannelCount) {
                finalChannels = finalChannels.slice(0, validatedOptions.targetChannelCount);
            }

            const initialCount = finalChannels.length;
            const { filteredChannels, excludedCount } = filterDuplicateChannels(finalChannels, exclusionFilters.excludeUsernames);
            if (excludedCount > 0) {
                console.log(`🚫 Исключено ${excludedCount} каналов из предыдущих поисков.`);
                finalChannels = filteredChannels;
            }

            let duplicatesRemoved = 0;
            if (validatedOptions.removeDuplicates) {
                const originalCount = finalChannels.length;
                finalChannels = removeDuplicateChannels(finalChannels);
                duplicatesRemoved = calculateDuplicatesRemoved(originalCount, finalChannels.length);
            }

            console.log(`\n📊 Итого найдено: ${finalChannels.length} уникальных каналов`);
            const processingTimeMs = Date.now() - startTime;

            const result: ISimilarityParsingResult = {
                channels: finalChannels,
                totalCount: finalChannels.length,
                sourceChannel: validatedOptions.sourceChannel,
                searchDepth: currentLevel - 1,
                duplicatesRemoved,
                processingTimeMs,
                depthStatistics: context.depthStatistics,
                targetReached: finalChannels.length >= validatedOptions.targetChannelCount
            };

            if (finalChannels.length > 0) {
                addToExclusionList(finalChannels, validatedOptions.sourceChannel);
                await this.autoExportResults(result);
            }

            return result;

        } catch (error: any) {
            if (isCriticalFloodWait(error) && partialChannels.length > 0) {
                await this.savePartialResults(partialChannels, _options.sourceChannel);
            }
            console.error(`❌ Критическая ошибка парсинга:`, error.message);
            throw error;
        }
    }

    private async performBasicSearch(
        _channelName: string,
        _limit: number,
        _minSubscribers: number,
        _maxSubscribers: number
    ): Promise<ISimilarChannel[]> {
        try {
            const apiResult = await this.p_apiAdapter.getChannelRecommendationsAsync(_channelName, _limit);
            return processApiResult(apiResult, 1, _minSubscribers, _maxSubscribers);
        } catch (error: any) {
            // Ошибка уже логируется в адаптере, здесь просто пробрасываем ее дальше
            throw error;
        }
    }

    async validateChannelAccessAsync(_channelName: string): Promise<boolean> {
        try {
            return await this.p_apiAdapter.resolveChannelAsync(_channelName) !== null;
        } catch (error) {
            return false;
        }
    }

    private async autoExportResults(_result: ISimilarityParsingResult): Promise<void> {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const sourceChannelName = _result.sourceChannel.replace(/[@]/g, '');
            const exportsDir = path.join(__dirname, '..', 'exports');
            if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

            const txtContent = SimilarityResultAdapter.exportChannelNames(_result);
            const txtFilename = `${sourceChannelName}_usernames_${timestamp}.txt`;
            fs.writeFileSync(path.join(exportsDir, txtFilename), txtContent, 'utf-8');

            const mdContent = SimilarityResultAdapter.exportDetailedMarkdown(_result);
            const mdFilename = `${sourceChannelName}_detailed_${timestamp}.md`;
            fs.writeFileSync(path.join(exportsDir, mdFilename), mdContent, 'utf-8');

            console.log(`\n✅ Результаты сохранены в папку: ${exportsDir}`);
            console.log(`   - ${txtFilename}`);
            console.log(`   - ${mdFilename}`);
        } catch (error: any) {
            console.error(`❌ Ошибка автоэкспорта:`, error.message);
        }
    }

    private async savePartialResults(_channels: ISimilarChannel[], _sourceChannel: string): Promise<void> {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const sourceChannelName = _sourceChannel.replace(/[@]/g, '');
            const exportsDir = path.join(__dirname, '..', 'exports');
            if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

            const partialResult: ISimilarityParsingResult = {
                channels: _channels,
                totalCount: _channels.length,
                sourceChannel: _sourceChannel,
                searchDepth: 0,
                duplicatesRemoved: 0,
                processingTimeMs: 0,
                targetReached: false
            };

            const txtContent = SimilarityResultAdapter.exportChannelNames(partialResult);
            const txtFilename = `${sourceChannelName}_partial_${timestamp}.txt`;
            fs.writeFileSync(path.join(exportsDir, txtFilename), txtContent, 'utf-8');

            console.log(`\n💾 Частичные результаты (${_channels.length} каналов) сохранены в: ${txtFilename}`);
        } catch (error: any) {
            console.error(`❌ Ошибка сохранения частичных результатов:`, error.message);
        }
    }
}
