/**
 * feed:listen — сбор постов ленты (live-listener + backfill).
 *
 * Один процесс, МНОГО сессий async (НЕ N процессов — помним OOM чекера). Шардинг каналов
 * по аккаунтам round-robin. На аккаунт: connect → онбординг своих каналов (joiner, троттлинг)
 * → backfill из курсора → startListening. Watchdog следит за «зависшими» сессиями.
 *
 * Запуск: npm run feed:listen   (env: FEED_SEED_CHANNELS, JOIN_THROTTLE_MS, …)
 */

import * as dotenv from 'dotenv';
import { Api } from 'telegram';
import { createLogger } from '../../../shared/utils/logger';
import { AccountsRepository } from '../../../shared/database/repositories/accountsRepository';
import { ChannelCursorsRepository } from '../../../shared/database/repositories/channelCursorsRepository';
import { AccessHashCacheRepository } from '../../../shared/database/repositories/accessHashCacheRepository';
import { VideoRequestsRepository } from '../../../shared/database/repositories/videoRequestsRepository';
import { getMediaStore } from '../services/mediaStore';
import { fetchVideoFile } from '../services/feedMediaService';
import { Account } from '../../../shared/utils/envAccountsParser';
import { FeedClient, credsFromAccount } from '../adapters/feedClient';
import { FeedJoinerService } from '../services/feedJoinerService';
import { FeedListenerService, MonitoredChannel } from '../services/feedListenerService';
import { FeedCrawlerService } from '../services/feedCrawlerService';
import { getSeedChannels } from '../config/seedChannels';

dotenv.config();
const log = createLogger('FeedListen');

