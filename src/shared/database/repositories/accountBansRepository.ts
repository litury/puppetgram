/**
 * AccountBans Repository — работа с таблицей account_bans (реальные spam-баны Telegram).
 *
 * Отличие от account_flood_wait: бан бессрочный пока пользователь не снимет вручную
 * (через appeal в @SpamBot и затем `npm run account:unban`).
 */

import { eq, isNull, and } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { accountBans, AccountBan } from '../schema';

export class AccountBansRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) {
      this.p_db = await getDatabase();
    }
    return this.p_db;
  }

  /**
   * Добавить бан для аккаунта. Если запись уже есть (даже снятая) — обновляет на свежую,
   * чтобы аккаунт снова попал в список активных банов.
   */
  async addBan(
    accountName: string,
    banReason?: string,
    spambotResponse?: string,
  ): Promise<AccountBan> {
    const db = await this.db();
    const result = await db
      .insert(accountBans)
      .values({
        accountName,
        banReason,
        spambotResponse,
      })
      .onConflictDoUpdate({
        target: accountBans.accountName,
        set: {
          bannedAt: new Date(),
          banReason,
          spambotResponse,
          unbannedAt: null,
        },
      })
      .returning();
    return result[0];
  }

  /**
   * Снять бан с аккаунта (после успешного appeal через @SpamBot).
   */
  async unban(accountName: string, notes?: string): Promise<AccountBan | undefined> {
    const db = await this.db();
    const result = await db
      .update(accountBans)
      .set({
        unbannedAt: new Date(),
        notes,
      })
      .where(eq(accountBans.accountName, accountName))
      .returning();
    return result[0];
  }

  /**
   * Получить все активные баны (где unbannedAt IS NULL).
   * Используется при старте бота для in-memory кеша.
   */
  async getActiveBans(): Promise<AccountBan[]> {
    const db = await this.db();
    return db
      .select()
      .from(accountBans)
      .where(isNull(accountBans.unbannedAt));
  }

  /**
   * Получить все имена активных банов как массив строк (для удобства Set).
   */
  async getActiveBannedNames(): Promise<string[]> {
    const rows = await this.getActiveBans();
    return rows.map(r => r.accountName);
  }

  /**
   * Получить запись по имени аккаунта.
   */
  async getByAccountName(accountName: string): Promise<AccountBan | undefined> {
    const db = await this.db();
    const result = await db
      .select()
      .from(accountBans)
      .where(eq(accountBans.accountName, accountName));
    return result[0];
  }

  /**
   * Проверить активен ли бан у аккаунта прямо сейчас (для точечной проверки).
   */
  async isActivelyBanned(accountName: string): Promise<boolean> {
    const db = await this.db();
    const result = await db
      .select()
      .from(accountBans)
      .where(
        and(eq(accountBans.accountName, accountName), isNull(accountBans.unbannedAt)),
      );
    return result.length > 0;
  }

  /**
   * Получить все записи (включая снятые баны) — для админки/дашборда.
   */
  async getAll(): Promise<AccountBan[]> {
    const db = await this.db();
    return db.select().from(accountBans);
  }
}
