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
import { PostsRepository } from '../../../shared/database/repositories/postsRepository';
import { fetchAndStoreMedia } from '../services/feedMediaService';
import { getMediaStore } from '../services/mediaStore';
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
  // Live-listen в poll-режиме: помимо backfill подписываемся на NewMessage → каналы, в которые
  // аккаунт ВСТУПИЛ (feed:join-all), дают мгновенный push. Поллинг при этом — страховка (пропуски/не-вступленные).
  liveListen: process.env.FEED_LIVE_LISTEN === '1',
  // Гентл-авто-join: подписывать аккаунт на неподписанные каналы (→ live-push, без поллинга-задержки).
  autoJoin: process.env.FEED_AUTO_JOIN === '1',
  autoJoinThrottleMs: Number(process.env.FEED_JOIN_THROTTLE_MS || 5000),
  // Само-лечение медиа: дозалить url постам с неполным медиа (видео без url / фото без refs).
  healPerCycle: Number(process.env.FEED_HEAL_PER_CYCLE || 20),
  healThrottleMs: Number(process.env.FEED_HEAL_THROTTLE_MS || 1500),
  healConcurrency: Number(process.env.FEED_HEAL_CONCURRENCY || 4), // параллельно — застрявший файл не серриализует
  healItemTimeoutMs: Number(process.env.FEED_HEAL_ITEM_TIMEOUT_MS || 60000), // 60с: тормозной файл бросаем, доберётся позже
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
  private posts = new PostsRepository();
  private sessions: Session[] = [];
  private running = true;
  private liveStarted = false; // FEED_LIVE_LISTEN: startListening навешен один раз на сессию

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

    this.setupShutdown();

    for (let i = 0; i < accounts.length; i++) {
      await this.bootSession(accounts[i], shards[i]);
    }

    if (CONFIG.healPerCycle > 0) this.startHealWorker();
    if (CONFIG.autoJoin) this.startJoinWorker();

    if (CONFIG.readonly) await this.pollLoop();
    else await this.watchdog();
  }

  /** Фоновый воркер авто-join — непрерывно, независимо от pollLoop: идём по базе, join каждые 5с, FLOOD ждём. */
  private startJoinWorker(): void {
    log.info('Авто-join: воркер запущен', { throttleMs: CONFIG.autoJoinThrottleMs });
    void this.joinWorkerLoop().catch((e) => log.error('Авто-join воркер упал', { error: e?.message }));
  }

  private async joinWorkerLoop(): Promise<void> {
    while (this.running) {
      if (!this.sessions.length) { await sleep(5000); continue; }
      const notJoined = await this.cursors.listNotJoined(200);
      if (!notJoined.length) { await sleep(60000); continue; } // всё вступлено — дремлем
      const aliveIds = this.sessions.map((s) => s.accountId);
      const byAcc = new Map<number, FeedClient>();
      for (const s of this.sessions) byAcc.set(s.accountId, s.client);
      for (let i = 0; i < notJoined.length && this.running; i++) {
        const chId = notJoined[i];
        const ah = await this.ahc.getForChannel(chId, aliveIds);
        if (!ah || !byAcc.has(ah.accountId)) continue; // нет живого access_hash — пропуск
        const input = new Api.InputChannel({ channelId: BigInt(chId) as any, accessHash: BigInt(ah.accessHash) as any });
        try {
          await byAcc.get(ah.accountId)!.getClient().invoke(new Api.channels.JoinChannel({ channel: input }));
          await this.cursors.markJoined(chId); log.info('Авто-join: вступили', { channelId: chId });
        } catch (e: any) {
          const msg = String(e?.errorMessage || e?.message || '');
          if (/USER_ALREADY_PARTICIPANT/i.test(msg)) { await this.cursors.markJoined(chId); }
          else if (/CHANNELS_TOO_MUCH/i.test(msg)) { log.warn('CHANNELS_TOO_MUCH — стоп авто-join'); return; }
          else if (/FLOOD/i.test(msg) || e?.constructor?.name === 'FloodWaitError') {
            const w = Number(e?.seconds || 60);
            log.warn('FLOOD авто-join — жду и повторяю', { wait: w });
            await sleep((w + 2) * 1000); i--; continue; // тот же канал
          }
        }
        await sleep(CONFIG.autoJoinThrottleMs);
      }
    }
  }

  /** Фоновый воркер само-лечения медиа — независим от pollLoop (auto-join с FLOOD его не голодит). */
  private startHealWorker(): void {
    const tick = async () => {
      if (!this.running) return;
      try {
        if (this.sessions.length) await this.healIncompleteMedia(CONFIG.healPerCycle);
      } catch (e: any) {
        log.warn('Само-лечение медиа не удалось', { error: e?.message });
      }
      if (this.running) setTimeout(tick, CONFIG.healThrottleMs);
    };
    setTimeout(tick, 5000);
    log.info('Само-лечение медиа: воркер запущен', { perBatch: CONFIG.healPerCycle });
  }

  /** Дозалить url постам с неполным медиа. ПАРАЛЛЕЛЬНО (волнами): застрявший файл не серриализует остальные. */
  private async healIncompleteMedia(limit: number): Promise<void> {
    const incomplete = await this.posts.listIncompleteMedia(limit);
    if (!incomplete.length) return;
    const aliveIds = this.sessions.map((s) => s.accountId);
    const byAcc = new Map<number, FeedClient>();
    for (const s of this.sessions) byAcc.set(s.accountId, s.client);
    let healed = 0;
    for (let i = 0; i < incomplete.length; i += CONFIG.healConcurrency) {
      const wave = incomplete.slice(i, i + CONFIG.healConcurrency);
      const res = await Promise.all(wave.map((it) => this.healOne(it.channelId, it.tgMessageId, byAcc, aliveIds)));
      healed += res.filter(Boolean).length;
    }
    if (healed) log.info('Само-лечение медиа', { healed });
  }

  /** Один пост: getMessages → fetchAndStoreMedia с таймаутом → updateMediaRefs. true = вылечен. */
  private async healOne(channelId: number, tgMessageId: number, byAcc: Map<number, FeedClient>, aliveIds: number[]): Promise<boolean> {
    const ah = await this.ahc.getForChannel(channelId, aliveIds);
    if (!ah || !byAcc.has(ah.accountId)) return false;
    try {
      const client = byAcc.get(ah.accountId)!.getClient();
      const input = new Api.InputChannel({ channelId: BigInt(channelId) as any, accessHash: BigInt(ah.accessHash) as any });
      const msgs: any[] = await client.getMessages(input, { ids: [tgMessageId] });
      // таймаут на один файл: застрявшая докачка не морозит волну
      const refs = msgs?.[0]
        ? await Promise.race([
            fetchAndStoreMedia(client, msgs[0], channelId, tgMessageId),
            new Promise<null>((_, rej) => setTimeout(() => rej(new Error('heal_item_timeout')), CONFIG.healItemTimeoutMs)),
          ])
        : null;
      if (refs) { await this.posts.updateMediaRefs(channelId, tgMessageId, refs); return true; }
    } catch { /* ETIMEDOUT/таймаут/FLOOD — пропускаем, доберётся в следующий проход */ }
    return false;
  }

  /** Read-only: периодический backfill по всем сессиям (без live/join) + краул. */
  private async pollLoop(): Promise<void> {
    log.info('Read-only режим: периодический backfill', { intervalMs: CONFIG.pollIntervalMs, crawl: CONFIG.crawl });
    while (this.running) {
      // Подхватываем каналы, открытые краулером (мониторим из БД, а не только env-сиды).
      await this.refreshChannelsFromDb();

      // Live-push по вступленным каналам: навешиваем NewMessage один раз (после первого refresh,
      // чтобы monitored уже был заполнен). Дальше события фильтруются по актуальному monitored.
      if (CONFIG.liveListen && !this.liveStarted && this.sessions.length) {
        for (const s of this.sessions) s.listener.startListening();
        this.liveStarted = true;
        log.info('Live-listen включён (push по вступленным каналам)', { sessions: this.sessions.length });
      }

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
            let avDone = 0, avEmpty = 0, avErr = 0; let avFirstErr = '';
            await Promise.all(
              [...perAcc.entries()].map(async ([accId, items]) => {
                const client = byAccount.get(accId)!.getClient();
                for (const it of items) {
                  try {
                    const input = new Api.InputChannel({
                      channelId: BigInt(it.channelId) as any,
                      accessHash: BigInt(it.accessHash) as any,
                    });
                    const entity: any = await client.getEntity(input);
                    // Дозаполнить username канала, если harvest добавил его без @ (иначе нет имени/ссылки в ленте).
                    if (entity?.username) { try { await this.cursors.setUsername(it.channelId, String(entity.username)); } catch { /* не критично */ } }
                    const buf = (await client.downloadProfilePhoto(entity, { isBig: false })) as Buffer;
                    if (buf && buf.length) {
                      const url = await getMediaStore().put(`avatar_${it.channelId}.jpg`, buf, 'image/jpeg');
                      await this.cursors.setAvatar(it.channelId, url);
                      avDone++;
                    } else {
                      avEmpty++;
                    }
                  } catch (e: any) {
                    avErr++;
                    if (!avFirstErr) avFirstErr = String(e?.errorMessage || e?.message || '').slice(0, 120);
                  }
                  await sleep(CONFIG.resolveThrottleMs);
                }
              })
            );
            log.info('Аватары: цикл', { batch: need.length, done: avDone, empty: avEmpty, err: avErr, firstErr: avFirstErr || undefined });
          }
        } catch (e: any) {
          log.warn('Бэкафилл аватаров не удался', { error: e?.message });
        }
      }

      // Дозаполнение username каналов без @ (harvest-форварды): резолв по кэшу access_hash живого
      // аккаунта (getEntity по InputChannel) → setUsername. Без этого нет имени/ссылки «Открыть» в ленте.
      if (this.sessions.length) {
        try {
          const missing = await this.cursors.listMissingUsername(200);
          if (missing.length) {
            const aliveIds = this.sessions.map((s) => s.accountId);
            const byAcc = new Map<number, FeedClient>();
            for (const s of this.sessions) byAcc.set(s.accountId, s.client);
            let setU = 0;
            for (const chId of missing) {
              const ah = await this.ahc.getForChannel(chId, aliveIds);
              if (!ah || !byAcc.has(ah.accountId)) continue;
              try {
                const input = new Api.InputChannel({ channelId: BigInt(chId) as any, accessHash: BigInt(ah.accessHash) as any });
                const ent: any = await byAcc.get(ah.accountId)!.getClient().getEntity(input);
                if (ent?.username) { await this.cursors.setUsername(chId, String(ent.username)); setU++; }
              } catch { /* приватный/без @ — пропускаем */ }
              await sleep(CONFIG.resolveThrottleMs);
            }
            if (setU) log.info('Username каналов дозаполнены', { setU });
          }
        } catch (e: any) {
          log.warn('Username-бэкафилл не удался', { error: e?.message });
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
      // RESOLVE-FREE ШАРДИНГ: канал назначаем аккаунту, у которого ЕСТЬ его access_hash (читает без ResolveUsername).
      // Орфаны (нет хэша ни у одного живого) — round-robin, читаются по username в пределах бюджета backfill.
      const aliveIds = this.sessions.map((s) => s.accountId);
      const cov = await this.ahc.listForAccounts(aliveIds);
      const hashByChannel = new Map<number, { accountId: number; accessHash: string }>();
      for (const c of cov) if (!hashByChannel.has(c.channelId)) hashByChannel.set(c.channelId, { accountId: c.accountId, accessHash: c.accessHash });
      const idxByAccount = new Map<number, number>();
      this.sessions.forEach((s, i) => idxByAccount.set(s.accountId, i));
      const n = this.sessions.length;
      const shards: MonitoredChannel[][] = this.sessions.map(() => []);
      let rr = 0, hashed = 0, orphan = 0;
      for (const c of all) {
        const mc: MonitoredChannel = { channelId: c.channelId, username: c.channelUsername, lastSeenPostId: c.lastSeenPostId, accessHash: null };
        const h = hashByChannel.get(c.channelId);
        if (h && idxByAccount.has(h.accountId)) {
          mc.accessHash = h.accessHash;
          shards[idxByAccount.get(h.accountId)!].push(mc);
          hashed++;
        } else {
          shards[rr % n].push(mc); rr++; orphan++;
        }
      }
      for (let i = 0; i < n; i++) {
        this.sessions[i].listener.setChannels(shards[i]);
        this.sessions[i].channels = shards[i];
      }
      log.info('Каналы перераспределены (resolve-free)', { sessions: n, total: all.length, hashed, orphan });
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
      // Сессия деавторизована/забанена (не транзиентный сбой) → помечаем dead, пул её больше не грузит.
      if (/не авторизован|UNAUTHORIZED|AUTH_KEY|USER_DEACTIVATED|SESSION_REVOKED/i.test(String(e?.message || ''))) {
        await this.accountsRepo.markDead(account.name, 'session_unauthorized').catch(() => {});
        log.warn('Аккаунт помечен dead (деавторизован)', { account: account.name });
      }
      return;
    }

    // Сессия подключена → СРАЗУ регистрируем (видео-воркер/краул получают живого клиента, не ждут онбординг).
    const listener = new FeedListenerService(client.getClient(), accountId);
    const session: Session = { account, accountId, client, listener, channels: [] };
    this.sessions.push(session);

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

    session.channels = channels;
    listener.setChannels(channels);
    await listener.backfill(CONFIG.backfillLimit);
    if (!CONFIG.readonly) listener.startListening(); // live только при join-режиме

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
