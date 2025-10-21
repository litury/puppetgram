/**
 * Автоматизированный скрипт для AI комментирования каналов от имени вашего канала
 * Все настройки заданы по умолчанию - не требует подтверждений
 */

import { GramClient } from '../../telegram/adapters/gramClient';
import { CommentPosterService, ICommentTarget, ICommentMessage, ICommentingOptionsWithAI, ICommentResult } from '../../app/commentPoster';
import { AICommentGeneratorService, IAICommentResult } from '../../app/aiCommentGenerator';
import { createStopMessage, analyzeFloodWaitError } from '../../shared/utils/floodWaitHandler';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

// Конфигурация AI из переменных окружения
const AI_CONFIG = {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    enabled: !!process.env.DEEPSEEK_API_KEY,
    timeout: 30000
};

// Фиксированные настройки
const FIXED_CONFIG = {
    channelsFile: './input-channels/channels.txt',
    delay: 5, // Фиксированная задержка 5 секунд
    dryRun: false, // Тестовый режим отключен
    targetChannel: process.env.TARGET_CHANNEL || '' // Целевой канал из .env
};

// Пустой массив fallback комментариев - используем только AI
const EMPTY_FALLBACK: ICommentMessage[] = [];

/**
 * Автоматически находит целевой канал среди пользовательских каналов
 */
async function findTargetChannel(commentPoster: CommentPosterService, targetChannelUsername: string) {
    console.log(`🔍 Поиск канала @${targetChannelUsername}...`);

    const userChannels = await commentPoster.getUserChannelsAsync();

    if (userChannels.length === 0) {
        throw new Error('У вас нет каналов для отправки от имени');
    }

    // Ищем канал по username
    const targetChannel = userChannels.find(channel =>
        channel.username?.toLowerCase() === targetChannelUsername.toLowerCase()
    );

    if (!targetChannel) {
        console.log('\n📺 Доступные каналы:');
        userChannels.forEach((channel, index) => {
            console.log(`${index + 1}. ${channel.title} (@${channel.username || 'без username'})`);
        });
        throw new Error(`Канал @${targetChannelUsername} не найден среди ваших каналов. Укажите правильный TARGET_CHANNEL в .env файле`);
    }

    console.log(`✅ Канал найден: ${targetChannel.title} (@${targetChannel.username})`);
    return targetChannel;
}

