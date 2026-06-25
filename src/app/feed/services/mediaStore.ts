/**
 * MediaStore — хранилище медиа за интерфейсом. Текущая реализация: blob в Postgres (coroka-db),
 * т.к. общий том между коллектором и API через Dokploy MCP не настраивается. И коллектор (пишет),
 * и API (отдаёт по /media/<key>) ходят в одну БД. Migrate → том/S3/R2 позже (поменять реализацию).
 * Для MVP объём мал (фото ~100-300КБ, видео ≤ лимита). Блобы в отдельной таблице (не в posts).
 */

import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { sql } from 'drizzle-orm';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getDatabase, DatabaseClient } from '../../../shared/database/client';

export interface MediaStore {
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  /** Выгрузить файл С ДИСКА потоком (для крупных видео — память плоская). */
  putFile(key: string, filePath: string, contentType: string): Promise<string>;
  has(key: string): Promise<boolean>;
  url(key: string): string;
}

/**
 * S3MediaStore — S3-совместимое объектное хранилище (Timeweb/R2/любое). Медиа уходит с диска бокса.
 * env: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, MEDIA_PUBLIC_BASE (публичная база URL бакета).
 * Бакет публичный → читается по прямой ссылке (ключи нужны только на запись из коллектора).
 */
export class S3MediaStore implements MediaStore {
  private client: S3Client;
  private bucket: string;
  private base: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET || 'coroka';
    this.base = (process.env.MEDIA_PUBLIC_BASE || '').replace(/\/$/, '');
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,            // напр. https://s3.twcstorage.ru
      region: process.env.S3_REGION || 'ru-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
      },
      forcePathStyle: true,                         // не-AWS S3-провайдеры
    });
  }

  async has(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType })
    );
    return this.url(key);
  }

  async putFile(key: string, filePath: string, contentType: string): Promise<string> {
    // multipart-стрим с диска: память не зависит от размера файла (хоть 3ГБ).
    const up = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: createReadStream(filePath), ContentType: contentType },
      partSize: 8 * 1024 * 1024,
      queueSize: 4,
    });
    await up.done();
    return this.url(key);
  }

  url(key: string): string {
    return `${this.base}/${key}`;
  }
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

  // Легаси-стор (blob в Postgres) — только мелкое; читаем файл в память.
  async putFile(key: string, filePath: string, contentType: string): Promise<string> {
    return this.put(key, await readFile(filePath), contentType);
  }

  url(key: string): string {
    return `${this.base}/${key}`;
  }
}

let singleton: MediaStore | null = null;
export function getMediaStore(): MediaStore {
  if (!singleton) {
    // MEDIA_STORE=s3 → S3-хранилище (Timeweb и т.п.); иначе блобы в Postgres (легаси/локально).
    singleton = process.env.MEDIA_STORE === 's3' ? new S3MediaStore() : new DbMediaStore();
  }
  return singleton;
}
