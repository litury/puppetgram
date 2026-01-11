import { drizzle as drizzleSqlite, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sqliteTable, text as sqliteText, integer as sqliteInteger, index as sqliteIndex } from 'drizzle-orm/sqlite-core';
import { pgTable, text as pgText, integer as pgInteger, serial, timestamp, index as pgIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import path from 'path';

// Функция для проверки режима БД (вызывается при каждом запросе)
export function isPostgres(): boolean {
  return !!process.env.DATABASE_URL;
}

// === SQLite схема (для локальной разработки) ===
export const commentsSqlite = sqliteTable('comments', {
  id: sqliteInteger('id').primaryKey({ autoIncrement: true }),
  channelUsername: sqliteText('channel_username').notNull(),
  commentText: sqliteText('comment_text'),
  postId: sqliteInteger('post_id'),
  commentId: sqliteInteger('comment_id'),
  accountName: sqliteText('account_name').notNull(),
  targetChannel: sqliteText('target_channel').notNull(),
  sessionId: sqliteText('session_id'),
  createdAt: sqliteInteger('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => ({
  channelIdx: sqliteIndex('idx_comments_channel').on(table.channelUsername),
  sessionIdx: sqliteIndex('idx_comments_session').on(table.sessionId),
}));

// === PostgreSQL схема (для продакшена) ===
export const commentsPg = pgTable('comments', {
  id: serial('id').primaryKey(),
  channelUsername: pgText('channel_username').notNull(),
  commentText: pgText('comment_text'),
  postId: pgInteger('post_id'),
  commentId: pgInteger('comment_id'),
  accountName: pgText('account_name').notNull(),
  targetChannel: pgText('target_channel').notNull(),
  sessionId: pgText('session_id'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  channelIdx: pgIndex('idx_comments_channel').on(table.channelUsername),
  sessionIdx: pgIndex('idx_comments_session').on(table.sessionId),
}));

// Singleton для подключения к БД
let sqliteDb: BetterSQLite3Database | null = null;
let pgDb: NodePgDatabase | null = null;
let pgPool: any = null;

// Инициализация PostgreSQL с миграцией
async function initPostgres() {
  if (pgDb) return pgDb;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const { Pool } = require('pg');
  pgPool = new Pool({ connectionString: databaseUrl });

  // Миграция: создаём таблицу если не существует
  await pgPool.query(`
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
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_comments_channel ON comments(channel_username);`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_comments_session ON comments(session_id);`);

  pgDb = drizzlePg(pgPool);
  console.log('Connected to PostgreSQL');
  return pgDb;
}

// Инициализация SQLite
function initSqlite() {
  if (sqliteDb) return sqliteDb;

  const Database = require('better-sqlite3');
  const DB_PATH = process.env.DATABASE_PATH
    || path.join(process.cwd(), '..', 'src', 'app', 'commenting', 'data', 'database', 'comments.db');
  const sqlite = new Database(DB_PATH, { readonly: true });
  sqliteDb = drizzleSqlite(sqlite);
  console.log('Connected to SQLite:', DB_PATH);
  return sqliteDb;
}

// Асинхронная функция для получения БД
export async function getDbAsync(): Promise<NodePgDatabase | BetterSQLite3Database> {
  if (isPostgres()) {
    return await initPostgres();
  }
  return initSqlite();
}

// Синхронная функция (только для SQLite, для обратной совместимости)
export function getDb(): BetterSQLite3Database {
  if (isPostgres()) {
    throw new Error('Use getDbAsync() for PostgreSQL');
  }
  return initSqlite();
}

// Типы
export type Comment = typeof commentsPg.$inferSelect;
