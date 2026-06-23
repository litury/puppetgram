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
  minSubs?: number;      // минимум подписчиков у кандидата
  maxChannels?: number;  // потолок всего каналов
  throttleMs?: number;   // пауза между resolve (анти-FloodWait)
  recoLimit?: number;    // сколько рекомендаций брать на канал
}

export class FeedCrawlerService {
  private cursors = new ChannelCursorsRepository();
  private recs: ChannelRecommendationService;
  private joiner: FeedJoinerService;

  constructor(private client: TelegramClient, accountId: number) {
    this.recs = new ChannelRecommendationService(client);
    this.joiner = new FeedJoinerService(client, accountId);
  }

  /** Один проход расширения. Возвращает {added, expanded}. */
  async expandOnce(opts: CrawlOptions = {}): Promise<{ added: number; expanded: number }> {
    const perRun = opts.perRun ?? Number(process.env.FEED_CRAWL_PER_RUN || 20);
    const minSubs = opts.minSubs ?? Number(process.env.FEED_CRAWL_MIN_SUBS || 1000);
    const maxChannels = opts.maxChannels ?? Number(process.env.FEED_CRAWL_MAX_CHANNELS || 200);
    const throttleMs = opts.throttleMs ?? Number(process.env.FEED_RESOLVE_THROTTLE_MS || 2500);
    const recoLimit = opts.recoLimit ?? 40;
    const uncapped = maxChannels <= 0; // 0/отрицательное = без потолка (рост до исчерпания графа рекомендаций)

    const total = await this.cursors.count();
    if (!uncapped && total >= maxChannels) {
      log.info('Потолок каналов достигнут — краул пропущен', { total, maxChannels });
      return { added: 0, expanded: 0 };
    }
    const frontier = await this.cursors.frontierToCrawl(perRun);
    if (frontier.length === 0) return { added: 0, expanded: 0 };

    const known = new Set((await this.cursors.listAll()).map((c) => (c.channelUsername || '').toLowerCase()).filter(Boolean));
    let added = 0;
    let expanded = 0;

    for (const f of frontier) {
      if (!uncapped && total + added >= maxChannels) break;
      let candidates: any[] = [];
      try {
        const res = await this.recs.getRecommendationsForChannel(f.channelUsername, recoLimit);
        candidates = res?.channels ?? [];
      } catch (e: any) {
        log.warn('Рекомендации не получены', { channel: f.channelUsername, error: e?.message });
      }

      for (const c of candidates) {
        if (!uncapped && total + added >= maxChannels) break;
        const uname = (c?.username || '').toLowerCase();
        if (!uname) continue;
        if ((c?.subscribersCount ?? 0) < minSubs) continue;
        if (known.has(uname)) continue;

        const r = await this.joiner.onboard(uname, { join: false });
        if (r.outcome === 'flood' && r.retryAfter) {
          log.warn('FLOOD при резолве — стоп краула до след. цикла', { seconds: r.retryAfter });
          await this.cursors.markCrawled(f.channelId);
          return { added, expanded };
        }
        if (r.channelId != null && (r.outcome === 'joined' || r.outcome === 'already')) {
          known.add(uname);
          added++;
          log.info('Канал добавлен краулером', { from: f.channelUsername, channel: uname, subs: c?.subscribersCount });
        }
        await sleep(throttleMs);
      }

      await this.cursors.markCrawled(f.channelId);
      expanded++;
      await sleep(throttleMs);
    }

    log.info('Краул-проход завершён', { expanded, added, totalBefore: total });
    return { added, expanded };
  }
}
