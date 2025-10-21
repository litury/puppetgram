/**
 * Утилита для фильтрации дубликатов на основе файлов с уже спарсенными каналами
 * Следует стандартам компании согласно frontend-coding-standards.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { ISimilarChannel } from '../interfaces';

/**
 * Интерфейс для результата загрузки фильтров
 */
interface IFilterLoadResult {
    /** Множество юзернеймов для исключения */
    excludeUsernames: Set<string>;
    /** Количество загруженных файлов */
    filesLoaded: number;
    /** Общее количество каналов для исключения */
    totalExclusions: number;
    /** Список загруженных файлов */
    loadedFiles: string[];
}

/**
 * Загружает список каналов для исключения из директории filter-duplicates
 */
export function loadExclusionFilters(): IFilterLoadResult {
    const filterDir = path.join(__dirname, '..', 'filter-duplicates', 'parsed-channels');
    const excludeUsernames = new Set<string>();
    const loadedFiles: string[] = [];

    // Проверяем существование директории
    if (!fs.existsSync(filterDir)) {
        console.log('📁 Директория filter-duplicates/parsed-channels не найдена, фильтрация отключена');
        return {
            excludeUsernames,
            filesLoaded: 0,
            totalExclusions: 0,
            loadedFiles
        };
    }

    try {
        const files = fs.readdirSync(filterDir);
        const txtFiles = files.filter(file => file.endsWith('.txt'));

        if (txtFiles.length === 0) {
            console.log('📁 Файлы фильтрации не найдены в filter-duplicates/parsed-channels/');
            return {
                excludeUsernames,
                filesLoaded: 0,
                totalExclusions: 0,
                loadedFiles
            };
        }

        console.log(`🔍 Загружаем фильтры из ${txtFiles.length} файлов...`);

        for (const file of txtFiles) {
            const filePath = path.join(filterDir, file);
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                let channelsFromFile = 0;

                for (const line of lines) {
                    const trimmedLine = line.trim();

                    // Пропускаем пустые строки и комментарии
                    if (!trimmedLine || trimmedLine.startsWith('#')) {
                        continue;
                    }

                    // Нормализуем юзернейм (убираем @ и приводим к нижнему регистру)
                    const normalizedUsername = trimmedLine.replace(/^@/, '').toLowerCase();

                    if (normalizedUsername) {
                        excludeUsernames.add(normalizedUsername);
                        channelsFromFile++;
                    }
                }

                loadedFiles.push(file);
                console.log(`  ✅ ${file}: ${channelsFromFile} каналов`);

            } catch (error) {
                console.warn(`  ⚠️ Ошибка чтения файла ${file}:`, error);
            }
        }

        const totalExclusions = excludeUsernames.size;
        console.log(`🚫 Всего каналов для исключения: ${totalExclusions}`);

        return {
            excludeUsernames,
            filesLoaded: txtFiles.length,
            totalExclusions,
            loadedFiles
        };

    } catch (error) {
        console.error('❌ Ошибка загрузки фильтров:', error);
        return {
            excludeUsernames,
            filesLoaded: 0,
            totalExclusions: 0,
            loadedFiles
        };
    }
}

/**
 * Фильтрует список каналов, исключая дубликаты на основе загруженных фильтров
 */
export function filterDuplicateChannels(
    _channels: ISimilarChannel[],
    _exclusionSet: Set<string>
): { filteredChannels: ISimilarChannel[], excludedCount: number } {

    if (_exclusionSet.size === 0) {
        return {
            filteredChannels: _channels,
            excludedCount: 0
        };
    }

    const filteredChannels: ISimilarChannel[] = [];
    let excludedCount = 0;

    for (const channel of _channels) {
        if (!channel.username) {
            // Если нет юзернейма, оставляем канал
            filteredChannels.push(channel);
            continue;
        }

        const normalizedUsername = channel.username.toLowerCase();

        if (_exclusionSet.has(normalizedUsername)) {
            excludedCount++;
            console.log(`🚫 Исключен дубликат: @${channel.username}`);
        } else {
            filteredChannels.push(channel);
        }
    }

    return {
        filteredChannels,
        excludedCount
    };
}

/**
 * Добавляет новый файл с результатами в директорию фильтрации
 * для использования в будущих запусках
 */
export function addToExclusionList(_channels: ISimilarChannel[], _sourceChannel: string): void {
    try {
        const filterDir = path.join(__dirname, '..', 'filter-duplicates', 'parsed-channels');

        // Создаем директорию если не существует
        if (!fs.existsSync(filterDir)) {
            fs.mkdirSync(filterDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const sourceChannelName = _sourceChannel.replace(/[@]/g, '');
        const filename = `${sourceChannelName}_parsed_${timestamp}.txt`;
        const filePath = path.join(filterDir, filename);

        // Создаем содержимое файла
        let content = `# Результаты парсинга похожих каналов для ${_sourceChannel}\n`;
        content += `# Дата: ${new Date().toLocaleString()}\n`;
        content += `# Найдено каналов: ${_channels.length}\n\n`;

        for (const channel of _channels) {
            if (channel.username) {
                content += `@${channel.username}\n`;
            }
        }

        fs.writeFileSync(filePath, content, 'utf-8');

        console.log(`\n📝 Результаты добавлены в фильтр: ${filename}`);
        console.log(`💡 Эти каналы будут исключены из будущих поисков`);

    } catch (error) {
        console.warn('⚠️ Не удалось добавить результаты в фильтр:', error);
    }
} 