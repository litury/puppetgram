/**
 * Feed Jobs Repository — эфемерная очередь событий «новый пост».
 *
 * listener пишет лёгкое событие (enqueue, идемпотентно по (channel_id, tg_message_id)),
 * enricher забирает партию через `UPDATE … FOR UPDATE SKIP LOCKED` (безопасно при N репликах),
 * обрабатывает и помечает done/error. После done строку можно подчищать reaper'ом.
 */

import { sql, inArray } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { FeedJob, feedJobs } from '../schema';

export class FeedJobsRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) {
      this.p_db = await getDatabase();
    }
    return this.p_db;
  }

  /**
   * Поставить событие в очередь. Идемпотентно: дубль (live + backfill) по
   * (channel_id, tg_message_id) игнорируется (ON CONFLICT DO NOTHING).
   */
  async enqueue(channelId: number, tgMessageId: number): Promise<void> {
    const db = await this.db();
    await db.execute(sql`
      INSERT INTO feed_jobs (channel_id, tg_message_id, status)
      VALUES (${channelId}, ${tgMessageId}, 'pending')
      ON CONFLICT (channel_id, tg_message_id) DO NOTHING;
    `);
  }

  /**
   * Атомарно забрать партию заданий на обработку.
   * Берёт pending + зависшие processing (reaper по stuckMinutes), помечает processing,
   * инкрементит attempts. Безопасно при нескольких enricher'ах (SKIP LOCKED).
   */
  async claimBatch(limit: number, stuckMinutes: number = 10): Promise<FeedJob[]> {
    const db = await this.db();
    // 1) Атомарно клеймим партию, возвращаем только id (raw SQL для FOR UPDATE SKIP LOCKED).
    const claimed: any = await db.execute(sql`
      UPDATE feed_jobs
      SET status = 'processing', claimed_at = now(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM feed_jobs
        WHERE status = 'pending'
           OR (status = 'processing' AND claimed_at < now() - make_interval(mins => ${stuckMinutes}))
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id;
    `);
    const rows = (claimed.rows ?? claimed) as any[];
    const ids = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return [];
    // 2) Полные строки тянем через query-builder — он гарантированно мапит snake_case→camelCase
    //    (channel_id→channelId), иначе job.channelId был бы undefined и getByChannelMsg падал.
    return db.select().from(feedJobs).where(inArray(feedJobs.id, ids));
  }

  async markDone(id: number): Promise<void> {
    const db = await this.db();
    await db.execute(sql`UPDATE feed_jobs SET status = 'done' WHERE id = ${id};`);
  }

  async markError(id: number, message: string): Promise<void> {
    const db = await this.db();
    await db.execute(sql`UPDATE feed_jobs SET status = 'error', error_message = ${message} WHERE id = ${id};`);
  }

  /** Подчистить успешно обработанные задания старше N часов (вызывать периодически). */
  async purgeDone(olderThanHours: number = 24): Promise<number> {
    const db = await this.db();
    const result: any = await db.execute(sql`
      DELETE FROM feed_jobs
      WHERE status = 'done' AND created_at < now() - make_interval(hours => ${olderThanHours});
    `);
    return (result.rowCount ?? 0) as number;
  }
}
