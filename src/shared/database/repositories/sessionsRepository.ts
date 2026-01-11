/**
 * Sessions Repository - работа с таблицей sessions (PostgreSQL async)
 */

import { eq } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { sessions, NewSession, Session } from '../schema';

export interface SessionStats {
  successfulCount: number;
  failedCount: number;
  newChannelsCount: number;
  accountsUsed: string[];
}

export class SessionsRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) {
      this.p_db = await getDatabase();
    }
    return this.p_db;
  }

  async start(_sessionId: string, _targetChannel: string): Promise<Session> {
    const db = await this.db();
    const newSession: NewSession = {
      id: _sessionId,
      targetChannel: _targetChannel.replace('@', ''),
      startedAt: new Date(),
      successfulCount: 0,
      failedCount: 0,
      newChannelsCount: 0,
      accountsUsed: '[]',
    };

    const result = await db.insert(sessions).values(newSession).returning();
    return result[0];
  }

  async finish(_sessionId: string, _stats: SessionStats): Promise<Session | undefined> {
    const db = await this.db();
    const result = await db
      .update(sessions)
      .set({
        finishedAt: new Date(),
        successfulCount: _stats.successfulCount,
        failedCount: _stats.failedCount,
        newChannelsCount: _stats.newChannelsCount,
        accountsUsed: JSON.stringify(_stats.accountsUsed),
      })
      .where(eq(sessions.id, _sessionId))
      .returning();
    return result[0];
  }

  async getById(_sessionId: string): Promise<Session | undefined> {
    const db = await this.db();
    const result = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, _sessionId));
    return result[0];
  }

  async getRecent(_limit: number = 10): Promise<Session[]> {
    const db = await this.db();
    return db
      .select()
      .from(sessions)
      .orderBy(sessions.startedAt)
      .limit(_limit);
  }

  async getStats(_sessionId: string): Promise<SessionStats | null> {
    const session = await this.getById(_sessionId);
    if (!session) return null;

    return {
      successfulCount: session.successfulCount ?? 0,
      failedCount: session.failedCount ?? 0,
      newChannelsCount: session.newChannelsCount ?? 0,
      accountsUsed: session.accountsUsed ? JSON.parse(session.accountsUsed) : [],
    };
  }

  async incrementSuccessful(_sessionId: string): Promise<void> {
    const session = await this.getById(_sessionId);
    if (!session) return;

    const db = await this.db();
    await db
      .update(sessions)
      .set({
        successfulCount: (session.successfulCount ?? 0) + 1,
      })
      .where(eq(sessions.id, _sessionId));
  }

  async incrementFailed(_sessionId: string): Promise<void> {
    const session = await this.getById(_sessionId);
    if (!session) return;

    const db = await this.db();
    await db
      .update(sessions)
      .set({
        failedCount: (session.failedCount ?? 0) + 1,
      })
      .where(eq(sessions.id, _sessionId));
  }
}
