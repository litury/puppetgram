import { NextResponse } from 'next/server';
import { getDbAsync, isPostgres, commentsPg, commentsSqlite } from '@/lib/db';
import { sql, ne, and, isNotNull } from 'drizzle-orm';

export async function GET() {
  try {
    const db = await getDbAsync();
    const table = isPostgres ? commentsPg : commentsSqlite;

    // Фильтр: исключаем "Уже есть" (неопубликованные)
    const successFilter = and(
      ne(table.commentText, 'Уже есть'),
      isNotNull(table.commentText)
    );

    if (isPostgres) {
      // PostgreSQL - асинхронные запросы
      const totalResult = await (db as any).select({
        count: sql<number>`COUNT(*)`
      })
        .from(table)
        .where(successFilter);

      const todayResult = await (db as any).select({
        count: sql<number>`COUNT(*)`
      })
        .from(table)
        .where(and(
          successFilter,
          sql`DATE(created_at) = CURRENT_DATE`
        ));

      return NextResponse.json({
        totalComments: totalResult[0]?.count ?? 0,
        todayComments: todayResult[0]?.count ?? 0,
      });
    } else {
      // SQLite - синхронные запросы
      const totalResult = (db as any).select({
        count: sql<number>`COUNT(*)`
      })
        .from(table)
        .where(successFilter)
        .get();

      const todayResult = (db as any).select({
        count: sql<number>`COUNT(*)`
      })
        .from(table)
        .where(and(
          successFilter,
          sql`DATE(created_at, 'unixepoch') = DATE('now')`
        ))
        .get();

      return NextResponse.json({
        totalComments: totalResult?.count ?? 0,
        todayComments: todayResult?.count ?? 0,
      });
    }
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
