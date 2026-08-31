/**
 * Database Client - PostgreSQL + Drizzle ORM
 */

import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { migrate } from './migrate';

let db: NodePgDatabase<typeof schema> | null = null;
let pool: Pool | null = null;

export async function createDatabase(): Promise<NodePgDatabase<typeof schema>> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Please set it in .env file.');
  }

  pool = new Pool({ connectionString: databaseUrl });

  await migrate(pool);

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
