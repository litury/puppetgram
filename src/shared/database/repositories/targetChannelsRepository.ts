/**
 * Target Channels Repository - работа с очередью каналов для комментирования
 */

import { eq, sql } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { targetChannels, TargetChannel } from '../schema';

export class TargetChannelsRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) {
      this.p_db = await getDatabase();
    }
    return this.p_db;
  }

  /**
   * Получить следующую партию каналов со статусом 'new'
   */
  async getNextBatch(limit: number): Promise<TargetChannel[]> {
    const db = await this.db();
    return db
      .select()
      .from(targetChannels)
      .where(eq(targetChannels.status, 'new'))
      .limit(limit);
  }

  /**
   * Пометить канал как успешно обработанный
   */
  async markDone(username: string): Promise<void> {
    const db = await this.db();
    await db
      .update(targetChannels)
      .set({
        status: 'done',
        processedAt: new Date(),
      })
      .where(eq(targetChannels.username, username.replace('@', '')));
  }

  /**
   * Пометить канал как ошибочный
   */
  async markError(username: string, errorMessage: string): Promise<void> {
    const db = await this.db();
    await db
      .update(targetChannels)
      .set({
        status: 'error',
        errorMessage,
        processedAt: new Date(),
      })
      .where(eq(targetChannels.username, username.replace('@', '')));
  }

  /**
   * Пометить канал как пропущенный
   */
  async markSkipped(username: string, reason?: string): Promise<void> {
    const db = await this.db();
    await db
      .update(targetChannels)
      .set({
        status: 'skipped',
        errorMessage: reason,
        processedAt: new Date(),
      })
      .where(eq(targetChannels.username, username.replace('@', '')));
  }

  /**
   * Добавить каналы в очередь (с дедупликацией)
   * Возвращает количество добавленных
   */
  async addChannels(usernames: string[]): Promise<number> {
    if (usernames.length === 0) return 0;

    const db = await this.db();
    const cleanUsernames = usernames.map(u => u.replace('@', '').toLowerCase().trim());

    // ON CONFLICT DO NOTHING - пропускает дубликаты
    const result = await db
      .insert(targetChannels)
      .values(cleanUsernames.map(username => ({ username })))
      .onConflictDoNothing()
      .returning();

    return result.length;
  }

  /**
   * Получить статистику очереди
   */
  async getStats(): Promise<{ new: number; done: number; error: number; skipped: number; total: number }> {
    const db = await this.db();

    const result = await db
      .select({
        status: targetChannels.status,
        count: sql<number>`count(*)::int`,
      })
      .from(targetChannels)
      .groupBy(targetChannels.status);

    const stats = { new: 0, done: 0, error: 0, skipped: 0, total: 0 };

    for (const row of result) {
      const status = row.status as keyof typeof stats;
      if (status in stats) {
        stats[status] = row.count;
      }
      stats.total += row.count;
    }

    return stats;
  }

  /**
   * Проверить существует ли канал в очереди
   */
  async exists(username: string): Promise<boolean> {
    const db = await this.db();
    const result = await db
      .select({ id: targetChannels.id })
      .from(targetChannels)
      .where(eq(targetChannels.username, username.replace('@', '')))
      .limit(1);

    return result.length > 0;
  }
}
