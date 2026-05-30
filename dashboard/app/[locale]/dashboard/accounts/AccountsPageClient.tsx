'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Clock, Ban, CheckCircle2, MessageSquare } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentLocale } from '@/locales/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';

type Status = 'working' | 'flood_wait' | 'banned';

interface Account {
  name: string;
  status: Status;
  activeNow: boolean;
  bannedAt: string | null;
  banReason: string | null;
  unlockAt: string | null;
  lastCommentAt: string | null;
  commentsToday: number;
}

interface AccountsResponse {
  accounts: Account[];
  summary: { total: number; working: number; floodWait: number; banned: number };
}

type Locale = 'ru' | 'en';

const T = {
  title: { ru: 'Аккаунты', en: 'Accounts' },
  subtitle: {
    ru: 'Марионетки-комментаторы и их статус',
    en: 'Commenter puppets and their status',
  },
  all: { ru: 'Все', en: 'All' },
  working: { ru: 'Готовы', en: 'Ready' },
  floodWait: { ru: 'Лимит', en: 'Flood wait' },
  banned: { ru: 'Бан', en: 'Banned' },
  activeNow: { ru: 'сейчас пишет', en: 'commenting now' },
  commentsToday: { ru: 'сегодня', en: 'today' },
  unlockIn: { ru: 'Разблокировка через', en: 'Unlocks in' },
  bannedAt: { ru: 'Забанен', en: 'Banned' },
  empty: { ru: 'Нет аккаунтов в этой категории', en: 'No accounts in this category' },
};

function fmtCountdown(iso: string, locale: Locale): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return locale === 'ru' ? 'скоро' : 'soon';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}${locale === 'ru' ? 'ч' : 'h'} ${m}${locale === 'ru' ? 'м' : 'm'}`;
  return `${m}${locale === 'ru' ? 'м' : 'm'}`;
}

function fmtDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_BADGE: Record<Status, { variant: 'default' | 'secondary' | 'destructive'; cls: string }> = {
  working: { variant: 'secondary', cls: 'bg-success/15 text-success border-success/20' },
  flood_wait: { variant: 'secondary', cls: 'bg-warning/15 text-warning border-warning/20' },
  banned: { variant: 'destructive', cls: '' },
};

function AccountCard({ account, locale }: { account: Account; locale: Locale }) {
  const badge = STATUS_BADGE[account.status];
  const statusLabel =
    account.status === 'working'
      ? T.working[locale]
      : account.status === 'flood_wait'
      ? T.floodWait[locale]
      : T.banned[locale];

  return (
    <Card className={account.activeNow ? 'gap-3 ring-2 ring-success/40' : 'gap-3'}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{account.name}</span>
        </CardTitle>
        <Badge variant={badge.variant} className={badge.cls}>
          {statusLabel}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {account.activeNow && (
          <div className="flex items-center gap-1.5 text-success">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            <span className="font-medium">{T.activeNow[locale]}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          <span className="tabular-nums text-foreground">{account.commentsToday}</span>
          <span>{T.commentsToday[locale]}</span>
        </div>

        {account.status === 'flood_wait' && account.unlockAt && (
          <div className="flex items-center gap-1.5 text-warning">
            <Clock className="h-3.5 w-3.5" />
            <span>
              {T.unlockIn[locale]} {fmtCountdown(account.unlockAt, locale)}
            </span>
          </div>
        )}

        {account.status === 'banned' && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-destructive">
              <Ban className="h-3.5 w-3.5" />
              <span>
                {T.bannedAt[locale]} {account.bannedAt ? fmtDate(account.bannedAt, locale) : ''}
              </span>
            </div>
            {account.banReason && (
              <p className="text-xs text-muted-foreground">{account.banReason}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AccountsPageClient() {
  const locale = (useCurrentLocale() as Locale) || 'ru';
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth(false);

  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | Status>('all');

  // Admin-guard (UX): не-админа уводим на Обзор. Реальная защита — 403 в API.
  useEffect(() => {
    if (!authLoading && user && !isAdmin(user)) {
      router.replace(`/${locale}/dashboard`);
    }
  }, [authLoading, user, locale, router]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/accounts');
      if (res.ok) setData(await res.json());
    } catch {
      // тихо
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return tab === 'all' ? data.accounts : data.accounts.filter((a) => a.status === tab);
  }, [data, tab]);

  const s = data?.summary;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{T.title[locale]}</h1>
        <p className="text-sm text-muted-foreground">{T.subtitle[locale]}</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'all' | Status)}>
        <TabsList>
          <TabsTrigger value="all">
            {T.all[locale]} {s ? `· ${s.total}` : ''}
          </TabsTrigger>
          <TabsTrigger value="working">
            {T.working[locale]} {s ? `· ${s.working}` : ''}
          </TabsTrigger>
          <TabsTrigger value="flood_wait">
            {T.floodWait[locale]} {s ? `· ${s.floodWait}` : ''}
          </TabsTrigger>
          <TabsTrigger value="banned">
            {T.banned[locale]} {s ? `· ${s.banned}` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-36 w-full rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 opacity-40" />
              <p className="text-sm">{T.empty[locale]}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((a) => (
                <AccountCard key={a.name} account={a} locale={locale} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
