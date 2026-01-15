/**
 * Comments Repository - работа с таблицей comments (PostgreSQL async)
 */

import { eq } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { comments, NewComment, Comment } from '../schema';

export interface SaveCommentData {
  channelUsername: string;
  commentText?: string;
  postId?: number;
  commentId?: number;
  accountName: string;
  targetChannel: string;
  sessionId?: string;
}

export class CommentsRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) {
      this.p_db = await getDatabase();
    }
    return this.p_db;
  }

  async save(_data: SaveCommentData): Promise<Comment> {
    const db = await this.db();
    const newComment: NewComment = {
      channelUsername: _data.channelUsername.replace('@', ''),
      commentText: _data.commentText,
      postId: _data.postId,
      commentId: _data.commentId,
      accountName: _data.accountName,
      targetChannel: _data.targetChannel.replace('@', ''),
      sessionId: _data.sessionId,
    };

    const result = await db.insert(comments).values(newComment).returning();

    // Отправка события в WebSocket сервер (fire-and-forget)
    this.emitNewComment(result[0]);

    return result[0];
  }

  private emitNewComment(comment: Comment): void {
    const wsUrl = process.env.WS_SERVER_URL || 'http://localhost:4000';
    const emitSecret = process.env.EMIT_SECRET || 'dev-secret';

    fetch(`${wsUrl}/emit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': emitSecret,
      },
      body: JSON.stringify({
        type: 'new_comment',
        data: {
          channel: comment.channelUsername,
          postId: comment.postId,
          commentText: comment.commentText,
          createdAt: comment.createdAt,
        },
      }),
    }).catch(() => {}); // fire-and-forget, не блокируем основной процесс
  }

  async getBySession(_sessionId: string): Promise<Comment[]> {
    const db = await this.db();
    return db
      .select()
      .from(comments)
      .where(eq(comments.sessionId, _sessionId));
  }

  async getByChannel(_channelUsername: string): Promise<Comment[]> {
    const db = await this.db();
    return db
      .select()
      .from(comments)
      .where(eq(comments.channelUsername, _channelUsername.replace('@', '')));
  }

  async countBySession(_sessionId: string): Promise<number> {
    const result = await this.getBySession(_sessionId);
    return result.length;
  }

  async getRecent(_limit: number = 10): Promise<Comment[]> {
    const db = await this.db();
    return db
      .select()
      .from(comments)
      .orderBy(comments.createdAt)
      .limit(_limit);
  }
}
