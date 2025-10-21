/**
 * Тесты для модуля парсинга похожих каналов
 * Следует стандартам компании согласно frontend-coding-standards.md
 */

import {
    ISimilarChannel,
    ISimilarityParsingOptions,
    ISimilarityParsingResult,
    IChannelSimilarityParser,
    ITelegramApiAdapter
} from '../interfaces';

/**
 * Мок адаптера Telegram API для тестирования
 */
class MockTelegramApiAdapter implements ITelegramApiAdapter {
    private p_mockChannels: Map<string, ISimilarChannel[]> = new Map();
    private p_unavailableChannels: Set<string> = new Set();

    /**
     * Настройка мок данных для канала
     */
    setMockChannelsForSource(_sourceChannel: string, _channels: ISimilarChannel[]): void {
        this.p_mockChannels.set(_sourceChannel.toLowerCase(), _channels);
    }

    /**
     * Добавление недоступного канала
     */
    addUnavailableChannel(_channelName: string): void {
        this.p_unavailableChannels.add(_channelName.toLowerCase());
    }

    async getChannelRecommendationsAsync(_channelName: string, _limit: number): Promise<any> {
        const normalizedName = _channelName.replace('@', '').toLowerCase();

        if (this.p_unavailableChannels.has(normalizedName)) {
            throw new Error(`Channel ${_channelName} not found`);
        }

        const mockChannels = this.p_mockChannels.get(normalizedName) || [];

        // Имитируем структуру ответа Telegram API
        return {
            chats: mockChannels.slice(0, _limit).map(channel => ({
                className: 'Channel',
                id: BigInt(channel.id),
                title: channel.title,
                username: channel.username,
                about: channel.description,
                participantsCount: channel.subscribersCount,
                verified: channel.isVerified
            }))
        };
    }

    async resolveChannelAsync(_channelName: string): Promise<any | null> {
        const normalizedName = _channelName.replace('@', '').toLowerCase();

        if (this.p_unavailableChannels.has(normalizedName)) {
            return null;
        }

        // Имитируем успешный резолв
        return {
            channelId: BigInt(Math.random() * 1000000),
            accessHash: BigInt(Math.random() * 1000000)
        };
    }
}

/**
 * Тестовые данные
 */
const createMockChannel = (_id: string, _username: string, _title: string): ISimilarChannel => ({
    id: _id,
    title: _title,
    username: _username,
    subscribersCount: Math.floor(Math.random() * 10000),
    isVerified: Math.random() > 0.8
});

/**
 * Группа тестов для парсера похожих каналов
 */
