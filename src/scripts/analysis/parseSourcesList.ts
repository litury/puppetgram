/**
 * Парсинг рекомендаций для списка каналов из PostgreSQL
 *
 * Логика:
 * 1. Загружаем все известные каналы из БД (для фильтрации дубликатов)
 * 2. Получаем каналы где parsed=false (источники для парсинга)
 * 3. Для каждого канала:
 *    - Запрашиваем рекомендации через GetChannelRecommendations
 *    - Фильтруем (только новые, которых нет в БД)
 *    - Сохраняем новые каналы в target_channels с parsed=false
 *    - Помечаем источник как parsed=true
 *    - При FloodWait → ротация на другой PARSER аккаунт
 *
 * Использование:
 * 1. Добавь PARSER аккаунты в .env (SESSION_STRING_PARSER_1, SESSION_STRING_PARSER_2, ...)
 * 2. Импортируй исходные каналы: npm run import -- data/sources.txt
 * 3. Запусти парсинг: npm run parse:sources
 * 4. Новые каналы автоматически попадут в target_channels
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { SourcesParserService, IParserAccount } from '../../app/sourcesParser';
import { EnvAccountsParser } from '../../shared/utils/envAccountsParser';
import { createLogger } from '../../shared/utils/logger';

const log = createLogger('ParseSources');

async function main(): Promise<void> {
  log.info('=== Парсинг рекомендаций каналов ===\n');

  // Загружаем PARSER аккаунты
  const accountsParser = new EnvAccountsParser();
  const rawAccounts = accountsParser.getAvailableAccounts('PARSER');

  if (rawAccounts.length === 0) {
    log.error('Не найдено PARSER аккаунтов в .env');
    log.info('Добавьте аккаунты в формате:');
    log.info('### Parser 1');
    log.info('SESSION_STRING_PARSER_1="..."');
    process.exit(1);
  }

  // Преобразуем в формат IParserAccount
  const accounts: IParserAccount[] = rawAccounts.map(acc => ({
    name: acc.name,
    sessionKey: acc.sessionKey,
    sessionValue: acc.sessionValue || acc.session || '',
    apiId: acc.apiId || parseInt(process.env.API_ID || '0'),
    apiHash: acc.apiHash || process.env.API_HASH || ''
  }));

  log.info(`Найдено ${accounts.length} PARSER аккаунтов:`);
  accounts.forEach((acc, i) => log.info(`  ${i + 1}. ${acc.name}`));
  console.log('');

  // Создаём сервис
  const service = new SourcesParserService(accounts);

  try {
    // Загружаем данные
    await service.loadData();

    const stats = await service.getStats();
    if (stats.unparsed === 0) {
      log.info('Все каналы уже обработаны!');
      log.info(`Новых каналов найдено: ${stats.newChannels}`);
      log.info(`Всего известно: ${stats.knownChannels}`);
      return;
    }

    // Подключаемся к первому аккаунту
    const connected = await service.connectFirstAccount();
    if (!connected) {
      log.error('Не удалось подключиться ни к одному аккаунту');
      process.exit(1);
    }

    // Запускаем парсинг
    const result = await service.parseAll();

    // Выводим итоговую статистику
    console.log('\n=== ИТОГИ ===');
    log.info(`Всего источников: ${result.totalSources}`);
    log.info(`Обработано: ${result.processedCount}`);
    log.info(`Найдено НОВЫХ каналов: ${result.resultsCount}`);

  } catch (error: any) {
    log.error(`Критическая ошибка: ${error.message}`);

    // Выводим статистику даже при ошибке
    const stats = await service.getStats();
    console.log('\n=== СТАТИСТИКА НА МОМЕНТ ОСТАНОВКИ ===');
    log.info(`Обработано: ${stats.parsed} из ${stats.total}`);
    log.info(`Осталось: ${stats.unparsed}`);
    log.info(`Новых каналов: ${stats.newChannels}`);
    log.info(`Всего известно: ${stats.knownChannels}`);
    log.info('Прогресс сохранён в БД, можно продолжить позже');

  } finally {
    await service.disconnect();
  }
}

// Обработка Ctrl+C
process.on('SIGINT', () => {
  log.warn('\nПолучен сигнал остановки (Ctrl+C)');
  log.info('Прогресс сохранён в PostgreSQL (target_channels)');
  log.info('Можно продолжить парсинг позже — обработка продолжится с непарсенных каналов');
  process.exit(0);
});

// Запуск
main().catch(error => {
  log.error(`Необработанная ошибка: ${error.message}`);
  process.exit(1);
});
