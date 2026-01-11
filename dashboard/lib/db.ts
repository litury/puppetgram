import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import path from 'path';

// Путь к SQLite базе комментирования
// В Docker используем переменную окружения DATABASE_PATH
const DB_PATH = process.env.DATABASE_PATH
  || path.join(process.cwd(), '..', 'src', 'app', 'commenting', 'data', 'database', 'comments.db');

// Схема таблицы comments (копия из основного проекта)
export const comments = sqliteTable('comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelUsername: text('channel_username').notNull(),
  commentText: text('comment_text'),
  postId: integer('post_id'),
  accountName: text('account_name').notNull(),
  targetChannel: text('target_channel').notNull(),
  sessionId: text('session_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => ({
  channelIdx: index('idx_comments_channel').on(table.channelUsername),
  sessionIdx: index('idx_comments_session').on(table.sessionId),
}));

// Singleton для подключения к БД
let dbInstance: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!dbInstance) {
    const sqlite = new Database(DB_PATH, { readonly: true });
    dbInstance = drizzle(sqlite);
  }
  return dbInstance;
}

export type Comment = typeof comments.$inferSelect;
