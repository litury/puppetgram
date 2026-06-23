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
import { createLogger } from '../../../shared/utils/logger';
import { AccountsRepository } from '../../../shared/database/repositories/accountsRepository';
import { ChannelCursorsRepository } from '../../../shared/database/repositories/channelCursorsRepository';
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
    if (CONFIG.readonly) await this.pollLoop();
    else await this.watchdog();
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

      // Аватарки: дозагрузка для каналов без avatar_url (onboard скачивает их в MediaStore).
      // РОТАЦИЯ по всем сессиям (round-robin) — НЕ только sessions[0] (он может быть в FLOOD-кулдауне),
      // иначе очередь без аватарок не разгребается при росте пула. Батч делим на аккаунты, качаем параллельно.
      if (this.sessions.length) {
        try {
          const batch = Number(process.env.FEED_AVATAR_BATCH || 40);
          const need = await this.cursors.withoutAvatar(batch);
          if (need.length) {
            const n = this.sessions.length;
            const perSession: Array<Array<{ channelUsername: string }>> = this.sessions.map(() => []);
            need.forEach((ch, i) => perSession[i % n].push(ch));
            await Promise.all(
              this.sessions.map(async (s, idx) => {
                const joiner = new FeedJoinerService(s.client.getClient(), s.accountId);
                for (const ch of perSession[idx]) {
                  try {
                    await joiner.onboard(ch.channelUsername, { join: false });
                  } catch (e: any) {
                    log.warn('Аватар-онбординг не удался', { username: ch.channelUsername, error: e?.message });
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
