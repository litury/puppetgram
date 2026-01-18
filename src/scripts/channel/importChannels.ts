/**
 * Импорт каналов из текстового файла в базу данных
 *
 * Использование:
 *   npm run channels:import path/to/channels.txt [--status new|done|error|skipped] [--parsed]
 *
 * Примеры:
 *   npm run channels:import channels.txt                    # статус new
 *   npm run channels:import successful.txt --status done    # статус done
 *   npm run channels:import failed.txt --status error       # статус error
 *   npm run channels:import processed.txt --parsed          # пометить как спарсенные
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

type Status = 'new' | 'done' | 'error' | 'skipped';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Использование: npm run channels:import <путь_к_файлу> [--status new|done|error|skipped] [--parsed]');
    console.log('Примеры:');
    console.log('  npm run channels:import channels.txt');
    console.log('  npm run channels:import successful.txt --status done');
    console.log('  npm run channels:import failed.txt --status error');
    console.log('  npm run channels:import processed.txt --parsed');
    process.exit(1);
  }

  const filePath = args[0];

  // Парсим --status
  let status: Status = 'new';
  const statusIndex = args.indexOf('--status');
  if (statusIndex !== -1 && args[statusIndex + 1]) {
    const statusArg = args[statusIndex + 1] as Status;
    if (['new', 'done', 'error', 'skipped'].includes(statusArg)) {
      status = statusArg;
    } else {
      console.error(`Неверный статус: ${statusArg}. Допустимые: new, done, error, skipped`);
      process.exit(1);
    }
  }

  // Парсим --parsed
  const markAsParsed = args.includes('--parsed');

  // Проверяем существование файла
  if (!fs.existsSync(filePath)) {
    console.error(`Файл не найден: ${filePath}`);
    process.exit(1);
  }

  const parsedInfo = markAsParsed ? ', parsed: true' : '';
  console.log(`Импорт каналов из: ${filePath} (статус: ${status}${parsedInfo})`);

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

  // Для статуса 'new' используем быстрый addChannels, иначе upsertWithStatus
  if (status === 'new') {
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

    // Если указан --parsed, помечаем каналы как спарсенные
    if (markAsParsed) {
      console.log('Помечаю каналы как спарсенные...');
      const markedCount = await repo.markParsedBatch(channels);
      console.log(`   Помечено parsed=true: ${markedCount}`);
    }

    // Показываем статистику
    const parsedStats = await repo.getParsedStats();

    console.log('\n✅ Импорт завершён!');
    console.log(`   Добавлено новых: ${totalAdded}`);
    console.log(`   Пропущено дубликатов: ${channels.length - totalAdded}`);
    console.log('\n📊 Статистика очереди:');
    console.log(`   Всего: ${stats.total}`);
    console.log(`   Новых (new): ${stats.new}`);
    console.log(`   Обработано (done): ${stats.done}`);
    console.log(`   Ошибок (error): ${stats.error}`);
    console.log(`   Пропущено (skipped): ${stats.skipped}`);
    console.log('\n📊 Статистика парсинга:');
    console.log(`   Спарсено (parsed): ${parsedStats.parsed}`);
    console.log(`   Не спарсено: ${parsedStats.unparsed}`);
  } else if (markAsParsed) {
    // Только пометить как спарсенные (без изменения статуса)
    const BATCH_SIZE = 1000;
    let totalMarked = 0;

    for (let i = 0; i < channels.length; i += BATCH_SIZE) {
      const batch = channels.slice(i, i + BATCH_SIZE);
      const marked = await repo.markParsedBatch(batch);
      totalMarked += marked;

      const progress = Math.min(i + BATCH_SIZE, channels.length);
      console.log(`  Обработано: ${progress}/${channels.length} (помечено: ${totalMarked})`);
    }

    // Показываем статистику
    const parsedStats = await repo.getParsedStats();

    console.log('\n✅ Импорт завершён!');
    console.log(`   Помечено parsed=true: ${totalMarked}`);
    console.log('\n📊 Статистика парсинга:');
    console.log(`   Спарсено (parsed): ${parsedStats.parsed}`);
    console.log(`   Не спарсено: ${parsedStats.unparsed}`);
  } else {
    // Upsert со статусом (batch операции)
    const BATCH_SIZE = 1000;
    let totalUpdated = 0;

    for (let i = 0; i < channels.length; i += BATCH_SIZE) {
      const batch = channels.slice(i, i + BATCH_SIZE);
      const result = await repo.upsertWithStatus(batch, status);
      totalUpdated += result.updated;

      const progress = Math.min(i + BATCH_SIZE, channels.length);
      console.log(`  Обработано: ${progress}/${channels.length}`);
    }

    // Показываем статистику
    const stats = await repo.getStats();

    console.log('\n✅ Импорт завершён!');
    console.log(`   Обработано записей: ${totalUpdated}`);
    console.log('\n📊 Статистика очереди:');
    console.log(`   Всего: ${stats.total}`);
    console.log(`   Новых (new): ${stats.new}`);
    console.log(`   Обработано (done): ${stats.done}`);
    console.log(`   Ошибок (error): ${stats.error}`);
    console.log(`   Пропущено (skipped): ${stats.skipped}`);
  }
}

main().catch((error) => {
  console.error('Ошибка:', error);
  process.exit(1);
});
