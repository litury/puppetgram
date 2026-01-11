/**
 * Database Client - SQLite + Drizzle ORM
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import * as fs from 'fs';
import * as path from 'path';
import { COMMENTING_PATHS } from '../../app/commenting/config/commentingConfig';

const DB_PATH = COMMENTING_PATHS.database.dbPath;

function ensureDataDirectory(): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function initializeTables(_sqlite: DatabaseType): void {
  _sqlite.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_username TEXT NOT NULL,
      comment_text TEXT,
      post_id INTEGER,
      account_name TEXT NOT NULL,
      target_channel TEXT NOT NULL,
      session_id TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  _sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_comments_channel ON comments(channel_username)`);
  _sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_comments_session ON comments(session_id)`);

  _sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      target_channel TEXT NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      successful_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      new_channels_count INTEGER DEFAULT 0,
      accounts_used TEXT
    )
  `);

  _sqlite.exec(`
    CREATE TABLE IF NOT EXISTS failed_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_username TEXT NOT NULL,
      error_type TEXT NOT NULL,
      error_message TEXT,
      target_channel TEXT NOT NULL,
      session_id TEXT,
      post_id INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Миграция для существующих БД без post_id
  try {
    _sqlite.exec(`ALTER TABLE failed_channels ADD COLUMN post_id INTEGER`);
  } catch {
    // Колонка уже существует
  }

  // Миграция для существующих БД без comment_id
  try {
    _sqlite.exec(`ALTER TABLE comments ADD COLUMN comment_id INTEGER`);
  } catch {
    // Колонка уже существует
  }

  _sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_comments_comment_id ON comments(comment_id)`);
  _sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_failed_error_type ON failed_channels(error_type)`);
  _sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_failed_channel ON failed_channels(channel_username)`);
}

export function createDatabase() {
  ensureDataDirectory();

  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  initializeTables(sqlite);

  return drizzle(sqlite, { schema });
}

let p_dbInstance: ReturnType<typeof createDatabase> | null = null;

export function getDatabase() {
  if (!p_dbInstance) {
    p_dbInstance = createDatabase();
  }
  return p_dbInstance;
}

export type DatabaseClient = ReturnType<typeof createDatabase>;
