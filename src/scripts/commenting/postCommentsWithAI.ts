#!/usr/bin/env node

/**
 * Реальное AI комментирование с выбором источника каналов
 * Поддерживает JSON прогресс файлы, TXT списки и интерактивный выбор
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';

import { GramClient } from '../../telegram/adapters/gramClient';
import { CommentPosterService } from '../../app/commentPoster/services/commentPosterService';
import { AICommentGeneratorService } from '../../app/aiCommentGenerator/services/aiCommentGeneratorService';
import { DEFAULT_AI_CONFIG } from '../../config/aiConfig';
import {
    ICommentTarget,
    ICommentTargetWithCache,
    ICommentMessage,
    ICommentingOptionsWithAI,
    ICommentingResponseWithAI,
    IUserChannel
} from '../../app/commentPoster/interfaces';

// Интерфейс для работы с консолью
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function main() {
    console.log('🤖 === AI КОММЕНТИРОВАНИЕ КАНАЛОВ ===\n');

    const gramClient = new GramClient();

    try {
        // 1. Инициализация Telegram клиента
        console.log('🔐 Инициализация Telegram клиента...');
        await gramClient.connect();
        const client = gramClient.getClient();
        console.log('✅ Telegram клиент подключен\n');

        // 2. Инициализация AI и CommentPoster
        const aiService = new AICommentGeneratorService(DEFAULT_AI_CONFIG);
        const commentPoster = new CommentPosterService(client);

        // Проверяем AI
        console.log('🤖 Проверяю AI сервис...');
        const aiAvailable = await aiService.checkHealthAsync();
        if (!aiAvailable) {
            console.log('❌ AI сервис недоступен. Будут использоваться шаблоны.');
        }

        // 3. Выбор источника каналов
        console.log('\n📂 === ВЫБОР ИСТОЧНИКА КАНАЛОВ ===');
        console.log('1. JSON файл прогресса (быстро, с кэшем)');
        console.log('2. TXT файл со списком каналов');
        console.log('3. Интерактивный ввод каналов');

        const sourceChoice = await question('\nВыберите источник (1-3): ');
        let targets: (ICommentTarget | ICommentTargetWithCache)[] = [];
        let sourceType: 'json' | 'txt' | 'interactive' = 'interactive';
        let jsonFilePath: string | undefined;

        switch (sourceChoice) {
            case '1':
                sourceType = 'json';
                const jsonResult = await loadFromJsonProgress(commentPoster);
                targets = jsonResult.channels;
                jsonFilePath = jsonResult.filePath;
                break;
            case '2':
                sourceType = 'txt';
                targets = await loadFromTxtFile();
                break;
            case '3':
                sourceType = 'interactive';
                targets = await interactiveChannelInput();
                break;
            default:
                console.log('❌ Неверный выбор');
                process.exit(1);
        }

        if (targets.length === 0) {
            console.log('❌ Нет каналов для комментирования');
            process.exit(1);
        }

        console.log(`✅ Загружено ${targets.length} каналов\n`);

        // 4. Настройка комментариев
        const messages = await setupCommentMessages();

        // 5. Выбор отправки от имени
        const sendAsOptions = await chooseSendAsOptions(commentPoster);

        // 6. Настройки сессии
        const sessionOptions = await setupSessionOptions();

        // 7. Запуск AI комментирования
        console.log('\n🚀 === ЗАПУСК AI КОММЕНТИРОВАНИЯ ===');

        const options: ICommentingOptionsWithAI = {
            targets: targets as ICommentTarget[],
            messages,
            useAI: aiAvailable,
            aiGenerator: aiService,
            delayBetweenTargets: sessionOptions.delayBetweenTargets,
            delayBetweenComments: sessionOptions.delayBetweenComments,
            maxCommentsPerSession: sessionOptions.maxComments,
            randomizeOrder: sessionOptions.randomizeOrder,
            skipRecentlyCommented: false,
            dryRun: sessionOptions.dryRun,
            sendAsOptions
        };

        console.log(`🎯 Целей: ${targets.length}`);
        console.log(`🤖 AI: ${aiAvailable ? 'Включен' : 'Шаблоны'}`);
        console.log(`🧪 Тест: ${sessionOptions.dryRun ? 'Да' : 'Нет'}`);
        console.log(`⏱️ Задержка: ${sessionOptions.delayBetweenTargets}мс\n`);

        const confirm = await question('Начать комментирование? (y/N): ');
        if (confirm.toLowerCase() !== 'y') {
            console.log('❌ Отменено пользователем');
            process.exit(0);
        }

        // Запускаем комментирование
        const result = await commentPoster.postCommentsWithAIAsync(options);

        // 8. Результаты
        console.log('\n📊 === РЕЗУЛЬТАТЫ ===');
        console.log(`✅ Успешно: ${result.successfulComments}`);
        console.log(`❌ Ошибок: ${result.failedComments}`);
        console.log(`🤖 AI успешных: ${result.aiSummary.successfulAIRequests}/${result.aiSummary.totalAIRequests}`);
        console.log(`⏭️ Пропущено: ${result.aiSummary.skippedPosts}`);
        console.log(`📈 Успешность: ${result.summary.successRate.toFixed(1)}%`);
        console.log(`⏱️ Время: ${Math.round(result.duration / 1000)}с`);

        // 9. Автоматическое удаление успешных каналов из JSON базы
        if (sourceType === 'json' && result.successfulComments > 0 && jsonFilePath) {
            await handleSuccessfulChannelRemoval(result, jsonFilePath);
        }

        console.log('\n🎉 Комментирование завершено!');

    } catch (error) {
        console.error('\n💥 Ошибка:', error);
        process.exit(1);
    } finally {
        await gramClient.disconnect();
        rl.close();
    }
}

/**
 * Загрузка каналов из JSON файла прогресса
 */