async function main() {
    const gramClient = new GramClient();

    try {
        console.log('🚀 === АВТОМАТИЧЕСКОЕ КОММЕНТИРОВАНИЕ ===\n');

        // Подключаемся к Telegram
        await gramClient.connect();
        console.log('✅ Подключение к Telegram успешно\n');

        // Создаем сервисы
        const commentPoster = new CommentPosterService(gramClient.getClient());
        const aiGenerator = new AICommentGeneratorService(AI_CONFIG);

        // Проверяем AI конфигурацию
        if (!AI_CONFIG.apiKey) {
            console.log('❌ AI ключ не настроен в переменных окружения');
            console.log('💡 Установите DEEPSEEK_API_KEY для использования AI');
            return;
        }

        // Проверяем доступность AI
        const aiAvailable = await aiGenerator.checkHealthAsync();
        if (!aiAvailable) {
            console.log('❌ AI сервис недоступен');
            return;
        }

        // Проверяем наличие TARGET_CHANNEL
        if (!FIXED_CONFIG.targetChannel) {
            console.log('❌ TARGET_CHANNEL не указан в .env файле');
            console.log('💡 Добавьте TARGET_CHANNEL=your_channel_name в .env');
            return;
        }

        // Автоматически находим целевой канал
        const targetChannel = await findTargetChannel(commentPoster, FIXED_CONFIG.targetChannel);
        const sendAsOptions = {
            useChannelAsSender: true,
            selectedChannelId: targetChannel.id,
            selectedChannelTitle: targetChannel.title
        };

        // Проверяем файл каналов
        if (!fs.existsSync(FIXED_CONFIG.channelsFile)) {
            console.log(`❌ Файл каналов не найден: ${FIXED_CONFIG.channelsFile}`);
            console.log('💡 Создайте файл со списком каналов для комментирования');
            return;
        }

        // Читаем каналы
        const channelsContent = fs.readFileSync(FIXED_CONFIG.channelsFile, 'utf-8');
        const channelUsernames = channelsContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));

        console.log(`📋 Загружено каналов: ${channelUsernames.length}`);

        if (channelUsernames.length === 0) {
            console.log('❌ Нет каналов для обработки');
            return;
        }

        // Преобразуем в формат ICommentTarget
        const targets: ICommentTarget[] = channelUsernames.map(username => ({
            channelUsername: username.replace('@', ''),
            channelUrl: `https://t.me/${username.replace('@', '')}`,
            isActive: true
        }));

        console.log(`\n⚙️ === АВТОМАТИЧЕСКИЕ НАСТРОЙКИ ===`);
        console.log(`🤖 Режим: Умные короткие комментарии (до 100 символов)`);
        console.log(`🧪 Тестовый режим: ОТКЛЮЧЕН`);
        console.log(`⏱️ Задержка между комментариями: ${FIXED_CONFIG.delay}с`);
        console.log(`📺 Отправка: От имени канала @${targetChannel.username}`);
        console.log(`📊 Каналов к обработке: ${targets.length}`);
        console.log(`🚫 Fallback комментарии: ОТКЛЮЧЕНЫ (только AI)`);

        // Рассчитываем примерное время
        const estimatedTime = Math.ceil((targets.length * FIXED_CONFIG.delay) / 60);
        console.log(`⏰ Примерное время выполнения: ${estimatedTime} минут\n`);

        // Настройки для AI комментирования
        const options: ICommentingOptionsWithAI = {
            targets,
            messages: EMPTY_FALLBACK, // Пустой массив - только AI
            delayBetweenComments: FIXED_CONFIG.delay * 1000,
            maxCommentsPerSession: targets.length,
            randomizeOrder: false,
            skipRecentlyCommented: false,
            dryRun: FIXED_CONFIG.dryRun,
            useAI: true,
            aiGenerator,
            delayBetweenTargets: FIXED_CONFIG.delay * 1000,
            sendAsOptions
        };

        // Запускаем комментирование БЕЗ подтверждения
        console.log('🤖 Автоматический запуск комментирования...\n');
        const result = await commentPoster.postCommentsWithAIAsync(options);

        // Выводим результаты
        console.log('\n🤖 === ИТОГОВЫЕ РЕЗУЛЬТАТЫ ===');
        console.log(`🎯 Всего каналов: ${result.totalTargets}`);
        console.log(`✅ Успешных комментариев: ${result.successfulComments}`);
        console.log(`❌ Неудачных попыток: ${result.failedComments}`);
        console.log(`🤖 AI запросов: ${result.aiSummary.totalAIRequests} (успешно: ${result.aiSummary.successfulAIRequests}, ошибок: ${result.aiSummary.failedAIRequests})`);
        console.log(`⏭️ Пропущено постов: ${result.aiSummary.skippedPosts}`);
        console.log(`⏱️ Общее время: ${Math.round(result.duration / 1000)}с`);
        console.log(`📊 Успешность: ${Math.round((result.successfulComments / result.totalTargets) * 100)}%`);

        // Детальная статистика
        if (result.results.length > 0) {
            console.log('\n📋 Детальная статистика:');
            result.results.forEach((res: ICommentResult, index: number) => {
                const status = res.success ? '✅' : '❌';
                const target = res.target as ICommentTarget;
                console.log(`${index + 1}. ${status} @${target.channelUsername}`);

                if (res.success && res.commentText) {
                    console.log(`   💬 "${res.commentText}"`);
                }

                if (res.error) {
                    console.log(`   ❌ ${res.error}`);
                }
            });
        }

        // AI статистика
        if (result.aiResults.length > 0) {
            console.log('\n🤖 AI статистика:');
            const successfulAI = result.aiResults.filter((r: IAICommentResult) => r.success);
            const failedAI = result.aiResults.filter((r: IAICommentResult) => !r.success);

            console.log(`✅ Успешных AI комментариев: ${successfulAI.length}`);
            console.log(`❌ Неудачных AI запросов: ${failedAI.length}`);

            if (failedAI.length > 0) {
                console.log('\n❌ Ошибки AI:');
                failedAI.forEach((ai: IAICommentResult, index: number) => {
                    if (ai.error) {
                        console.log(`${index + 1}. ${ai.error}`);
                    }
                });
            }
        }

        // Предупреждение о неудачных AI запросах
        if (result.aiSummary.failedAIRequests > 0) {
            console.log('\n⚠️ ВАЖНО: Некоторые AI запросы не удались!');
            console.log('🚫 Fallback комментарии отключены - каналы без AI анекдотов пропущены');
            console.log('💡 Для максимальной эффективности убедитесь в стабильности AI сервиса');
        }

        console.log('\n🎉 Автоматическое комментирование завершено!');

    } catch (error: any) {
        // Проверяем на критический FloodWait
        const floodAnalysis = analyzeFloodWaitError(error);
        if (floodAnalysis.isFloodWait && floodAnalysis.shouldStop) {
            console.error('\n' + createStopMessage(floodAnalysis.seconds, 'АВТОМАТИЧЕСКОЕ КОММЕНТИРОВАНИЕ'));
            console.error(`💡 Перезапустите скрипт через ${floodAnalysis.hours} часов`);
        } else {
            console.error('❌ Критическая ошибка:', error);
        }
    } finally {
        await gramClient.disconnect();
        console.log('\n👋 Отключение от Telegram');
    }
}

// Запуск с обработкой ошибок
main().catch(error => {
    // Проверяем на критический FloodWait в необработанных ошибках
    const floodAnalysis = analyzeFloodWaitError(error);
    if (floodAnalysis.isFloodWait && floodAnalysis.shouldStop) {
        console.error('\n' + createStopMessage(floodAnalysis.seconds, 'АВТОМАТИЧЕСКОЕ КОММЕНТИРОВАНИЕ'));
        console.error(`💡 Перезапустите скрипт через ${floodAnalysis.hours} часов`);
        process.exit(2); // Специальный код выхода для FloodWait
    } else {
        console.error('💥 Необработанная ошибка:', error);
        process.exit(1);
    }
});
