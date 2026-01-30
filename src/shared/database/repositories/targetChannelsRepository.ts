/**
 * Target Channels Repository - работа с очередью каналов для комментирования
 */

import { eq, sql } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { targetChannels, TargetChannel } from '../schema';

/**
 * Интерфейс данных канала из рекомендаций Telegram
 */
export interface ChannelData {
  username: string;
  channelId?: number;
  title?: string;
  participants?: number;
  isVerified?: boolean;
  isScam?: boolean;
  isFake?: boolean;
}

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

  /**
   * Добавить каналы с указанным статусом (batch upsert)
   * Если канал существует — обновляет статус
   * Если не существует — добавляет с указанным статусом
   */
  async upsertWithStatus(usernames: string[], status: 'new' | 'done' | 'error' | 'skipped'): Promise<{ added: number; updated: number }> {
    if (usernames.length === 0) return { added: 0, updated: 0 };

    const db = await this.db();
    const cleanUsernames = usernames.map(u => u.replace('@', '').toLowerCase().trim());
    const now = new Date();

    // Используем INSERT ... ON CONFLICT DO UPDATE для batch upsert
    const result = await db
      .insert(targetChannels)
      .values(cleanUsernames.map(username => ({
        username,
        status,
        processedAt: status !== 'new' ? now : undefined,
      })))
      .onConflictDoUpdate({
        target: targetChannels.username,
        set: {
          status,
          processedAt: now,
        },
      })
      .returning({ username: targetChannels.username });

    return { added: 0, updated: result.length };
  }

  // ==================== МЕТОДЫ ДЛЯ ПАРСИНГА ====================

  /**
   * Получить следующую партию неспарсенных каналов
   */
  async getUnparsed(limit: number): Promise<TargetChannel[]> {
    const db = await this.db();
    return db
      .select()
      .from(targetChannels)
      .where(eq(targetChannels.parsed, false))
      .limit(limit);
  }

  /**
   * Пометить канал как спарсенный
   */
  async markParsed(username: string): Promise<void> {
    const db = await this.db();
    await db
      .update(targetChannels)
      .set({
        parsed: true,
        parsedAt: new Date(),
      })
      .where(eq(targetChannels.username, username.replace('@', '').toLowerCase()));
  }

  /**
   * Пометить каналы как спарсенные (batch)
   */
  async markParsedBatch(usernames: string[]): Promise<number> {
    if (usernames.length === 0) return 0;

    const db = await this.db();
    const cleanUsernames = usernames.map(u => u.replace('@', '').toLowerCase().trim());
    const now = new Date();

    // Используем raw SQL с массивом PostgreSQL для обхода лимита параметров
    const result = await db
      .update(targetChannels)
      .set({
        parsed: true,
        parsedAt: now,
      })
      .where(sql`${targetChannels.username} = ANY(${sql.raw(`ARRAY[${cleanUsernames.map(u => `'${u.replace(/'/g, "''")}'`).join(',')}]`)})`)
      .returning({ username: targetChannels.username });

    return result.length;
  }

  /**
   * Получить все юзернеймы (для фильтрации дубликатов в парсере)
   */
  async getAllUsernames(): Promise<Set<string>> {
    const db = await this.db();
    const result = await db
      .select({ username: targetChannels.username })
      .from(targetChannels);

    return new Set(result.map(r => r.username.toLowerCase()));
  }

  /**
   * Получить статистику парсинга
   */
  async getParsedStats(): Promise<{ parsed: number; unparsed: number; total: number }> {
    const db = await this.db();

    const result = await db
      .select({
        parsed: targetChannels.parsed,
        count: sql<number>`count(*)::int`,
      })
      .from(targetChannels)
      .groupBy(targetChannels.parsed);

    const stats = { parsed: 0, unparsed: 0, total: 0 };

    for (const row of result) {
      if (row.parsed) {
        stats.parsed = row.count;
      } else {
        stats.unparsed = row.count;
      }
      stats.total += row.count;
    }

    return stats;
  }

  // ==================== МЕТОДЫ ФАЗЫ 1: ДАННЫЕ ИЗ РЕКОМЕНДАЦИЙ ====================

  /**
   * Добавить каналы с расширенными данными из рекомендаций
   * Использует ON CONFLICT DO UPDATE для обновления существующих каналов
   */
  async addChannelsWithData(channels: ChannelData[]): Promise<number> {
    if (channels.length === 0) return 0;

    const db = await this.db();

    const values = channels.map(ch => ({
      username: ch.username.replace('@', '').toLowerCase().trim(),
      channelId: ch.channelId,
      title: ch.title,
      participants: ch.participants,
      isVerified: ch.isVerified ?? false,
      isScam: ch.isScam ?? false,
      isFake: ch.isFake ?? false,
    }));

    // ON CONFLICT DO UPDATE — обновляем данные если канал уже существует
    const result = await db
      .insert(targetChannels)
      .values(values)
      .onConflictDoUpdate({
        target: targetChannels.username,
        set: {
          channelId: sql`EXCLUDED.channel_id`,
          title: sql`EXCLUDED.title`,
          participants: sql`EXCLUDED.participants`,
          isVerified: sql`EXCLUDED.is_verified`,
          isScam: sql`EXCLUDED.is_scam`,
          isFake: sql`EXCLUDED.is_fake`,
        },
      })
      .returning();

    return result.length;
  }

  // ==================== МЕТОДЫ ФАЗЫ 2: МЕТРИКИ ИЗ ПОСТОВ ====================

  /**
   * Обновить метрики канала (из данных поста при комментировании)
   */
  async updateMetrics(username: string, metrics: {
    avgViews?: number;
    avgReactions?: number;
  }): Promise<void> {
    const db = await this.db();
    await db
      .update(targetChannels)
      .set({
        avgViews: metrics.avgViews,
        avgReactions: metrics.avgReactions,
        metricsAt: new Date(),
      })
      .where(eq(targetChannels.username, username.replace('@', '').toLowerCase()));
  }

  /**
   * Получить каналы с подписчиками больше указанного числа
   */
  async getByMinParticipants(minParticipants: number, limit: number = 100): Promise<TargetChannel[]> {
    const db = await this.db();
    return db
      .select()
      .from(targetChannels)
      .where(sql`${targetChannels.participants} >= ${minParticipants}`)
      .orderBy(sql`${targetChannels.participants} DESC`)
      .limit(limit);
  }

  /**
   * Получить статистику по подписчикам
   */
  async getParticipantsStats(): Promise<{
    total: number;
    withData: number;
    totalParticipants: number;
    avgParticipants: number;
  }> {
    const db = await this.db();

    const result = await db
      .select({
        total: sql<number>`count(*)::int`,
        withData: sql<number>`count(participants)::int`,
        totalParticipants: sql<number>`coalesce(sum(participants), 0)::bigint`,
        avgParticipants: sql<number>`coalesce(avg(participants), 0)::int`,
      })
      .from(targetChannels);

    return result[0] || { total: 0, withData: 0, totalParticipants: 0, avgParticipants: 0 };
  }
}
