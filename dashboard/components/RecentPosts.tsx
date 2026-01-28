'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';

interface Post {
  channel: string;
  postId: number;
  commentText: string | null;
  createdAt: string | null;
}

// Telegram Post Widget — просто вставляем виджет
function TelegramPost({ channel, postId }: { channel: string; postId: number }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-post', `${channel}/${postId}`);
    script.setAttribute('data-width', '100%');

    containerRef.current.appendChild(script);
  }, [channel, postId]);

  return <div ref={containerRef} className="w-full p-2 [&_iframe]:rounded-lg" />;
}

// Карточка поста
function PostCard({ post, formatTime }: { post: Post; formatTime: (s: string | null) => string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg hover:border-neutral-700 transition-all duration-300 overflow-hidden shrink-0 hover:shadow-md hover:shadow-accent-500/5">
      {/* Комментарий */}
      <div className={`p-4 ${expanded ? 'border-b border-neutral-800' : ''}`}>
        <div className="flex justify-between items-start gap-3 mb-3">
          <a
            href={`https://t.me/${post.channel}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs uppercase tracking-wide text-accent-500 hover:text-accent-400 transition-all duration-200 truncate hover:underline"
          >
            @{post.channel}
          </a>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs tabular-nums text-tertiary whitespace-nowrap">
              {formatTime(post.createdAt)}
            </span>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-tertiary hover:text-secondary transition-all duration-200 text-xs px-2 py-1 rounded-md hover:bg-neutral-850"
              title={expanded ? 'Свернуть' : 'Развернуть'}
            >
              {expanded ? 'Скрыть' : 'Показать'}
            </button>
          </div>
        </div>
        <p className="text-base leading-relaxed text-primary wrap-break-word">
          {post.commentText || '—'}
        </p>
      </div>

      {/* Telegram пост с fade-in */}
      {expanded && (
        <div className="border-t border-neutral-800 animate-fade-in">
          <TelegramPost channel={post.channel} postId={post.postId} />
        </div>
      )}
    </div>
  );
}

export function RecentPosts() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const limit = 10;

  // WebSocket: добавление новых постов в реальном времени
  const handleWsMessage = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'new_comment') {
      const data = msg.data as { channel: string; postId: number; commentText: string; createdAt: string };
      setPosts(prev => [{
        channel: data.channel,
        postId: data.postId,
        commentText: data.commentText,
        createdAt: data.createdAt,
      }, ...prev]);
    }
  }, []);

  useWebSocket(handleWsMessage);

  const fetchPosts = useCallback(async (offset: number, append = false) => {
    try {
      if (append) setLoadingMore(true);
      const res = await fetch(`/api/recent-posts?limit=${limit}&offset=${offset}`);
      if (res.ok) {
        const data = await res.json();
        if (data.posts.length < limit) {
          setHasMore(false);
        }
        setPosts(prev => append ? [...prev, ...data.posts] : data.posts);
      }
    } catch (error) {
      console.error('Failed to fetch posts:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts(0);
  }, [fetchPosts]);

  // Intersection Observer для ленивой загрузки
  useEffect(() => {
    if (loading) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          fetchPosts(posts.length, true);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [loading, hasMore, loadingMore, posts.length, fetchPosts]);

  const formatTime = (isoString: string | null) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow',
    });
  };

  if (loading) {
    return (
      <div className="bg-neutral-900 rounded-xl p-4 md:p-6 border border-neutral-800 h-full flex flex-col">
        <div className="mb-4 pb-4 border-b border-neutral-800 shrink-0">
          <p className="text-xs uppercase tracking-wide text-tertiary mb-2">
            Последние комментарии
          </p>
          <h2 className="text-lg font-semibold text-primary">
            Прокомментированные посты
          </h2>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto flex-1 min-h-0">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-neutral-850 rounded-lg animate-pulse h-20 border border-neutral-800 shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="bg-neutral-900 rounded-xl p-4 md:p-6 border border-neutral-800 h-full flex flex-col">
        <div className="mb-4 pb-4 border-b border-neutral-800 shrink-0">
          <p className="text-xs uppercase tracking-wide text-tertiary mb-2">
            Последние комментарии
          </p>
          <h2 className="text-lg font-semibold text-primary">
            Прокомментированные посты
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-tertiary">Нет прокомментированных постов</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-neutral-900 rounded-xl p-4 md:p-6 border border-neutral-800 h-full flex flex-col">
      <div className="mb-4 pb-4 border-b border-neutral-800 shrink-0">
        <p className="text-xs uppercase tracking-wide text-tertiary mb-2">
          Последние комментарии
        </p>
        <h2 className="text-lg font-semibold text-primary">
          Прокомментированные посты
        </h2>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto flex-1 min-h-0 pr-2">
        {posts.map((post, index) => (
          <PostCard
            key={`${post.channel}-${post.postId}-${index}`}
            post={post}
            formatTime={formatTime}
          />
        ))}

        {/* Триггер для загрузки */}
        <div ref={loadMoreRef} className="h-10 shrink-0">
          {loadingMore && (
            <div className="text-center text-tertiary py-2 text-sm">Загрузка...</div>
          )}
          {!hasMore && posts.length > 0 && (
            <div className="text-center text-disabled py-2 text-xs">
              Все посты загружены
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
