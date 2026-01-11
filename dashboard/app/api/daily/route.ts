import { NextResponse } from 'next/server';
import { getDb, comments } from '@/lib/db';
import { sql, ne, and, isNotNull } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);

    const db = await getDb();

    const filter = and(
      ne(comments.commentText, 'Уже есть'),
      isNotNull(comments.commentText)
    );

    const data = await db.select({
      date: sql<string>`DATE(created_at)`.as('date'),
      count: sql<number>`COUNT(*)`.as('count'),
    })
      .from(comments)
      .where(and(
        filter,
        sql`created_at >= NOW() - INTERVAL '${sql.raw(days.toString())} days'`
      ))
      .groupBy(sql`DATE(created_at)`)
      .orderBy(sql`date ASC`);

    const formattedData = data.map(item => ({
      date: item.date,
      count: Number(item.count),
    }));

    return NextResponse.json({ data: formattedData });
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch daily stats' },
      { status: 500 }
    );
  }
}
