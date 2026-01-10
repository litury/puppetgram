/**
 * Failed Channels Repository - заменяет 8+ текстовых файлов единой таблицей
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
  private p_db: DatabaseClient;

  constructor() {
    this.p_db = getDatabase();
  }

  save(_data: SaveFailedChannelData): FailedChannel {
    const newRecord: NewFailedChannel = {
      channelUsername: _data.channelUsername.replace('@', ''),
      errorType: _data.errorType,
      errorMessage: _data.errorMessage,
      targetChannel: _data.targetChannel.replace('@', ''),
      sessionId: _data.sessionId,
      postId: _data.postId,
    };

    return this.p_db.insert(failedChannels).values(newRecord).returning().get();
  }

  getByErrorType(_errorType: ErrorType): FailedChannel[] {
    return this.p_db
      .select()
      .from(failedChannels)
      .where(eq(failedChannels.errorType, _errorType))
      .all();
  }

  getByChannel(_channelUsername: string): FailedChannel[] {
    return this.p_db
      .select()
      .from(failedChannels)
      .where(eq(failedChannels.channelUsername, _channelUsername.replace('@', '')))
      .orderBy(desc(failedChannels.createdAt))
      .all();
  }

  getStats(): Record<string, number> {
    const result = this.p_db
      .select({
        errorType: failedChannels.errorType,
        count: sql<number>`count(*)`,
      })
      .from(failedChannels)
      .groupBy(failedChannels.errorType)
      .all();

    const stats: Record<string, number> = {};
    for (const row of result) {
      stats[row.errorType] = row.count;
    }
    return stats;
  }

  getBySession(_sessionId: string): FailedChannel[] {
    return this.p_db
      .select()
      .from(failedChannels)
      .where(eq(failedChannels.sessionId, _sessionId))
      .all();
  }

  getRecent(_limit: number = 20): FailedChannel[] {
    return this.p_db
      .select()
      .from(failedChannels)
      .orderBy(desc(failedChannels.createdAt))
      .limit(_limit)
      .all();
  }
}
