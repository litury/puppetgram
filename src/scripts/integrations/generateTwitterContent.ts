/**
 * CLI скрипт для генерации Twitter контента из Telegram постов
 * Использует AI (DeepSeek) для адаптации контента под формат Twitter
 */

import prompts from "prompts";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { TwitterContentGeneratorService } from "../../app/twitterContentGenerator/services/twitterContentGeneratorService";
import { IChannelData, ITwitterContentGeneratorConfig } from "../../app/twitterContentGenerator/interfaces/ITwitterContentGenerator";

dotenv.config();

/**
 * Получить список JSON файлов из указанных директорий
 */
function getAvailableChannelFiles(): Array<{ path: string; name: string; size: number; dir: string }> {
    const searchDirs = [
        { path: path.join(process.cwd(), 'exports', 'channel-parser'), name: 'Channel Parser' },
        { path: path.join(process.cwd(), 'input-channels'), name: 'Input Channels' }
    ];

    const files: Array<{ path: string; name: string; size: number; dir: string }> = [];

    for (const dir of searchDirs) {
        if (fs.existsSync(dir.path)) {
            const dirFiles = fs.readdirSync(dir.path)
                .filter(file => file.endsWith('.json'))
                .map(file => {
                    const filePath = path.join(dir.path, file);
                    const stats = fs.statSync(filePath);
                    return {
                        path: filePath,
                        name: file,
                        size: stats.size,
                        dir: dir.name
                    };
                });
            files.push(...dirFiles);
        }
    }

    return files;
}

/**
 * Загрузить данные канала из JSON файла
 */
function loadChannelData(filePath: string): IChannelData {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Преобразуем даты из строк в Date объекты
    if (data.messages) {
        data.messages = data.messages.map((msg: any) => ({
            ...msg,
            date: new Date(msg.date),
            editDate: msg.editDate ? new Date(msg.editDate) : undefined
        }));
    }

    return data;
}

/**
 * Проверка, находимся ли в off-peak часах (50% скидка)
 */
function isOffPeakHours(): boolean {
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const totalMinutes = utcHours * 60 + utcMinutes;

    // Off-peak: 16:30-00:30 UTC (990-1470 минут и 0-30 минут)
    return (totalMinutes >= 990 && totalMinutes <= 1440) || (totalMinutes >= 0 && totalMinutes <= 30);
}

/**
 * Главная функция
 */
