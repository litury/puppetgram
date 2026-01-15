import { NextResponse } from 'next/server';
import { getDb, comments } from '@/lib/db';
import { sql, ne, and, isNotNull } from 'drizzle-orm';

export async function GET() {
  try {
    const db = await getDb();

    const successFilter = and(
      ne(comments.commentText, 'Уже есть'),
      isNotNull(comments.commentText)
    );

    const totalResult = await db.select({
      count: sql<number>`COUNT(*)`
    })
      .from(comments)
      .where(successFilter);

    const todayResult = await db.select({
      count: sql<number>`COUNT(*)`
    })
      .from(comments)
      .where(and(
        successFilter,
        sql`DATE(created_at AT TIME ZONE 'Europe/Moscow') = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date`
      ));

    return NextResponse.json({
      totalComments: Number(totalResult[0]?.count) || 0,
      todayComments: Number(todayResult[0]?.count) || 0,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