describe('ChannelSimilarityParser', () => {
    let mockApiAdapter: MockTelegramApiAdapter;
    let parser: IChannelSimilarityParser;

    beforeEach(() => {
        mockApiAdapter = new MockTelegramApiAdapter();
        // parser будет создан в конкретной реализации
    });

    describe('Валидация входных данных', () => {
        test('должен требовать sourceChannel', async () => {
            const options = {
                sourceChannel: ''
            } as ISimilarityParsingOptions;

            await expect(async () => {
                await parser.parseSimilarChannelsAsync(options);
            }).rejects.toThrow('sourceChannel обязателен');
        });

        test('должен валидировать лимит результатов', async () => {
            const options: ISimilarityParsingOptions = {
                sourceChannel: '@test_channel',
                limit: -1
            };

            await expect(async () => {
                await parser.parseSimilarChannelsAsync(options);
            }).rejects.toThrow('limit должен быть положительным числом');
        });

        test('должен валидировать maxDepth', async () => {
            const options: ISimilarityParsingOptions = {
                sourceChannel: '@test_channel',
                recursiveSearch: true,
                maxDepth: 0
            };

            await expect(async () => {
                await parser.parseSimilarChannelsAsync(options);
            }).rejects.toThrow('maxDepth должен быть больше 0');
        });
    });

    describe('Базовый поиск похожих каналов', () => {
        test('должен возвращать список похожих каналов', async () => {
            const mockChannels = [
                createMockChannel('1', 'similar1', 'Similar Channel 1'),
                createMockChannel('2', 'similar2', 'Similar Channel 2')
            ];

            mockApiAdapter.setMockChannelsForSource('test_channel', mockChannels);

            const options: ISimilarityParsingOptions = {
                sourceChannel: '@test_channel',
                limit: 10
            };

            const result = await parser.parseSimilarChannelsAsync(options);

            expect(result.channels).toHaveLength(2);
            expect(result.sourceChannel).toBe('@test_channel');
            expect(result.totalCount).toBe(2);
            expect(result.searchDepth).toBe(1);
            expect(result.processingTimeMs).toBeGreaterThan(0);
        });

        test('должен обрабатывать пустой результат', async () => {
            mockApiAdapter.setMockChannelsForSource('empty_channel', []);

            const options: ISimilarityParsingOptions = {
                sourceChannel: '@empty_channel'
            };

            const result = await parser.parseSimilarChannelsAsync(options);

            expect(result.channels).toHaveLength(0);
            expect(result.totalCount).toBe(0);
        });

        test('должен ограничивать результаты по лимиту', async () => {
            const mockChannels = Array.from({ length: 20 }, (_, i) =>
                createMockChannel(String(i), `channel${i}`, `Channel ${i}`)
            );

            mockApiAdapter.setMockChannelsForSource('popular_channel', mockChannels);

            const options: ISimilarityParsingOptions = {
                sourceChannel: '@popular_channel',
                limit: 5
            };

            const result = await parser.parseSimilarChannelsAsync(options);

            expect(result.channels).toHaveLength(5);
            expect(result.totalCount).toBe(5);
        });
    });

    describe('Рекурсивный поиск', () => {
        test('должен выполнять рекурсивный поиск', async () => {
            // Настраиваем мок данные для рекурсивного поиска
            const level1Channels = [
                createMockChannel('1', 'level1_1', 'Level 1 Channel 1'),
                createMockChannel('2', 'level1_2', 'Level 1 Channel 2')
            ];

            const level2Channels = [
                createMockChannel('3', 'level2_1', 'Level 2 Channel 1'),
                createMockChannel('4', 'level2_2', 'Level 2 Channel 2')
            ];

            mockApiAdapter.setMockChannelsForSource('source_channel', level1Channels);
            mockApiAdapter.setMockChannelsForSource('level1_1', level2Channels);
            mockApiAdapter.setMockChannelsForSource('level1_2', []);

            const options: ISimilarityParsingOptions = {
                sourceChannel: '@source_channel',
                recursiveSearch: true,
                maxDepth: 2,
                limit: 10
            };

            const result = await parser.parseSimilarChannelsAsync(options);

            expect(result.channels.length).toBeGreaterThan(2); // Должны быть каналы с обеих уровней
            expect(result.searchDepth).toBe(2);

            // Проверяем, что есть каналы с разной глубиной поиска
            const depthLevels = [...new Set(result.channels.map(c => c.searchDepth))];
            expect(depthLevels.length).toBeGreaterThan(1);
        });

        test('должен останавливаться на maxDepth', async () => {
            const channels = [createMockChannel('1', 'recursive_channel', 'Recursive Channel')];

            // Настраиваем бесконечную рекурсию
            mockApiAdapter.setMockChannelsForSource('source_channel', channels);
            mockApiAdapter.setMockChannelsForSource('recursive_channel', channels);

            const options: ISimilarityParsingOptions = {
                sourceChannel: '@source_channel',
                recursiveSearch: true,
                maxDepth: 3,
                limit: 100
            };

            const result = await parser.parseSimilarChannelsAsync(options);

            expect(result.searchDepth).toBe(3);
            // Не должно быть бесконечной рекурсии
            expect(result.channels.length).toBeLessThan(50);
        });
    });

    describe('Удаление дубликатов', () => {
        test('должен удалять дубликаты по ID', async () => {
            const channelsWithDuplicates = [
                createMockChannel('1', 'channel1', 'Channel 1'),
                createMockChannel('1', 'channel1_dup', 'Channel 1 Duplicate'), // Тот же ID
                createMockChannel('2', 'channel2', 'Channel 2')
            ];

            mockApiAdapter.setMockChannelsForSource('test_channel', channelsWithDuplicates);

            const options: ISimilarityParsingOptions = {
                sourceChannel: '@test_channel',
                removeDuplicates: true
            };

            const result = await parser.parseSimilarChannelsAsync(options);

            expect(result.channels).toHaveLength(2);
            expect(result.duplicatesRemoved).toBe(1);
        });

        test('должен удалять дубликаты по username', async () => {
            const channelsWithDuplicates = [
                createMockChannel('1', 'same_username', 'Channel 1'),
                createMockChannel('2', 'same_username', 'Channel 2'), // Тот же username
                createMockChannel('3', 'different_username', 'Channel 3')
            ];

            mockApiAdapter.setMockChannelsForSource('test_channel', channelsWithDuplicates);

            const options: ISimilarityParsingOptions = {
                sourceChannel: '@test_channel',
                removeDuplicates: true
            };

            const result = await parser.parseSimilarChannelsAsync(options);

            expect(result.channels).toHaveLength(2);
            expect(result.duplicatesRemoved).toBe(1);
        });

        test('не должен удалять дубликаты если removeDuplicates = false', async () => {
            const channelsWithDuplicates = [
                createMockChannel('1', 'channel1', 'Channel 1'),
                createMockChannel('1', 'channel1', 'Channel 1 Duplicate')
            ];

            mockApiAdapter.setMockChannelsForSource('test_channel', channelsWithDuplicates);

            const options: ISimilarityParsingOptions = {
                sourceChannel: '@test_channel',
                removeDuplicates: false
            };

            const result = await parser.parseSimilarChannelsAsync(options);

            expect(result.channels).toHaveLength(2);
            expect(result.duplicatesRemoved).toBe(0);
        });
    });

    describe('Обработка ошибок', () => {
        test('должен обрабатывать недоступный канал', async () => {
            mockApiAdapter.addUnavailableChannel('unavailable_channel');

            const options: ISimilarityParsingOptions = {
                sourceChannel: '@unavailable_channel'
            };

            await expect(async () => {
                await parser.parseSimilarChannelsAsync(options);
            }).rejects.toThrow('Канал @unavailable_channel не найден или недоступен');
        });

        test('должен обрабатывать ошибки API', async () => {
            // Мокаем ошибку API
            jest.spyOn(mockApiAdapter, 'getChannelRecommendationsAsync')
                .mockRejectedValueOnce(new Error('API Error'));

            const options: ISimilarityParsingOptions = {
                sourceChannel: '@error_channel'
            };

            await expect(async () => {
                await parser.parseSimilarChannelsAsync(options);
            }).rejects.toThrow('Ошибка получения рекомендаций');
        });
    });

    describe('Валидация доступа к каналу', () => {
        test('должен возвращать true для доступного канала', async () => {
            mockApiAdapter.setMockChannelsForSource('available_channel', []);

            const isAvailable = await parser.validateChannelAccessAsync('@available_channel');

            expect(isAvailable).toBe(true);
        });

        test('должен возвращать false для недоступного канала', async () => {
            mockApiAdapter.addUnavailableChannel('unavailable_channel');

            const isAvailable = await parser.validateChannelAccessAsync('@unavailable_channel');

            expect(isAvailable).toBe(false);
        });
    });
});

/**
 * Интеграционные тесты с реальным API (опционально)
 */
describe('ChannelSimilarityParser Integration Tests', () => {
    // Эти тесты можно запускать только при наличии реального Telegram клиента
    // и только в development среде

    test.skip('должен работать с реальным API', async () => {
        // Реальный тест с настоящим Telegram API
        // Запускается только вручную для проверки интеграции
    });
}); 