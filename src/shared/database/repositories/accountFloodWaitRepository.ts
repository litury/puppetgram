/**
 * AccountFloodWait Repository - работа с таблицей account_flood_wait (PostgreSQL async)
 *
 * Хранит состояние FLOOD_WAIT аккаунтов для персистентности между перезапусками
 */

import { eq, gt, sql } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { accountFloodWait, AccountFloodWait, NewAccountFloodWait } from '../schema';

export class AccountFloodWaitRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) {
      this.p_db = await getDatabase();
    }
    return this.p_db;
  }

  /**
   * Добавить или обновить FLOOD_WAIT для аккаунта
   */
  async setFloodWait(accountName: string, unlockAt: Date, reason?: string): Promise<AccountFloodWait> {
    const db = await this.db();

    // Используем upsert (INSERT ... ON CONFLICT UPDATE)
    const result = await db
      .insert(accountFloodWait)
      .values({
        accountName,
        unlockAt,
        reason,
      })
      .onConflictDoUpdate({
        target: accountFloodWait.accountName,
        set: {
          unlockAt,
          reason,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  }

  /**
   * Удалить FLOOD_WAIT для аккаунта (когда разблокирован)
   */
  async removeFloodWait(accountName: string): Promise<void> {
    const db = await this.db();
    await db
      .delete(accountFloodWait)
      .where(eq(accountFloodWait.accountName, accountName));
  }

  /**
   * Получить все активные FLOOD_WAIT (где unlockAt > now)
   */
  async getActiveFloodWaits(): Promise<AccountFloodWait[]> {
    const db = await this.db();
    return db
      .select()
      .from(accountFloodWait)
      .where(gt(accountFloodWait.unlockAt, new Date()));
  }

  /**
   * Получить FLOOD_WAIT для конкретного аккаунта
   */
  async getByAccountName(accountName: string): Promise<AccountFloodWait | undefined> {
    const db = await this.db();
    const result = await db
      .select()
      .from(accountFloodWait)
      .where(eq(accountFloodWait.accountName, accountName));
    return result[0];
  }

  /**
   * Удалить истекшие записи (cleanup)
   */
  async cleanupExpired(): Promise<number> {
    const db = await this.db();
    const result = await db
      .delete(accountFloodWait)
      .where(sql`${accountFloodWait.unlockAt} <= NOW()`)
      .returning();
    return result.length;
  }

  /**
   * Получить все записи (для отладки)
   */
  async getAll(): Promise<AccountFloodWait[]> {
    const db = await this.db();
    return db.select().from(accountFloodWait);
  }
}
