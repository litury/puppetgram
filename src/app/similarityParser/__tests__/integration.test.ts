/**
 * Интеграционные тесты для парсера похожих каналов
 * Тестируют реальную работу с Telegram API
 */

import { GramClient } from '../../telegram/adapters/gramClient';
import { ChannelSimilarityParserService } from '../services/channelSimilarityParserService';
import { ISimilarityParsingOptions } from '../interfaces';

/**
 * Интеграционные тесты с реальным API
 * ВНИМАНИЕ: Эти тесты используют реальный Telegram API!
 * Запускайте их только при необходимости проверки API
 */
describe('ChannelSimilarityParser Integration Tests', () => {
    let gramClient: GramClient;
    let parser: ChannelSimilarityParserService;

    // Пропускаем интеграционные тесты по умолчанию
    // Для запуска используйте: npm test -- --testNamePattern="Integration"
    const shouldRunIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';

    beforeAll(async () => {
        if (!shouldRunIntegrationTests) {
            console.log('⏭️ Интеграционные тесты пропущены. Для запуска установите RUN_INTEGRATION_TESTS=true');
            return;
        }

        try {
            gramClient = new GramClient();
            await gramClient.connect();
            parser = new ChannelSimilarityParserService(gramClient.getClient());
            console.log('✅ Подключение к Telegram API установлено');
        } catch (error) {
            console.error('❌ Ошибка подключения к Telegram API:', error);
            throw error;
        }
    }, 30000); // 30 секунд на подключение

    afterAll(async () => {
        if (gramClient) {
            await gramClient.disconnect();
            console.log('👋 Отключение от Telegram API');
        }
    });

    describe('Реальные API запросы', () => {
        test.skipIf(!shouldRunIntegrationTests)('должен найти похожие каналы для известного канала', async () => {
            const options: ISimilarityParsingOptions = {
                sourceChannel: '@telegram', // Официальный канал Telegram
                limit: 5,
                recursiveSearch: false,
                removeDuplicates: true,
                maxSubscribers: 100000 // Ограничиваем крупными каналами
            };

            const result = await parser.parseSimilarChannelsAsync(options);

            expect(result).toBeDefined();
            expect(result.sourceChannel).toBe('@telegram');
            expect(result.channels).toBeInstanceOf(Array);
            expect(result.totalCount).toBeGreaterThanOrEqual(0);
            expect(result.processingTimeMs).toBeGreaterThan(0);

            // Проверяем структуру найденных каналов
            result.channels.forEach(channel => {
                expect(channel.id).toBeDefined();
                expect(channel.title).toBeDefined();
                expect(typeof channel.title).toBe('string');
                expect(channel.title.length).toBeGreaterThan(0);

                if (channel.subscribersCount) {
                    expect(channel.subscribersCount).toBeLessThanOrEqual(100000);
                }
            });

            console.log(`📊 Результат теста: найдено ${result.channels.length} каналов за ${result.processingTimeMs}мс`);
        }, 15000);

        test.skipIf(!shouldRunIntegrationTests)('должен корректно валидировать доступ к каналу', async () => {
            // Тестируем известный публичный канал
            const isAccessible = await parser.validateChannelAccessAsync('@telegram');
            expect(isAccessible).toBe(true);

            // Тестируем несуществующий канал
            const randomChannelName = `@nonexistent_channel_${Date.now()}`;
            const isNotAccessible = await parser.validateChannelAccessAsync(randomChannelName);
            expect(isNotAccessible).toBe(false);

            console.log('✅ Валидация доступа к каналам работает корректно');
        }, 10000);

        test.skipIf(!shouldRunIntegrationTests)('должен обрабатывать ошибки недоступных каналов', async () => {
            const options: ISimilarityParsingOptions = {
                sourceChannel: '@this_channel_definitely_does_not_exist_12345',
                limit: 5
            };

            await expect(parser.parseSimilarChannelsAsync(options))
                .rejects
                .toThrow(/не найден или недоступен/);

            console.log('✅ Обработка ошибок недоступных каналов работает корректно');
        }, 10000);

        test.skipIf(!shouldRunIntegrationTests)('должен работать с фильтрацией по подписчикам', async () => {
            const options: ISimilarityParsingOptions = {
                sourceChannel: '@telegram',
                limit: 10,
                minSubscribers: 1000,
                maxSubscribers: 50000
            };

            const result = await parser.parseSimilarChannelsAsync(options);

            // Проверяем что все найденные каналы соответствуют фильтру
            result.channels.forEach(channel => {
                if (channel.subscribersCount) {
                    expect(channel.subscribersCount).toBeGreaterThanOrEqual(1000);
                    expect(channel.subscribersCount).toBeLessThanOrEqual(50000);
                }
            });

            console.log(`📊 Фильтрация работает: найдено ${result.channels.length} каналов с 1K-50K подписчиков`);
        }, 15000);
    });

    describe('Производительность и лимиты', () => {
        test.skipIf(!shouldRunIntegrationTests)('должен соблюдать лимиты времени выполнения', async () => {
            const startTime = Date.now();

            const options: ISimilarityParsingOptions = {
                sourceChannel: '@telegram',
                limit: 3,
                recursiveSearch: false
            };

            const result = await parser.parseSimilarChannelsAsync(options);
            const executionTime = Date.now() - startTime;

            // Базовый поиск не должен занимать больше 10 секунд
            expect(executionTime).toBeLessThan(10000);
            expect(result.processingTimeMs).toBeLessThan(10000);

            console.log(`⏱️ Время выполнения: ${executionTime}мс (внутреннее: ${result.processingTimeMs}мс)`);
        }, 15000);

        test.skipIf(!shouldRunIntegrationTests)('должен обрабатывать рекурсивный поиск с ограничением времени', async () => {
            const startTime = Date.now();

            const options: ISimilarityParsingOptions = {
                sourceChannel: '@telegram',
                limit: 5,
                recursiveSearch: true,
                maxDepth: 2 // Ограничиваем глубину для скорости
            };

            const result = await parser.parseSimilarChannelsAsync(options);
            const executionTime = Date.now() - startTime;

            // Рекурсивный поиск может занимать больше времени, но не более 30 секунд
            expect(executionTime).toBeLessThan(30000);
            expect(result.searchDepth).toBeGreaterThanOrEqual(1);
            expect(result.searchDepth).toBeLessThanOrEqual(2);

            console.log(`🔄 Рекурсивный поиск: ${result.channels.length} каналов за ${executionTime}мс, глубина ${result.searchDepth}`);
        }, 35000);
    });
});

/**
 * Утилита для запуска интеграционных тестов
 * Использование: RUN_INTEGRATION_TESTS=true npm test integration.test.ts
 */
export function runIntegrationTests() {
    if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
        console.log(`
🧪 Интеграционные тесты

Для запуска интеграционных тестов с реальным API:

1. Убедитесь что у вас настроен .env файл с API_ID и API_HASH
2. Запустите: RUN_INTEGRATION_TESTS=true npm test integration.test.ts

⚠️  ВНИМАНИЕ: Интеграционные тесты делают реальные запросы к Telegram API!
    `);
    }
} 