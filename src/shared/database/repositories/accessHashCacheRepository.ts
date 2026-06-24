/**
 * Access Hash Cache Repository — кэш (аккаунт, канал) → access_hash.
 *
 * access_hash привязан к аккаунту: значение, полученное аккаунтом A, не работает у B.
 * Позволяет читать канал через InputPeerChannel БЕЗ повторного ResolveUsername.
 * Резолв канала аккаунтом — один раз, дальше чтение из кэша (экономит ~200/сутки бюджет резолвов).
 */

import { sql } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { AccessHashCache } from '../schema';

export class AccessHashCacheRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) {
      this.p_db = await getDatabase();
    }
    return this.p_db;
  }

  /** Сохранить/обновить access_hash для пары (аккаунт, канал). */
  async set(accountId: number, channelId: number, accessHash: bigint, channelUsername?: string | null): Promise<void> {
    const db = await this.db();
    await db.execute(sql`
      INSERT INTO access_hash_cache (account_id, channel_id, access_hash, channel_username)
      VALUES (${accountId}, ${channelId}, ${accessHash}, ${channelUsername ?? null})
      ON CONFLICT (account_id, channel_id) DO UPDATE SET
        access_hash = EXCLUDED.access_hash,
        channel_username = COALESCE(EXCLUDED.channel_username, access_hash_cache.channel_username);
    `);
  }

  /**
   * Каналы БЕЗ аватарки, у которых ЕСТЬ кэш access_hash → можно скачать фото без ResolveUsername.
   * DISTINCT ON: один аккаунт-владелец на канал (любой, что резолвил). access_hash — строкой (bigint).
   */
  async listForAvatar(limit: number): Promise<Array<{ channelId: number; accountId: number; accessHash: string; channelUsername: string | null }>> {
    const db = await this.db();
    const r: any = await db.execute(sql`
      SELECT DISTINCT ON (a.channel_id)
        a.channel_id, a.account_id, a.access_hash::text AS access_hash, c.channel_username
      FROM channel_cursors c
      JOIN access_hash_cache a ON a.channel_id = c.channel_id
      WHERE c.avatar_url IS NULL AND c.channel_username IS NOT NULL
      ORDER BY a.channel_id, a.account_id
      LIMIT ${limit};
    `);
    return ((r.rows ?? r) as any[]).map((x) => ({
      channelId: Number(x.channel_id),
      accountId: Number(x.account_id),
      accessHash: String(x.access_hash),
      channelUsername: x.channel_username ?? null,
    }));
  }

  /** access_hash для канала ОТ ЖИВОГО аккаунта (из переданного списка accountIds) — InputChannel без ResolveUsername. */
  async getForChannel(channelId: number, accountIds: number[]): Promise<{ accountId: number; accessHash: string } | null> {
    const ids = accountIds.filter((n) => Number.isInteger(n)).join(',');
    if (!ids) return null;
    const db = await this.db();
    const r: any = await db.execute(sql`
      SELECT account_id, access_hash::text AS access_hash FROM access_hash_cache
      WHERE channel_id = ${channelId} AND account_id IN (${sql.raw(ids)}) LIMIT 1;
    `);
    const row = (r.rows ?? r)[0];
    return row ? { accountId: Number(row.account_id), accessHash: String(row.access_hash) } : null;
  }

  /** Любой (account_id, access_hash) для канала — чтобы построить InputChannel без ResolveUsername. */
  async getAnyForChannel(channelId: number): Promise<{ accountId: number; accessHash: string } | null> {
    const db = await this.db();
    const r: any = await db.execute(sql`
      SELECT account_id, access_hash::text AS access_hash FROM access_hash_cache
      WHERE channel_id = ${channelId} LIMIT 1;
    `);
    const row = (r.rows ?? r)[0];
    return row ? { accountId: Number(row.account_id), accessHash: String(row.access_hash) } : null;
  }

  async get(accountId: number, channelId: number): Promise<AccessHashCache | null> {
    const db = await this.db();
    const result: any = await db.execute(sql`
      SELECT * FROM access_hash_cache WHERE account_id = ${accountId} AND channel_id = ${channelId} LIMIT 1;
    `);
    const rows = (result.rows ?? result) as AccessHashCache[];
    return rows[0] ?? null;
  }
}
