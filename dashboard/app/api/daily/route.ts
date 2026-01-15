import { NextResponse } from 'next/server';
import { getDb, comments } from '@/lib/db';
import { sql, ne, and, isNotNull, min, max } from 'drizzle-orm';

// Генерация всех дат в диапазоне
function generateDateRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);

  const endDate = new Date(end);
  endDate.setHours(23, 59, 59, 999);

  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

export async function GET() {
  try {
    const db = await getDb();

    const filter = and(
      ne(comments.commentText, 'Уже есть'),
      isNotNull(comments.commentText)
    );

    // Получить диапазон дат
    const dateRange = await db.select({
      firstDate: min(comments.createdAt),
      lastDate: max(comments.createdAt),
    })
      .from(comments)
      .where(filter);

    const firstDate = dateRange[0]?.firstDate;
    const lastDate = dateRange[0]?.lastDate;

    if (!firstDate || !lastDate) {
      return NextResponse.json({ data: [], groupBy: 'day' });
    }

    // Получить данные сгруппированные по дням (Moscow timezone)
    const rawData = await db.select({
      date: sql<string>`DATE(created_at AT TIME ZONE 'Europe/Moscow')`.as('date'),
      count: sql<number>`COUNT(*)`.as('count'),
    })
      .from(comments)
      .where(filter)
      .groupBy(sql`DATE(created_at AT TIME ZONE 'Europe/Moscow')`)
      .orderBy(sql`date ASC`);

    // Создать map для быстрого доступа
    const dataMap = new Map<string, number>();
    rawData.forEach(item => {
      dataMap.set(item.date, Number(item.count));
    });

    // Сгенерировать все даты и заполнить пропуски нулями
    const allDates = generateDateRange(new Date(firstDate), new Date(lastDate));
    const filledData = allDates.map(date => ({
      time: date,
      count: dataMap.get(date) || 0,
    }));

    return NextResponse.json({ data: filledData, groupBy: 'day' });
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch daily stats' },
      { status: 500 }
    );
  }
}
