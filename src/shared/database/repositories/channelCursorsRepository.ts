/**
 * Channel Cursors Repository — состояние сбора по каналу.
 *
 * last_seen_post_id — докуда дочитан канал (инкрементальный GetHistory + backfill).
 * next_poll_at + tier — адаптивная частота опроса/рефреша метрик.
 * baseline_views — медиана просмотров для overperformance в скоринге.
 */

import { sql } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { ChannelCursor } from '../schema';

export class ChannelCursorsRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) {
      this.p_db = await getDatabase();
    }
    return this.p_db;
  }

  /** Завести курсор канала, если его ещё нет (идемпотентно). */
  async ensure(channelId: number, channelUsername?: string | null): Promise<void> {
    const db = await this.db();
    await db.execute(sql`
      INSERT INTO channel_cursors (channel_id, channel_username, next_poll_at)
      VALUES (${channelId}, ${channelUsername ?? null}, now())
      ON CONFLICT (channel_id) DO NOTHING;
    `);
  }

  async get(channelId: number): Promise<ChannelCursor | null> {
    const db = await this.db();
    const result: any = await db.execute(sql`SELECT * FROM channel_cursors WHERE channel_id = ${channelId} LIMIT 1;`);
    const rows = (result.rows ?? result) as ChannelCursor[];
    return rows[0] ?? null;
  }

  /** Сдвинуть курсор вперёд (только если новое значение больше — защита от гонок). */
  async advanceLastSeen(channelId: number, lastSeenPostId: number): Promise<void> {
    const db = await this.db();
    await db.execute(sql`
      UPDATE channel_cursors
      SET last_seen_post_id = GREATEST(COALESCE(last_seen_post_id, 0), ${lastSeenPostId}), updated_at = now()
      WHERE channel_id = ${channelId};
    `);
  }

  /** Запланировать следующий опрос (адаптивная частота по tier). */
  async scheduleNextPoll(channelId: number, nextPollAt: Date, tier?: string): Promise<void> {
    const db = await this.db();
    if (tier) {
      await db.execute(sql`
        UPDATE channel_cursors SET next_poll_at = ${nextPollAt}, tier = ${tier}, updated_at = now()
        WHERE channel_id = ${channelId};
      `);
    } else {
      await db.execute(sql`
        UPDATE channel_cursors SET next_poll_at = ${nextPollAt}, updated_at = now()
        WHERE channel_id = ${channelId};
      `);
    }
  }

  async setBaselineViews(channelId: number, baselineViews: number): Promise<void> {
    const db = await this.db();
    await db.execute(sql`
      UPDATE channel_cursors SET baseline_views = ${baselineViews}, updated_at = now()
      WHERE channel_id = ${channelId};
    `);
  }

  /** Каналы, которым пора опрос/backfill (next_poll_at <= now). */
  async dueForPoll(limit: number = 100): Promise<ChannelCursor[]> {
    const db = await this.db();
    const result: any = await db.execute(sql`
      SELECT * FROM channel_cursors
      WHERE next_poll_at IS NULL OR next_poll_at <= now()
      ORDER BY next_poll_at ASC NULLS FIRST
      LIMIT ${limit};
    `);
    return (result.rows ?? result) as ChannelCursor[];
  }
}
