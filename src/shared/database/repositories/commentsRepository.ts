/**
 * Comments Repository - работа с таблицей comments
 */

import { eq } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { comments, NewComment, Comment } from '../schema';

export interface SaveCommentData {
  channelUsername: string;
  commentText?: string;
  postId?: number;
  accountName: string;
  targetChannel: string;
  sessionId?: string;
}

export class CommentsRepository {
  private p_db: DatabaseClient;

  constructor() {
    this.p_db = getDatabase();
  }

  save(_data: SaveCommentData): Comment {
    const newComment: NewComment = {
      channelUsername: _data.channelUsername.replace('@', ''),
      commentText: _data.commentText,
      postId: _data.postId,
      accountName: _data.accountName,
      targetChannel: _data.targetChannel.replace('@', ''),
      sessionId: _data.sessionId,
    };

    return this.p_db.insert(comments).values(newComment).returning().get();
  }

  getBySession(_sessionId: string): Comment[] {
    return this.p_db
      .select()
      .from(comments)
      .where(eq(comments.sessionId, _sessionId))
      .all();
  }

  getByChannel(_channelUsername: string): Comment[] {
    return this.p_db
      .select()
      .from(comments)
      .where(eq(comments.channelUsername, _channelUsername.replace('@', '')))
      .all();
  }

  countBySession(_sessionId: string): number {
    return this.getBySession(_sessionId).length;
  }

  getRecent(_limit: number = 10): Comment[] {
    return this.p_db
      .select()
      .from(comments)
      .orderBy(comments.createdAt)
      .limit(_limit)
      .all();
  }
}
