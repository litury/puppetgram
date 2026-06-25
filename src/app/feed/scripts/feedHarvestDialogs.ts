/**
 * feed:harvest-dialogs — собрать пул из ПОДПИСОК аккаунта (iterDialogs), пред-фильтр ПО ПОСТАМ.
 *
 * Берём только broadcast-каналы с @username (чаты/группы/боты/юзеры — отбрасываем).
 * Для каждого канала читаем N свежих постов (resolve-free — аккаунт уже член) → пост-классификатор → доля IT.
 * dry-run (по умолчанию): печатает распределение IT% по каналам. --write <порог 0..100>: пишет каналы с IT% ≥ порога.
 *
 * Запуск: npm run feed:harvest-dialogs                 (dry-run)
 *         npm run feed:harvest-dialogs -- --write 40   (записать каналы с IT-долей ≥40%)
 * ENV: FEED_HARVEST_POOL (default 'harvest'), DEEPSEEK_API_KEY, FEED_DIALOGS_POSTS (default 20),
 *      FEED_DIALOGS_READ_MS (пауза между каналами, default 400), FEED_FLOOD_SLEEP_THRESHOLD (=30 пережить getDialogs-флуд).
 */

import * as dotenv from 'dotenv';
import { writeFileSync } from 'fs';
import { Api } from 'telegram';
import { AccountsRepository } from '../../../shared/database/repositories/accountsRepository';
import { ChannelCursorsRepository } from '../../../shared/database/repositories/channelCursorsRepository';
import { AccessHashCacheRepository } from '../../../shared/database/repositories/accessHashCacheRepository';
import { FeedClient, credsFromAccount } from '../adapters/feedClient';
import { FeedClassifierService } from '../services/feedClassifierService';
import { isItReason } from '../config/contentCategories';
import { createLogger } from '../../../shared/utils/logger';

dotenv.config();
const log = createLogger('HarvestDialogs');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const csv = (s: string) => `"${String(s).replace(/"/g, '""').replace(/\s+/g, ' ').trim()}"`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wIdx = args.indexOf('--write');
  const write = wIdx >= 0;
  const threshold = write ? Number(args[wIdx + 1] || 40) : 0;
  const pool = process.env.FEED_HARVEST_POOL || 'harvest';
  const perChannel = Number(process.env.FEED_DIALOGS_POSTS || 20);
  const readMs = Number(process.env.FEED_DIALOGS_READ_MS || 400);
  if (!process.env.DEEPSEEK_API_KEY) { log.error('Нет DEEPSEEK_API_KEY'); process.exit(1); }

  const accountsRepo = new AccountsRepository();
  const cursors = new ChannelCursorsRepository();
  const ahc = new AccessHashCacheRepository();
  const clf = new FeedClassifierService();

  const accounts = await accountsRepo.getActiveByPool(pool);
  if (!accounts.length) { log.error('Нет аккаунтов в пуле', { pool }); process.exit(1); }
  const acc = accounts[0];
  const accountId = Number(String(acc.sessionKey).split('_').pop());
  const fc = new FeedClient(credsFromAccount(acc));
  await fc.connect();
  const client = fc.getClient();

  // 1) iterDialogs → broadcast-каналы с username + access_hash
  const chans = new Map<string, { id: number; accessHash: string; username: string; title: string }>();
  let dialogs = 0, skipped = 0;
  for await (const d of client.iterDialogs({})) {
    dialogs++;
    const e: any = (d as any).entity;
    if (e?.className === 'Channel' && e?.broadcast === true && e?.username && e?.accessHash != null) {
      chans.set(String(e.username).toLowerCase(), {
        id: Number(e.id.toString()), accessHash: String(e.accessHash),
        username: String(e.username).toLowerCase(), title: String(e.title || ''),
      });
    } else skipped++;
  }
  const list = [...chans.values()];
  log.info('Диалоги обойдены', { dialogs, broadcast_channels: list.length, skipped_chats: skipped, postsPerChannel: perChannel });

  // 2) по каждому каналу: читаем посты → классифицируем → доля IT
  const stats: Array<{ c: typeof list[number]; total: number; it: number }> = [];
  let done = 0;
  for (const c of list) {
    try {
      const input = new Api.InputChannel({ channelId: BigInt(c.id) as any, accessHash: BigInt(c.accessHash) as any });
      const msgs: any[] = await client.getMessages(input, { limit: perChannel });
      const texts = msgs.filter((m) => m?.message).map((m) => ({ mid: Number(m.id), text: String(m.message) }));
      let it = 0, total = 0;
      for (let i = 0; i < texts.length; i += 15) {
        const res = await clf.classifyBatch(texts.slice(i, i + 15));
        for (const r of res) { total++; if (isItReason(r.reason)) it++; }
      }
      stats.push({ c, total, it });
    } catch (e: any) {
      log.warn('Канал не прочитан', { ch: c.username, error: e?.message });
      stats.push({ c, total: 0, it: 0 });
    }
    if (++done % 50 === 0) log.info('Прогресс', { done, of: list.length });
    await sleep(readMs);
  }

  // 3) доля IT, сортировка, распределение по корзинам
  const scored = stats.map((s) => ({ ...s, pct: s.total ? Math.round((s.it * 100) / s.total) : -1 }))
    .sort((a, b) => b.pct - a.pct);
  const buckets = { '80-100': 0, '60-79': 0, '40-59': 0, '20-39': 0, '0-19': 0, 'no_posts': 0 };
  for (const s of scored) {
    if (s.pct < 0) buckets.no_posts++;
    else if (s.pct >= 80) buckets['80-100']++;
    else if (s.pct >= 60) buckets['60-79']++;
    else if (s.pct >= 40) buckets['40-59']++;
    else if (s.pct >= 20) buckets['20-39']++;
    else buckets['0-19']++;
  }
  log.info('Распределение IT% по каналам', buckets);
  log.info('Топ-IT каналы', { sample: scored.filter((s) => s.pct >= 50).slice(0, 25).map((s) => `@${s.c.username} ${s.pct}% (${s.c.title})`) });
  log.info('Низ (кандидаты НЕ брать)', { sample: scored.filter((s) => s.pct >= 0 && s.pct < 30).slice(0, 20).map((s) => `@${s.c.username} ${s.pct}%`) });

  // CSV для ревью
  const rows = ['channel,it_pct,it,total,title', ...scored.map((s) => [csv(s.c.username), s.pct, s.it, s.total, csv(s.c.title)].join(','))];
  writeFileSync('/tmp/harvest_channels.csv', rows.join('\n'));
  log.info('CSV сохранён', { path: '/tmp/harvest_channels.csv' });

  if (write) {
    let added = 0;
    for (const s of scored) {
      if (s.pct < threshold) continue;
      await cursors.ensure(s.c.id, s.c.username);
      try { await ahc.set(accountId, s.c.id, BigInt(s.c.accessHash), s.c.username); } catch { /* не критично */ }
      added++;
    }
    log.info('Записано в пул (IT% ≥ порога)', { threshold, added, poolTotalNow: await cursors.count() });
  } else {
    log.info('DRY-RUN — ничего не записано. Запись: --write <порог>, напр. --write 40');
  }
  await fc.disconnect();
  process.exit(0);
}

main().catch((e) => { log.error('Фатальная ошибка feed:harvest-dialogs', { error: (e as Error)?.message }); process.exit(1); });
