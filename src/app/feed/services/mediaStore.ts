/**
 * MediaStore — хранилище медиа за интерфейсом. Текущая реализация: blob в Postgres (coroka-db),
 * т.к. общий том между коллектором и API через Dokploy MCP не настраивается. И коллектор (пишет),
 * и API (отдаёт по /media/<key>) ходят в одну БД. Migrate → том/S3/R2 позже (поменять реализацию).
 * Для MVP объём мал (фото ~100-300КБ, видео ≤ лимита). Блобы в отдельной таблице (не в posts).
 */

import { sql } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../../../shared/database/client';

export interface MediaStore {
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  has(key: string): Promise<boolean>;
  url(key: string): string;
}

export class DbMediaStore implements MediaStore {
  private p_db: DatabaseClient | null = null;
  private base: string;

  constructor() {
    this.base = (process.env.MEDIA_PUBLIC_BASE || '').replace(/\/$/, ''); // напр. http://coroka-api.../media
  }

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) this.p_db = await getDatabase();
    return this.p_db;
  }

  async has(key: string): Promise<boolean> {
    const db = await this.db();
    const r: any = await db.execute(sql`SELECT 1 FROM media_blobs WHERE key = ${key} LIMIT 1;`);
    const rows = (r.rows ?? r) as any[];
    return rows.length > 0;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<string> {
    const db = await this.db();
    await db.execute(sql`
      INSERT INTO media_blobs (key, content_type, bytes)
      VALUES (${key}, ${contentType}, ${data})
      ON CONFLICT (key) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes;
    `);
    return this.url(key);
  }

  url(key: string): string {
    return `${this.base}/${key}`;
  }
}

let singleton: MediaStore | null = null;
export function getMediaStore(): MediaStore {
  if (!singleton) singleton = new DbMediaStore();
  return singleton;
}
