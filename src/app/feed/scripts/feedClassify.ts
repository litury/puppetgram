/**
 * feed:classify — авто-классификация постов (DeepSeek).
 *
 * Режимы:
 *   --sample N   классифицировать N свежих постов, напечатать распределение + примеры, БЕЗ записи (валидация).
 *   (по умолчанию --sample 200)
 *   --write      боевой прогон: классифицировать все непомеченные (category IS NULL) и записать в БД.
 *
 * Запуск: npm run feed:classify -- --sample 200   |   npm run feed:classify -- --write
 * ENV: DEEPSEEK_API_KEY (+ DEEPSEEK_BASE_URL/DEEPSEEK_MODEL); FEED_CLASSIFY_BATCH (default 12).
 */

import * as dotenv from 'dotenv';
import { createLogger } from '../../../shared/utils/logger';
import { PostsRepository } from '../../../shared/database/repositories/postsRepository';
import { FeedClassifierService } from '../services/feedClassifierService';
import { isItCategory } from '../config/contentCategories';

dotenv.config();
const log = createLogger('FeedClassify');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const sIdx = args.indexOf('--sample');
  const limit = write ? Number(process.env.FEED_CLASSIFY_MAX || 100000) : Number((sIdx >= 0 && args[sIdx + 1]) || 200);
  const batchSize = Number(process.env.FEED_CLASSIFY_BATCH || 12);

  if (!process.env.DEEPSEEK_API_KEY) { log.error('Нет DEEPSEEK_API_KEY в env'); process.exit(1); }

  const posts = new PostsRepository();
  const clf = new FeedClassifierService();
  const items = await posts.listUnclassified(limit);
  log.info(write ? 'Боевой прогон классификации' : 'Сэмпл-валидация (без записи)', { posts: items.length, batchSize });
  if (!items.length) { log.info('Нечего классифицировать'); process.exit(0); }

  const dist: Record<string, number> = {};
  const examples: Array<{ category: string; text: string }> = [];
  let done = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const byMid = new Map(batch.map((p) => [p.tgMessageId, p]));
    const res = await clf.classifyBatch(batch.map((p) => ({ mid: p.tgMessageId, text: p.text })));
    for (const r of res) {
      const src = byMid.get(r.mid);
      if (!src) continue;
      dist[r.category] = (dist[r.category] || 0) + 1;
      if (write) await posts.setClassification(src.channelId, src.tgMessageId, r.category);
      else if (examples.length < 25) examples.push({ category: r.category, text: src.text.slice(0, 90).replace(/\s+/g, ' ') });
      done++;
    }
    await sleep(300);
  }

  const itCount = Object.entries(dist).filter(([c]) => isItCategory(c)).reduce((s, [, n]) => s + n, 0);
  log.info('Готово', { classified: done, it: itCount, nonIt: done - itCount });
  log.info('Распределение по категориям', dist);
  if (!write) for (const e of examples) log.info(`  [${e.category}] ${e.text}`);
  process.exit(0);
}

main().catch((e) => { log.error('Фатальная ошибка feed:classify', e as Error); process.exit(1); });
