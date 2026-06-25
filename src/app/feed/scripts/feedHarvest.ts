/**
 * feedHarvest — собрать пул каналов из истории ОДНОГО канала-источника (по умолчанию divatoz).
 *
 * Источник — канал, куда юзер репостил/цитировал другие каналы → курированный пул.
 * Извлекаем референсы на каналы по 3 сигналам:
 *   1) forward (репост) — исходный канал зашит в ответе (chats[]) → RESOLVE-FREE (id+username+access_hash);
 *   2) ссылки t.me/<user> в тексте и entities (TextUrl/Url);
 *   3) упоминания @username (entity Mention + regex).
 * Forward-каналы добавляются без резолва. username-кандидаты резолвятся ГЕНТЛ (троттл + кап),
 * и только если это broadcast-канал (не чат/бот/группа).
 *
 * Запуск: npm run feed:harvest
 * ENV:
 *   FEED_HARVEST_SOURCE        канал-источник (default 'divatoz')
 *   FEED_ACCOUNT_POOL          пул аккаунта (default 'join')
 *   FEED_HARVEST_DRYRUN=1      только обойти историю + напечатать найденное, без записи/резолвов
 *   FEED_HARVEST_MAX_MSGS      кап сообщений (0 = вся история)
 *   FEED_HARVEST_MAX_RESOLVES  кап резолвов username за прогон (default 200, резюмируемо)
 *   FEED_RESOLVE_THROTTLE_MS   пауза между резолвами (default 3000)
 *   FEED_HARVEST_PAGE_MS       пауза между страницами истории (default 700)
 *   FEED_FLOOD_SLEEP_THRESHOLD рекомендуется 60
 */

import * as dotenv from 'dotenv';
import { Api } from 'telegram';
import { AccountsRepository } from '../../../shared/database/repositories/accountsRepository';
import { ChannelCursorsRepository } from '../../../shared/database/repositories/channelCursorsRepository';
import { AccessHashCacheRepository } from '../../../shared/database/repositories/accessHashCacheRepository';
import { FeedClient, credsFromAccount } from '../adapters/feedClient';
import { extractEntities } from '../services/postExtractor';
import { createLogger } from '../../../shared/utils/logger';

dotenv.config();

const log = createLogger('FeedHarvest');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isFlood = (e: any): boolean =>
  /FLOOD/i.test(String(e?.errorMessage || e?.message || '')) || e?.constructor?.name === 'FloodWaitError';

// Зарезервированные пути t.me — не каналы.
const RESERVED = new Set([
  'joinchat', 's', 'c', 'addstickers', 'addemoji', 'share', 'proxy', 'socks',
  'bg', 'setlanguage', 'iv', 'addlist', 'addtheme', 'login', 'confirmphone',
]);
const UNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

function normUser(raw?: string | null): string | null {
  if (!raw) return null;
  const u = String(raw).trim().replace(/^@/, '').toLowerCase();
  if (!UNAME_RE.test(u) || RESERVED.has(u)) return null;
  return u;
}

function userFromTme(url?: string | null): string | null {
  if (!url) return null;
  const m = String(url).match(/(?:https?:\/\/)?t\.me\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})/i);
  return m ? normUser(m[1]) : null;
}

/** Username'ы из текста+entities одного сообщения. */
function usernamesFromMessage(msg: any): string[] {
  const out = new Set<string>();
  const text: string = msg?.message ?? msg?.text ?? '';
  const ents = extractEntities(msg) || [];
  for (const e of ents) {
    if (e.type === 'Mention') {
      const u = normUser(text.slice(e.offset, e.offset + e.length));
      if (u) out.add(u);
    } else if (e.type === 'TextUrl') {
      const u = userFromTme(e.url);
      if (u) out.add(u);
    } else if (e.type === 'Url') {
      const u = userFromTme(text.slice(e.offset, e.offset + e.length));
      if (u) out.add(u);
    }
  }
  // regex-фолбэк по тексту (на случай немаркированных ссылок/упоминаний)
  for (const m of text.matchAll(/@([A-Za-z][A-Za-z0-9_]{3,31})/g)) { const u = normUser(m[1]); if (u) out.add(u); }
  for (const m of text.matchAll(/t\.me\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})/gi)) { const u = normUser(m[1]); if (u) out.add(u); }
  return [...out];
}

