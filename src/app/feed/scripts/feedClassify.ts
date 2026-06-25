/**
 * feed:classify — авто-классификация постов (DeepSeek): IT vs не-IT + reason.
 *
 * Режимы:
 *   --sample N   классифицировать N свежих постов, напечатать IT/не-IT split + reason-распределение + примеры. БЕЗ записи.
 *   --write      боевой прогон: классифицировать все непомеченные (category IS NULL) и записать reason в БД.
 *
 * Запуск: npm run feed:classify -- --sample 200   |   npm run feed:classify -- --write
 * ENV: DEEPSEEK_API_KEY (+ DEEPSEEK_BASE_URL/DEEPSEEK_MODEL); FEED_CLASSIFY_BATCH (default 12).
 */

import * as dotenv from 'dotenv';
import { writeFileSync } from 'fs';
import { createLogger } from '../../../shared/utils/logger';
import { PostsRepository } from '../../../shared/database/repositories/postsRepository';
import { FeedClassifierService } from '../services/feedClassifierService';

dotenv.config();
const log = createLogger('FeedClassify');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const csvCell = (s: string) => `"${String(s).replace(/"/g, '""').replace(/\s+/g, ' ').trim()}"`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const sIdx = args.indexOf('--sample');
  const oIdx = args.indexOf('--out');
  const outPath = oIdx >= 0 ? args[oIdx + 1] : null;
  const limit = write ? Number(process.env.FEED_CLASSIFY_MAX || 100000) : Number((sIdx >= 0 && args[sIdx + 1]) || 200);
  const batchSize = Number(process.env.FEED_CLASSIFY_BATCH || 12);
  const csvRows: string[] = outPath ? ['channel,mid,is_it,reason,text'] : [];

  if (!process.env.DEEPSEEK_API_KEY) { log.error('Нет DEEPSEEK_API_KEY в env'); process.exit(1); }

  const posts = new PostsRepository();
  const clf = new FeedClassifierService();
  const items = await posts.listUnclassified(limit);
  log.info(write ? 'Боевой прогон классификации' : 'Сэмпл-валидация (без записи)', { posts: items.length, batchSize });
  if (!items.length) { log.info('Нечего классифицировать'); process.exit(0); }

  const reasons: Record<string, number> = {};
  const examples: Array<{ isIt: boolean; reason: string; text: string }> = [];
  let it = 0, notIt = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const byMid = new Map(batch.map((p) => [p.tgMessageId, p]));
    const res = await clf.classifyBatch(batch.map((p) => ({ mid: p.tgMessageId, text: p.text })));
    for (const r of res) {
      const src = byMid.get(r.mid);
      if (!src) continue;
      r.isIt ? it++ : notIt++;
      reasons[r.reason] = (reasons[r.reason] || 0) + 1;
      if (write) await posts.setClassification(src.channelId, src.tgMessageId, r.reason);
      if (outPath) csvRows.push([csvCell(src.channelUsername || String(src.channelId)), src.tgMessageId, r.isIt, r.reason, csvCell(src.text.slice(0, 300))].join(','));
      if (!write && !outPath && examples.length < 30) examples.push({ isIt: r.isIt, reason: r.reason, text: src.text.slice(0, 90).replace(/\s+/g, ' ') });
    }
    await sleep(300);
  }

  log.info('Готово', { classified: it + notIt, IT: it, 'не-IT': notIt });
  log.info('Распределение по reason', reasons);
  if (outPath) {
    // сортируем по каналу для удобного просмотра
    const header = csvRows[0]; const body = csvRows.slice(1).sort();
    writeFileSync(outPath, [header, ...body].join('\n'));
    log.info('CSV записан', { outPath, rows: body.length });
  } else if (!write) {
    for (const e of examples) log.info(`  ${e.isIt ? 'IT ' : 'НЕ '} [${e.reason}] ${e.text}`);
  }
  process.exit(0);
}

main().catch((e) => { log.error('Фатальная ошибка feed:classify', e as Error); process.exit(1); });
