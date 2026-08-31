import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

function resolveMigrationsDir(): string {
  const candidates = [
    path.join(__dirname, 'migrations'),
    path.join(process.cwd(), 'src/shared/database/migrations'),
    path.join(process.cwd(), 'dist/shared/database/migrations'),
  ];
  const found = candidates.find((dir) => fs.existsSync(dir));
  if (!found) {
    throw new Error(`migrations dir not found, tried: ${candidates.join(', ')}`);
  }
  return found;
}

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = resolveMigrationsDir();
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const applied = await pool.query<{ version: string }>(
    'SELECT version FROM schema_migrations',
  );
  const done = new Set(applied.rows.map((row) => row.version));

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [
        version,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`migration ${version} failed: ${message}`);
    } finally {
      client.release();
    }
  }
}
