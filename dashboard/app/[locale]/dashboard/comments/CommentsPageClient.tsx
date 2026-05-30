'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, ExternalLink, Bot, Loader2, MessageSquare } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useCurrentLocale } from '@/locales/client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type Locale = 'ru' | 'en';

interface Comment {
  id: number;
  channel: string; // '@username'
  account: string | null;
  text: string;
  postId: number | null;
  createdAt: string | null;
}

const PAGE_SIZE = 20;

const T = {
  title: { ru: 'Комментарии', en: 'Comments' },
  subtitle: { ru: 'Лента опубликованных комментариев', en: 'Feed of published comments' },
  search: { ru: 'Поиск по каналу или тексту…', en: 'Search by channel or text…' },
  empty: { ru: 'Ничего не найдено', en: 'Nothing found' },
  loadMore: { ru: 'Показать ещё', en: 'Load more' },
  openPost: { ru: 'Открыть пост', en: 'Open post' },
};

function fmtTime(iso: string | null, locale: Locale): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

export function CommentsPageClient() {
  const locale = (useCurrentLocale() as Locale) || 'ru';

  const [items, setItems] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const reqId = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(id);
  }, [search]);

  const fetchPage = useCallback(
    async (offset: number, q: string, append: boolean) => {
      const myReq = ++reqId.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        if (q) params.set('search', q);
        const res = await apiFetch(`/api/comments?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (myReq !== reqId.current) return; // устаревший ответ
        setHasMore(Boolean(data.hasMore));
        setItems((prev) => (append ? [...prev, ...(data.comments || [])] : data.comments || []));
      } finally {
        if (myReq === reqId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    []
  );

  // Перезагрузка при смене поиска
  useEffect(() => {
    fetchPage(0, debounced, false);
  }, [debounced, fetchPage]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{T.title[locale]}</h1>
        <p className="text-sm text-muted-foreground">{T.subtitle[locale]}</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={T.search[locale]}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <MessageSquare className="h-8 w-8 opacity-40" />
          <p className="text-sm">{T.empty[locale]}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((c) => {
            const channelName = c.channel.replace('@', '');
            const postUrl = c.postId ? `https://t.me/${channelName}/${c.postId}` : null;
            return (
              <Card key={c.id} className="gap-0 py-0">
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={`https://t.me/${channelName}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm font-medium text-primary hover:underline"
                    >
                      {c.channel}
                    </a>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {fmtTime(c.createdAt, locale)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-foreground/90">{c.text || '—'}</p>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    {c.account ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Bot className="h-3.5 w-3.5" />
                        {c.account}
                      </span>
                    ) : (
                      <span />
                    )}
                    {postUrl && (
                      <a
                        href={postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                      >
                        {T.openPost[locale]}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {hasMore && (
            <Button
              variant="outline"
              className="mt-2 self-center"
              disabled={loadingMore}
              onClick={() => fetchPage(items.length, debounced, true)}
            >
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
              {T.loadMore[locale]}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
