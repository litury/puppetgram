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

  async get(accountId: number, channelId: number): Promise<AccessHashCache | null> {
    const db = await this.db();
    const result: any = await db.execute(sql`
      SELECT * FROM access_hash_cache WHERE account_id = ${accountId} AND channel_id = ${channelId} LIMIT 1;
    `);
    const rows = (result.rows ?? result) as AccessHashCache[];
    return rows[0] ?? null;
  }
}
