'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

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
    <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden flex-shrink-0">
      {/* Комментарий */}
      <div className={`p-3 md:p-4 ${expanded ? 'border-b border-white/10' : ''}`}>
        <div className="flex justify-between items-start gap-2 mb-2">
          <a
            href={`https://t.me/${post.channel}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 font-medium hover:text-violet-300 transition-colors text-sm truncate"
          >
            @{post.channel}
          </a>
          <div className="flex items-center gap-2">
            <span className="text-white/40 text-xs whitespace-nowrap">
              {formatTime(post.createdAt)}
            </span>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-white/40 hover:text-white/60 transition-colors text-sm px-1"
              title={expanded ? 'Свернуть пост' : 'Развернуть пост'}
            >
              {expanded ? '▲' : '▼'}
            </button>
          </div>
        </div>
        <p className="text-white/70 text-sm leading-relaxed break-words">
          {post.commentText || '—'}
        </p>
      </div>

      {/* Telegram пост со встроенным скелетоном */}
      {expanded && (
        <TelegramPost channel={post.channel} postId={post.postId} />
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
      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-4 md:p-6 border border-white/10 h-full flex flex-col">
        <h2 className="text-lg md:text-xl font-semibold text-white mb-4 flex-shrink-0">Прокомментированные посты</h2>
        <div className="flex flex-col gap-3 overflow-y-auto flex-1 min-h-0">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white/10 rounded-xl animate-pulse h-[80px] flex-shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-4 md:p-6 border border-white/10 h-full flex flex-col">
        <h2 className="text-lg md:text-xl font-semibold text-white mb-4 flex-shrink-0">Прокомментированные посты</h2>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-white/40">Нет прокомментированных постов</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-3 md:p-4 border border-white/10 h-full flex flex-col">
      <h2 className="text-lg md:text-xl font-semibold text-white mb-3 flex-shrink-0">Прокомментированные посты</h2>
      <div className="flex flex-col gap-3 overflow-y-auto flex-1 min-h-0 pr-2">
        {posts.map((post, index) => (
          <PostCard
            key={`${post.channel}-${post.postId}-${index}`}
            post={post}
            formatTime={formatTime}
          />
        ))}

        {/* Триггер для загрузки */}
        <div ref={loadMoreRef} className="h-10 flex-shrink-0">
          {loadingMore && (
            <div className="text-center text-white/40 py-2">Загрузка...</div>
          )}
          {!hasMore && posts.length > 0 && (
            <div className="text-center text-white/30 py-2 text-sm">
              Все посты загружены
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