async function loadFromJsonProgress(commentPoster: CommentPosterService): Promise<{ channels: ICommentTargetWithCache[], filePath: string }> {
    const progressDir = './input-comment-targets';

    if (!fs.existsSync(progressDir)) {
        console.log('❌ Папка input-comment-targets не найдена');
        return { channels: [], filePath: '' };
    }

    const files = fs.readdirSync(progressDir)
        .filter(f => f.endsWith('.json'))
        .sort();

    if (files.length === 0) {
        console.log('❌ JSON файлы не найдены');
        return { channels: [], filePath: '' };
    }

    console.log('\n📁 Доступные JSON файлы:');
    files.forEach((file, index) => {
        console.log(`${index + 1}. ${file}`);
    });

    const fileChoice = await question('\nВыберите файл (номер): ');
    const fileIndex = parseInt(fileChoice) - 1;

    if (fileIndex < 0 || fileIndex >= files.length) {
        console.log('❌ Неверный номер файла');
        return { channels: [], filePath: '' };
    }

    const filePath = path.join(progressDir, files[fileIndex]);
    console.log(`📂 Загружаю: ${files[fileIndex]}`);

    const channels = await commentPoster.loadChannelsFromProgressFile(filePath);
    return { channels, filePath };
}

/**
 * Загрузка каналов из TXT файла
 */
async function loadFromTxtFile(): Promise<ICommentTarget[]> {
    const inputDir = './input-comment-targets';

    if (!fs.existsSync(inputDir)) {
        console.log('❌ Папка input-comment-targets не найдена');
        return [];
    }

    const files = fs.readdirSync(inputDir)
        .filter(f => f.endsWith('.txt'))
        .sort();

    if (files.length === 0) {
        console.log('❌ TXT файлы не найдены');
        return [];
    }

    console.log('\n📁 Доступные TXT файлы:');
    files.forEach((file, index) => {
        console.log(`${index + 1}. ${file}`);
    });

    const fileChoice = await question('\nВыберите файл (номер): ');
    const fileIndex = parseInt(fileChoice) - 1;

    if (fileIndex < 0 || fileIndex >= files.length) {
        console.log('❌ Неверный номер файла');
        return [];
    }

    const filePath = path.join(inputDir, files[fileIndex]);
    console.log(`📂 Загружаю: ${files[fileIndex]}`);

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));

    const targets: ICommentTarget[] = [];

    for (const line of lines) {
        // Поддерживаем разные форматы:
        // @channel
        // https://t.me/channel
        // channel
        let username = line;

        if (line.startsWith('https://t.me/')) {
            username = line.replace('https://t.me/', '');
        } else if (line.startsWith('@')) {
            username = line.substring(1);
        }

        targets.push({
            channelUsername: username,
            channelUrl: `https://t.me/${username}`,
            channelTitle: username,
            isActive: true
        });
    }

    console.log(`✅ Загружено ${targets.length} каналов из TXT`);
    return targets;
}

/**
 * Интерактивный ввод каналов
 */
