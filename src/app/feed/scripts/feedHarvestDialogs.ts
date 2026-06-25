/**
 * feed:harvest-dialogs — собрать пул из ПОДПИСОК аккаунта (его iterDialogs), с пред-фильтром.
 *
 * Берём ТОЛЬКО broadcast-каналы с @username (чаты/группы/боты/юзеры отбрасываем).
 * Пред-фильтр «только IT» по названию канала (LLM, без чтения постов).
 * dry-run (по умолчанию) — только посчитать и показать; --write — добавить IT-каналы в channel_cursors.
 *
 * Запуск: npm run feed:harvest-dialogs            (dry-run)
 *         npm run feed:harvest-dialogs -- --write (запись)
 * ENV: FEED_HARVEST_POOL (default 'harvest'), DEEPSEEK_API_KEY, FEED_DIALOGS_LIMIT (0=все).
 */

import * as dotenv from 'dotenv';
import { AccountsRepository } from '../../../shared/database/repositories/accountsRepository';
import { ChannelCursorsRepository } from '../../../shared/database/repositories/channelCursorsRepository';
import { AccessHashCacheRepository } from '../../../shared/database/repositories/accessHashCacheRepository';
import { FeedClient, credsFromAccount } from '../adapters/feedClient';
import { FeedClassifierService } from '../services/feedClassifierService';
import { createLogger } from '../../../shared/utils/logger';

dotenv.config();
const log = createLogger('HarvestDialogs');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const write = process.argv.slice(2).includes('--write');
  const pool = process.env.FEED_HARVEST_POOL || 'harvest';
  const maxDialogs = Number(process.env.FEED_DIALOGS_LIMIT || 0);
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

  // iterDialogs → только broadcast-каналы с username
  const chans = new Map<string, { id: number; accessHash: string; username: string; title: string }>();
  let dialogs = 0, channels = 0, skippedChats = 0;
  for await (const d of client.iterDialogs({})) {
    dialogs++;
    const e: any = (d as any).entity;
    if (e?.className === 'Channel' && e?.broadcast === true) {
      channels++;
      if (e.username && e.accessHash != null) {
        chans.set(String(e.username).toLowerCase(), {
          id: Number(e.id.toString()), accessHash: String(e.accessHash),
          username: String(e.username).toLowerCase(), title: String(e.title || ''),
        });
      }
    } else { skippedChats++; }
    if (maxDialogs && dialogs >= maxDialogs) break;
  }
  log.info('Диалоги обойдены', { dialogs, channels_broadcast: channels, withUsername: chans.size, skipped_chats_groups: skippedChats });

  // пред-фильтр IT по названию (батчами)
  const list = [...chans.values()];
  const itKeys = new Set<string>();
  for (let i = 0; i < list.length; i += 30) {
    const batch = list.slice(i, i + 30);
    const res = await clf.classifyChannelsIT(batch.map((c) => ({ key: c.username, title: c.title })));
    for (const r of res) if (r.isIt) itKeys.add(r.key);
    await sleep(400);
  }
  const itChans = list.filter((c) => itKeys.has(c.username));
  log.info('Пред-фильтр IT', { каналов_с_username: list.length, IT: itChans.length, не_IT: list.length - itChans.length });
  log.info('IT-каналы (примеры)', { sample: itChans.slice(0, 30).map((c) => `@${c.username} (${c.title})`) });
  log.info('Отброшено как не-IT (примеры)', { sample: list.filter((c) => !itKeys.has(c.username)).slice(0, 20).map((c) => `@${c.username} (${c.title})`) });

  if (write) {
    let added = 0;
    for (const c of itChans) {
      await cursors.ensure(c.id, c.username);
      try { await ahc.set(accountId, c.id, BigInt(c.accessHash), c.username); } catch { /* не критично */ }
      added++;
    }
    log.info('Записано IT-каналов в пул', { added, poolTotalNow: await cursors.count() });
  } else {
    log.info('DRY-RUN — ничего не записано. Для записи: --write');
  }
  await fc.disconnect();
  process.exit(0);
}

main().catch((e) => { log.error('Фатальная ошибка feed:harvest-dialogs', { error: (e as Error)?.message }); process.exit(1); });
