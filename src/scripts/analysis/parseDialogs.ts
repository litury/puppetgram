#!/usr/bin/env ts-node

/**
 * Скрипт для парсинга диалогов пользователя
 * Интерактивный выбор чатов, фильтров и экспорта
 */

import readline from 'readline';
import { TelegramClient } from 'telegram';
import { DialogParserService } from '../modules/dialogParser/services/dialogParserService';
import {
    IDialogParseOptions,
    IDialogFilters,
    IDialogExportConfig,
    IChatInfo,
    IChatParseOptions,
    IExportConfig,
    IUserInChatParseOptions
} from '../modules/dialogParser/interfaces';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
};

async function main() {
    console.log('🗨️ === ПАРСЕР ДИАЛОГОВ ПОЛЬЗОВАТЕЛЯ ===\n');

    let client: TelegramClient;

    try {
        // 1. Подключение к Telegram (упрощенная версия)
        console.log('🔐 Инициализация Telegram клиента...');

        // Импортируем GramClient для подключения
        const { GramClient } = await import('../telegram/adapters/gramClient');
        const gramClient = new GramClient();
        await gramClient.connect();
        client = gramClient.getClient();

        console.log('✅ Telegram клиент подключен\n');

        // 2. Создание сервиса
        const parserService = new DialogParserService(client);

        // 3. Получение информации о пользователе
        const currentUser = await client.getMe();
        const fullName = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim();
        console.log(`👤 Текущий пользователь: ${fullName} (@${currentUser.username}, ID: ${currentUser.id})\n`);

        // 4. Выбор режима работы
        console.log('📋 === РЕЖИМ РАБОТЫ ===');
        console.log('1. Быстрый экспорт (последние 1000 сообщений)');
        console.log('2. Настраиваемый экспорт (выбор чатов и фильтров)');
        console.log('3. Просмотр списка чатов');
        console.log('4. Парсинг всех пользователей чата по ID');
        console.log('5. Парсинг конкретного пользователя в чате');

        const modeChoice = await question('\nВыберите режим (1-5): ');

        if (modeChoice === '3') {
            await showChatsList(parserService);
            return;
        }

        if (modeChoice === '4') {
            await parseChatUsers(parserService);
            return;
        }

        if (modeChoice === '5') {
            await parseUserInChat(parserService);
            return;
        }

        let options: IDialogParseOptions;

        if (modeChoice === '1') {
            options = await createQuickExportOptions();
        } else if (modeChoice === '2') {
            options = await createCustomExportOptions(parserService);
        } else {
            console.log('❌ Неверный выбор');
            return;
        }

        // 5. Подтверждение настроек
        console.log('\n📋 === НАСТРОЙКИ ЭКСПОРТА ===');
        console.log(`📅 Период: ${options.filters.dateFrom?.toLocaleDateString() || 'начало'} - ${options.filters.dateTo?.toLocaleDateString() || 'сегодня'}`);
        console.log(`💬 Мин. длина сообщения: ${options.filters.minMessageLength || 'любая'}`);
        console.log(`📱 Типы чатов: ${getSelectedChatTypes(options)}`);
        console.log(`📄 Форматы: ${options.exportConfig.formats.join(', ')}`);
        console.log(`🔢 Лимит: ${options.limit || 'без ограничений'}`);

        const confirm = await question('\nНачать парсинг? (y/n): ');
        if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
            console.log('❌ Отменено пользователем');
            return;
        }

        // 6. Парсинг
        console.log('\n🚀 Начинаю парсинг...');
        const result = await parserService.parseUserDialogsAsync(options);

        // 7. Экспорт
        console.log('\n📤 Экспортирую результаты...');
        const exportedFiles = await parserService.exportDialogsAsync(result);

        // 8. Результат
        console.log('\n🎉 === ПАРСИНГ ЗАВЕРШЕН ===');
        console.log(`💬 Найдено сообщений: ${result.totalMessages}`);
        console.log(`📂 Активных чатов: ${result.totalChats}`);
        console.log(`📅 Период: ${result.dateRange.from.toLocaleDateString()} - ${result.dateRange.to.toLocaleDateString()}`);
        console.log(`📁 Экспортировано файлов: ${exportedFiles.length}`);
        console.log(`📍 Путь: ${result.exportPath}`);

    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        rl.close();
    }
}

