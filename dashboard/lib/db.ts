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

  // Автомиграция: создаём таблицу если не существует
  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      channel_username TEXT NOT NULL,
      comment_text TEXT,
      post_id INTEGER,
      comment_id INTEGER,
      account_name TEXT NOT NULL,
      target_channel TEXT NOT NULL,
      session_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_channel ON comments(channel_username);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_session ON comments(session_id);`);

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