async function interactiveChannelInput(): Promise<ICommentTarget[]> {
    const targets: ICommentTarget[] = [];

    console.log('\n📝 Введите каналы (пустая строка для завершения):');
    console.log('Форматы: @channel, https://t.me/channel, channel');

    while (true) {
        const input = await question(`Канал ${targets.length + 1}: `);

        if (!input.trim()) break;

        let username = input.trim();
        if (username.startsWith('https://t.me/')) {
            username = username.replace('https://t.me/', '');
        } else if (username.startsWith('@')) {
            username = username.substring(1);
        }

        targets.push({
            channelUsername: username,
            channelUrl: `https://t.me/${username}`,
            channelTitle: username,
            isActive: true
        });

        console.log(`✅ Добавлен: @${username}`);
    }

    return targets;
}

/**
 * Настройка сообщений для комментирования
 */
async function setupCommentMessages(): Promise<ICommentMessage[]> {
    console.log('\n💬 === НАСТРОЙКА КОММЕНТАРИЕВ ===');
    console.log('1. Использовать стандартные шаблоны');
    console.log('2. Ввести свои комментарии');

    const choice = await question('Выберите (1-2): ');

    if (choice === '2') {
        const messages: ICommentMessage[] = [];
        console.log('\nВведите комментарии (пустая строка для завершения):');

        while (true) {
            const text = await question(`Комментарий ${messages.length + 1}: `);
            if (!text.trim()) break;

            messages.push({
                text: text.trim(),
                weight: 5,
                category: 'general'
            });
        }

        if (messages.length > 0) return messages;
    }

    // Стандартные деловые шаблоны
    return [
        { text: 'Интересная тема!', weight: 5, category: 'general' },
        { text: 'Полезная информация, спасибо!', weight: 7, category: 'appreciation' },
        { text: 'Хорошая подача материала', weight: 6, category: 'appreciation' },
        { text: 'Актуальный вопрос', weight: 5, category: 'general' },
        { text: 'Стоит изучить подробнее', weight: 4, category: 'insight' }
    ];
}

/**
 * Выбор отправки от имени автора или канала
 */
async function chooseSendAsOptions(commentPoster: CommentPosterService): Promise<any> {
    console.log('\n👤 === ОТПРАВКА ОТ ИМЕНИ ===');
    console.log('1. От своего имени');
    console.log('2. От имени канала');

    const choice = await question('Выберите (1-2): ');

    if (choice === '2') {
        console.log('\n📺 Получаю список ваших каналов...');
        try {
            const userChannels = await commentPoster.getUserChannelsAsync();

            if (userChannels.length === 0) {
                console.log('❌ У вас нет каналов для отправки');
                return undefined;
            }

            console.log('\n📋 Ваши каналы:');
            userChannels.forEach((channel, index) => {
                console.log(`${index + 1}. ${channel.title} (@${channel.username || channel.id})`);
            });

            const channelChoice = await question('\nВыберите канал (номер): ');
            const channelIndex = parseInt(channelChoice) - 1;

            if (channelIndex >= 0 && channelIndex < userChannels.length) {
                const selectedChannel = userChannels[channelIndex];
                console.log(`✅ Выбран: ${selectedChannel.title}`);

                return {
                    useChannelAsSender: true,
                    selectedChannelId: selectedChannel.id,
                    selectedChannelTitle: selectedChannel.title
                };
            }
        } catch (error) {
            console.log('❌ Ошибка получения каналов:', error);
        }
    }

    return undefined;
}

/**
 * Настройки сессии комментирования
 */
async function setupSessionOptions() {
    console.log('\n⚙️ === НАСТРОЙКИ СЕССИИ ===');

    const maxComments = parseInt(await question('Максимум комментариев (10): ') || '10');
    const delayBetweenTargets = parseInt(await question('Задержка между каналами, мс (5000): ') || '5000');
    const delayBetweenComments = parseInt(await question('Задержка между комментариями, мс (3000): ') || '3000');
    const randomizeOrder = (await question('Случайный порядок? (y/N): ')).toLowerCase() === 'y';
    const dryRun = (await question('Тестовый режим (без отправки)? (y/N): ')).toLowerCase() === 'y';

    return {
        maxComments,
        delayBetweenTargets,
        delayBetweenComments,
        randomizeOrder,
        dryRun
    };
}

// Запуск
if (require.main === module) {
    main().catch(error => {
        console.error('\n💥 Критическая ошибка:', error);
        process.exit(1);
    });
}
/**
 * Удаление успешно прокомментированных каналов из JSON базы
 */