async function main(): Promise<void> {
  const source = (process.env.FEED_HARVEST_SOURCE || 'divatoz').replace(/^@/, '');
  const pool = process.env.FEED_ACCOUNT_POOL || 'join';
  const dryRun = process.env.FEED_HARVEST_DRYRUN === '1';
  const maxMsgs = Number(process.env.FEED_HARVEST_MAX_MSGS || 0);
  const maxResolves = Number(process.env.FEED_HARVEST_MAX_RESOLVES || 200);
  const resolveThrottle = Number(process.env.FEED_RESOLVE_THROTTLE_MS || 3000);
  const pageThrottle = Number(process.env.FEED_HARVEST_PAGE_MS || 700);
  const PAGE = 100;

  const accountsRepo = new AccountsRepository();
  const cursors = new ChannelCursorsRepository();
  const ahc = new AccessHashCacheRepository();

  const accountsList = await accountsRepo.getActiveByPool(pool);
  if (!accountsList.length) { log.error('Нет активных аккаунтов в пуле', { pool }); process.exit(1); }
  const acc = accountsList[0];
  const accountId = Number(String(acc.sessionKey).split('_').pop());

  const fc = new FeedClient(credsFromAccount(acc));
  await fc.connect();
  const client = fc.getClient();

  // Резолв источника ОДИН раз.
  const peer = await client.getInputEntity(source);

  // Существующие каналы — чтобы не дублировать резолвы.
  const existing = await cursors.listAll();
  const knownUsernames = new Set(existing.map((c) => (c.channelUsername || '').toLowerCase()).filter(Boolean));
  const knownIds = new Set(existing.map((c) => c.channelId));
  knownUsernames.add(source.toLowerCase());

  // forward-каналы (resolve-free): channelId -> {username, accessHash}
  const fwdChannels = new Map<string, { username: string | null; accessHash: string; broadcast: boolean }>();
  const chatMap = new Map<string, any>(); // channelId(str) -> Api.Channel
  const linkUsernames = new Set<string>();

  let scanned = 0, fwdHits = 0, offsetId = 0, pages = 0;
  while (true) {
    let res: any;
    try {
      res = await client.invoke(new Api.messages.GetHistory({
        peer, offsetId, offsetDate: 0, addOffset: 0, limit: PAGE, maxId: 0, minId: 0, hash: BigInt(0) as any,
      }));
    } catch (e: any) {
      if (isFlood(e)) { const w = Number(e?.seconds || 30); log.warn('FLOOD на GetHistory — сплю', { wait: w }); await sleep((w + 2) * 1000); continue; }
      log.error('GetHistory упал — стоп', { error: e?.message }); break;
    }
    const msgs: any[] = res?.messages || [];
    if (!msgs.length) break;

    for (const ch of (res?.chats || [])) {
      if (ch?.className === 'Channel') chatMap.set(String(ch.id), ch);
    }
    for (const m of msgs) {
      const fc2 = m?.fwdFrom?.fromId;
      if (fc2?.className === 'PeerChannel' && fc2?.channelId != null) {
        const cidStr = String(fc2.channelId);
        if (!fwdChannels.has(cidStr)) {
          const ch = chatMap.get(cidStr);
          if (ch?.accessHash != null && ch?.broadcast) {
            fwdChannels.set(cidStr, { username: ch.username ? String(ch.username).toLowerCase() : null, accessHash: String(ch.accessHash), broadcast: true });
            fwdHits++;
          }
        }
      }
      for (const u of usernamesFromMessage(m)) linkUsernames.add(u);
    }

    scanned += msgs.length;
    pages++;
    offsetId = Number(msgs[msgs.length - 1].id);
    if (maxMsgs && scanned >= maxMsgs) break;
    await sleep(pageThrottle);
  }

  // Кандидаты-username, ещё не покрытые forward-каналами и не известные.
  const fwdUsernames = new Set([...fwdChannels.values()].map((v) => v.username).filter(Boolean) as string[]);
  const toResolve = [...linkUsernames].filter((u) => !knownUsernames.has(u) && !fwdUsernames.has(u));

  log.info('История обойдена', {
    source, pages, scanned, fwdChannels: fwdChannels.size, linkUsernames: linkUsernames.size, toResolve: toResolve.length,
  });

  if (dryRun) {
    const fwdSample = [...fwdChannels.values()].map((v) => v.username || '(private)').slice(0, 40);
    log.info('DRY-RUN forward-каналы (resolve-free)', { count: fwdChannels.size, sample: fwdSample });
    log.info('DRY-RUN username-кандидаты (резолв в боевом)', { count: toResolve.length, sample: toResolve.slice(0, 40) });
    await fc.disconnect();
    process.exit(0);
  }

  // 1) forward-каналы — USERNAME-ONLY: добавляем только если есть публичный @username.
  // Если в форварде username не пришёл — резолвим getEntity; не вышло → ПРОПУСК (чистый пул без безымянных).
  let addedFwd = 0, skippedNoUser = 0;
  for (const [cidStr, v] of fwdChannels) {
    const cid = Number(cidStr);
    if (knownIds.has(cid)) continue;
    let uname = v.username;
    if (!uname) {
      try {
        const input = new Api.InputChannel({ channelId: BigInt(cid) as any, accessHash: BigInt(v.accessHash) as any });
        const ent: any = await client.getEntity(input);
        if (ent?.username) uname = String(ent.username).toLowerCase();
      } catch { /* min-hash/private → username недоступен */ }
      await sleep(resolveThrottle);
    }
    if (!uname) { skippedNoUser++; continue; } // нет публичного @ → не добавляем
    await cursors.ensure(cid, uname);
    try { await ahc.set(accountId, cid, BigInt(v.accessHash), uname); } catch { /* не критично */ }
    knownIds.add(cid);
    knownUsernames.add(uname);
    addedFwd++;
  }
  if (skippedNoUser) log.info('Пропущены форвард-каналы без публичного @username', { skipped: skippedNoUser });

  // 2) username-кандидаты — гентл-резолв с type-guard (только broadcast-каналы).
  let resolved = 0, addedLink = 0, skipped = 0, flood = 0;
  for (const uname of toResolve) {
    if (resolved >= maxResolves) { log.info('Достигнут кап резолвов', { maxResolves }); break; }
    try {
      const ent: any = await client.getEntity(uname);
      resolved++;
      if (ent?.className === 'Channel' && ent?.broadcast === true && ent?.accessHash != null) {
        const cid = Number(ent.id.toString());
        if (!knownIds.has(cid)) {
          await cursors.ensure(cid, uname);
          try { await ahc.set(accountId, cid, BigInt(ent.accessHash.toString()), uname); } catch { /* не критично */ }
          knownIds.add(cid); knownUsernames.add(uname); addedLink++;
        }
      } else {
        skipped++; // не broadcast-канал (чат/бот/юзер/супергруппа)
      }
    } catch (e: any) {
      if (isFlood(e)) { flood++; const w = Number(e?.seconds || 30); log.warn('FLOOD на резолве — сплю', { wait: w }); await sleep((w + 2) * 1000); continue; }
      skipped++; // username не существует / приватный / ушёл
    }
    await sleep(resolveThrottle);
  }

  const total = await cursors.count();
  log.info('Готово', { addedFwd, addedLink, resolved, skipped, flood, poolTotalNow: total });
  log.info('Источник', { source, scanned });

  await fc.disconnect();
  process.exit(0);
}

main().catch((e) => {
  log.error('Фатальная ошибка feedHarvest', { error: (e as Error)?.message });
  process.exit(1);
});
