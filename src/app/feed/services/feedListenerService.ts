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
import { messageToPost, channelIdFromMessage, groupedIdOf } from './postExtractor';
import { fetchAndStoreMedia, MediaRef } from './feedMediaService';

const MEDIA_ENABLED = process.env.FEED_DOWNLOAD_MEDIA !== '0';

const log = createLogger('FeedListener');

export interface MonitoredChannel {
  channelId: number;
  username?: string | null;
  lastSeenPostId?: number | null;
  accessHash?: string | null; // если есть → читаем resolve-free (InputChannel, без ResolveUsername-флуда)
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

  /** Backfill пропущенного по каждому каналу (GetHistory minId=last_seen).
   *  Троттлинг между каналами (анти-FLOOD одним аккаунтом); на FLOOD — стоп цикла (даём остыть). */
  async backfill(perChannelLimit: number = 50): Promise<void> {
    const throttleMs = Number(process.env.FEED_BACKFILL_THROTTLE_MS || 500);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Орфаны (нет access_hash) читаем по username = ResolveUsername (флуд-killer) → строгий бюджет на цикл.
    let orphanBudget = Number(process.env.FEED_ORPHAN_RESOLVES_PER_CYCLE || 5);
    for (const ch of this.monitored.values()) {
      // RESOLVE-FREE: если есть access_hash — читаем через InputChannel (НЕ дёргаем ResolveUsername).
      let ref: any;
      if (ch.accessHash) {
        ref = new Api.InputChannel({ channelId: BigInt(ch.channelId) as any, accessHash: BigInt(ch.accessHash) as any });
      } else if (ch.username && orphanBudget > 0) {
        ref = ch.username; // орфан: разовый резолв (в пределах бюджета) → дальше закэшируется
        orphanBudget--;
      } else {
        continue; // орфан без бюджета — пропускаем этот цикл (покурсору догоним позже/другим аккаунтом)
      }
      try {
        const opts: any = { limit: perChannelLimit };
        if (ch.lastSeenPostId) opts.minId = ch.lastSeenPostId;
        const messages: any[] = await this.client.getMessages(ref as any, opts);
        let maxId = ch.lastSeenPostId || 0;
        // Группируем Telegram-альбомы (media-group) по grouped_id → один пост на альбом.
        // Одиночные сообщения (нет grouped_id) идут как раньше.
        const albums = new Map<string, any[]>();
        const singles: any[] = [];
        for (const msg of messages) {
          if (msg?.id > maxId) maxId = msg.id;
          const gid = groupedIdOf(msg);
          if (gid) {
            if (!albums.has(gid)) albums.set(gid, []);
            albums.get(gid)!.push(msg);
          } else {
            singles.push(msg);
          }
        }
        for (const msg of singles) await this.ingest(msg, ch.channelId, ch.username);
        for (const members of albums.values()) {
          if (members.length === 1) await this.ingest(members[0], ch.channelId, ch.username);
          else await this.ingestAlbum(members, ch.channelId, ch.username);
        }
        if (maxId > (ch.lastSeenPostId || 0)) {
          await this.cursors.advanceLastSeen(ch.channelId, maxId);
          ch.lastSeenPostId = maxId;
        }
        log.debug('Backfill канала', { channelId: ch.channelId, fetched: messages.length });
      } catch (e: any) {
        const err = e?.errorMessage || e?.message || '';
        log.warn('Backfill не удался', { channelId: ch.channelId, error: err });
        // FLOOD — аккаунт упёрся в лимит: прекращаем цикл, дадим остыть до следующего опроса.
        if (/FLOOD/i.test(String(err)) || e?.constructor?.name === 'FloodWaitError') {
          log.warn('FLOOD на backfill — стоп цикла, остываем', { stoppedAt: ch.channelId });
          break;
        }
      }
      await sleep(throttleMs);
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

    // Медиа: качаем через свой GramJS-клиент и кладём в MediaStore (телеграм-файлы публично недоступны).
    // Идемпотентно: пропускаем, если у поста уже есть mediaRefs.
    if (MEDIA_ENABLED && msg?.media) {
      try {
        if (await this.posts.hasMediaRefs(channelId, post.tgMessageId)) return;
        const refs = await fetchAndStoreMedia(this.client, msg, channelId, post.tgMessageId);
        if (refs && refs.length) await this.posts.updateMediaRefs(channelId, post.tgMessageId, refs);
      } catch (e: any) {
        log.warn('Медиа не обработано', { channelId, msgId: post.tgMessageId, error: e?.message });
      }
    }
  }

  /**
   * Альбом (media-group) = несколько сообщений с общим grouped_id → ОДИН пост.
   * Ключ поста = минимальный message id группы (стабилен). Текст/entities — из участника с подписью.
   * Метрики — max по участникам (у альбома общие). Медиа всех участников собираются в один mediaRefs.
   */
  private async ingestAlbum(members: any[], channelId: number, username?: string | null): Promise<void> {
    const sorted = [...members].sort((a, b) => Number(a?.id ?? 0) - Number(b?.id ?? 0));
    const repId = Number(sorted[0]?.id);
    if (!repId) return;
    // подпись альбома — у того участника, где есть текст (обычно первый)
    const caption = sorted.find((m) => (m?.message ?? m?.text)) ?? sorted[0];

    const post = messageToPost(caption, channelId, username);
    if (!post) return;
    post.tgMessageId = repId;
    post.mediaType = 'album';
    // метрики — максимум по участникам (Telegram отдаёт их по альбому в целом, но на каждом сообщении)
    const maxOf = (key: string) => sorted.reduce((mx, m) => Math.max(mx, Number(m?.[key] ?? 0)), 0) || null;
    post.views = maxOf('views');
    post.forwards = maxOf('forwards');
    post.repliesCount = sorted.reduce((mx, m) => Math.max(mx, Number(m?.replies?.replies ?? 0)), 0) || null;

    await this.posts.upsertPost(post);
    await this.jobs.enqueue(channelId, repId);

    if (MEDIA_ENABLED) {
      try {
        if (await this.posts.hasMediaRefs(channelId, repId)) return;
        const collected: MediaRef[] = [];
        for (const m of sorted) {
          if (!m?.media) continue;
          // ключ файлов — по СВОЕМУ id участника (не repId), чтобы не конфликтовали
          const refs = await fetchAndStoreMedia(this.client, m, channelId, Number(m.id));
          if (refs && refs.length) collected.push(...refs);
        }
        if (collected.length) {
          // все фото и их ≥2 → завернуть в один album-ref (сетка-превью на фронте); иначе плоский массив
          const allPhotos = collected.length >= 2 && collected.every((r) => r.kind === 'photo');
          const finalRefs: any = allPhotos
            ? [{ kind: 'album', items: collected.map((r: any) => ({ url: r.url, w: r.w, h: r.h })) }]
            : collected;
          await this.posts.updateMediaRefs(channelId, repId, finalRefs);
        }
      } catch (e: any) {
        log.warn('Медиа альбома не обработано', { channelId, repId, error: e?.message });
      }
    }
  }
}
