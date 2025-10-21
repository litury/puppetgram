/**
 * Скрипт для автоматического вступления в каналы Telegram
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import {
    ChannelJoinerService,
    CommentErrorExtractor,
    JoinResultAdapter
} from '../../app/channelJoiner';
import {
    IJoinTarget,
    IJoinSessionOptions,
    IJoinSessionResult
} from '../../app/channelJoiner/interfaces';
import {
    loadJoinTargetsFromFile,
    parseJoinTargetFromLine,
    saveJoinTargetsToFile,
    generateFailedChannelsFilename
} from '../../app/channelJoiner/parts';
import { exportService } from '../../shared/exportService';
import { EnvAccountsParser } from '../../shared/utils/envAccountsParser';

// Парсер аккаунтов из .env
const envParser = new EnvAccountsParser();

async function main(): Promise<void> {
    console.log('\n🚪 Автоматическое вступление в каналы');
    console.log('════════════════════════════════════');

    // Получение доступных аккаунтов
    const accounts = envParser.getAvailableAccounts();
    if (accounts.length === 0) {
        console.error('❌ Не найдено доступных аккаунтов в .env');
        process.exit(1);
    }

    console.log(`\n📱 Найдено аккаунтов: ${accounts.length}`);

    // Выбор аккаунта
    const accountChoice = await prompts({
        type: 'select',
        name: 'account',
        message: 'Выберите аккаунт:',
        choices: accounts.map(account => ({
            title: `📱 ${account.name} ${account.username ? `@${account.username}` : ''}`.trim(),
            value: account
        }))
    });

    if (!accountChoice.account) {
        console.log('Операция отменена');
        return;
    }

    const selectedAccount = accountChoice.account;
    console.log(`\n✅ Выбран аккаунт: ${selectedAccount.name}`);

    // Подключение к Telegram
    console.log('Подключение к Telegram...');
    const client = new TelegramClient(
        new StringSession(selectedAccount.session || ''),
        selectedAccount.apiId || 0,
        selectedAccount.apiHash || '',
        { connectionRetries: 5 }
    );

    try {
        await client.connect();
        console.log('Успешно подключено к Telegram\n');

        const joinerService = new ChannelJoinerService(client);

        // Главное меню
        const mainChoice = await prompts({
            type: 'select',
            name: 'action',
            message: 'Выберите действие:',
            choices: [
                { title: '📁 Вступить в каналы из файла', value: 'file' },
                { title: '✍️ Ввести каналы вручную', value: 'manual' },
                { title: '🔄 Повторить неудачные попытки', value: 'retry' },
                { title: '📊 Проверить доступ к каналам', value: 'check' },
                { title: '🚪 Покинуть каналы', value: 'leave' }
            ]
        });

        if (!mainChoice.action) {
            console.log('Операция отменена');
            return;
        }

        switch (mainChoice.action) {
            case 'file':
                await handleJoinFromFile(joinerService);
                break;
            case 'manual':
                await handleJoinManual(joinerService);
                break;
            case 'retry':
                await handleRetryFailed(joinerService);
                break;
            case 'check':
                await handleCheckAccess(joinerService);
                break;
            case 'leave':
                await handleLeaveChannels(joinerService);
                break;
        }

    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await client.disconnect();
    }
}

/**
 * Сканирование файлов с каналами для вступления в указанной директории
 */
function scanJoinTargetFiles(_inputDir: string): string[] {
    if (!fs.existsSync(_inputDir)) {
        return [];
    }

    return fs.readdirSync(_inputDir)
        .filter(file => file.endsWith('.txt') && !file.startsWith('.'))
        .map(file => path.join(_inputDir, file))
        .filter(filePath => {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                return content.trim().length > 0;
            } catch {
                return false;
            }
        });
}

/**
 * Вступление в каналы из файла
 */
