/**
 * Accounts Repository — единый реестр Telegram-аккаунтов (таблица accounts).
 *
 * Заменяет хранение сессий в env: сервис грузит аккаунты по своему `pool`
 * (checker/commenter/parser/…), добавить = INSERT (без редеплоя).
 * `getActiveByPool` отдаёт объекты в форме EnvAccountsParser.Account, чтобы
 * существующая логика подключения (ensureAccount и т.п.) работала без изменений.
 */

import { eq, and } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { accounts } from '../schema';
import { Account } from '../../utils/envAccountsParser';

export class AccountsRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) {
      this.p_db = await getDatabase();
    }
    return this.p_db;
  }

  /** Активные аккаунты пула в форме EnvAccountsParser.Account (для ротации). */
  async getActiveByPool(pool: string): Promise<Account[]> {
    const db = await this.db();
    const rows = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.pool, pool), eq(accounts.status, 'active')));

    const apiId = parseInt(process.env.API_ID || '0');
    const apiHash = process.env.API_HASH || '';

    return rows.map((r) => ({
      name: r.username || String(r.tgId ?? r.id),
      sessionKey: `DB_${pool.toUpperCase()}_${r.id}`,
      sessionValue: r.sessionString,
      session: r.sessionString,
      username: r.username || undefined,
      apiId,
      apiHash,
    }));
  }

  /** Добавить аккаунт. Идемпотентно по session_string. */
  async insertAccount(a: {
    pool: string;
    sessionString: string;
    tgId?: number;
    username?: string;
    phone?: string;
    sourceItemId?: string;
  }): Promise<void> {
    const db = await this.db();
    await db
      .insert(accounts)
      .values({
        pool: a.pool,
        sessionString: a.sessionString,
        tgId: a.tgId,
        username: a.username,
        phone: a.phone,
        sourceItemId: a.sourceItemId,
      })
      .onConflictDoNothing({ target: accounts.sessionString });
  }

  /**
   * Залить текущие env-аккаунты пула в БД (одноразовая авто-миграция при старте).
   * Идемпотентно: уже существующие (по session_string) пропускаются.
   */
  async upsertFromEnv(pool: string, envAccounts: Account[]): Promise<void> {
    for (const a of envAccounts) {
      if (!a.sessionValue) continue;
      const tgId = /^\d+$/.test(a.name) ? Number(a.name) : undefined;
      await this.insertAccount({
        pool,
        sessionString: a.sessionValue,
        tgId,
        username: a.username?.replace('@', '') || a.name,
      });
    }
  }

  /** Сменить статус аккаунта (active/flooded/banned/dead) по tg_id. */
  async setStatus(tgId: number, status: string): Promise<void> {
    const db = await this.db();
    await db.update(accounts).set({ status }).where(eq(accounts.tgId, tgId));
  }
}
