/**
 * Упрощенный скрипт для парсинга похожих каналов Telegram
 * Использует единую базу для фильтрации дубликатов
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { SimpleSimilarityParserService } from '../../app/similarityParser/services/simpleSimilarityParserService';
import { createStopMessage, analyzeFloodWaitError } from '../../shared/utils/floodWaitHandler';
import { EnvAccountsParser } from '../../shared/utils/envAccountsParser';
import prompts from 'prompts';

/**
 * Выбор аккаунта для парсинга
 */
async function selectAccount(): Promise<TelegramClient> {
    const accountsParser = new EnvAccountsParser();
    const accounts = accountsParser.getAvailableAccounts();

    if (accounts.length === 0) {
        throw new Error('Не найдено аккаунтов в .env файле');
    }

    console.log('🔐 Выбор аккаунта для парсинга...\n');

    const response = await prompts({
        type: 'select',
        name: 'account',
        message: 'Выберите аккаунт для парсинга:',
        choices: accounts.map(acc => ({
            title: `${acc.name} ${acc.username ? `@${acc.username}` : ''}`,
            value: acc
        }))
    });

    if (!response.account) {
        throw new Error('Аккаунт не выбран');
    }

    const client = new TelegramClient(
        new StringSession(response.account.session || ''),
        response.account.apiId || 0,
        response.account.apiHash || '',
        { connectionRetries: 5 }
    );

    console.log('Подключение к Telegram...');
    await client.connect();
    console.log(`✅ Выбран аккаунт: ${response.account.name}\n`);

    return client;
}

/**
 * Главная функция скрипта
 */
async function main(): Promise<void> {
    let client: TelegramClient | null = null;

    try {
        // Выбор аккаунта
        client = await selectAccount();

        console.log('🎯 === ПРОСТОЙ ПАРСЕР ПОХОЖИХ КАНАЛОВ ===');
        console.log('📊 С автоматической фильтрацией дубликатов\n');

        const parser = new SimpleSimilarityParserService(client);

        // Получение параметров от пользователя (всего 2 вопроса!)
        const options = await getOptions();
        if (!options) {
            console.log('❌ Операция отменена');
            return;
        }

        // Проверка доступа к каналу
        console.log(`\n🔍 Проверка доступа к каналу @${options.sourceChannel}...`);
        const isAccessible = await parser.validateChannelAccess(options.sourceChannel);

        if (!isAccessible) {
            console.error(`\n❌ Канал @${options.sourceChannel} недоступен`);
            console.log('💡 Возможные причины:');
            console.log('   - Неправильно указано имя канала');
            console.log('   - Канал приватный или не существует');
            return;
        }

        console.log('✅ Канал доступен\n');

        // Выполнение парсинга
        const result = await parser.parseSimilarChannels(options);

        // Вывод результатов
        console.log('\n📊 === РЕЗУЛЬТАТЫ ===');
        console.log(`✅ Новых каналов найдено: ${result.newChannels}`);
        console.log(`🔄 Всего обработано: ${result.totalFound}`);
        console.log(`🚫 Дубликатов отфильтровано: ${result.duplicatesFiltered}`);
        console.log(`⏱️ Время выполнения: ${Math.round(result.processingTimeMs / 1000)}с`);

        // Показываем первые результаты
        if (result.channels.length > 0) {
            console.log('\n📝 Первые 10 найденных каналов:');
            result.channels.slice(0, 10).forEach((channel, index) => {
                console.log(`${index + 1}. ${channel}`);
            });

            if (result.channels.length > 10) {
                console.log(`... и еще ${result.channels.length - 10} каналов`);
            }
        }

    } catch (error: any) {
        const floodAnalysis = analyzeFloodWaitError(error);
        if (floodAnalysis.isFloodWait && floodAnalysis.shouldStop) {
            console.error('\n' + createStopMessage(floodAnalysis.seconds, 'ПАРСЕР'));
            console.error(`💡 Перезапустите через ${floodAnalysis.hours} часов`);
            throw error;
        } else {
            console.error('❌ Ошибка:', error.message);
        }
    } finally {
        if (client) {
            await client.disconnect();
        }
        console.log('\n👋 Работа завершена');
    }
}

/**
 * Получение опций от пользователя (упрощенная версия)
 */
async function getOptions() {
    try {
        const responses = await prompts([
            {
                type: 'text',
                name: 'sourceChannel',
                message: 'Введите канал для поиска похожих (например, @channel или channel):',
                validate: (value: string) => value.trim().length > 0 || 'Введите имя канала'
            },
            {
                type: 'number',
                name: 'targetCount',
                message: 'Сколько новых каналов найти:',
                initial: 100,
                min: 1,
                max: 1000,
                validate: (value: number) => value > 0 || 'Введите число больше 0'
            }
        ]);

        if (!responses.sourceChannel || !responses.targetCount) {
            return null;
        }

        // Нормализуем имя канала
        const sourceChannel = responses.sourceChannel.trim().replace(/^@/, '');

        return {
            sourceChannel,
            targetCount: responses.targetCount
        };

    } catch (error) {
        console.error('Ошибка ввода:', error);
        return null;
    }
}

/**
 * Обработка ошибок процесса
 */
process.on('unhandledRejection', (reason, promise) => {
    console.error('Необработанная ошибка:', reason);
    process.exit(1);
});

// Запуск скрипта
if (require.main === module) {
    main().catch((error) => {
        const floodAnalysis = analyzeFloodWaitError(error);
        if (floodAnalysis.isFloodWait && floodAnalysis.shouldStop) {
            console.error('\n' + createStopMessage(floodAnalysis.seconds, 'ПАРСЕР'));
            process.exit(2);
        } else {
            console.error('Критическая ошибка:', error);
            process.exit(1);
        }
    });
}