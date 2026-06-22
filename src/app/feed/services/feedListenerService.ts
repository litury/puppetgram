/**
 * feedListenerService — ТОНКИЙ live-listener на одной сессии.
 *
 * На событие NewMessage в мониторимом канале: upsert поста (данные из события — бесплатно)
 * + enqueue в feed_jobs (тяжёлую обработку делает enricher) + сдвиг курсора. На старте/реконнекте
 * — backfill из last_seen (GetHistory minId) для добора дыр в потоке апдейтов. Watchdog:
 * lastEventAt наружу — runner перезапускает «зависшую» сессию.
 */

import { Api, TelegramClient } from 'telegram';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { createLogger } from '../../../shared/utils/logger';
import { PostsRepository } from '../../../shared/database/repositories/postsRepository';
import { FeedJobsRepository } from '../../../shared/database/repositories/feedJobsRepository';
import { ChannelCursorsRepository } from '../../../shared/database/repositories/channelCursorsRepository';
import { messageToPost, channelIdFromMessage } from './postExtractor';

const log = createLogger('FeedListener');

export interface MonitoredChannel {
  channelId: number;
  username?: string | null;
  lastSeenPostId?: number | null;
}

export class FeedListenerService {
  private posts = new PostsRepository();
  private jobs = new FeedJobsRepository();
  private cursors = new ChannelCursorsRepository();

  private monitored = new Map<number, MonitoredChannel>();
  private handler: ((e: NewMessageEvent) => Promise<void>) | null = null;
  lastEventAt = Date.now();

  constructor(private client: TelegramClient) {}

  /** Зарегистрировать набор каналов этой сессии. */
  setChannels(channels: MonitoredChannel[]): void {
    this.monitored = new Map(channels.map((c) => [c.channelId, c]));
  }

  /** Backfill пропущенного по каждому каналу (GetHistory minId=last_seen). */
  async backfill(perChannelLimit: number = 50): Promise<void> {
    for (const ch of this.monitored.values()) {
      const ref = ch.username || ch.channelId;
      try {
        const opts: any = { limit: perChannelLimit };
        if (ch.lastSeenPostId) opts.minId = ch.lastSeenPostId;
        const messages: any[] = await this.client.getMessages(ref as any, opts);
        let maxId = ch.lastSeenPostId || 0;
        for (const msg of messages) {
          await this.ingest(msg, ch.channelId, ch.username);
          if (msg?.id > maxId) maxId = msg.id;
        }
        if (maxId > (ch.lastSeenPostId || 0)) {
          await this.cursors.advanceLastSeen(ch.channelId, maxId);
          ch.lastSeenPostId = maxId;
        }
        log.debug('Backfill канала', { channelId: ch.channelId, fetched: messages.length });
      } catch (e: any) {
        log.warn('Backfill не удался', { channelId: ch.channelId, error: e?.errorMessage || e?.message });
      }
    }
  }

  /** Навесить обработчик новых сообщений (каналы-посты). */
  startListening(): void {
    this.handler = async (event: NewMessageEvent) => {
      try {
        this.lastEventAt = Date.now();
        const msg = event.message as any;
        const cid = channelIdFromMessage(msg);
        if (cid == null || !this.monitored.has(cid)) return; // не наш канал
        const ch = this.monitored.get(cid)!;
        await this.ingest(msg, cid, ch.username);
        await this.cursors.advanceLastSeen(cid, Number(msg.id));
      } catch (e: any) {
        log.warn('Ошибка обработки события', { error: e?.message });
      }
    };
    this.client.addEventHandler(this.handler, new NewMessage({}));
    log.info('Listener запущен', { channels: this.monitored.size });
  }

  /** Записать пост (upsert) + поставить событие в очередь обогащения. */
  private async ingest(msg: any, channelId: number, username?: string | null): Promise<void> {
    const post = messageToPost(msg, channelId, username);
    if (!post) return;
    await this.posts.upsertPost(post);
    await this.jobs.enqueue(channelId, post.tgMessageId);
  }
}
