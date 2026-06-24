/**
 * Video Requests Repository — LAZY-очередь загрузки видео по запросу зрителя (async request-reply).
 * Фронт по клику Play → request() (enqueue pending или вернуть готовый url). Коллектор claimOne()
 * (SKIP LOCKED) → качает видео → markDone(url). Идемпотентно по (channel_id, tg_message_id).
 */

import { sql } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';

export interface VideoReqState {
  status: 'pending' | 'processing' | 'done' | 'error';
  url: string | null;
}

export class VideoRequestsRepository {
  private p_db: DatabaseClient | null = null;
  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) this.p_db = await getDatabase();
    return this.p_db;
  }

  /** Запрос на видео: вставить pending (или ничего, если уже есть) и вернуть текущее состояние. */
  async request(channelId: number, tgMessageId: number): Promise<VideoReqState> {
    const db = await this.db();
    // Клик зрителя → высокий приоритет (10): берётся воркером ВПЕРЁД предзагрузки (priority 0).
    // Если уже в очереди от precache (pending) — поднимаем приоритет.
    await db.execute(sql`
      INSERT INTO video_requests (channel_id, tg_message_id, status, priority)
      VALUES (${channelId}, ${tgMessageId}, 'pending', 10)
      ON CONFLICT (channel_id, tg_message_id) DO UPDATE SET priority = 10
      WHERE video_requests.status = 'pending';
    `);
    return this.get(channelId, tgMessageId);
  }

  /**
   * Предзагрузка: поставить в очередь последние N постов с видео (по posted_at DESC), которые ещё не
   * скачаны. Идемпотентно (ON CONFLICT DO NOTHING) — уже done/pending не трогаются. Возвращает кол-во новых.
   */
  async enqueueRecentVideos(limit: number): Promise<number> {
    const db = await this.db();
    // Берём mid КАЖДОГО видео-элемента media_refs (покрывает участников альбома, у каждого свой mid),
    // а не tg_message_id поста (rep). Старые рефы без mid пропускаются (их чинит бэкафилл).
    const r: any = await db.execute(sql`
      INSERT INTO video_requests (channel_id, tg_message_id, status)
      SELECT p.channel_id, (elem->>'mid')::bigint, 'pending'
      FROM (
        SELECT channel_id, media_refs FROM posts
        WHERE media_refs @> '[{"kind":"video"}]'::jsonb AND posted_at IS NOT NULL
        ORDER BY posted_at DESC LIMIT ${limit}
      ) p, jsonb_array_elements(p.media_refs) elem
      WHERE elem->>'kind' = 'video' AND (elem ? 'mid')
      ON CONFLICT (channel_id, tg_message_id) DO NOTHING
      RETURNING id;
    `);
    return ((r.rows ?? r) as any[]).length;
  }

  async get(channelId: number, tgMessageId: number): Promise<VideoReqState> {
    const db = await this.db();
    const r: any = await db.execute(sql`
      SELECT status, url FROM video_requests
      WHERE channel_id = ${channelId} AND tg_message_id = ${tgMessageId} LIMIT 1;
    `);
    const row = (r.rows ?? r)[0];
    if (!row) return { status: 'pending', url: null };
    return { status: row.status, url: row.url ?? null };
  }

  /** Забрать одну pending-задачу (SKIP LOCKED) → processing. null если очередь пуста. */
  async claimOne(): Promise<{ id: number; channelId: number; tgMessageId: number } | null> {
    const db = await this.db();
    const r: any = await db.execute(sql`
      UPDATE video_requests SET status='processing', claimed_at=now(), attempts=attempts+1
      WHERE id = (
        SELECT id FROM video_requests
        WHERE status='pending' OR (status='processing' AND claimed_at < now() - interval '5 minutes')
        ORDER BY priority DESC, created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, channel_id, tg_message_id;
    `);
    const row = (r.rows ?? r)[0];
    if (!row) return null;
    return { id: Number(row.id), channelId: Number(row.channel_id), tgMessageId: Number(row.tg_message_id) };
  }

  /** Готовые видео (для one-off ре-ремукса в faststart). */
  async listDone(limit: number = 1000): Promise<Array<{ channelId: number; tgMessageId: number; url: string }>> {
    const db = await this.db();
    const r: any = await db.execute(sql`
      SELECT channel_id, tg_message_id, url FROM video_requests
      WHERE status='done' AND url IS NOT NULL ORDER BY id DESC LIMIT ${limit};
    `);
    return ((r.rows ?? r) as any[]).map((x) => ({ channelId: Number(x.channel_id), tgMessageId: Number(x.tg_message_id), url: String(x.url) }));
  }

  async markDone(id: number, url: string): Promise<void> {
    const db = await this.db();
    await db.execute(sql`UPDATE video_requests SET status='done', url=${url}, error_message=NULL WHERE id=${id};`);
  }

  async markError(id: number, message: string): Promise<void> {
    const db = await this.db();
    await db.execute(sql`UPDATE video_requests SET status='error', error_message=${message.slice(0, 500)} WHERE id=${id};`);
  }
}
