/**
 * Database Client - PostgreSQL + Drizzle ORM
 */

import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

let db: NodePgDatabase<typeof schema> | null = null;
let pool: Pool | null = null;

async function initializeTables(_pool: Pool): Promise<void> {
  // Создаём таблицы если не существуют
  await _pool.query(`
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
    )
  `);

  await _pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_channel ON comments(channel_username)`);
  await _pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_session ON comments(session_id)`);
  await _pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_comment_id ON comments(comment_id)`);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      target_channel TEXT NOT NULL,
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      successful_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      new_channels_count INTEGER DEFAULT 0,
      accounts_used TEXT
    )
  `);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS target_channels (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'new',
      parsed BOOLEAN NOT NULL DEFAULT false,
      error_message TEXT,
      processed_at TIMESTAMP,
      parsed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await _pool.query(`CREATE INDEX IF NOT EXISTS idx_target_channels_status ON target_channels(status)`);

  // Миграция: добавляем колонки если таблица уже существует
  await _pool.query(`ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS parsed BOOLEAN NOT NULL DEFAULT false`);
  await _pool.query(`ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS parsed_at TIMESTAMP`);

  // Индекс для parsed (после миграции)
  await _pool.query(`CREATE INDEX IF NOT EXISTS idx_target_channels_parsed ON target_channels(parsed)`);
}

export async function createDatabase(): Promise<NodePgDatabase<typeof schema>> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Please set it in .env file.');
  }

  pool = new Pool({ connectionString: databaseUrl });

  // Автомиграция: создаём таблицы если не существуют
  await initializeTables(pool);

  return drizzle(pool, { schema });
}

let initPromise: Promise<NodePgDatabase<typeof schema>> | null = null;

export async function getDatabase(): Promise<NodePgDatabase<typeof schema>> {
  if (db) return db;

  if (!initPromise) {
    initPromise = createDatabase().then((_db) => {
      db = _db;
      return _db;
    });
  }

  return initPromise;
}

export type DatabaseClient = NodePgDatabase<typeof schema>;
