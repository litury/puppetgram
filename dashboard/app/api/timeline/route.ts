import { NextResponse } from 'next/server';
import { getDb, comments } from '@/lib/db';
import { sql, ne, and, isNotNull } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get('hours') || '24', 10);

    const db = await getDb();

    const filter = and(
      ne(comments.commentText, 'Уже есть'),
      isNotNull(comments.commentText)
    );

    const data = await db.select({
      time: sql<string>`date_trunc('hour', created_at)`.as('time'),
      count: sql<number>`COUNT(*)`.as('count'),
    })
      .from(comments)
      .where(and(
        filter,
        sql`created_at >= NOW() - INTERVAL '${sql.raw(hours.toString())} hours'`
      ))
      .groupBy(sql`date_trunc('hour', created_at)`)
      .orderBy(sql`time ASC`);

    const formattedData = data.map(item => ({
      time: new Date(item.time).toISOString(),
      count: Number(item.count),
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
