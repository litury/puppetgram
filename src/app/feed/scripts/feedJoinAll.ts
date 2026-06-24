/**
 * feedJoinAll — вступить аккаунтом во ВСЕ каналы из channel_cursors RESOLVE-FREE.
 *
 * Использует кэш access_hash (access_hash_cache) — строит InputChannel(channelId, accessHash)
 * и зовёт channels.JoinChannel БЕЗ ResolveUsername (главный флуд-киллер исключён).
 * Вступление = членство → Telegram шлёт live-push новых постов (real-time лента).
 *
 * Гентл-пейсинг + уважение FloodWait (на лимит — поспать retryAfter и продолжить).
 * JoinChannel лимитируется по КОЛИЧЕСТВУ за окно (~20–50 → FLOOD) — поэтому 134 канала
 * растянутся с паузами; это нормально. CHANNELS_TOO_MUCH (~500 кап) → стоп.
 *
 * Запуск: npm run feed:join-all
 * ENV:
 *   FEED_ACCOUNT_POOL          пул аккаунта (default 'join')
 *   FEED_JOIN_THROTTLE_MS      пауза между вступлениями (default 10000)
 *   FEED_JOIN_MAX              кап вступлений за прогон (0 = все; для суточных пачек)
 *   FEED_JOIN_DRYRUN=1         только показать сколько вступим, без JoinChannel
 *   FEED_FLOOD_SLEEP_THRESHOLD рекомендуется 60
 */

import * as dotenv from 'dotenv';
import { Api } from 'telegram';
import { AccountsRepository } from '../../../shared/database/repositories/accountsRepository';
import { AccessHashCacheRepository } from '../../../shared/database/repositories/accessHashCacheRepository';
import { FeedClient, credsFromAccount } from '../adapters/feedClient';
import { createLogger } from '../../../shared/utils/logger';

dotenv.config();

const log = createLogger('FeedJoinAll');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isFlood = (e: any): boolean =>
  /FLOOD/i.test(String(e?.errorMessage || e?.message || '')) || e?.constructor?.name === 'FloodWaitError';
const isTooMuch = (e: any): boolean => /CHANNELS_TOO_MUCH/i.test(String(e?.errorMessage || e?.message || ''));
const isAlready = (e: any): boolean => /USER_ALREADY_PARTICIPANT/i.test(String(e?.errorMessage || e?.message || ''));

async function main(): Promise<void> {
  const pool = process.env.FEED_ACCOUNT_POOL || 'join';
  const throttle = Number(process.env.FEED_JOIN_THROTTLE_MS || 10000);
  const max = Number(process.env.FEED_JOIN_MAX || 0);
  const dryRun = process.env.FEED_JOIN_DRYRUN === '1';

  const accountsRepo = new AccountsRepository();
  const ahc = new AccessHashCacheRepository();

  const accountsList = await accountsRepo.getActiveByPool(pool);
  if (!accountsList.length) { log.error('Нет активных аккаунтов в пуле', { pool }); process.exit(1); }
  const acc = accountsList[0];
  const accountId = Number(String(acc.sessionKey).split('_').pop());

  // Каналы с кэшированным access_hash именно у ЭТОГО аккаунта → вступаем resolve-free.
  const cov = await ahc.listForAccounts([accountId]);
  // дедуп по channelId
  const byId = new Map<number, string>();
  for (const c of cov) if (!byId.has(c.channelId)) byId.set(c.channelId, c.accessHash);
  const targets = [...byId.entries()];
  log.info('К вступлению', { account: acc.name, channels: targets.length });

  if (dryRun) { log.info('DRY-RUN — вступлений не делаю', { channels: targets.length }); process.exit(0); }

  const fc = new FeedClient(credsFromAccount(acc));
  await fc.connect();
  const client = fc.getClient();

  let joined = 0, already = 0, flood = 0, fail = 0;
  for (const [channelId, accessHash] of targets) {
    if (max && joined >= max) { log.info('Достигнут FEED_JOIN_MAX', { max }); break; }
    const input = new Api.InputChannel({ channelId: BigInt(channelId) as any, accessHash: BigInt(accessHash) as any });
    try {
      await client.invoke(new Api.channels.JoinChannel({ channel: input }));
      joined++;
    } catch (e: any) {
      if (isAlready(e)) { already++; }
      else if (isTooMuch(e)) { log.warn('CHANNELS_TOO_MUCH — стоп (кап ~500 каналов)'); break; }
      else if (isFlood(e)) {
        flood++; const w = Number(e?.seconds || 60);
        log.warn('FLOOD при вступлении — сплю и продолжаю', { wait: w, joined, already });
        await sleep((w + 2) * 1000);
        try { await client.invoke(new Api.channels.JoinChannel({ channel: input })); joined++; }
        catch (e2: any) { if (isAlready(e2)) already++; else if (isTooMuch(e2)) { log.warn('CHANNELS_TOO_MUCH — стоп'); break; } else fail++; }
      } else {
        fail++; log.warn('Вступление не удалось', { channelId, error: String(e?.errorMessage || e?.message || '').slice(0, 90) });
      }
    }
    if (joined % 10 === 0 && joined) log.info('Прогресс', { joined, already, flood, fail });
    await sleep(throttle);
  }

  log.info('Готово', { account: acc.name, joined, already, flood, fail, totalTargets: targets.length });
  await fc.disconnect();
  process.exit(0);
}

main().catch((e) => {
  log.error('Фатальная ошибка feedJoinAll', { error: (e as Error)?.message });
  process.exit(1);
});
