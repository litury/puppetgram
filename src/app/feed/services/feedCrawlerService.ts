/**
 * feedCrawlerService — рекурсивное наращивание набора каналов ленты (READ-ONLY, без вступления).
 *
 * Берёт «фронтир» (каналы с crawled_at IS NULL), для каждого тянет похожие через
 * GetChannelRecommendations (channelRecommendationService) → онбордит достойных read-only
 * (resolve+cursor+access_hash, БЕЗ JoinChannel) → помечает источник crawled. Гарды: лимит
 * новых за прогон, потолок всего каналов, троттлинг (FloodWait). Так лента сама растёт от divatoz.
 */

import { TelegramClient } from 'telegram';
import { createLogger } from '../../../shared/utils/logger';
import { ChannelCursorsRepository } from '../../../shared/database/repositories/channelCursorsRepository';
import { FeedJoinerService } from './feedJoinerService';
import { ChannelRecommendationService } from '../../channelRecommendations/services/channelRecommendationService';

const log = createLogger('FeedCrawler');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CrawlOptions {
  perRun?: number;       // сколько фронтир-каналов расширять за прогон
  minSubs?: number;      // минимум подписчиков у кандидата (0 = без порога)
  maxChannels?: number;  // потолок всего каналов (<=0 = без потолка)
  throttleMs?: number;   // пауза между resolve (анти-FloodWait)
  recoLimit?: number;    // сколько рекомендаций брать на канал
  recrawlDays?: number;  // переспрашивать каналы, обойдённые раньше N дней назад (0 = одноразово)
}

export interface CrawlSession {
  client: TelegramClient;
  accountId: number;
}

export class FeedCrawlerService {
  private cursors = new ChannelCursorsRepository();
  // По сессии — свой recs + joiner (access_hash кэшируется на accountId; рекомендации у каждого акка свои).
  private workers: Array<{ recs: ChannelRecommendationService; joiner: FeedJoinerService }>;

  /** Принимает ОДНУ сессию или СПИСОК (ротация по аккаунтам → union рекомендаций, обход непремиум-капа ~10). */
  constructor(sessions: CrawlSession | CrawlSession[]) {
    const list = Array.isArray(sessions) ? sessions : [sessions];
    this.workers = list.map((s) => ({
      recs: new ChannelRecommendationService(s.client),
      joiner: new FeedJoinerService(s.client, s.accountId),
    }));
  }

  /** Один проход расширения. Возвращает {added, expanded}. */
  async expandOnce(opts: CrawlOptions = {}): Promise<{ added: number; expanded: number }> {
    const perRun = opts.perRun ?? Number(process.env.FEED_CRAWL_PER_RUN || 20);
    const minSubs = opts.minSubs ?? Number(process.env.FEED_CRAWL_MIN_SUBS || 1000);
    const maxChannels = opts.maxChannels ?? Number(process.env.FEED_CRAWL_MAX_CHANNELS || 200);
    const throttleMs = opts.throttleMs ?? Number(process.env.FEED_RESOLVE_THROTTLE_MS || 2500);
    const recoLimit = opts.recoLimit ?? 40;
    const recrawlDays = opts.recrawlDays ?? Number(process.env.FEED_RECRAWL_DAYS || 0);
    const uncapped = maxChannels <= 0; // 0/отрицательное = без потолка (рост до исчерпания графа рекомендаций)

    if (this.workers.length === 0) return { added: 0, expanded: 0 };

    const total = await this.cursors.count();
    if (!uncapped && total >= maxChannels) {
      log.info('Потолок каналов достигнут — краул пропущен', { total, maxChannels });
      return { added: 0, expanded: 0 };
    }
    const frontier = await this.cursors.frontierToCrawl(perRun, recrawlDays);
    if (frontier.length === 0) return { added: 0, expanded: 0 };

    const known = new Set((await this.cursors.listAll()).map((c) => (c.channelUsername || '').toLowerCase()).filter(Boolean));
    let added = 0;
    let expanded = 0;

    // Каждый фронтир-канал обрабатываем РОТИРУЕМЫМ аккаунтом (i-й канал → worker[i % N]).
    // Так разные аккаунты видят разные рекомендации, а на ре-краулах union накапливается в БД.
    const n = this.workers.length;
    const floodedWorkers = new Set<number>();

    for (let i = 0; i < frontier.length; i++) {
      if (!uncapped && total + added >= maxChannels) break;
      if (floodedWorkers.size >= n) {
        log.warn('Все аккаунты в FLOOD — стоп краула до след. цикла');
        break;
      }
      const f = frontier[i];
      const wIdx = i % n;
      if (floodedWorkers.has(wIdx)) continue; // этот акк остывает — пропускаем канал до след. цикла
      const w = this.workers[wIdx];

      let candidates: any[] = [];
      try {
        const res = await w.recs.getRecommendationsForChannel(f.channelUsername, recoLimit);
        candidates = res?.channels ?? [];
      } catch (e: any) {
        log.warn('Рекомендации не получены', { channel: f.channelUsername, worker: wIdx, error: e?.message });
      }

      let workerFlooded = false;
      for (const c of candidates) {
        if (!uncapped && total + added >= maxChannels) break;
        const uname = (c?.username || '').toLowerCase();
        if (!uname) continue;
        if (minSubs > 0 && (c?.subscribersCount ?? 0) < minSubs) continue;
        if (known.has(uname)) continue;

        const r = await w.joiner.onboard(uname, { join: false });
        if (r.outcome === 'flood' && r.retryAfter) {
          log.warn('FLOOD при резолве — аккаунт остывает', { worker: wIdx, seconds: r.retryAfter });
          floodedWorkers.add(wIdx);
          workerFlooded = true;
          break;
        }
        if (r.channelId != null && (r.outcome === 'joined' || r.outcome === 'already')) {
          known.add(uname);
          added++;
          log.info('Канал добавлен краулером', { from: f.channelUsername, channel: uname, subs: c?.subscribersCount, worker: wIdx });
        }
        await sleep(throttleMs);
      }

      // Источник помечаем обойдённым, только если аккаунт не упёрся в FLOOD на полпути (иначе переспросим позже).
      if (!workerFlooded) {
        await this.cursors.markCrawled(f.channelId);
        expanded++;
      }
      await sleep(throttleMs);
    }

    log.info('Краул-проход завершён', { expanded, added, totalBefore: total, accounts: n });
    return { added, expanded };
  }
}
