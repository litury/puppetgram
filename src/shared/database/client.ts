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
  await _pool.query(`ALTER TABLE comments ADD COLUMN IF NOT EXISTS session_id TEXT`);

  // Миграция: предпроверка комментариев чекером (отдельная колонка, не status)
  await _pool.query(`ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS comments_state TEXT`);
  await _pool.query(`ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP`);

  // Миграция: метаданные канала из GetFullChannel (JSONB-блоб) + атрибуция аккаунта чекера
  await _pool.query(`ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS channel_meta JSONB`);
  await _pool.query(`ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS checked_by TEXT`);

  // Миграция: единый реестр аккаунтов (generic, колонка pool) — вынос из env в БД
  await _pool.query(`CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    session_string TEXT NOT NULL UNIQUE,
    pool TEXT NOT NULL,
    tg_id BIGINT,
    username TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    proxy TEXT,
    source_item_id TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT now(),
    last_used_at TIMESTAMP
  )`);
  await _pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS meta JSONB`);
  await _pool.query(`CREATE INDEX IF NOT EXISTS idx_accounts_pool_status ON accounts(pool, status)`);

  // Индекс для parsed (после миграции)
  await _pool.query(`CREATE INDEX IF NOT EXISTS idx_target_channels_parsed ON target_channels(parsed)`);
  await _pool.query(`CREATE INDEX IF NOT EXISTS idx_target_channels_comments_state ON target_channels(comments_state)`);
  await _pool.query(`CREATE INDEX IF NOT EXISTS idx_target_channels_checked_by ON target_channels(checked_by)`);

  // Таблица account_bans — реальные spam-баны от Telegram (через @SpamBot)
  await _pool.query(`
    CREATE TABLE IF NOT EXISTS account_bans (
      id SERIAL PRIMARY KEY,
      account_name TEXT NOT NULL UNIQUE,
      banned_at TIMESTAMP NOT NULL DEFAULT NOW(),
      ban_reason TEXT,
      spambot_response TEXT,
      unbanned_at TIMESTAMP,
      notes TEXT
    )
  `);
  await _pool.query(`CREATE INDEX IF NOT EXISTS idx_account_bans_active ON account_bans(account_name)`);

  // Таблица account_group_memberships — учёт вступлений в чаты обсуждения (для авто-join + reaper)
  await _pool.query(`
    CREATE TABLE IF NOT EXISTS account_group_memberships (
      id SERIAL PRIMARY KEY,
      account_name TEXT NOT NULL,
      group_id BIGINT NOT NULL,
      group_username TEXT,
      joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_comment_at TIMESTAMP,
      left_at TIMESTAMP
    )
  `);
  await _pool.query(`ALTER TABLE account_group_memberships ADD COLUMN IF NOT EXISTS group_access_hash BIGINT`);
  await _pool.query(`CREATE INDEX IF NOT EXISTS idx_agm_account_active ON account_group_memberships(account_name, left_at)`);
  await _pool.query(`CREATE INDEX IF NOT EXISTS idx_agm_account_joined ON account_group_memberships(account_name, joined_at)`);
  await _pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agm_account_group ON account_group_memberships(account_name, group_id)`);
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
