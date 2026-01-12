import { NextResponse } from 'next/server';
import { getDb, comments } from '@/lib/db';
import { desc, isNotNull, ne, and } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const db = await getDb();

    // Берём комментарии с postId, сортируем по дате
    const data = await db
      .select({
        channel: comments.channelUsername,
        postId: comments.postId,
        commentText: comments.commentText,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .where(
        and(
          isNotNull(comments.postId),
          ne(comments.commentText, 'Уже есть')
        )
      )
      .orderBy(desc(comments.createdAt))
      .limit(limit)
      .offset(offset);

    const posts = data.map((post) => ({
      channel: post.channel?.replace('@', '') || '',
      postId: post.postId,
      commentText: post.commentText,
      createdAt: post.createdAt ? new Date(post.createdAt).toISOString() : null,
    }));

    return NextResponse.json({ posts });
  } catch (error) {
    console.error('Error fetching recent posts:', error);
    return NextResponse.json({ posts: [] }, { status: 500 });
  }
}
