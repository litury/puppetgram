/**
 * Posts Repository — долговременное хранилище постов ленты + чтение ранжированной ленты.
 *
 * upsertPost — идемпотентная запись по (channel_id, tg_message_id): новый пост вставляется,
 * существующий обновляет растущие метрики (views/reactions/forwards/replies) + score.
 * getFeed — pull-модель: ранжированный срез (фильтр политика/спам + сортировка по score).
 */

import { sql } from 'drizzle-orm';
import { getDatabase, DatabaseClient } from '../client';
import { Post } from '../schema';

export interface UpsertPostInput {
  channelId: number;
  channelUsername?: string | null;
  tgMessageId: number;
  text?: string | null;
  mediaType?: string | null;
  mediaRefs?: any;
  entities?: any;
  views?: number | null;
  reactions?: any;
  forwards?: number | null;
  repliesCount?: number | null;
  postedAt?: Date | null;
  editedAt?: Date | null;
}

export class PostsRepository {
  private p_db: DatabaseClient | null = null;

  private async db(): Promise<DatabaseClient> {
    if (!this.p_db) {
      this.p_db = await getDatabase();
    }
    return this.p_db;
  }

  /**
   * Вставить или обновить пост. На конфликте (channel_id, tg_message_id) обновляет
   * метрики и текст (пост мог быть отредактирован) — без затирания score/категории.
   * Возвращает id поста (для записи снимка метрик).
   */
  async upsertPost(input: UpsertPostInput): Promise<number> {
    const db = await this.db();
    const result: any = await db.execute(sql`
      INSERT INTO posts (
        channel_id, channel_username, tg_message_id, text, media_type, media_refs, entities,
        views, reactions, forwards, replies_count, posted_at, edited_at
      ) VALUES (
        ${input.channelId}, ${input.channelUsername ?? null}, ${input.tgMessageId},
        ${input.text ?? null}, ${input.mediaType ?? null}, ${input.mediaRefs ?? null},
        ${input.entities ? JSON.stringify(input.entities) : null},
        ${input.views ?? null}, ${input.reactions ?? null}, ${input.forwards ?? null},
        ${input.repliesCount ?? null}, ${input.postedAt ?? null}, ${input.editedAt ?? null}
      )
      ON CONFLICT (channel_id, tg_message_id) DO UPDATE SET
        text = COALESCE(EXCLUDED.text, posts.text),
        media_type = COALESCE(EXCLUDED.media_type, posts.media_type),
        media_refs = COALESCE(EXCLUDED.media_refs, posts.media_refs),
        entities = COALESCE(EXCLUDED.entities, posts.entities),
        views = COALESCE(EXCLUDED.views, posts.views),
        reactions = COALESCE(EXCLUDED.reactions, posts.reactions),
        forwards = COALESCE(EXCLUDED.forwards, posts.forwards),
        replies_count = COALESCE(EXCLUDED.replies_count, posts.replies_count),
        edited_at = COALESCE(EXCLUDED.edited_at, posts.edited_at)
      RETURNING id;
    `);
    const rows = (result.rows ?? result) as Array<{ id: number }>;
    return rows[0].id;
  }

  /** Получить пост по (channel_id, tg_message_id) — для enricher'а из job. */
  async getByChannelMsg(channelId: number, tgMessageId: number): Promise<Post | null> {
    const db = await this.db();
    const result: any = await db.execute(sql`
      SELECT * FROM posts WHERE channel_id = ${channelId} AND tg_message_id = ${tgMessageId} LIMIT 1;
    `);
    const rows = (result.rows ?? result) as Post[];
    return rows[0] ?? null;
  }

  /** Обновить вычисленный score поста (re-rank стадия enricher'а). */
  async setScore(id: number, score: number): Promise<void> {
    const db = await this.db();
    await db.execute(sql`UPDATE posts SET score = ${score} WHERE id = ${id};`);
  }

  /** Записать снимок метрик поста (для скорости набора / baseline). */
  async recordMetricSnapshot(
    postId: number,
    m: { views?: number | null; reactions?: number | null; forwards?: number | null; repliesCount?: number | null }
  ): Promise<void> {
    const db = await this.db();
    await db.execute(sql`
      INSERT INTO post_metrics (post_id, views, reactions, forwards, replies_count)
      VALUES (${postId}, ${m.views ?? null}, ${m.reactions ?? null}, ${m.forwards ?? null}, ${m.repliesCount ?? null});
    `);
  }

  /**
   * Лента — pull-модель: ранжированный срез постов.
   * Фильтр: НЕ политика, НЕ спам, есть score. Сортировка по score (re-rank/diversity —
   * в сервисном слое поверх). limit/offset для бесконечного скролла.
   */
  async getFeed(limit: number = 50, offset: number = 0): Promise<Post[]> {
    const db = await this.db();
    const result: any = await db.execute(sql`
      SELECT * FROM posts
      WHERE is_political = false AND is_spam = false AND score IS NOT NULL
      ORDER BY score DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset};
    `);
    return (result.rows ?? result) as Post[];
  }

  /** Хронологическая лента («Свежее» / fallback при сбое ранкера). */
  async getLatest(limit: number = 50, offset: number = 0): Promise<Post[]> {
    const db = await this.db();
    const result: any = await db.execute(sql`
      SELECT * FROM posts
      WHERE is_political = false AND is_spam = false
      ORDER BY posted_at DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset};
    `);
    return (result.rows ?? result) as Post[];
  }

  /** Медиана просмотров канала за окно (baseline для overperformance). */
  async channelMedianViews(channelId: number, days: number = 30): Promise<number | null> {
    const db = await this.db();
    const result: any = await db.execute(sql`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY views) AS median
      FROM posts
      WHERE channel_id = ${channelId}
        AND views IS NOT NULL
        AND posted_at > now() - make_interval(days => ${days});
    `);
    const rows = (result.rows ?? result) as Array<{ median: number | null }>;
    return rows[0]?.median ?? null;
  }
}
