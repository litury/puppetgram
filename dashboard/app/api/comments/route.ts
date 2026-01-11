import { NextResponse } from 'next/server';
import { getDb, comments } from '@/lib/db';
import { desc, ne, and, isNotNull } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const db = await getDb();

    const filter = and(
      ne(comments.commentText, 'Уже есть'),
      isNotNull(comments.commentText)
    );

    const data = await db.select({
      id: comments.id,
      channel: comments.channelUsername,
      text: comments.commentText,
      postId: comments.postId,
      createdAt: comments.createdAt,
    })
      .from(comments)
      .where(filter)
      .orderBy(desc(comments.createdAt))
      .limit(limit)
      .offset(offset);

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
