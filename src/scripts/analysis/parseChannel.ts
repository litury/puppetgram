import { GramClient } from "../telegram/adapters/gramClient";
import { ChannelParserService } from "../modules/channelParser";
import prompts from "prompts";

async function main() {
    const gramClient = new GramClient();

    try {
        await gramClient.connect();

        console.log("\n🔍 === ПОЛНЫЙ ПАРСИНГ TELEGRAM КАНАЛА ===\n");

        // Запрос имени канала
        const channelResponse = await prompts({
            type: "text",
            name: "channelName",
            message: "Введите имя канала (например, @channel_name):",
            validate: (value) =>
                value.length > 0 ? true : "Имя канала не может быть пустым",
        });

        if (!channelResponse.channelName) {
            console.log("❌ Операция отменена");
            return;
        }

        const channelName = channelResponse.channelName;

        // Настройки парсинга
        const optionsResponse = await prompts([
            {
                type: "number",
                name: "messageLimit",
                message: "Количество сообщений для парсинга (0 = все):",
                initial: 100,
                min: 0,
                max: 10000
            },
            {
                type: "confirm",
                name: "downloadMedia",
                message: "Скачивать медиа файлы?",
                initial: true
            },
            {
                type: "multiselect",
                name: "mediaTypes",
                message: "Какие типы медиа скачивать?",
                choices: [
                    { title: "Фотографии", value: "photo", selected: true },
                    { title: "Видео", value: "video", selected: true },
                    { title: "Документы", value: "document", selected: true },
                    { title: "Аудио", value: "audio", selected: true },
                    { title: "Голосовые сообщения", value: "voice", selected: false },
                    { title: "Анимации/GIF", value: "animation", selected: false }
                ],
                instructions: false,
                hint: "Используйте пробел для выбора, Enter для подтверждения"
            },
            {
                type: "number",
                name: "maxMediaSize",
                message: "Максимальный размер медиа файла (MB, 0 = без ограничений):",
                initial: 0,
                min: 0,
                max: 10000
            },
            {
                type: "confirm",
                name: "skipLargeFiles",
                message: "Пропускать файлы больше 50MB для ускорения?",
                initial: true
            }
        ]);

        // Создаем сервис парсера
        const parser = new ChannelParserService(gramClient.getClient(), './exports/channel-parser', gramClient);

        // Запускаем парсинг
        const result = await parser.parseChannelAsync(channelName, {
            downloadMedia: optionsResponse.downloadMedia,
            mediaTypes: optionsResponse.mediaTypes,
            maxMediaSize: optionsResponse.maxMediaSize,
            messageLimit: optionsResponse.messageLimit
        });

        // Показываем результаты
        console.log("\n📊 === РЕЗУЛЬТАТЫ ПАРСИНГА ===");
        console.log(`📺 Канал: ${result.channelInfo.title}`);
        console.log(`📝 Сообщений обработано: ${result.stats.totalMessages}`);
        console.log(`📸 Сообщений с медиа: ${result.stats.messagesWithMedia}`);
        console.log(`💾 Медиа файлов скачано: ${result.stats.downloadedMedia}`);
        console.log(`📏 Общий размер медиа: ${formatBytes(result.stats.totalMediaSize)}`);
        console.log(`🔗 Ссылок найдено: ${result.stats.totalLinks}`);
        console.log(`#️⃣ Хэштегов: ${result.stats.totalHashtags}`);
        console.log(`@️⃣ Упоминаний: ${result.stats.totalMentions}`);
        console.log(`⏱️ Время парсинга: ${(result.stats.parseTime / 1000).toFixed(1)}с`);

        console.log("\n📁 === ЭКСПОРТИРОВАННЫЕ ФАЙЛЫ ===");
        console.log(`📄 JSON: ${result.exportPaths.jsonFile}`);
        console.log(`📝 TXT: ${result.exportPaths.textFile}`);
        console.log(`📊 CSV: ${result.exportPaths.csvFile}`);
        console.log(`📈 Статистика: ${result.exportPaths.statsFile}`);
        console.log(`📁 Медиа: ${result.exportPaths.mediaDirectory}`);

        if (result.stats.errors.length > 0) {
            console.log("\n⚠️  === ОШИБКИ ===");
            result.stats.errors.forEach(error => {
                console.log(`❌ ${error}`);
            });
        }

        console.log("\n✅ Парсинг завершен успешно!");

    } catch (error) {
        console.error("\n❌ Ошибка парсинга:", error);
    } finally {
        await gramClient.disconnect();
        console.log("\n🔌 Соединение закрыто");
    }
}

/**
 * Форматирование размера в байтах
 */
function formatBytes(_bytes: number): string {
    if (_bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(_bytes) / Math.log(k));

    return parseFloat((_bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Запуск скрипта
if (require.main === module) {
    main().catch((error) => {
        console.error("❌ Критическая ошибка:", error);
        process.exit(1);
    });
} 