/**
 * Создает опции для быстрого экспорта
 */
async function createQuickExportOptions(): Promise<IDialogParseOptions> {
    console.log('\n⚡ === БЫСТРЫЙ ЭКСПОРТ ===');
    console.log('Последние 1000 сообщений из всех чатов');

    const filters: IDialogFilters = {
        minMessageLength: 5, // Минимум 5 символов
        excludeForwarded: true,
        excludeMedia: false
    };

    const exportConfig: IDialogExportConfig = {
        formats: ['json', 'txt'],
        includeMetadata: true,
        groupByChats: true,
        sortBy: 'date',
        sortOrder: 'desc'
    };

    return {
        filters,
        exportConfig,
        includePrivateChats: true,
        includeGroups: true,
        includeSupergroups: true,
        includeChannels: false, // В каналах обычно пользователь не пишет
        limit: 1000
    };
}

/**
 * Создает опции для настраиваемого экспорта
 */
async function createCustomExportOptions(_parserService: DialogParserService): Promise<IDialogParseOptions> {
    console.log('\n⚙️ === НАСТРАИВАЕМЫЙ ЭКСПОРТ ===');

    // 1. Получаем список чатов
    console.log('📋 Получаю список чатов...');
    const allChats = await _parserService.getUserChatsAsync();
    console.log(`✅ Найдено ${allChats.length} чатов\n`);

    // 2. Фильтры по датам
    const filters = await createDateFilters();

    // 3. Выбор типов чатов
    const chatTypeOptions = await selectChatTypes();

    // 4. Дополнительные фильтры
    const additionalFilters = await createAdditionalFilters();

    // 5. Конфигурация экспорта
    const exportConfig = await createExportConfig();

    // 6. Лимит сообщений
    const limitStr = await question('Максимум сообщений (Enter = без ограничений): ');
    const limit = limitStr ? parseInt(limitStr) : undefined;

    return {
        filters: { ...filters, ...additionalFilters },
        exportConfig,
        ...chatTypeOptions,
        limit
    };
}

/**
 * Создает фильтры по датам
 */
async function createDateFilters(): Promise<Partial<IDialogFilters>> {
    console.log('\n📅 === ФИЛЬТРЫ ПО ДАТЕ ===');

    const dateFromStr = await question('Дата начала (YYYY-MM-DD, Enter = с начала): ');
    const dateToStr = await question('Дата окончания (YYYY-MM-DD, Enter = до сегодня): ');

    const filters: Partial<IDialogFilters> = {};

    if (dateFromStr) {
        filters.dateFrom = new Date(dateFromStr);
    }

    if (dateToStr) {
        filters.dateTo = new Date(dateToStr);
    }

    return filters;
}

/**
 * Выбор типов чатов
 */
async function selectChatTypes(): Promise<{
    includePrivateChats: boolean;
    includeGroups: boolean;
    includeSupergroups: boolean;
    includeChannels: boolean;
}> {
    console.log('\n💬 === ТИПЫ ЧАТОВ ===');

    const privateAnswer = await question('Включить приватные чаты? (y/n): ');
    const groupAnswer = await question('Включить группы? (y/n): ');
    const supergroupAnswer = await question('Включить супергруппы? (y/n): ');
    const channelAnswer = await question('Включить каналы? (y/n): ');

    return {
        includePrivateChats: privateAnswer.toLowerCase() === 'y',
        includeGroups: groupAnswer.toLowerCase() === 'y',
        includeSupergroups: supergroupAnswer.toLowerCase() === 'y',
        includeChannels: channelAnswer.toLowerCase() === 'y'
    };
}

