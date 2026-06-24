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
    await db.execute(sql`
      INSERT INTO video_requests (channel_id, tg_message_id, status)
      VALUES (${channelId}, ${tgMessageId}, 'pending')
      ON CONFLICT (channel_id, tg_message_id) DO NOTHING;
    `);
    return this.get(channelId, tgMessageId);
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
        ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, channel_id, tg_message_id;
    `);
    const row = (r.rows ?? r)[0];
    if (!row) return null;
    return { id: Number(row.id), channelId: Number(row.channel_id), tgMessageId: Number(row.tg_message_id) };
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
