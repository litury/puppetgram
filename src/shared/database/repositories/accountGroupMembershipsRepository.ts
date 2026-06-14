/**
 * AccountGroupMemberships Repository — учёт вступлений аккаунтов в чаты обсуждения.
 *
 * Чтобы прокомментировать канал с открытыми комментами, аккаунт должен быть участником
 * привязанной discussion-группы. Членство персональное (per-account): при ротации новый
 * аккаунт вступает заново. Используется для авто-join и reaper'а у потолка ~500 членств.
 */

import { eq, and, isNull, sql, asc } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { accountGroupMemberships, AccountGroupMembership } from '../schema';

export class AccountGroupMembershipsRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) {
      this.p_db = await getDatabase();
    }
    return this.p_db;
  }

  /**
   * Зафиксировать вступление. Если запись уже была (в т.ч. с leftAt) — реактивируем.
   */
  async recordJoin(
    accountName: string,
    groupId: number,
    groupAccessHash?: bigint | null,
    groupUsername?: string,
  ): Promise<AccountGroupMembership> {
    const db = await this.db();
    const result = await db
      .insert(accountGroupMemberships)
      .values({ accountName, groupId, groupAccessHash: groupAccessHash ?? null, groupUsername })
      .onConflictDoUpdate({
        target: [accountGroupMemberships.accountName, accountGroupMemberships.groupId],
        set: {
          joinedAt: new Date(),
          leftAt: null,
          groupAccessHash: groupAccessHash ?? null,
          groupUsername,
        },
      })
      .returning();
    return result[0];
  }

  /**
   * Отметить факт коммента в группе (обновляет last_comment_at).
   */
  async touchComment(accountName: string, groupId: number): Promise<void> {
    const db = await this.db();
    await db
      .update(accountGroupMemberships)
      .set({ lastCommentAt: new Date() })
      .where(
        and(
          eq(accountGroupMemberships.accountName, accountName),
          eq(accountGroupMemberships.groupId, groupId),
        ),
      );
  }

  /**
   * Сколько активных членств (leftAt IS NULL) у аккаунта — для контроля потолка.
   */
  async countActive(accountName: string): Promise<number> {
    const db = await this.db();
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(accountGroupMemberships)
      .where(
        and(
          eq(accountGroupMemberships.accountName, accountName),
          isNull(accountGroupMemberships.leftAt),
        ),
      );
    return result[0]?.count ?? 0;
  }

  /**
   * Самые старые активные членства (для reaper'а). Сортировка по joinedAt ASC.
   */
  async oldestActive(accountName: string, limit: number): Promise<AccountGroupMembership[]> {
    const db = await this.db();
    return db
      .select()
      .from(accountGroupMemberships)
      .where(
        and(
          eq(accountGroupMemberships.accountName, accountName),
          isNull(accountGroupMemberships.leftAt),
        ),
      )
      .orderBy(asc(accountGroupMemberships.joinedAt))
      .limit(limit);
  }

  /**
   * Пометить выход из группы (после leaveChannel в reaper'е).
   */
  async markLeft(accountName: string, groupId: number): Promise<void> {
    const db = await this.db();
    await db
      .update(accountGroupMemberships)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(accountGroupMemberships.accountName, accountName),
          eq(accountGroupMemberships.groupId, groupId),
        ),
      );
  }

  /**
   * Все активные членства (leftAt IS NULL) — для revert-скрипта (выйти из всех).
   */
  async listActive(): Promise<AccountGroupMembership[]> {
    const db = await this.db();
    return db
      .select()
      .from(accountGroupMemberships)
      .where(isNull(accountGroupMemberships.leftAt))
      .orderBy(asc(accountGroupMemberships.joinedAt));
  }

  /**
   * Активно ли членство в группе прямо сейчас (точечная проверка).
   */
  async isActiveMember(accountName: string, groupId: number): Promise<boolean> {
    const db = await this.db();
    const result = await db
      .select()
      .from(accountGroupMemberships)
      .where(
        and(
          eq(accountGroupMemberships.accountName, accountName),
          eq(accountGroupMemberships.groupId, groupId),
          isNull(accountGroupMemberships.leftAt),
        ),
      );
    return result.length > 0;
  }
}
