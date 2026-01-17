/**
 * Импорт каналов из текстового файла в базу данных
 *
 * Использование:
 *   npm run channels:import path/to/channels.txt
 *
 * Формат файла:
 *   @channel1
 *   @channel2
 *   channel3
 *   # комментарий (пропускается)
 */

import 'dotenv/config';
import * as fs from 'fs';
import { TargetChannelsRepository } from '../../shared/database';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Использование: npm run channels:import <путь_к_файлу>');
    console.log('Пример: npm run channels:import src/app/commenting/data/inputs/channel-commenting/channels.txt');
    process.exit(1);
  }

  const filePath = args[0];

  // Проверяем существование файла
  if (!fs.existsSync(filePath)) {
    console.error(`Файл не найден: ${filePath}`);
    process.exit(1);
  }

  console.log(`Импорт каналов из: ${filePath}`);

  // Читаем файл
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Парсим каналы
  const channels: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();

    // Пропускаем пустые строки и комментарии
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Убираем @ и приводим к нижнему регистру
    const username = trimmed.replace('@', '').toLowerCase();
    channels.push(username);
  }

  console.log(`Найдено каналов в файле: ${channels.length}`);

  if (channels.length === 0) {
    console.log('Нет каналов для импорта');
    process.exit(0);
  }

  // Импортируем в БД
  const repo = new TargetChannelsRepository();

  console.log('Импортирую в базу данных...');

  // Импортируем батчами по 1000 для производительности
  const BATCH_SIZE = 1000;
  let totalAdded = 0;

  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE);
    const added = await repo.addChannels(batch);
    totalAdded += added;

    const progress = Math.min(i + BATCH_SIZE, channels.length);
    console.log(`  Обработано: ${progress}/${channels.length} (добавлено: ${totalAdded})`);
  }

  // Показываем статистику
  const stats = await repo.getStats();

  console.log('\n✅ Импорт завершён!');
  console.log(`   Добавлено новых: ${totalAdded}`);
  console.log(`   Пропущено дубликатов: ${channels.length - totalAdded}`);
  console.log('\n📊 Статистика очереди:');
  console.log(`   Всего: ${stats.total}`);
  console.log(`   Новых (new): ${stats.new}`);
  console.log(`   Обработано (done): ${stats.done}`);
  console.log(`   Ошибок (error): ${stats.error}`);
  console.log(`   Пропущено (skipped): ${stats.skipped}`);
}

main().catch((error) => {
  console.error('Ошибка:', error);
  process.exit(1);
});
