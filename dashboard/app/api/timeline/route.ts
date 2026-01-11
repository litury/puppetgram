import { NextResponse } from 'next/server';
import { getDbAsync, isPostgres, commentsPg, commentsSqlite } from '@/lib/db';
import { sql, ne, and, isNotNull } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get('hours') || '24', 10);

    const db = await getDbAsync();
    const isPg = isPostgres();
    const table = isPg ? commentsPg : commentsSqlite;

    const filter = and(
      ne(table.commentText, 'Уже есть'),
      isNotNull(table.commentText)
    );

    let data: any[];

    if (isPg) {
      // PostgreSQL - группировка по часам
      data = await (db as any).select({
        time: sql<string>`date_trunc('hour', created_at)`.as('time'),
        count: sql<number>`COUNT(*)`.as('count'),
      })
        .from(table)
        .where(and(
          filter,
          sql`created_at >= NOW() - INTERVAL '${sql.raw(hours.toString())} hours'`
        ))
        .groupBy(sql`date_trunc('hour', created_at)`)
        .orderBy(sql`time ASC`);

      // Форматируем для фронтенда
      const formattedData = data.map(item => ({
        time: new Date(item.time).toISOString(),
        count: Number(item.count),
      }));

      return NextResponse.json({ data: formattedData });
    } else {
      // SQLite - группировка по часам
      data = (db as any).select({
        time: sql<number>`(created_at / 3600) * 3600`.as('time'),
        count: sql<number>`COUNT(*)`.as('count'),
      })
        .from(table)
        .where(and(
          filter,
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
    }
  } catch (error) {
    console.error('Error fetching timeline:', error);
    return NextResponse.json(
      { error: 'Failed to fetch timeline' },
      { status: 500 }
    );
  }
}