/**
 * Создает дополнительные фильтры
 */
async function createAdditionalFilters(): Promise<Partial<IDialogFilters>> {
    console.log('\n🔍 === ДОПОЛНИТЕЛЬНЫЕ ФИЛЬТРЫ ===');

    const minLengthStr = await question('Минимальная длина сообщения (Enter = любая): ');
    const excludeMedia = await question('Исключить сообщения с медиа? (y/n): ');

    const filters: Partial<IDialogFilters> = {};

    if (minLengthStr) {
        filters.minMessageLength = parseInt(minLengthStr);
    }

    if (excludeMedia.toLowerCase() === 'y') {
        filters.excludeMedia = true;
    }

    return filters;
}

/**
 * Создает конфигурацию экспорта
 */
async function createExportConfig(): Promise<IDialogExportConfig> {
    console.log('\n📤 === НАСТРОЙКИ ЭКСПОРТА ===');

    // Форматы
    console.log('Доступные форматы:');
    console.log('1. JSON (детальная информация)');
    console.log('2. TXT (читаемый текст)');
    console.log('3. CSV (табличные данные)');

    const formatsStr = await question('Выберите форматы (1,2,3): ');
    const formatChoices = formatsStr.split(',').map(s => s.trim());

    const formats: ('json' | 'txt' | 'csv')[] = [];
    if (formatChoices.includes('1')) formats.push('json');
    if (formatChoices.includes('2')) formats.push('txt');
    if (formatChoices.includes('3')) formats.push('csv');

    if (formats.length === 0) formats.push('json'); // По умолчанию JSON

    // Сортировка
    const sortChoice = await question('Сортировка (1-дата, 2-чаты, 3-длина): ');
    let sortBy: 'date' | 'chat' | 'length' = 'date';

    switch (sortChoice) {
        case '2': sortBy = 'chat'; break;
        case '3': sortBy = 'length'; break;
        default: sortBy = 'date'; break;
    }

    const orderChoice = await question('Порядок сортировки (asc/desc): ');
    const sortOrder: 'asc' | 'desc' = orderChoice.toLowerCase() === 'desc' ? 'desc' : 'asc';

    // Группировка
    const groupByChats = await question('Группировать по чатам в TXT? (y/n): ');

    return {
        formats,
        includeMetadata: true,
        groupByChats: groupByChats.toLowerCase() === 'y',
        sortBy,
        sortOrder
    };
}

/**
 * Показывает список чатов пользователя
 */
async function showChatsList(_parserService: DialogParserService): Promise<void> {
    console.log('\n📋 === СПИСОК ЧАТОВ ===');

    try {
        const chats = await _parserService.getUserChatsAsync();

        console.log(`\n✅ Найдено ${chats.length} чатов:\n`);

        const grouped = {
            private: chats.filter(c => c.type === 'private'),
            group: chats.filter(c => c.type === 'group'),
            supergroup: chats.filter(c => c.type === 'supergroup'),
            channel: chats.filter(c => c.type === 'channel')
        };

        Object.entries(grouped).forEach(([type, typeChats]) => {
            if (typeChats.length > 0) {
                console.log(`\n📱 ${type.toUpperCase()} (${typeChats.length}):`);
                typeChats.slice(0, 10).forEach(chat => {
                    const lastActivity = chat.lastMessageDate
                        ? chat.lastMessageDate.toLocaleDateString()
                        : 'неизвестно';
                    console.log(`  • ${chat.title} ${chat.username ? `(@${chat.username})` : ''} - ${lastActivity}`);
                });

                if (typeChats.length > 10) {
                    console.log(`  ... и еще ${typeChats.length - 10} чатов`);
                }
            }
        });

    } catch (error) {
        console.error('❌ Ошибка получения чатов:', error);
    }
}

