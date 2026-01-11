import { NextResponse } from 'next/server';
import { getDb, comments } from '@/lib/db';
import { sql, ne, and, isNotNull } from 'drizzle-orm';

export async function GET() {
  try {
    const db = getDb();

    // Фильтр: исключаем "Уже есть" (неопубликованные)
    const successFilter = and(
      ne(comments.commentText, 'Уже есть'),
      isNotNull(comments.commentText)
    );

    // Общее количество успешных комментариев
    const totalResult = db.select({
      count: sql<number>`COUNT(*)`
    })
      .from(comments)
      .where(successFilter)
      .get();

    // Успешные комментарии за сегодня
    const todayResult = db.select({
      count: sql<number>`COUNT(*)`
    })
      .from(comments)
      .where(and(
        successFilter,
        sql`DATE(created_at, 'unixepoch') = DATE('now')`
      ))
      .get();

    return NextResponse.json({
      totalComments: totalResult?.count ?? 0,
      todayComments: todayResult?.count ?? 0,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
