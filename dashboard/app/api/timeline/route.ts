import { NextResponse } from 'next/server';
import { getDb, comments } from '@/lib/db';
import { sql, ne, and, isNotNull } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get('hours') || '24', 10);

    const db = getDb();

    // Группировка успешных комментариев по часам (исключаем "Уже есть")
    const data = db.select({
      time: sql<number>`(created_at / 3600) * 3600`.as('time'),
      count: sql<number>`COUNT(*)`.as('count'),
    })
      .from(comments)
      .where(and(
        ne(comments.commentText, 'Уже есть'),
        isNotNull(comments.commentText),
        sql`created_at >= unixepoch('now', '-${sql.raw(hours.toString())} hours')`
      ))
      .groupBy(sql`(created_at / 3600) * 3600`)
      .orderBy(sql`time ASC`)
      .all();

    // Форматируем для фронтенда
    const formattedData = data.map(item => ({
      time: new Date(item.time * 1000).toISOString(),
      count: item.count,
    }));

    return NextResponse.json({ data: formattedData });
  } catch (error) {
    console.error('Error fetching timeline:', error);
    return NextResponse.json(
      { error: 'Failed to fetch timeline' },
      { status: 500 }
    );
  }
}