/**
 * Возвращает строку с выбранными типами чатов
 */
function getSelectedChatTypes(_options: IDialogParseOptions): string {
    const types: string[] = [];
    if (_options.includePrivateChats) types.push('приватные');
    if (_options.includeGroups) types.push('группы');
    if (_options.includeSupergroups) types.push('супергруппы');
    if (_options.includeChannels) types.push('каналы');
    return types.join(', ') || 'нет';
}

/**
 * Парсит всех пользователей конкретного чата
 */
async function parseChatUsers(_parserService: DialogParserService): Promise<void> {
    console.log('\n🎯 === ПАРСИНГ ПОЛЬЗОВАТЕЛЕЙ ЧАТА ===');

    // 1. Запрашиваем ID чата
    const chatId = await question('Введите ID чата (например, 1955908022): ');
    if (!chatId) {
        console.log('❌ ID чата не указан');
        return;
    }

    // 2. Фильтры по датам
    console.log('\n📅 === ФИЛЬТРЫ ПО ДАТЕ ===');
    const dateFromStr = await question('Дата начала (YYYY-MM-DD, Enter = с начала): ');
    const dateToStr = await question('Дата окончания (YYYY-MM-DD, Enter = до сегодня): ');

    const filters: IDialogFilters = {};
    if (dateFromStr) filters.dateFrom = new Date(dateFromStr);
    if (dateToStr) filters.dateTo = new Date(dateToStr);

    // 3. Дополнительные фильтры
    console.log('\n🔍 === ДОПОЛНИТЕЛЬНЫЕ ФИЛЬТРЫ ===');
    const minLengthStr = await question('Минимальная длина сообщения (Enter = любая): ');
    const minMessagesStr = await question('Минимум сообщений от пользователя (Enter = 1): ');
    const excludeBots = await question('Исключить ботов? (y/n): ');
    const limitStr = await question('Максимум сообщений (Enter = без ограничений): ');

    if (minLengthStr) filters.minMessageLength = parseInt(minLengthStr);

    // 4. Конфигурация экспорта
    console.log('\n📤 === НАСТРОЙКИ ЭКСПОРТА ===');
    console.log('Доступные форматы:');
    console.log('1. JSON (детальная информация)');
    console.log('2. TXT (читаемый текст)');
    console.log('3. CSV (табличные данные)');

    const formatsStr = await question('Выберите форматы (1,2,3): ');
    const formatChoices = formatsStr.split(',').map(s => s.trim());

    const formats: ('json' | 'txt' | 'csv')[] = [];
    if (formatChoices.includes('1')) formats.push('json');
    if (formatChoices.includes('2')) formats.push('txt');
    if (formatChoices.includes('3')) formats.push('csv');

    if (formats.length === 0) formats.push('json');

    const exportByUsers = await question('Создавать отдельные файлы для каждого пользователя? (y/n): ');

    const exportConfig: IDialogExportConfig = {
        formats,
        includeMetadata: true,
        groupByChats: false,
        sortBy: 'date',
        sortOrder: 'desc',
        exportByUsers: exportByUsers.toLowerCase() === 'y'
    };

    const options: IChatParseOptions = {
        chatId,
        filters,
        exportConfig,
        limit: limitStr ? parseInt(limitStr) : undefined,
        minMessagesPerUser: minMessagesStr ? parseInt(minMessagesStr) : 1,
        excludeBots: excludeBots.toLowerCase() === 'y',
        exportByUsers: exportByUsers.toLowerCase() === 'y'
    };

    // 5. Подтверждение настроек
    console.log('\n📋 === НАСТРОЙКИ ПАРСИНГА ЧАТА ===');
    console.log(`🎯 ID чата: ${options.chatId}`);
    console.log(`📅 Период: ${filters.dateFrom?.toLocaleDateString() || 'начало'} - ${filters.dateTo?.toLocaleDateString() || 'сегодня'}`);
    console.log(`💬 Мин. длина сообщения: ${filters.minMessageLength || 'любая'}`);
    console.log(`👥 Мин. сообщений от пользователя: ${options.minMessagesPerUser}`);
    console.log(`🤖 Исключить ботов: ${options.excludeBots ? 'да' : 'нет'}`);
    console.log(`📄 Форматы: ${formats.join(', ')}`);
    console.log(`📁 Отдельные файлы: ${options.exportByUsers ? 'да' : 'нет'}`);
    console.log(`🔢 Лимит: ${options.limit || 'без ограничений'}`);

    const confirm = await question('\nНачать парсинг чата? (y/n): ');
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
        console.log('❌ Отменено пользователем');
        return;
    }

    try {
        // 6. Парсинг
        console.log('\n🚀 Начинаю парсинг чата...');
        const result = await _parserService.parseChatUsersAsync(options);

        // 7. Экспорт
        console.log('\n📤 Экспортирую результаты...');
        const exportedFiles = await _parserService.exportChatUsersAsync(result);

        // 8. Результат
        console.log('\n🎉 === ПАРСИНГ ЧАТА ЗАВЕРШЕН ===');
        console.log(`💬 Найдено сообщений: ${result.totalMessages}`);
        console.log(`👥 Активных пользователей: ${result.totalUsers}`);
        console.log(`📅 Период: ${result.dateRange.from.toLocaleDateString()} - ${result.dateRange.to.toLocaleDateString()}`);
        console.log(`📁 Экспортировано файлов: ${exportedFiles.length}`);
        console.log(`📍 Путь: ${result.exportPath}`);

    } catch (error) {
        console.error('❌ Ошибка парсинга чата:', error);
    }
}