async function handleJoinFromFile(_joinerService: ChannelJoinerService): Promise<void> {
    console.log('\n📁 Вступление в каналы из файла');
    console.log('──────────────────────────────');

    // Сканируем доступные файлы для вступления
    const joinTargetsDir = './input-join-targets';

    const joinFiles = scanJoinTargetFiles(joinTargetsDir);
    const allFiles = joinFiles.map(file => ({ file, source: 'Каналы для вступления' }));

    if (allFiles.length === 0) {
        console.log('❌ Не найдено файлов с каналами');
        console.log(`💡 Создайте файл в папке ${joinTargetsDir}`);
        console.log(`📄 Пример: ${joinTargetsDir}/example-join-targets.txt`);
        return;
    }

    // Выбор файла
    const fileChoices = allFiles.map(({ file, source }) => ({
        title: `📄 ${path.basename(file)} (${source})`,
        value: file
    }));

    const fileChoice = await prompts({
        type: 'select',
        name: 'file',
        message: 'Выберите файл с каналами:',
        choices: fileChoices
    });

    if (!fileChoice.file) return;

    try {
        const targets = loadJoinTargetsFromFile(fileChoice.file);
        console.log(`📋 Загружено каналов: ${targets.length}`);

        if (targets.length === 0) {
            console.log('❌ Файл не содержит валидных каналов');
            return;
        }

        // Показываем первые несколько каналов для подтверждения
        console.log('\n📋 Примеры каналов:');
        targets.slice(0, 5).forEach((target: IJoinTarget, index: number) => {
            console.log(`   ${index + 1}. @${target.channelUsername} (${target.priority} приоритет)`);
        });
        if (targets.length > 5) {
            console.log(`   ... и еще ${targets.length - 5} каналов`);
        }

        const sessionOptions = await getJoinSessionOptions(targets);
        if (!sessionOptions) return;

        const result = await _joinerService.joinMultipleChannels(sessionOptions);
        await handleJoinResults(result);

    } catch (error) {
        console.error('❌ Ошибка при загрузке файла:', error);
    }
}

/**
 * Ручной ввод каналов
 */
async function handleJoinManual(_joinerService: ChannelJoinerService): Promise<void> {
    console.log('\n✍️ Ручной ввод каналов');
    console.log('─────────────────────');

    const targets: IJoinTarget[] = [];

    while (true) {
        const channelInput = await prompts({
            type: 'text',
            name: 'channel',
            message: 'Введите канал (@username, t.me/username или пустая строка для завершения):',
            validate: (value: string) => {
                if (!value.trim()) return true; // Пустая строка для завершения
                const target = parseJoinTargetFromLine(value);
                return target ? true : 'Неверный формат канала';
            }
        });

        if (!channelInput.channel || !channelInput.channel.trim()) {
            break;
        }

        const target = parseJoinTargetFromLine(channelInput.channel);
        if (target) {
            // Проверяем дубликаты
            const exists = targets.some(t => t.channelUsername === target.channelUsername);
            if (!exists) {
                targets.push(target);
                console.log(`✅ Добавлен: @${target.channelUsername}`);
            } else {
                console.log(`⚠️ Канал @${target.channelUsername} уже добавлен`);
            }
        }
    }

    if (targets.length === 0) {
        console.log('❌ Не введено ни одного канала');
        return;
    }

    console.log(`\n📋 Итого каналов: ${targets.length}`);

    const sessionOptions = await getJoinSessionOptions(targets);
    if (!sessionOptions) return;

    const result = await _joinerService.joinMultipleChannels(sessionOptions);
    await handleJoinResults(result);
}

/**
 * Получение настроек сессии вступления
 */
async function getJoinSessionOptions(_targets: IJoinTarget[]): Promise<IJoinSessionOptions | null> {
    const maxChannels = await prompts({
        type: 'number',
        name: 'value',
        message: `Максимум каналов для обработки (доступно: ${_targets.length}):`,
        initial: Math.min(_targets.length, 10),
        min: 1,
        max: _targets.length
    });

    if (!maxChannels.value) return null;

    const delay = await prompts({
        type: 'number',
        name: 'value',
        message: '⚠️ Задержка между вступлениями (секунды, рекомендуется 180+):',
        initial: 180,
        min: 10,
        max: 600
    });

    if (delay.value === undefined) return null;

    const randomOrder = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Случайный порядок обработки каналов?',
        initial: true
    });

    const dryRun = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Тестовый режим (без реального вступления)?',
        initial: false
    });

    return {
        targets: _targets,
        delayBetweenJoins: delay.value * 1000,
        maxJoinsPerSession: maxChannels.value,
        randomizeOrder: randomOrder.value,
        skipAlreadyJoined: true,
        dryRun: dryRun.value,
        retryFailedChannels: false,
        maxRetries: 0
    };
}

