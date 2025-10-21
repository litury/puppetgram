/**
 * Вспомогательные функции для работы с файлами и данными
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Загружает список каналов из файла
 */
export async function loadChannelsFromFile(filePath: string): Promise<string[]> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');

        return content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#')) // Исключаем комментарии
            .map(line => {
                // Очищаем от возможных лишних символов
                const cleaned = line.replace(/[@\s]/g, '');
                return cleaned.startsWith('@') ? cleaned : `@${cleaned}`;
            });
    } catch (error: any) {
        throw new Error(`Ошибка при загрузке файла ${filePath}: ${error.message}`);
    }
}

/**
 * Сохраняет список каналов в файл
 */
export async function saveChannelsToFile(channels: string[], filePath: string): Promise<void> {
    try {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        const content = channels.join('\n');
        await fs.writeFile(filePath, content, 'utf-8');
    } catch (error: any) {
        throw new Error(`Ошибка при сохранении файла ${filePath}: ${error.message}`);
    }
}

/**
 * Проверяет существование файла
 */
export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Создает директорию если её нет
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error: any) {
        throw new Error(`Ошибка при создании директории ${dirPath}: ${error.message}`);
    }
}

/**
 * Форматирует дату для имени файла
 */
export function formatDateForFilename(date: Date = new Date()): string {
    return date.toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

/**
 * Очищает имя канала от лишних символов
 */
export function cleanChannelName(channelName: string): string {
    return channelName.replace(/[@\s]/g, '');
}

/**
 * Добавляет @ к имени канала если его нет
 */
export function ensureChannelPrefix(channelName: string): string {
    const cleaned = cleanChannelName(channelName);
    return cleaned.startsWith('@') ? cleaned : `@${cleaned}`;
}

/**
 * Генерирует случайную задержку между запросами
 */
export function getRandomDelay(min: number = 1000, max: number = 3000): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Промиса с задержкой
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
} 