/**
 * Парсит конкретного пользователя в конкретном чате
 */
async function parseUserInChat(_parserService: DialogParserService): Promise<void> {
    console.log('\n🎯 === ПАРСИНГ ПОЛЬЗОВАТЕЛЯ В ЧАТЕ ===');

    // 1. Запрашиваем ID чата
    const chatId = await question('Введите ID чата (например, 1955908022): ');
    if (!chatId) {
        console.log('❌ ID чата не указан');
        return;
    }

    // 2. Выбор способа поиска пользователя
    console.log('\n👤 === ПОИСК ПОЛЬЗОВАТЕЛЯ ===');
    console.log('1. По ID пользователя');
    console.log('2. По username (@username)');
    console.log('3. По имени или фамилии');

    const searchType = await question('Как искать пользователя? (1-3): ');

    let targetUserId: number | undefined;
    let targetUsername: string | undefined;
    let targetName: string | undefined;

    switch (searchType) {
        case '1':
            const userIdStr = await question('Введите ID пользователя (например, 123456789): ');
            if (!userIdStr) {
                console.log('❌ ID пользователя не указан');
                return;
            }
            targetUserId = parseInt(userIdStr);
            break;
        case '2':
            targetUsername = await question('Введите username (без @, например: username): ');
            if (!targetUsername) {
                console.log('❌ Username не указан');
                return;
            }
            break;
        case '3':
            targetName = await question('Введите имя или фамилию для поиска: ');
            if (!targetName) {
                console.log('❌ Имя не указано');
                return;
            }
            break;
        default:
            console.log('❌ Неверный выбор');
            return;
    }

    // 3. Фильтры по датам
    console.log('\n📅 === ФИЛЬТРЫ ПО ДАТЕ ===');
    const dateFromStr = await question('Дата начала (YYYY-MM-DD, Enter = с начала): ');
    const dateToStr = await question('Дата окончания (YYYY-MM-DD, Enter = до сегодня): ');

    const filters: IDialogFilters = {};
    if (dateFromStr) filters.dateFrom = new Date(dateFromStr);
    if (dateToStr) filters.dateTo = new Date(dateToStr);

    // 4. Дополнительные фильтры
    console.log('\n🔍 === ДОПОЛНИТЕЛЬНЫЕ ФИЛЬТРЫ ===');
    const minLengthStr = await question('Минимальная длина сообщения (Enter = любая): ');
    const limitStr = await question('Максимум сообщений (Enter = без ограничений): ');

    if (minLengthStr) filters.minMessageLength = parseInt(minLengthStr);

    // 5. Конфигурация экспорта
    console.log('\n📤 === НАСТРОЙКИ ЭКСПОРТА ===');
    console.log('Доступные форматы:');
    console.log('1. JSON (детальная информация)');
    console.log('2. TXT (читаемый текст)');
    console.log('3. CSV (табличные данные)');

    const formatsStr = await question('Выберите форматы (1,2,3): ');
    const formatChoices = formatsStr.split(',').map(s => s.trim());

    const formats: ('json' | 'txt' | 'csv')[] = [];
    if (formatChoices.includes('1')) formats.push('json');
    if (formatChoices.includes('2')) formats.push('txt');
    if (formatChoices.includes('3')) formats.push('csv');

    if (formats.length === 0) formats.push('json');

    const exportConfig: IExportConfig = {
        formats,
        includeMetadata: true,
        groupByChats: false,
        sortBy: 'date',
        sortOrder: 'desc'
    };

    const options: IUserInChatParseOptions = {
        chatId,
        targetUserId,
        targetUsername,
        targetName,
        filters,
        exportConfig,
        limit: limitStr ? parseInt(limitStr) : undefined
    };

    // 6. Подтверждение настроек
    console.log('\n📋 === НАСТРОЙКИ ПАРСИНГА ПОЛЬЗОВАТЕЛЯ В ЧАТЕ ===');
    console.log(`🎯 ID чата: ${options.chatId}`);
    if (targetUserId) console.log(`👤 ID пользователя: ${targetUserId}`);
    if (targetUsername) console.log(`👤 Username: @${targetUsername}`);
    if (targetName) console.log(`👤 Имя для поиска: ${targetName}`);
    console.log(`📅 Период: ${filters.dateFrom?.toLocaleDateString() || 'начало'} - ${filters.dateTo?.toLocaleDateString() || 'сегодня'}`);
    console.log(`💬 Мин. длина сообщения: ${filters.minMessageLength || 'любая'}`);
    console.log(`📄 Форматы: ${formats.join(', ')}`);
    console.log(`🔢 Лимит: ${options.limit || 'без ограничений'}`);

    const confirm = await question('\nНачать парсинг пользователя в чате? (y/n): ');
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
        console.log('❌ Отменено пользователем');
        return;
    }

    try {
        // 7. Парсинг
        console.log('\n🚀 Начинаю парсинг пользователя в чате...');
        const result = await _parserService.parseUserInChatAsync(options);

        // 8. Экспорт
        console.log('\n📤 Экспортирую результаты...');
        const exportedFiles = await _parserService.exportUserInChatAsync(result);

        // 9. Результат
        console.log('\n🎉 === ПАРСИНГ ПОЛЬЗОВАТЕЛЯ В ЧАТЕ ЗАВЕРШЕН ===');
        console.log(`💬 Найдено сообщений: ${result.totalMessages}`);
        console.log(`👤 Пользователь: ${result.targetUser.fullName} (@${result.targetUser.username || 'no_username'})`);
        console.log(`📅 Период: ${result.dateRange.from.toLocaleDateString()} - ${result.dateRange.to.toLocaleDateString()}`);
        console.log(`📁 Экспортировано файлов: ${exportedFiles.length}`);
        console.log(`📍 Путь: ${result.exportPath}`);

    } catch (error) {
        console.error('❌ Ошибка парсинга пользователя в чате:', error);
    }
}

// Запуск скрипта
if (require.main === module) {
    main().catch(console.error);
} 