async function removeSuccessfulChannelsFromJson(
    jsonFilePath: string,
    successfulChannelIds: string[]
): Promise<void> {
    if (successfulChannelIds.length === 0) {
        console.log('🔄 Нет успешных каналов для удаления');
        return;
    }

    try {
        console.log(`\n🗑️ === УДАЛЕНИЕ УСПЕШНЫХ КАНАЛОВ ===`);
        console.log(`📁 Файл: ${path.basename(jsonFilePath)}`);
        console.log(`🎯 Каналов для удаления: ${successfulChannelIds.length}`);

        // Читаем JSON файл
        const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
        const originalCount = jsonData.results.length;

        // Удаляем успешные каналы
        jsonData.results = jsonData.results.filter((result: any) => {
            const channelId = result.channel.channelId;
            return !successfulChannelIds.includes(channelId);
        });

        // Обновляем метаданные
        jsonData.lastUpdate = new Date().toISOString();
        jsonData.processedChannels = jsonData.results.length;
        jsonData.totalChannels = jsonData.results.length;

        const removedCount = originalCount - jsonData.results.length;

        // Сохраняем обновленный файл
        fs.writeFileSync(jsonFilePath, JSON.stringify(jsonData, null, 2), 'utf-8');

        console.log(`✅ Удалено каналов: ${removedCount}`);
        console.log(`📊 Осталось каналов: ${jsonData.results.length}`);
        console.log(`💾 Файл обновлен: ${path.basename(jsonFilePath)}`);

        // Создаем резервную копию удаленных каналов
        if (removedCount > 0) {
            const removedChannels = {
                removedDate: new Date().toISOString(),
                removedCount: removedCount,
                originalFile: path.basename(jsonFilePath),
                removedChannelIds: successfulChannelIds,
                note: "Каналы удалены после успешного комментирования"
            };

            const backupFile = path.join(
                path.dirname(jsonFilePath),
                `removed_channels_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
            );

            fs.writeFileSync(backupFile, JSON.stringify(removedChannels, null, 2), 'utf-8');
            console.log(`🗂️ Резервная копия: ${path.basename(backupFile)}`);
        }

    } catch (error) {
        console.error('❌ Ошибка при удалении каналов:', error);
    }
}

/**
 * Запрос подтверждения удаления успешных каналов
 */
async function confirmChannelRemoval(
    successfulChannelIds: string[],
    successfulChannelNames: string[]
): Promise<boolean> {
    if (successfulChannelIds.length === 0) {
        return false;
    }

    console.log('\n🗑️ === УДАЛЕНИЕ УСПЕШНЫХ КАНАЛОВ ===');
    console.log(`📋 Найдено ${successfulChannelIds.length} успешно прокомментированных каналов:`);

    // Показываем первые 5 каналов
    successfulChannelNames.slice(0, 5).forEach((name, index) => {
        console.log(`${index + 1}. ${name}`);
    });

    if (successfulChannelNames.length > 5) {
        console.log(`... и еще ${successfulChannelNames.length - 5} каналов`);
    }

    console.log('\n🗑️ Удаление предотвратит повторное комментирование этих каналов');
    console.log('🗂️ Резервная копия будет создана автоматически');

    const confirm = await question('\nУдалить успешные каналы из базы? (y/N): ');
    return confirm.toLowerCase() === 'y';
}

/**
 * Обработка удаления успешных каналов из JSON базы
 */
async function handleSuccessfulChannelRemoval(
    result: ICommentingResponseWithAI,
    jsonFilePath: string
): Promise<void> {
    try {
        // Собираем ID успешно прокомментированных каналов
        const successfulChannelIds: string[] = [];
        const successfulChannelNames: string[] = [];

        for (const commentResult of result.results) {
            if (commentResult.success && commentResult.target) {
                // Проверяем, есть ли channelId в target (для JSON источников)
                if ('channelId' in commentResult.target) {
                    successfulChannelIds.push(String(commentResult.target.channelId));
                    const channelName = commentResult.target.channelTitle || commentResult.target.channelUsername;
                    successfulChannelNames.push(String(channelName));
                }
            }
        }

        if (successfulChannelIds.length === 0) {
            console.log('🔄 Нет успешных каналов для удаления');
            return;
        }

        // Запрашиваем подтверждение удаления
        const shouldRemove = await confirmChannelRemoval(successfulChannelIds, successfulChannelNames);

        if (shouldRemove) {
            await removeSuccessfulChannelsFromJson(jsonFilePath, successfulChannelIds);
        } else {
            console.log('🔄 Удаление отменено пользователем');
        }

    } catch (error) {
        console.error('❌ Ошибка при обработке удаления каналов:', error);
    }
}
