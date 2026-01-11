import { NextResponse } from 'next/server';
import { getDbAsync, isPostgres, commentsPg, commentsSqlite } from '@/lib/db';
import { sql, ne, and, isNotNull } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);

    const db = await getDbAsync();
    const table = isPostgres ? commentsPg : commentsSqlite;

    const filter = and(
      ne(table.commentText, 'Уже есть'),
      isNotNull(table.commentText)
    );

    let data: any[];

    if (isPostgres) {
      // PostgreSQL - агрегация по дням
      data = await (db as any).select({
        date: sql<string>`DATE(created_at)`.as('date'),
        count: sql<number>`COUNT(*)`.as('count'),
      })
        .from(table)
        .where(and(
          filter,
          sql`created_at >= NOW() - INTERVAL '${sql.raw(days.toString())} days'`
        ))
        .groupBy(sql`DATE(created_at)`)
        .orderBy(sql`date ASC`);

      // Форматируем count как число
      const formattedData = data.map(item => ({
        date: item.date,
        count: Number(item.count),
      }));

      return NextResponse.json({ data: formattedData });
    } else {
      // SQLite - агрегация по дням
      data = (db as any).select({
        date: sql<string>`DATE(created_at, 'unixepoch')`.as('date'),
        count: sql<number>`COUNT(*)`.as('count'),
      })
        .from(table)
        .where(and(
          filter,
          sql`created_at >= unixepoch('now', '-${sql.raw(days.toString())} days')`
        ))
        .groupBy(sql`DATE(created_at, 'unixepoch')`)
        .orderBy(sql`date ASC`)
        .all();

      return NextResponse.json({ data });
    }
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch daily stats' },
      { status: 500 }
    );
  }
}
