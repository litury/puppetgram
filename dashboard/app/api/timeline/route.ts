import { NextResponse } from 'next/server';
import { getDb, comments } from '@/lib/db';
import { sql, ne, and, isNotNull, min, max } from 'drizzle-orm';

// Генерация всех часов в диапазоне
function generateHourRange(start: Date, end: Date): string[] {
  const hours: string[] = [];
  const current = new Date(start);
  current.setMinutes(0, 0, 0);

  while (current <= end) {
    hours.push(current.toISOString());
    current.setHours(current.getHours() + 1);
  }

  return hours;
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
      return NextResponse.json({ data: [] });
    }

    // Агрегация по часам
    const rawData = await db.select({
      hour: sql<string>`date_trunc('hour', created_at AT TIME ZONE 'Europe/Moscow')`.as('hour'),
      count: sql<number>`COUNT(*)`.as('count'),
    })
      .from(comments)
      .where(filter)
      .groupBy(sql`date_trunc('hour', created_at AT TIME ZONE 'Europe/Moscow')`)
      .orderBy(sql`hour ASC`);

    // Создать map для быстрого доступа
    const dataMap = new Map<string, number>();
    rawData.forEach(item => {
      // Нормализуем ключ к ISO строке
      const key = new Date(item.hour).toISOString();
      dataMap.set(key, Number(item.count));
    });

    // Сгенерировать все часы и заполнить пропуски нулями
    const allHours = generateHourRange(new Date(firstDate), new Date(lastDate));
    const filledData = allHours.map(hour => ({
      time: hour,
      count: dataMap.get(hour) || 0,
    }));

    return NextResponse.json({ data: filledData });
  } catch (error) {
    console.error('Error fetching timeline:', error);
    return NextResponse.json(
      { error: 'Failed to fetch timeline' },
      { status: 500 }
    );
  }
}
