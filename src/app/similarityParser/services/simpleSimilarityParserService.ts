/**
 * Упрощенный сервис для парсинга похожих каналов
 * Одноуровневый поиск с автоматической фильтрацией
 */

import { ChannelDatabase } from '../utils/channelDatabase';
import { handleFloodWaitError, isCriticalFloodWait } from '../../../shared/utils/floodWaitHandler';
import * as fs from 'fs';
import * as path from 'path';

export interface ISimpleParsingOptions {
    sourceChannel: string;
    targetCount: number;
}

export interface ISimpleParsingResult {
    channels: string[];
    totalFound: number;
    newChannels: number;
    duplicatesFiltered: number;
    sourceChannel: string;
    processingTimeMs: number;
}

export class SimpleSimilarityParserService {
    private readonly database: ChannelDatabase;

    constructor(private readonly telegramClient: any) {
        this.database = new ChannelDatabase();
    }

    /**
     * Парсинг похожих каналов с автоматической фильтрацией
     */
    async parseSimilarChannels(options: ISimpleParsingOptions): Promise<ISimpleParsingResult> {
        const startTime = Date.now();
        const normalizedSource = this.normalizeChannelName(options.sourceChannel);

        console.log(`\n🚀 Начинаем парсинг похожих каналов для @${normalizedSource}`);
        console.log(`🎯 Цель: ${options.targetCount} новых каналов\n`);

        // Показываем статистику базы
        const stats = this.database.getStats();
        console.log(`📊 База данных: ${stats.totalUniqueChannels} известных каналов`);
        console.log(`   - Основная база: ${stats.mainDatabaseSize} каналов`);
        console.log(`   - Ранее спарсено: ${stats.parsedChannelsSize} каналов\n`);

        // Многоуровневый поиск
        let sourceChannels = [normalizedSource];
        let allNewChannels: string[] = [];
        const foundChannelsSet = new Set<string>(); // Отслеживаем все найденные каналы в текущем сеансе
        const nextSourcesSet = new Set<string>(); // Для предотвращения дубликатов в источниках
        let totalProcessed = 0;
        let totalDuplicates = 0;
        let sessionDuplicates = 0; // Дубликаты внутри текущего сеанса
        let level = 1;
        const processedSources = new Set<string>();

        try {

            while (allNewChannels.length < options.targetCount && sourceChannels.length > 0) {
                console.log(`\n📡 Уровень ${level}: обрабатываем ${sourceChannels.length} источников...`);
                nextSourcesSet.clear(); // Очищаем для нового уровня
                let levelNewChannels = 0;

                for (const source of sourceChannels) {
                    if (allNewChannels.length >= options.targetCount) break;

                    // Пропускаем уже обработанные источники
                    if (processedSources.has(source)) {
                        console.log(`   ⏭️  Пропускаем @${source} (уже обработан)`);
                        continue;
                    }

                    console.log(`   🔍 Парсим @${source}...`);
                    processedSources.add(source);

                    const rawChannels = await this.fetchSimilarChannels(source, 100);

                    // Фильтруем через базу данных
                    const newChannels = this.database.filterNewChannels(rawChannels);
                    const actualReceived = rawChannels.length;
                    const actualNew = newChannels.length;
                    const actualDuplicates = actualReceived - actualNew;

                    totalProcessed += actualReceived;
                    totalDuplicates += actualDuplicates;

                    // Добавляем новые каналы в общий результат, проверяя на дубликаты в текущем сеансе
                    let addedInLevel = 0;
                    for (const channel of newChannels) {
                        const normalized = channel.replace('@', '');
                        if (!foundChannelsSet.has(normalized)) {
                            allNewChannels.push(channel);
                            foundChannelsSet.add(normalized);
                            addedInLevel++;
                            levelNewChannels++;
                        } else {
                            sessionDuplicates++;
                        }
                    }

                    // ВСЕ найденные каналы могут стать источниками для следующего уровня
                    // (но только те, которые еще не обрабатывали)
                    for (const channel of rawChannels) {
                        const normalized = channel.replace('@', '');
                        if (!processedSources.has(normalized)) {
                            nextSourcesSet.add(normalized);
                        }
                    }

                    console.log(`      📊 API вернул: ${actualReceived} | Новых: ${actualNew} | В базе: ${actualDuplicates} | Добавлено: ${addedInLevel}`);
                    if (actualReceived > 0 && actualNew === 0) {
                        console.log(`      🔄 Все ${actualReceived} каналов уже в базе`);
                    }

                    // Небольшая задержка между запросами
                    if (sourceChannels.length > 1) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                console.log(`   ✨ Уровень ${level} завершен: +${levelNewChannels} новых каналов`);

                // Сохраняем промежуточные результаты после каждого уровня
                if (allNewChannels.length > 0) {
                    await this.saveResults(allNewChannels.slice(0, options.targetCount), normalizedSource);
                    console.log(`   💾 Промежуточное сохранение: ${Math.min(allNewChannels.length, options.targetCount)} каналов`);
                }

                // Преобразуем Set в массив для следующего уровня
                const nextSourcesArray = Array.from(nextSourcesSet);

                // Останавливаем если:
                // 1. Нет новых источников для обработки
                // 2. Достигли максимального уровня глубины (защита от бесконечного цикла)
                if (nextSourcesArray.length === 0) {
                    console.log(`   🛑 Нет новых источников для обработки, останавливаем поиск`);
                    break;
                }

                if (level >= 5) {
                    console.log(`   🛑 Достигнут максимальный уровень глубины (5), останавливаем поиск`);
                    break;
                }

                // Ограничиваем количество источников на следующем уровне
                const maxSourcesPerLevel = 50;
                if (nextSourcesArray.length > maxSourcesPerLevel) {
                    console.log(`   ⚠️  Ограничиваем источники: ${nextSourcesArray.length} → ${maxSourcesPerLevel}`);
                    sourceChannels = nextSourcesArray.slice(0, maxSourcesPerLevel);
                } else {
                    sourceChannels = nextSourcesArray;
                }

                level++;
            }

            console.log(`\n📊 Многоуровневый поиск завершен:`);
            console.log(`   🔄 Обработано уровней: ${level - 1}`);
            console.log(`   🔍 Обработано источников: ${processedSources.size}`);
            console.log(`   📡 Всего каналов от API: ${totalProcessed}`);
            console.log(`   🚫 Дубликатов в БД: ${totalDuplicates}`);
            console.log(`   🔁 Дубликатов в сеансе: ${sessionDuplicates}`);
            console.log(`   ✨ Новых уникальных каналов: ${allNewChannels.length}`)

            // Обрезаем до нужного количества
            const finalChannels = allNewChannels.slice(0, options.targetCount);

            // Добавляем в базу спарсенных
            if (finalChannels.length > 0) {
                this.database.addParsedChannels(finalChannels);
                await this.saveResults(finalChannels, normalizedSource);
            }

            const processingTimeMs = Date.now() - startTime;
            console.log(`\n✅ Парсинг завершен за ${Math.round(processingTimeMs / 1000)}с`);

            return {
                channels: finalChannels,
                totalFound: totalProcessed,
                newChannels: finalChannels.length,
                duplicatesFiltered: totalDuplicates,
                sourceChannel: normalizedSource,
                processingTimeMs
            };

        } catch (error: any) {
            // Сохраняем результаты перед выходом при любой ошибке
            if (allNewChannels.length > 0) {
                const finalChannels = allNewChannels.slice(0, options.targetCount);
                await this.saveResults(finalChannels, normalizedSource);
                console.log(`\n⚠️ Сохранено ${finalChannels.length} каналов перед остановкой`);
            }

            if (isCriticalFloodWait(error)) {
                handleFloodWaitError(error, `Парсинг каналов для ${normalizedSource}`);
            }
            throw error;
        }
    }

    /**
     * Получение похожих каналов через API
     */
    private async fetchSimilarChannels(channelName: string, limit: number): Promise<string[]> {
        try {
            const { Api } = await import('telegram');

            // Резолвим канал
            const resolveResult = await this.telegramClient.invoke(
                new Api.contacts.ResolveUsername({ username: channelName })
            );

            if (!resolveResult?.chats?.length) {
                throw new Error(`Канал @${channelName} не найден`);
            }

            const chat = resolveResult.chats[0];
            const inputChannel = new Api.InputChannel({
                channelId: chat.id,
                accessHash: chat.accessHash
            });

            // Получаем рекомендации
            const recommendations = await this.telegramClient.invoke(
                new Api.channels.GetChannelRecommendations({
                    channel: inputChannel
                })
            );

            // Извлекаем юзернеймы
            const channels: string[] = [];

            if (recommendations?.chats) {
                for (const chat of recommendations.chats) {
                    if (chat.username) {
                        channels.push(`@${chat.username}`);
                    }
                }
            }

            return channels;

        } catch (error: any) {
            console.error(`❌ Ошибка при получении похожих каналов: ${error.message}`);
            throw error;
        }
    }

    /**
     * Сохранение результатов
     */
    private async saveResults(channels: string[], sourceChannel: string): Promise<void> {
        try {
            const exportDir = path.resolve(__dirname, '../../../../exports/similar-channels');

            // Создаем директорию если не существует
            if (!fs.existsSync(exportDir)) {
                fs.mkdirSync(exportDir, { recursive: true });
            }

            // Используем фиксированное имя файла для перезаписи
            const filename = `${sourceChannel}_latest.txt`;
            const filePath = path.join(exportDir, filename);

            // Формируем содержимое файла
            let content = `# Похожие каналы для @${sourceChannel}\n`;
            content += `# Дата: ${new Date().toLocaleString()}\n`;
            content += `# Найдено новых каналов: ${channels.length}\n\n`;
            content += channels.join('\n');

            fs.writeFileSync(filePath, content, 'utf-8');

            console.log(`   💾 Сохранено в: ${filename}`);

        } catch (error: any) {
            console.error(`❌ Ошибка сохранения результатов: ${error.message}`);
        }
    }

    /**
     * Нормализация имени канала
     */
    private normalizeChannelName(name: string): string {
        return name.trim().replace(/^@/, '').replace(/\s/g, '');
    }

    /**
     * Проверка доступности канала
     */
    async validateChannelAccess(channelName: string): Promise<boolean> {
        try {
            const normalized = this.normalizeChannelName(channelName);
            const { Api } = await import('telegram');

            const result = await this.telegramClient.invoke(
                new Api.contacts.ResolveUsername({ username: normalized })
            );

            return result?.chats?.length > 0;
        } catch (error) {
            return false;
        }
    }
}