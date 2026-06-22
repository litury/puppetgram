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

  /** Все известные каналы (для мониторинга листенером — env-сиды + открытые краулером). */
  async listAll(): Promise<Array<{ channelId: number; channelUsername: string | null; lastSeenPostId: number | null }>> {
    const db = await this.db();
    const r: any = await db.execute(sql`SELECT channel_id, channel_username, last_seen_post_id FROM channel_cursors;`);
    const rows = (r.rows ?? r) as any[];
    return rows.map((x) => ({
      channelId: Number(x.channel_id),
      channelUsername: x.channel_username ?? null,
      lastSeenPostId: x.last_seen_post_id != null ? Number(x.last_seen_post_id) : null,
    }));
  }

  /** Фронтир для краулера: каналы с username, ещё не расширенные (crawled_at IS NULL). */
  async frontierToCrawl(limit: number): Promise<Array<{ channelId: number; channelUsername: string }>> {
    const db = await this.db();
    const r: any = await db.execute(sql`
      SELECT channel_id, channel_username FROM channel_cursors
      WHERE crawled_at IS NULL AND channel_username IS NOT NULL
      ORDER BY updated_at ASC LIMIT ${limit};
    `);
    const rows = (r.rows ?? r) as any[];
    return rows.map((x) => ({ channelId: Number(x.channel_id), channelUsername: String(x.channel_username) }));
  }

  /** Пометить канал расширённым (краулер обработал его рекомендации). */
  async markCrawled(channelId: number): Promise<void> {
    const db = await this.db();
    await db.execute(sql`UPDATE channel_cursors SET crawled_at = now() WHERE channel_id = ${channelId};`);
  }

  /** Сколько всего каналов известно (для лимита роста). */
  async count(): Promise<number> {
    const db = await this.db();
    const r: any = await db.execute(sql`SELECT count(*)::int AS n FROM channel_cursors;`);
    return Number((r.rows ?? r)[0]?.n ?? 0);
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
