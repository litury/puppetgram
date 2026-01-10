/**
 * Sessions Repository - работа с таблицей sessions
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
  private p_db: DatabaseClient;

  constructor() {
    this.p_db = getDatabase();
  }

  start(_sessionId: string, _targetChannel: string): Session {
    const newSession: NewSession = {
      id: _sessionId,
      targetChannel: _targetChannel.replace('@', ''),
      startedAt: new Date(),
      successfulCount: 0,
      failedCount: 0,
      newChannelsCount: 0,
      accountsUsed: '[]',
    };

    return this.p_db.insert(sessions).values(newSession).returning().get();
  }

  finish(_sessionId: string, _stats: SessionStats): Session | undefined {
    return this.p_db
      .update(sessions)
      .set({
        finishedAt: new Date(),
        successfulCount: _stats.successfulCount,
        failedCount: _stats.failedCount,
        newChannelsCount: _stats.newChannelsCount,
        accountsUsed: JSON.stringify(_stats.accountsUsed),
      })
      .where(eq(sessions.id, _sessionId))
      .returning()
      .get();
  }

  getById(_sessionId: string): Session | undefined {
    return this.p_db
      .select()
      .from(sessions)
      .where(eq(sessions.id, _sessionId))
      .get();
  }

  getRecent(_limit: number = 10): Session[] {
    return this.p_db
      .select()
      .from(sessions)
      .orderBy(sessions.startedAt)
      .limit(_limit)
      .all();
  }

  getStats(_sessionId: string): SessionStats | null {
    const session = this.getById(_sessionId);
    if (!session) return null;

    return {
      successfulCount: session.successfulCount ?? 0,
      failedCount: session.failedCount ?? 0,
      newChannelsCount: session.newChannelsCount ?? 0,
      accountsUsed: session.accountsUsed ? JSON.parse(session.accountsUsed) : [],
    };
  }

  incrementSuccessful(_sessionId: string): void {
    const session = this.getById(_sessionId);
    if (!session) return;

    this.p_db
      .update(sessions)
      .set({
        successfulCount: (session.successfulCount ?? 0) + 1,
      })
      .where(eq(sessions.id, _sessionId))
      .run();
  }

  incrementFailed(_sessionId: string): void {
    const session = this.getById(_sessionId);
    if (!session) return;

    this.p_db
      .update(sessions)
      .set({
        failedCount: (session.failedCount ?? 0) + 1,
      })
      .where(eq(sessions.id, _sessionId))
      .run();
  }
}
