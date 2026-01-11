import { NextResponse } from 'next/server';
import { getDb, comments } from '@/lib/db';
import { sql, ne, and, isNotNull } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);

    const db = getDb();

    // Агрегация успешных комментариев по дням (исключаем "Уже есть")
    const data = db.select({
      date: sql<string>`DATE(created_at, 'unixepoch')`.as('date'),
      count: sql<number>`COUNT(*)`.as('count'),
    })
      .from(comments)
      .where(and(
        ne(comments.commentText, 'Уже есть'),
        isNotNull(comments.commentText),
        sql`created_at >= unixepoch('now', '-${sql.raw(days.toString())} days')`
      ))
      .groupBy(sql`DATE(created_at, 'unixepoch')`)
      .orderBy(sql`date ASC`)
      .all();

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch daily stats' },
      { status: 500 }
    );
  }
}
