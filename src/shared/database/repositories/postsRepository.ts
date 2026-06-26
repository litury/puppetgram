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

  /** Записать mediaRefs (наши URL после скачивания коллектором). */
  async updateMediaRefs(channelId: number, tgMessageId: number, refs: any): Promise<void> {
    const db = await this.db();
    await db.execute(sql`
      UPDATE posts SET media_refs = ${refs ? JSON.stringify(refs) : null}
      WHERE channel_id = ${channelId} AND tg_message_id = ${tgMessageId};
    `);
  }

  /** Есть ли уже mediaRefs у поста (чтобы не качать повторно). */
  async hasMediaRefs(channelId: number, tgMessageId: number): Promise<boolean> {
    const db = await this.db();
    const r: any = await db.execute(sql`
      SELECT (media_refs IS NOT NULL) AS has FROM posts
      WHERE channel_id = ${channelId} AND tg_message_id = ${tgMessageId} LIMIT 1;
    `);
    const rows = (r.rows ?? r) as Array<{ has: boolean }>;
    return rows[0]?.has === true;
  }

  /** Посты с неполным медиа: фото/видео-тип без refs ЛИБО видео-ref без url И без постера. Постер — терминальный фолбэк. */
  async listIncompleteMedia(limit: number): Promise<Array<{ channelId: number; tgMessageId: number }>> {
    const db = await this.db();
    const r: any = await db.execute(sql`
      SELECT channel_id, tg_message_id FROM posts
      WHERE (
        (media_type IN ('MessageMediaPhoto', 'MessageMediaDocument')
          AND (media_refs IS NULL OR jsonb_array_length(media_refs) = 0))
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(media_refs) e
          WHERE e->>'kind' = 'video' AND NOT (e ? 'url') AND NOT (e ? 'poster')
        )
      )
      ORDER BY posted_at DESC LIMIT ${limit};
    `);
    return ((r.rows ?? r) as any[]).map((x) => ({ channelId: Number(x.channel_id), tgMessageId: Number(x.tg_message_id) }));
  }

  /** Посты без классификации (category IS NULL) с непустым текстом — для авто-классификатора. */
  async listUnclassified(limit: number): Promise<Array<{ channelId: number; tgMessageId: number; channelUsername: string | null; text: string }>> {
    const db = await this.db();
    const r: any = await db.execute(sql`
      SELECT channel_id, tg_message_id, channel_username, text FROM posts
      WHERE category IS NULL AND text IS NOT NULL AND text <> ''
      ORDER BY posted_at DESC NULLS LAST LIMIT ${limit};
    `);
    return ((r.rows ?? r) as any[]).map((x) => ({
      channelId: Number(x.channel_id), tgMessageId: Number(x.tg_message_id),
      channelUsername: x.channel_username ?? null, text: String(x.text),
    }));
  }

  /** До N свежих постов с текстом НА КАНАЛ — для пер-канальной аналитики (дёшево, без перекоса). */
  async listForChannelAnalytics(perChannel: number): Promise<Array<{ channelId: number; tgMessageId: number; channelUsername: string | null; text: string }>> {
    const db = await this.db();
    const r: any = await db.execute(sql`
      SELECT channel_id, tg_message_id, channel_username, text FROM (
        SELECT channel_id, tg_message_id, channel_username, text,
               ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY posted_at DESC NULLS LAST) AS rn
        FROM posts WHERE text IS NOT NULL AND text <> ''
      ) t WHERE rn <= ${perChannel};
    `);
    return ((r.rows ?? r) as any[]).map((x) => ({
      channelId: Number(x.channel_id), tgMessageId: Number(x.tg_message_id),
      channelUsername: x.channel_username ?? null, text: String(x.text),
    }));
  }

  /** Записать reason-ярлык в category + производные метки отсева (is_political/is_spam). */
  async setClassification(channelId: number, tgMessageId: number, reason: string): Promise<void> {
    const db = await this.db();
    const isPolitical = reason === 'politics';
    const isSpam = reason === 'spam' || reason === 'ads';
    await db.execute(sql`
      UPDATE posts SET category = ${reason}, is_political = ${isPolitical}, is_spam = ${isSpam}
      WHERE channel_id = ${channelId} AND tg_message_id = ${tgMessageId};
    `);
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
