import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pgTable, text, integer, serial, timestamp, index } from 'drizzle-orm/pg-core';

// === PostgreSQL схема ===
export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  channelUsername: text('channel_username').notNull(),
  commentText: text('comment_text'),
  postId: integer('post_id'),
  commentId: integer('comment_id'),
  accountName: text('account_name').notNull(),
  targetChannel: text('target_channel').notNull(),
  sessionId: text('session_id'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  channelIdx: index('idx_comments_channel').on(table.channelUsername),
  sessionIdx: index('idx_comments_session').on(table.sessionId),
}));

// Singleton для подключения к БД
let db: NodePgDatabase | null = null;
let pool: any = null;

// Инициализация PostgreSQL с автомиграцией
async function initDb(): Promise<NodePgDatabase> {
  if (db) return db;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const { Pool } = require('pg');
  pool = new Pool({ connectionString: databaseUrl });

  db = drizzle(pool);
  console.log('Connected to PostgreSQL');
  return db;
}

// Получение подключения к БД
export async function getDb(): Promise<NodePgDatabase> {
  return await initDb();
}

// Типы
export type Comment = typeof comments.$inferSelect;
