import { sql } from 'drizzle-orm';
import { DatabaseClient, getDatabase } from '../client';

export class CommenterRetriesRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) this.p_db = await getDatabase();
    return this.p_db;
  }

  async defer(sender: string, channel: string, reason: string, baseSeconds: number, maxSeconds: number): Promise<Date> {
    const db = await this.db();
    const result = await db.execute(sql`
      INSERT INTO commenter_retries (sender, channel_username, retry_at, attempts, reason)
      VALUES (${sender.replace(/^@/, '').toLowerCase()}, ${channel.replace(/^@/, '').toLowerCase()},
        now() + make_interval(secs => ${baseSeconds}), 1, ${reason.slice(0, 500)})
      ON CONFLICT (sender, channel_username) DO UPDATE SET
        attempts = LEAST(commenter_retries.attempts + 1, 11),
        retry_at = GREATEST(commenter_retries.retry_at,
          now() + make_interval(secs => LEAST(${maxSeconds}, ${baseSeconds} * power(2, LEAST(commenter_retries.attempts, 10))))),
        reason = EXCLUDED.reason
      RETURNING retry_at
    `);
    return new Date((result.rows[0] as { retry_at: Date }).retry_at);
  }

  async getGlobalPause(sender: string): Promise<Date | null> {
    const db = await this.db();
    const result = await db.execute(sql`
      SELECT retry_at FROM commenter_retries
      WHERE sender = ${sender.replace(/^@/, '').toLowerCase()} AND channel_username = '' AND retry_at > now()
    `);
    return result.rows[0] ? new Date((result.rows[0] as { retry_at: Date }).retry_at) : null;
  }

  async clear(sender: string, channel: string): Promise<void> {
    const db = await this.db();
    await db.execute(sql`DELETE FROM commenter_retries
      WHERE sender = ${sender.replace(/^@/, '').toLowerCase()} AND channel_username = ${channel.replace(/^@/, '').toLowerCase()}`);
  }
}