/**
 * Обработка результатов вступления
 */
async function handleJoinResults(_result: IJoinSessionResult): Promise<void> {
    // Показываем результаты
    console.log(JoinResultAdapter.formatSessionResults(_result));

    // Предлагаем экспорт
    const exportChoice = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Экспортировать результаты?',
        initial: true
    });

    if (exportChoice.value) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `join-results-${timestamp}.json`;
            const content = JSON.stringify(_result, null, 2);
            await exportService.saveToFile(content, filename);
            console.log(`💾 Результаты сохранены: ${filename}`);
        } catch (error) {
            console.error('❌ Ошибка экспорта:', error);
        }
    }

    // Сохраняем каналы для повтора если есть
    if (_result.summary.channelsNeedingRetry.length > 0) {
        const saveRetry = await prompts({
            type: 'confirm',
            name: 'value',
            message: `Сохранить ${_result.summary.channelsNeedingRetry.length} каналов для повтора?`,
            initial: true
        });

        if (saveRetry.value) {
            try {
                const retryFilename = generateFailedChannelsFilename();
                const retryPath = path.join('./input-join-targets', retryFilename);
                saveJoinTargetsToFile(_result.summary.channelsNeedingRetry, retryPath);
                console.log(`💾 Каналы для повтора сохранены: ${retryFilename}`);
            } catch (error) {
                console.error('❌ Ошибка сохранения каналов для повтора:', error);
            }
        }
    }
}

/**
 * Повтор неудачных попыток
 */
async function handleRetryFailed(_joinerService: ChannelJoinerService): Promise<void> {
    console.log('\n🔄 Повтор неудачных попыток');
    console.log('──────────────────────────');

    // Ищем файлы с failed_channels в директории для вступления
    const joinTargetsDir = './input-join-targets';
    const failedFiles: { title: string; value: string }[] = [];

    if (fs.existsSync(joinTargetsDir)) {
        const files = fs.readdirSync(joinTargetsDir)
            .filter(file => file.includes('failed_channels') && file.endsWith('.txt'))
            .map(file => ({
                title: `📄 ${file}`,
                value: path.join(joinTargetsDir, file)
            }));
        failedFiles.push(...files);
    }

    if (failedFiles.length === 0) {
        console.log('❌ Не найдено файлов с неудачными каналами');
        console.log(`💡 Файлы с неудачными каналами создаются автоматически после сессий вступления`);
        return;
    }

    const fileChoice = await prompts({
        type: 'select',
        name: 'file',
        message: 'Выберите файл с каналами для повтора:',
        choices: failedFiles
    });

    if (!fileChoice.file) return;

    try {
        const targets = loadJoinTargetsFromFile(fileChoice.file);
        console.log(`📋 Загружено каналов для повтора: ${targets.length}`);

        if (targets.length === 0) {
            console.log('❌ Файл не содержит каналов');
            return;
        }

        const sessionOptions = await getJoinSessionOptions(targets);
        if (!sessionOptions) return;

        const result = await _joinerService.joinMultipleChannels(sessionOptions);
        await handleJoinResults(result);

    } catch (error) {
        console.error('❌ Ошибка при повторе:', error);
    }
}

/**
 * Проверка доступа к каналам
 */
