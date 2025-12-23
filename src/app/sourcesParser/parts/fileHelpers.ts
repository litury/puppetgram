/**
 * Внутренние хелперы для работы с файлами
 * Используются только внутри модуля sourcesParser
 */

import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.resolve(__dirname, '../data');

/**
 * Загрузка списка каналов из файла
 */
export function loadChannelsList(filename: string): string[] {
  const filePath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const channels: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Пропускаем пустые строки и комментарии
    if (trimmed && !trimmed.startsWith('#')) {
      // Нормализуем: убираем @ если есть
      const normalized = trimmed.replace(/^@/, '').toLowerCase();
      if (normalized) {
        channels.push(normalized);
      }
    }
  }

  return channels;
}

/**
 * Загрузка в Set для быстрой проверки O(1)
 */
export function loadChannelsSet(filename: string): Set<string> {
  const channels = loadChannelsList(filename);
  return new Set(channels);
}

/**
 * Добавление канала в файл (append)
 */
export function appendChannel(filename: string, channel: string): void {
  const filePath = path.join(DATA_DIR, filename);
  const normalized = channel.replace(/^@/, '').toLowerCase();

  // Создаём директорию если не существует
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  fs.appendFileSync(filePath, `@${normalized}\n`, 'utf-8');
}

/**
 * Добавление списка каналов в файл (append)
 */
export function appendChannels(filename: string, channels: string[]): void {
  if (channels.length === 0) return;

  const filePath = path.join(DATA_DIR, filename);

  // Создаём директорию если не существует
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const normalized = channels.map(ch => `@${ch.replace(/^@/, '').toLowerCase()}`);
  fs.appendFileSync(filePath, normalized.join('\n') + '\n', 'utf-8');
}

/**
 * Проверка существования файла
 */
export function fileExists(filename: string): boolean {
  const filePath = path.join(DATA_DIR, filename);
  return fs.existsSync(filePath);
}

/**
 * Получение количества строк в файле
 */
export function countLines(filename: string): number {
  const filePath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return 0;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').filter(line => line.trim() && !line.startsWith('#')).length;
}

/**
 * Создание пустого файла с заголовком
 */
export function createFileWithHeader(filename: string, header: string): void {
  const filePath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  fs.writeFileSync(filePath, `# ${header}\n# Created: ${new Date().toISOString()}\n\n`, 'utf-8');
}