async function main() {
    console.log('🐦 Генератор Twitter контента из Telegram постов');
    console.log('================================================\n');

    // Проверка API ключа
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        console.error('❌ Ошибка: DEEPSEEK_API_KEY не найден в .env файле');
        console.error('Добавьте DEEPSEEK_API_KEY=your_key в файл .env');
        process.exit(1);
    }

    // Получение списка доступных файлов
    const availableFiles = getAvailableChannelFiles();

    if (availableFiles.length === 0) {
        console.error('❌ Не найдено JSON файлов с данными каналов');
        console.error('Запустите сначала:');
        console.error('  npm run parse:similar    - для парсинга похожих каналов');
        console.error('  npm run parse:channel     - для парсинга конкретного канала');
        process.exit(1);
    }

    // Выбор файла
    const fileResponse = await prompts({
        type: "select",
        name: "filePath",
        message: "Выберите файл с данными канала:",
        choices: availableFiles.map(file => ({
            title: `${file.name} (${file.dir})`,
            value: file.path,
            description: `Размер: ${(file.size / 1024).toFixed(1)} KB`
        }))
    });

    if (!fileResponse.filePath) {
        console.log('Отменено пользователем');
        process.exit(0);
    }

    // Загрузка данных
    console.log('\n📂 Загрузка данных канала...');
    let channelData: IChannelData;
    try {
        channelData = loadChannelData(fileResponse.filePath);
        console.log(`✅ Загружено: ${channelData.messages.length} сообщений`);
        console.log(`📺 Канал: ${channelData.channelInfo.title} (@${channelData.channelInfo.username})`);
    } catch (error) {
        console.error('❌ Ошибка загрузки файла:', error);
        process.exit(1);
    }

    // Настройки генерации
    const configResponse = await prompts([
        {
            type: "number",
            name: "maxPostLength",
            message: "Максимальная длина Twitter поста (символов):",
            initial: 270,
            min: 100,
            max: 280
        },
        {
            type: "confirm",
            name: "removeEmojis",
            message: "Удалить эмодзи из постов?",
            initial: true
        },
        {
            type: "confirm",
            name: "skipMediaPosts",
            message: "Пропускать посты с медиа (фото/видео)?",
            initial: true
        }
    ]);

    if (Object.keys(configResponse).length === 0) {
        console.log('Отменено пользователем');
        process.exit(0);
    }

    // Создание сервиса генерации
    const service = new TwitterContentGeneratorService();

    // Оценка стоимости
    console.log('\n💰 Оценка стоимости генерации...');
    const estimation = await service.estimateGeneration(channelData);

    const offPeak = isOffPeakHours();
    const baseCost = estimation.estimatedCost;
    const finalCost = offPeak ? baseCost * 0.5 : baseCost;

    console.log('\n📊 Оценка параметров:');
    console.log(`   • Всего сообщений: ${estimation.totalMessages}`);
    console.log(`   • Сообщений с текстом: ${estimation.messagesWithText}`);
    console.log(`   • Будет пропущено: ${estimation.messagesSkipped}`);
    console.log(`   • Ожидается постов: ~${estimation.postsGenerated}`);
    console.log(`   • Оценка токенов: ~${estimation.estimatedTokens.toLocaleString()}`);
    console.log(`   • Базовая стоимость: $${baseCost.toFixed(4)}`);
    if (offPeak) {
        console.log(`   • 🎉 Off-peak скидка 50%: $${finalCost.toFixed(4)}`);
        console.log(`   • Экономия: $${(baseCost - finalCost).toFixed(4)}`);
    } else {
        console.log(`   • Итоговая стоимость: $${finalCost.toFixed(4)}`);
        console.log(`   💡 Совет: Запустите с 16:30 до 00:30 UTC для 50% скидки`);
    }

    // Подтверждение генерации
    const confirmResponse = await prompts({
        type: "confirm",
        name: "confirm",
        message: `Начать генерацию Twitter постов? (~$${finalCost.toFixed(4)})`,
        initial: false
    });

    if (!confirmResponse.confirm) {
        console.log('Отменено пользователем');
        process.exit(0);
    }

    // Конфигурация генератора
    const config: ITwitterContentGeneratorConfig = {
        apiKey,
        baseUrl: process.env.DEEPSEEK_BASE_URL,
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        maxPostLength: configResponse.maxPostLength,
        maxTokens: 100,
        temperature: 0.7,
        removeEmojis: configResponse.removeEmojis,
        skipMediaPosts: configResponse.skipMediaPosts
    };

    // Генерация постов
    console.log('\n🚀 Начинаю генерацию...\n');
    try {
        const { posts, stats } = await service.generateTwitterPosts(channelData, config);

        // Сохранение результатов
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const channelName = channelData.channelInfo.username.replace('@', '');
        const outputDir = path.join(process.cwd(), 'exports', 'twitter-content');
        const outputFile = path.join(outputDir, `${channelName}_${timestamp}.json`);

        await service.savePostsToFile(posts, outputFile);

        // Итоговая статистика
        console.log('\n✨ Генерация завершена!');
        console.log('\n📊 Итоговая статистика:');
        console.log(`   • Обработано сообщений: ${stats.totalMessages}`);
        console.log(`   • Создано постов: ${stats.postsGenerated}`);
        console.log(`   • Создано тредов: ${stats.threadsCreated}`);
        console.log(`   • Пропущено: ${stats.messagesSkipped}`);

        console.log('\n📁 Файлы сохранены:');
        console.log(`   • ${outputFile}`);
        console.log(`   • ${outputFile.replace('.json', '.txt')}`);

        console.log('\n🎯 Следующий шаг:');
        console.log('   Запустите: npm run integration:twitter');
        console.log('   Чтобы запланировать публикацию постов в Twitter\n');

    } catch (error) {
        console.error('\n❌ Ошибка при генерации:', error);
        process.exit(1);
    }
}

// Запуск
main().catch(error => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
});
