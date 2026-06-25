/**
 * feed:classify — авто-классификация постов (DeepSeek): IT vs не-IT + reason.
 *
 * Режимы:
 *   --sample N        классифицировать N свежих постов, напечатать IT/не-IT split + reason + примеры. БЕЗ записи.
 *   --per-channel N   взять до N свежих постов НА КАНАЛ, вывести пер-канальную сводку (--out CSV). БЕЗ записи.
 *   --write           боевой: классифицировать все непомеченные (category IS NULL) и записать reason в БД.
 *   --out <path>      куда писать CSV (для --per-channel — сводка по каналам; иначе — по постам).
 *
 * ENV: DEEPSEEK_API_KEY (+ DEEPSEEK_BASE_URL/DEEPSEEK_MODEL); FEED_CLASSIFY_BATCH (default 12).
 */

import * as dotenv from 'dotenv';
import { writeFileSync } from 'fs';
import { createLogger } from '../../../shared/utils/logger';
import { PostsRepository } from '../../../shared/database/repositories/postsRepository';
import { FeedClassifierService } from '../services/feedClassifierService';
import { isItReason } from '../config/contentCategories';

dotenv.config();
const log = createLogger('FeedClassify');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const csvCell = (s: string) => `"${String(s).replace(/"/g, '""').replace(/\s+/g, ' ').trim()}"`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const argN = (flag: string, def: number) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def; };
  const perChannel = args.includes('--per-channel') ? argN('--per-channel', 10) : 0;
  const limit = write ? Number(process.env.FEED_CLASSIFY_MAX || 100000) : argN('--sample', 200);
  const oIdx = args.indexOf('--out');
  const outPath = oIdx >= 0 ? args[oIdx + 1] : null;
  const batchSize = Number(process.env.FEED_CLASSIFY_BATCH || 12);

  if (!process.env.DEEPSEEK_API_KEY) { log.error('Нет DEEPSEEK_API_KEY в env'); process.exit(1); }

  const posts = new PostsRepository();
  const clf = new FeedClassifierService();
  const items = perChannel
    ? await posts.listForChannelAnalytics(perChannel)
    : (await posts.listUnclassified(limit)).map((p) => ({ ...p }));
  log.info('Старт', { mode: perChannel ? `per-channel ${perChannel}` : write ? 'write' : 'sample', posts: items.length, batchSize });
  if (!items.length) { log.info('Нечего классифицировать'); process.exit(0); }

  // пер-канальная агрегация: channel → {total, it, reasons{}}
  const ch: Record<string, { total: number; it: number; reasons: Record<string, number> }> = {};
  let it = 0, notIt = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const byMid = new Map(batch.map((p) => [p.tgMessageId, p]));
    const res = await clf.classifyBatch(batch.map((p) => ({ mid: p.tgMessageId, text: p.text })));
    for (const r of res) {
      const src = byMid.get(r.mid);
      if (!src) continue;
      r.isIt ? it++ : notIt++;
      if (write) await posts.setClassification(src.channelId, src.tgMessageId, r.reason);
      const key = src.channelUsername || String(src.channelId);
      const c = (ch[key] ||= { total: 0, it: 0, reasons: {} });
      c.total++; if (r.isIt) c.it++; c.reasons[r.reason] = (c.reasons[r.reason] || 0) + 1;
    }
    await sleep(300);
  }

  log.info('Готово', { classified: it + notIt, IT: it, 'не-IT': notIt });

  if (perChannel && outPath) {
    const rows = Object.entries(ch).map(([name, c]) => {
      const notit = c.total - c.it;
      const top = Object.entries(c.reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}:${n}`).join(' ');
      return { name, total: c.total, it: c.it, notit, pct: Math.round((notit * 100) / c.total), top };
    }).sort((a, b) => b.pct - a.pct);
    const csv = ['channel,total,it,not_it,pct_not_it,reasons'];
    for (const r of rows) csv.push([csvCell(r.name), r.total, r.it, r.notit, r.pct, csvCell(r.top)].join(','));
    writeFileSync(outPath, csv.join('\n'));
    log.info('Пер-канальная сводка записана', { outPath, channels: rows.length });
  }
  process.exit(0);
}

main().catch((e) => { log.error('Фатальная ошибка feed:classify', e as Error); process.exit(1); });