async function handleCheckAccess(_joinerService: ChannelJoinerService): Promise<void> {
    console.log('\n📊 Проверка доступа к каналам');
    console.log('────────────────────────────');

    // Выбор источника каналов
    const sourceChoice = await prompts({
        type: 'select',
        name: 'source',
        message: 'Откуда взять каналы для проверки:',
        choices: [
            { title: '📁 Из файла', value: 'file' },
            { title: '✍️ Ввести вручную', value: 'manual' }
        ]
    });

    if (!sourceChoice.source) return;

    let targets: IJoinTarget[] = [];

    if (sourceChoice.source === 'file') {
        // Загрузка из файла
        const joinTargetsDir = './input-join-targets';

        const joinFiles = scanJoinTargetFiles(joinTargetsDir);
        const allFiles = joinFiles.map(file => ({ file, source: 'Каналы для вступления' }));

        if (allFiles.length === 0) {
            console.log('❌ Не найдено файлов с каналами');
            return;
        }

        const fileChoices = allFiles.map(({ file, source }) => ({
            title: `📄 ${path.basename(file)} (${source})`,
            value: file
        }));

        const fileChoice = await prompts({
            type: 'select',
            name: 'file',
            message: 'Выберите файл:',
            choices: fileChoices
        });

        if (!fileChoice.file) return;
        targets = loadJoinTargetsFromFile(fileChoice.file);
    } else {
        // Ручной ввод (упрощенная версия)
        const channelInput = await prompts({
            type: 'text',
            name: 'channels',
            message: 'Введите каналы через пробел или запятую:'
        });

        if (!channelInput.channels) return;

        targets = channelInput.channels
            .split(/[,\s]+/)
            .map((ch: string) => parseJoinTargetFromLine(ch.trim()))
            .filter((t: IJoinTarget | null) => t !== null) as IJoinTarget[];
    }

    if (targets.length === 0) {
        console.log('❌ Не найдено валидных каналов');
        return;
    }

    console.log(`\n🔍 Проверка доступа к ${targets.length} каналам...`);

    // Проверяем доступ к каждому каналу
    for (const [index, target] of targets.entries()) {
        console.log(`[${index + 1}/${targets.length}] @${target.channelUsername}`);

        try {
            const accessInfo = await _joinerService.checkChannelAccess(target.channelUsername);

            if (accessInfo.isJoinable) {
                console.log(`   ✅ Доступен для вступления`);
            } else if (accessInfo.isPrivate) {
                console.log(`   🔒 Приватный канал`);
            } else if (accessInfo.requiresApproval) {
                console.log(`   📝 Требует одобрения`);
            } else {
                console.log(`   ❌ Недоступен`);
            }

            if (accessInfo.memberCount) {
                console.log(`   👥 Участников: ${accessInfo.memberCount}`);
            }

        } catch (error) {
            console.log(`   ❌ Ошибка: ${error}`);
        }

        // Небольшая задержка между проверками
        if (index < targets.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

/**
 * Выход из каналов
 */
async function handleLeaveChannels(_joinerService: ChannelJoinerService): Promise<void> {
    console.log('\n🚪 Выход из каналов');
    console.log('──────────────────');

    const channelInput = await prompts({
        type: 'text',
        name: 'channels',
        message: 'Введите каналы для выхода (через пробел или запятую):'
    });

    if (!channelInput.channels) return;

    const channelUsernames = channelInput.channels
        .split(/[,\s]+/)
        .map((ch: string) => ch.trim().replace(/^@/, ''))
        .filter((ch: string) => ch.length > 0);

    if (channelUsernames.length === 0) {
        console.log('❌ Не введено каналов');
        return;
    }

    const confirm = await prompts({
        type: 'confirm',
        name: 'value',
        message: `Покинуть ${channelUsernames.length} каналов?`,
        initial: false
    });

    if (!confirm.value) return;

    console.log(`\n🚪 Выход из ${channelUsernames.length} каналов...`);

    for (const [index, username] of channelUsernames.entries()) {
        console.log(`[${index + 1}/${channelUsernames.length}] @${username}`);

        try {
            const success = await _joinerService.leaveChannel(username);
            if (success) {
                console.log(`   ✅ Покинул канал`);
            } else {
                console.log(`   ❌ Ошибка выхода`);
            }
        } catch (error) {
            console.log(`   ❌ Ошибка: ${error}`);
        }

        // Задержка между выходами
        if (index < channelUsernames.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// Запуск скрипта
if (require.main === module) {
    main().catch(console.error);
} 
 
 
 
 