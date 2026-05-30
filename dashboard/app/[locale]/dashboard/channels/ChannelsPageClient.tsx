'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentLocale } from '@/locales/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Status = 'new' | 'done' | 'error' | 'skipped';
type Locale = 'ru' | 'en';

interface Channel {
  username: string;
  title: string | null;
  status: Status;
  participants: number | null;
  avgViews: number | null;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string | null;
}

interface ChannelsResponse {
  channels: Channel[];
  summary: Record<string, number>;
  filteredTotal: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 50;

const T = {
  title: { ru: 'Каналы', en: 'Channels' },
  subtitle: {
    ru: 'Очередь каналов для комментирования (результат парсинга)',
    en: 'Channel queue for commenting (parsing output)',
  },
  total: { ru: 'Всего', en: 'Total' },
  new: { ru: 'В очереди', en: 'Queued' },
  done: { ru: 'Готово', en: 'Done' },
  error: { ru: 'Ошибка', en: 'Error' },
  skipped: { ru: 'Пропущено', en: 'Skipped' },
  search: { ru: 'Поиск по @юзернейму или названию…', en: 'Search by @username or title…' },
  colChannel: { ru: 'Канал', en: 'Channel' },
  colStatus: { ru: 'Статус', en: 'Status' },
  colSubs: { ru: 'Подписчики', en: 'Subscribers' },
  colViews: { ru: 'Ср. просмотры', en: 'Avg. views' },
  colDate: { ru: 'Дата', en: 'Date' },
  processed: { ru: 'обработан', en: 'processed' },
  found: { ru: 'найден', en: 'found' },
  colInfo: { ru: 'Инфо', en: 'Info' },
  empty: { ru: 'Ничего не найдено', en: 'Nothing found' },
  page: { ru: 'Стр.', en: 'Page' },
  of: { ru: 'из', en: 'of' },
};

const STATUS_META: Record<Status, { label: Record<Locale, string>; cls: string }> = {
  new: { label: T.new, cls: 'bg-muted text-muted-foreground border-border' },
  done: { label: T.done, cls: 'bg-success/15 text-success border-success/20' },
  error: { label: T.error, cls: 'bg-destructive/15 text-destructive border-destructive/20' },
  skipped: { label: T.skipped, cls: 'bg-warning/15 text-warning border-warning/20' },
};

function fmtNum(n: number, locale: Locale): string {
  return n.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US');
}

function fmtDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function SummaryCard({
  label,
  value,
  active,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  active: boolean;
  accent?: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="text-left">
      <Card
        className={`gap-1 px-4 py-3 transition-colors hover:border-ring/50 ${
          active ? 'border-ring ring-1 ring-ring/40' : ''
        }`}
      >
        <span className={`text-2xl font-semibold tabular-nums ${accent ?? 'text-foreground'}`}>
          {value}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </Card>
    </button>
  );
}

export function ChannelsPageClient() {
  const locale = (useCurrentLocale() as Locale) || 'ru';
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth(false);

  const [data, setData] = useState<ChannelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);

  // Admin-guard (UX); реальная защита — 403 в API.
  useEffect(() => {
    if (!authLoading && user && !isAdmin(user)) {
      router.replace(`/${locale}/dashboard`);
    }
  }, [authLoading, user, locale, router]);

  // Дебаунс поиска
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search);
      setOffset(0);
    }, 400);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (status) params.set('status', status);
      if (debounced) params.set('search', debounced);
      const res = await apiFetch(`/api/channels?${params.toString()}`);
      if (res.ok) setData(await res.json());
    } catch {
      // тихо
    } finally {
      setLoading(false);
    }
  }, [status, debounced, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary;
  const filteredTotal = data?.filteredTotal ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  const cards = useMemo(
    () =>
      [
        { key: null as Status | null, label: T.total[locale], val: summary?.total ?? 0, accent: 'text-foreground' },
        { key: 'new' as Status, label: T.new[locale], val: summary?.new ?? 0, accent: 'text-foreground' },
        { key: 'done' as Status, label: T.done[locale], val: summary?.done ?? 0, accent: 'text-success' },
        { key: 'error' as Status, label: T.error[locale], val: summary?.error ?? 0, accent: 'text-destructive' },
        { key: 'skipped' as Status, label: T.skipped[locale], val: summary?.skipped ?? 0, accent: 'text-warning' },
      ],
    [summary, locale]
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{T.title[locale]}</h1>
        <p className="text-sm text-muted-foreground">{T.subtitle[locale]}</p>
      </div>

      {/* Сводка по статусам — кликабельные фильтры */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <SummaryCard
            key={c.label}
            label={c.label}
            value={fmtNum(c.val, locale)}
            accent={c.accent}
            active={status === c.key}
            onClick={() => {
              setStatus(c.key);
              setOffset(0);
            }}
          />
        ))}
      </div>

      {/* Поиск */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={T.search[locale]}
          className="pl-9"
        />
      </div>

      {/* Таблица */}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{T.colChannel[locale]}</TableHead>
              <TableHead className="w-28">{T.colStatus[locale]}</TableHead>
              <TableHead className="w-28 text-right">{T.colSubs[locale]}</TableHead>
              <TableHead className="w-28 text-right">{T.colViews[locale]}</TableHead>
              <TableHead className="w-32">{T.colDate[locale]}</TableHead>
              <TableHead>{T.colInfo[locale]}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : !data || data.channels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  {T.empty[locale]}
                </TableCell>
              </TableRow>
            ) : (
              data.channels.map((ch) => {
                const meta = STATUS_META[ch.status];
                return (
                  <TableRow key={ch.username}>
                    <TableCell>
                      <a
                        href={`https://t.me/${ch.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1.5"
                      >
                        <span className="font-medium text-foreground group-hover:text-primary">
                          @{ch.username}
                        </span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </a>
                      {ch.title && (
                        <div className="truncate text-xs text-muted-foreground">{ch.title}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={meta?.cls}>
                        {meta?.label[locale] ?? ch.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {ch.participants != null ? fmtNum(ch.participants, locale) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {ch.avgViews != null ? fmtNum(ch.avgViews, locale) : '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {ch.processedAt ? (
                        <div>
                          <div className="text-foreground">{fmtDate(ch.processedAt, locale)}</div>
                          <div className="text-muted-foreground">{T.processed[locale]}</div>
                        </div>
                      ) : ch.createdAt ? (
                        <div>
                          <div className="text-foreground">{fmtDate(ch.createdAt, locale)}</div>
                          <div className="text-muted-foreground">{T.found[locale]}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      {ch.errorMessage ? (
                        <span className="line-clamp-1 text-xs text-destructive/80">
                          {ch.errorMessage}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Пагинация */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {fmtNum(filteredTotal, locale)} {locale === 'ru' ? 'каналов' : 'channels'}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {T.page[locale]} {page} {T.of[locale]} {fmtNum(totalPages, locale)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
