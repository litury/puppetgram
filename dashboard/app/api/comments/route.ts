import { NextResponse } from 'next/server';
import { getDbAsync, isPostgres, commentsPg, commentsSqlite } from '@/lib/db';
import { desc, ne, and, isNotNull } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const db = await getDbAsync();
    const isPg = isPostgres();
    const table = isPg ? commentsPg : commentsSqlite;

    // Исключаем комментарии с текстом "Уже есть" (не опубликованные)
    const filter = and(
      ne(table.commentText, 'Уже есть'),
      isNotNull(table.commentText)
    );

    let data: any[];

    if (isPg) {
      // PostgreSQL - асинхронные запросы
      data = await (db as any).select({
        id: table.id,
        channel: table.channelUsername,
        text: table.commentText,
        postId: table.postId,
        createdAt: table.createdAt,
      })
        .from(table)
        .where(filter)
        .orderBy(desc(table.createdAt))
        .limit(limit)
        .offset(offset);
    } else {
      // SQLite - синхронные запросы
      data = (db as any).select({
        id: table.id,
        channel: table.channelUsername,
        text: table.commentText,
        postId: table.postId,
        createdAt: table.createdAt,
      })
        .from(table)
        .where(filter)
        .orderBy(desc(table.createdAt))
        .limit(limit)
        .offset(offset)
        .all();
    }

    // Форматируем данные для фронтенда
    const formattedComments = data.map(comment => ({
      id: comment.id,
      channel: `@${comment.channel}`,
      text: comment.text || '',
      postId: comment.postId,
      createdAt: comment.createdAt ? new Date(comment.createdAt).toISOString() : null,
    }));

    return NextResponse.json({ comments: formattedComments });
  } catch (error) {
    console.error('Error fetching comments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}
