'use client';

import { useState, useEffect } from 'react';
import InfiniteScroll from 'react-infinite-scroll-component';
import { CommentCard } from './CommentCard';

interface Comment {
  id: number;
  channel: string;
  text: string;
  createdAt: string | null;
}

export function ActivityFeed() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const limit = 20;

  const fetchComments = async (offset: number, append = false) => {
    if (!append) {
      setLoading(true);
    }

    try {
      const res = await fetch(`/api/comments?limit=${limit}&offset=${offset}`);
      const json = await res.json();
      const newComments = json.comments || [];

      if (append) {
        setComments((prev) => [...prev, ...newComments]);
      } else {
        setComments(newComments);
      }

      setHasMore(newComments.length === limit);
    } catch (error) {
      console.error('Failed to fetch comments:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments(0);
  }, []);

  const loadMore = () => {
    fetchComments(comments.length, true);
  };

  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 flex flex-col h-full">
      <h2 className="text-xl font-semibold text-white mb-4">Последние комментарии</h2>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-white/40">Загрузка...</div>
        </div>
      ) : comments.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-white/40">Нет комментариев</div>
        </div>
      ) : (
        <div
          id="scrollableDiv"
          className="flex-1 overflow-y-auto pr-2"
          style={{ scrollbarWidth: 'thin' }}
        >
          <InfiniteScroll
            dataLength={comments.length}
            next={loadMore}
            hasMore={hasMore}
            loader={
              <div className="text-center text-white/40 py-3 text-sm">
                Загрузка...
              </div>
            }
            endMessage={
              <div className="text-center text-white/30 py-3 text-xs">
                Все комментарии загружены
              </div>
            }
            scrollableTarget="scrollableDiv"
          >
            <div className="space-y-2">
              {comments.map((comment) => (
                <CommentCard
                  key={comment.id}
                  channel={comment.channel}
                  text={comment.text}
                  createdAt={comment.createdAt}
                />
              ))}
            </div>
          </InfiniteScroll>
        </div>
      )}
    </div>
  );
}