const CONFIG = {
  joinThrottleMs: Number(process.env.JOIN_THROTTLE_MS || 8000), // пауза между вступлениями (анти-флуд)
  backfillLimit: Number(process.env.FEED_BACKFILL_LIMIT || 50),
  watchdogMs: Number(process.env.FEED_WATCHDOG_MS || 60000),
  staleMs: Number(process.env.FEED_STALE_MS || 15 * 60 * 1000), // нет событий 15 мин → реконнект
  // Read-only: НЕ вступаем, только резолв + периодический backfill (риск как у чекера).
  readonly: process.env.FEED_READONLY === '1',
  pollIntervalMs: Number(process.env.FEED_POLL_INTERVAL_MS || 5 * 60 * 1000),
  resolveThrottleMs: Number(process.env.FEED_RESOLVE_THROTTLE_MS || 2500),
  crawl: process.env.FEED_CRAWL === '1', // рекурсивное наращивание каналов (read-only)
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** accounts.id из sessionKey 'DB_FEED_<id>' (feed-пул всегда из БД). */
function accountIdOf(a: Account): number {
  const tail = a.sessionKey?.split('_').pop();
  const id = Number(tail);
  return Number.isFinite(id) ? id : 0;
}

interface Session {
  account: Account;
  accountId: number;
  client: FeedClient;
  listener: FeedListenerService;
  channels: MonitoredChannel[];
}

class FeedListenRunner {
  private accountsRepo = new AccountsRepository();
  private cursors = new ChannelCursorsRepository();
  private ahc = new AccessHashCacheRepository();
  private videoReqs = new VideoRequestsRepository();
  private sessions: Session[] = [];
  private running = true;

  /** Сессии из env: SESSION_STRING_FEED_1..N (fallback без пула в БД). api creds — из env. */
  private envAccounts(): Account[] {
    const apiId = Number(process.env.API_ID || 0);
    const apiHash = String(process.env.API_HASH || '');
    const out: Account[] = [];
    for (let i = 1; i <= 20; i++) {
      const s = process.env[`SESSION_STRING_FEED_${i}`];
      if (!s) continue;
      out.push({ name: `env_feed_${i}`, sessionKey: `ENV_FEED_${i}`, sessionValue: s, session: s, apiId, apiHash } as Account);
    }
    return out;
  }

  async start(): Promise<void> {
    const pool = process.env.FEED_ACCOUNT_POOL || 'feed';
    let accounts: Account[] = [];
    try { accounts = await this.accountsRepo.getActiveByPool(pool); } catch (e) {
      log.warn('Не удалось прочитать пул из БД — пробую env', { error: (e as Error).message });
    }
    // Env-сессии в приоритете дополнения (дедуп по sessionValue).
    const byVal = new Map<string, Account>();
    for (const a of [...accounts, ...this.envAccounts()]) byVal.set(a.sessionValue || a.session || a.name, a);
    accounts = [...byVal.values()];
    if (accounts.length === 0) {
      log.error(`Нет аккаунтов: пул '${pool}' пуст и нет SESSION_STRING_FEED_*. Задайте сессии в env.`);
      return;
    }
    const seeds = getSeedChannels();
    log.info('Старт feed:listen', { accounts: accounts.length, channels: seeds.length, readonly: CONFIG.readonly });

    // Шардинг каналов по аккаунтам round-robin (один канал = один аккаунт).
    const shards: string[][] = accounts.map(() => []);
    seeds.forEach((ch, i) => shards[i % accounts.length].push(ch));

    for (let i = 0; i < accounts.length; i++) {
      await this.bootSession(accounts[i], shards[i]);
    }

    this.setupShutdown();
    this.startVideoWorker(); // LAZY-видео: фоновый воркер очереди video_requests (независим от poll-цикла)
    if (CONFIG.readonly) await this.pollLoop();
    else await this.watchdog();
  }

  /** Фоновый воркер: разгребает очередь video_requests (lazy-загрузка видео по клику зрителя). */
  private startVideoWorker(): void {
    const ms = Number(process.env.FEED_VIDEO_WORKER_MS || 8000);
    const tick = async () => {
      if (!this.running) return;
      try {
        await this.processVideoQueue();
      } catch (e: any) {
        log.warn('Видео-воркер: ошибка тика', { error: e?.message });
      }
      if (this.running) setTimeout(tick, ms);
    };
    setTimeout(tick, ms);
    log.info('Видео-воркер запущен (lazy-очередь)', { intervalMs: ms });
  }

  /** Одна задача из video_requests: скачать видео resolve-free (InputChannel из кэша) → S3 → done/error. */
  private async processVideoQueue(): Promise<void> {
    if (!this.sessions.length) return;
    const req = await this.videoReqs.claimOne();
    if (!req) return;
    try {
      const byAcc = new Map<number, FeedClient>();
      for (const s of this.sessions) byAcc.set(s.accountId, s.client);
      const ah = await this.ahc.getAnyForChannel(req.channelId);
      let client, input: any;
      if (ah && byAcc.has(ah.accountId)) {
        client = byAcc.get(ah.accountId)!.getClient();
        input = new Api.InputChannel({ channelId: BigInt(req.channelId) as any, accessHash: BigInt(ah.accessHash) as any });
      } else {
        client = this.sessions[0].client.getClient();
        input = req.channelId; // фолбэк по id
      }
      const url = await fetchVideoFile(client, input, req.channelId, req.tgMessageId);
      if (url) {
        await this.videoReqs.markDone(req.id, url);
        log.info('Видео готово (lazy)', { channelId: req.channelId, msgId: req.tgMessageId });
      } else {
        await this.videoReqs.markError(req.id, 'no_video_or_too_big');
      }
    } catch (e: any) {
      await this.videoReqs.markError(req.id, e?.message || 'video_fetch_failed');
    }
  }

  /** Read-only: периодический backfill по всем сессиям (без live/join) + краул. */
  private async pollLoop(): Promise<void> {
    log.info('Read-only режим: периодический backfill', { intervalMs: CONFIG.pollIntervalMs, crawl: CONFIG.crawl });
    while (this.running) {
      // Подхватываем каналы, открытые краулером (мониторим из БД, а не только env-сиды).
      await this.refreshChannelsFromDb();

      for (const s of this.sessions) {
        try {
          await s.listener.backfill(CONFIG.backfillLimit);
        } catch (e: any) {
          log.warn('Backfill сессии не удался', { account: s.account.name, error: e?.message });
        }
      }

      // Аватарки: RESOLVE-FREE дозагрузка через кэш access_hash → НЕ дёргаем contacts.ResolveUsername
      // (самый флуд-лимитируемый метод). Берём канал + кэшированный access_hash, строим InputChannel,
      // getEntity (channels.GetChannels, мягкий лимит) → downloadProfilePhoto. Качаем аккаунтом-владельцем хэша.
      if (this.sessions.length) {
        try {
          const batch = Number(process.env.FEED_AVATAR_BATCH || 40);
          const need = await this.ahc.listForAvatar(batch);
          if (need.length) {
            const byAccount = new Map<number, FeedClient>();
            for (const s of this.sessions) byAccount.set(s.accountId, s.client);
            const perAcc = new Map<number, typeof need>();
            for (const item of need) {
              if (!byAccount.has(item.accountId)) continue; // нет живой сессии этого аккаунта
              if (!perAcc.has(item.accountId)) perAcc.set(item.accountId, []);
              perAcc.get(item.accountId)!.push(item);
            }
            await Promise.all(
              [...perAcc.entries()].map(async ([accId, items]) => {
                const client = byAccount.get(accId)!.getClient();
                for (const it of items) {
                  try {
                    const input = new Api.InputChannel({
                      channelId: BigInt(it.channelId) as any,
                      accessHash: BigInt(it.accessHash) as any,
                    });
                    const entity = await client.getEntity(input);
                    const buf = (await client.downloadProfilePhoto(entity, { isBig: false })) as Buffer;
                    if (buf && buf.length) {
                      const url = await getMediaStore().put(`avatar_${it.channelId}.jpg`, buf, 'image/jpeg');
                      await this.cursors.setAvatar(it.channelId, url);
                    }
                  } catch (e: any) {
                    log.warn('Аватар (resolve-free) не скачан', { channelId: it.channelId, error: e?.message });
                  }
                  await sleep(CONFIG.resolveThrottleMs);
                }
              })
            );
          }
        } catch (e: any) {
          log.warn('Бэкафилл аватаров не удался', { error: e?.message });
        }
      }

      // Краул: расширяем фронтир по рекомендациям ВСЕМИ сессиями (ротация по аккаунтам →
      // union рекомендаций, обход непремиум-капа ~10 похожих на канал).
      if (CONFIG.crawl && this.sessions.length) {
        try {
          const crawler = new FeedCrawlerService(
            this.sessions.map((s) => ({ client: s.client.getClient(), accountId: s.accountId }))
          );
          await crawler.expandOnce();
        } catch (e: any) {
          log.warn('Краул-проход не удался', { error: e?.message });
        }
      }

      await sleep(CONFIG.pollIntervalMs);
    }
  }

  /** Обновить список мониторимых каналов из channel_cursors (env-сиды + открытые краулером). */
  private async refreshChannelsFromDb(): Promise<void> {
    if (!this.sessions.length) return;
    try {
      const all = await this.cursors.listAll();
      if (!all.length) return;
      const channels: MonitoredChannel[] = all.map((c) => ({
        channelId: c.channelId,
        username: c.channelUsername,
        lastSeenPostId: c.lastSeenPostId,
      }));
      // ШАРДИНГ: раздаём каналы по всем сессиям round-robin → нагрузка делится на N аккаунтов (анти-FLOOD).
      const n = this.sessions.length;
      const shards: MonitoredChannel[][] = this.sessions.map(() => []);
      channels.forEach((ch, i) => shards[i % n].push(ch));
      for (let i = 0; i < n; i++) {
        this.sessions[i].listener.setChannels(shards[i]);
        this.sessions[i].channels = shards[i];
      }
      log.info('Каналы перераспределены по сессиям', { sessions: n, total: channels.length });
    } catch (e: any) {
      log.warn('Не удалось обновить каналы из БД', { error: e?.message });
    }
  }

  /** Поднять одну сессию: connect → онбординг → backfill → listen. */
  private async bootSession(account: Account, usernames: string[]): Promise<void> {
    const accountId = accountIdOf(account);
    let client: FeedClient;
    try {
      client = new FeedClient(credsFromAccount(account));
      await client.connect();
    } catch (e: any) {
      log.error('Не удалось поднять сессию', e, { account: account.name });
      return;
    }

    // Онбординг (вступления с троттлингом). Собираем channelId успешно подключённых.
    const joiner = new FeedJoinerService(client.getClient(), accountId);
    const channelIds = new Map<number, string>(); // channelId → username
    for (const uname of usernames) {
      if (!this.running) break;
      const res = await joiner.onboard(uname, { join: !CONFIG.readonly });
      log.info(CONFIG.readonly ? 'Резолв (read-only)' : 'Онбординг', { account: account.name, ...res });
      if (res.channelId != null && (res.outcome === 'joined' || res.outcome === 'already')) {
        channelIds.set(res.channelId, uname);
      }
      if (res.outcome === 'flood' && res.retryAfter) {
        log.warn('FLOOD при вступлении — пауза', { account: account.name, seconds: res.retryAfter });
        await sleep(res.retryAfter * 1000);
      } else if (res.outcome === 'channels_too_much') {
        log.warn('Аккаунт упёрся в лимит каналов (~500) — стоп онбординга', { account: account.name });
        break;
      }
      await sleep(CONFIG.readonly ? CONFIG.resolveThrottleMs : CONFIG.joinThrottleMs);
    }

    // Каналы сессии (с курсором last_seen для backfill).
    const channels: MonitoredChannel[] = [];
    for (const [channelId, uname] of channelIds) {
      const cur = await this.cursors.get(channelId);
      channels.push({ channelId, username: uname, lastSeenPostId: cur?.lastSeenPostId ?? null });
    }

    const listener = new FeedListenerService(client.getClient());
    listener.setChannels(channels);
    await listener.backfill(CONFIG.backfillLimit);
    if (!CONFIG.readonly) listener.startListening(); // live только при join-режиме

    this.sessions.push({ account, accountId, client, listener, channels });
    log.info('Сессия активна', { account: account.name, channels: channels.length });
  }

  /** Periodic watchdog: «зависшие» сессии переподключаем + добираем backfill. */
  private async watchdog(): Promise<void> {
    while (this.running) {
      await sleep(CONFIG.watchdogMs);
      const now = Date.now();
      for (const s of this.sessions) {
        const stale = now - s.listener.lastEventAt > CONFIG.staleMs;
        if (stale && !s.client.connected) {
          log.warn('Сессия зависла — переподключение', { account: s.account.name });
          try {
            await s.client.connect();
            await s.listener.backfill(CONFIG.backfillLimit);
            s.listener.lastEventAt = now;
          } catch (e: any) {
            log.error('Реконнект не удался', e, { account: s.account.name });
          }
        }
      }
    }
  }

  private setupShutdown(): void {
    const shutdown = async () => {
      this.running = false;
      log.info('Остановка feed:listen…');
      for (const s of this.sessions) await s.client.disconnect();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

new FeedListenRunner().start().catch((e) => {
  log.error('Фатальная ошибка feed:listen', e as Error);
  process.exit(1);
});
