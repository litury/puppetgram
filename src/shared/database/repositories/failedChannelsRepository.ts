/**
 * Failed Channels Repository - заменяет 8+ текстовых файлов единой таблицей (PostgreSQL async)
 */

import { eq, desc, sql } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { failedChannels, NewFailedChannel, FailedChannel } from '../schema';

export type ErrorType =
  | 'BANNED'
  | 'UNAVAILABLE'
  | 'SUBSCRIPTION_REQUIRED'
  | 'MODERATED'
  | 'POST_SKIPPED'
  | 'FLOOD_WAIT'
  | 'OTHER';

export interface SaveFailedChannelData {
  channelUsername: string;
  errorType: ErrorType;
  errorMessage?: string;
  targetChannel: string;
  sessionId?: string;
  postId?: number;
}

export class FailedChannelsRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) {
      this.p_db = await getDatabase();
    }
    return this.p_db;
  }

  async save(_data: SaveFailedChannelData): Promise<FailedChannel> {
    const db = await this.db();
    const newRecord: NewFailedChannel = {
      channelUsername: _data.channelUsername.replace('@', ''),
      errorType: _data.errorType,
      errorMessage: _data.errorMessage,
      targetChannel: _data.targetChannel.replace('@', ''),
      sessionId: _data.sessionId,
      postId: _data.postId,
    };

    const result = await db.insert(failedChannels).values(newRecord).returning();
    return result[0];
  }

  async getByErrorType(_errorType: ErrorType): Promise<FailedChannel[]> {
    const db = await this.db();
    return db
      .select()
      .from(failedChannels)
      .where(eq(failedChannels.errorType, _errorType));
  }

  async getByChannel(_channelUsername: string): Promise<FailedChannel[]> {
    const db = await this.db();
    return db
      .select()
      .from(failedChannels)
      .where(eq(failedChannels.channelUsername, _channelUsername.replace('@', '')))
      .orderBy(desc(failedChannels.createdAt));
  }

  async getStats(): Promise<Record<string, number>> {
    const db = await this.db();
    const result = await db
      .select({
        errorType: failedChannels.errorType,
        count: sql<number>`count(*)`,
      })
      .from(failedChannels)
      .groupBy(failedChannels.errorType);

    const stats: Record<string, number> = {};
    for (const row of result) {
      stats[row.errorType] = row.count;
    }
    return stats;
  }

  async getBySession(_sessionId: string): Promise<FailedChannel[]> {
    const db = await this.db();
    return db
      .select()
      .from(failedChannels)
      .where(eq(failedChannels.sessionId, _sessionId));
  }

  async getRecent(_limit: number = 20): Promise<FailedChannel[]> {
    const db = await this.db();
    return db
      .select()
      .from(failedChannels)
      .orderBy(desc(failedChannels.createdAt))
      .limit(_limit);
  }
}
