/**
 * Этап 1 VK-конвейера: экспорт постов С МЕДИА из выгрузки канала.
 *
 * Берёт сырой экспорт парсера (exports/channel-parser/<channel>/<channel>_*.json),
 * отбирает только сообщения с медиа (фото/видео/анимация), объединяет альбомы,
 * сохраняет ОРИГИНАЛЬНЫЙ текст и пишет результат в exports/vk-content/*.json.
 *
 * Публикация и адаптация текста — отдельные этапы (см. план).
 */

import prompts from "prompts";
import * as fs from "fs";
import * as path from "path";
import { VkContentExporterService } from "../../app/vkContentExporter/services/vkContentExporterService";
import { IChannelExportFile } from "../../app/vkContentExporter/interfaces/IVkContentExporter";

/**
 * Рекурсивно (на один уровень подпапок) ищет JSON-выгрузки парсера каналов,
 * исключая файлы статистики.
 */
function getChannelExportFiles(): string[] {
    const baseDir = path.join(process.cwd(), "exports", "channel-parser");
    if (!fs.existsSync(baseDir)) {
        return [];
    }

    const results: string[] = [];
    const collect = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                collect(full);
            } else if (
                entry.isFile() &&
                entry.name.endsWith(".json") &&
                !entry.name.endsWith("_stats.json")
            ) {
                results.push(full);
            }
        }
    };
    collect(baseDir);
    return results;
}

/**
 * Имя канала для имени выходного файла
 */
function deriveChannelName(_data: IChannelExportFile, _sourcePath: string): string {
    const username = _data.metadata?.channel?.username;
    if (username) {
        return username.replace(/^@/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    }
    return path.basename(_sourcePath).replace(/\.json$/, "");
}

async function main() {
    console.log("\n📦 Экспорт VK-постов с медиа (этап 1)");
    console.log("═══════════════════════════════════════════════");

    const files = getChannelExportFiles();
    if (files.length === 0) {
        console.log("📭 Выгрузки каналов не найдены в exports/channel-parser/");
        console.log("Сначала спарсите канал: npm run parse:channel (с включённым скачиванием медиа)");
        return;
    }

    const fileResponse = await prompts({
        type: "select",
        name: "filePath",
        message: "Выберите выгрузку канала:",
        choices: files.map(filePath => ({
            title: path.relative(process.cwd(), filePath),
            value: filePath,
            description: `Размер: ${(fs.statSync(filePath).size / 1024 / 1024).toFixed(1)} MB`
        }))
    });

    if (!fileResponse.filePath) {
        console.log("❌ Операция отменена");
        return;
    }

    let channelData: IChannelExportFile;
    try {
        channelData = JSON.parse(fs.readFileSync(fileResponse.filePath, "utf-8"));
    } catch (error: any) {
        console.error(`❌ Не удалось прочитать файл: ${error.message}`);
        return;
    }

    if (!Array.isArray(channelData.messages)) {
        console.error("❌ В файле нет массива messages — это не выгрузка парсера каналов");
        return;
    }

    const exporter = new VkContentExporterService();
    const { posts, stats } = exporter.exportMediaPosts(channelData);

    console.log("\n📊 Статистика отбора:");
    console.log("═".repeat(50));
    console.log(`   • Всего сообщений:        ${stats.totalMessages}`);
    console.log(`   • С подходящим медиа:     ${stats.messagesWithMedia}`);
    console.log(`   • Объединено в альбомы:   ${stats.albumMessagesMerged} сообщ. → ${stats.albumPosts} постов`);
    console.log(`   • Итоговых постов:        ${stats.postsGenerated}`);
    console.log(`   • Из них без подписи:     ${stats.postsWithEmptyText}`);
    console.log(`   • Всего медиа-файлов:     ${stats.mediaFilesTotal}`);

    if (posts.length === 0) {
        console.log("\n📭 Постов с медиа не найдено — нечего сохранять");
        return;
    }

    const channelName = deriveChannelName(channelData, fileResponse.filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = path.join(process.cwd(), "exports", "vk-content", `${channelName}_${timestamp}.json`);

    await exporter.savePostsToFile(posts, outPath);

    console.log("\n✅ Готово. Дальше: адаптация текста (опционально) и планирование в ВК.");
}

if (require.main === module) {
    main();
}
