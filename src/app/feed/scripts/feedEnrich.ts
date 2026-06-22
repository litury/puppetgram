/**
 * feed:enrich — воркер обогащения/скоринга (MVP: метрики + score, без AI).
 *
 * Бесконечный цикл: claimBatch (SKIP LOCKED) → score → setScore → done. Масштабируется
 * репликами (несколько контейнеров безопасно делят очередь). Периодически чистит done-задания.
 *
 * Запуск: npm run feed:enrich
 */

import * as dotenv from 'dotenv';
import { createLogger } from '../../../shared/utils/logger';
import { FeedEnricherService } from '../services/feedEnricherService';
import { FeedJobsRepository } from '../../../shared/database/repositories/feedJobsRepository';

dotenv.config();
const log = createLogger('FeedEnrich');

const CONFIG = {
  batchSize: Number(process.env.FEED_ENRICH_BATCH || 50),
  idleSleepMs: Number(process.env.FEED_ENRICH_IDLE_MS || 5000),
  purgeEveryMs: Number(process.env.FEED_PURGE_EVERY_MS || 3600_000),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const enricher = new FeedEnricherService();
  const jobs = new FeedJobsRepository();
  let running = true;
  let lastPurge = 0; // покетная чистка стартует не сразу (Date.now избегаем на самом старте не нужно)

  const shutdown = () => { running = false; log.info('Остановка feed:enrich…'); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log.info('Старт feed:enrich', CONFIG);
  while (running) {
    let processed = 0;
    try {
      processed = await enricher.processBatch(CONFIG.batchSize);
    } catch (e: any) {
      log.warn('Ошибка батча enrich', { error: e?.message });
    }

    const now = Date.now();
    if (now - lastPurge > CONFIG.purgeEveryMs) {
      try {
        const purged = await jobs.purgeDone(24);
        if (purged > 0) log.debug('Подчищены done-задания', { purged });
      } catch { /* ignore */ }
      lastPurge = now;
    }

    if (processed === 0) await sleep(CONFIG.idleSleepMs);
  }
  process.exit(0);
}

main().catch((e) => {
  log.error('Фатальная ошибка feed:enrich', e as Error);
  process.exit(1);
});
