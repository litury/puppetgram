'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Hash, Bot, Sparkles, ShieldCheck, MessageSquare, Radio, Ban, Info } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentLocale } from '@/locales/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type Locale = 'ru' | 'en';

interface Settings {
  config: {
    targetChannel: string | null;
    botUsername: string | null;
    deepseekModel: string | null;
    deepseekEnabled: string | null;
    maxCommentsPerAccount: string | null;
    adminCount: number;
  };
  system: {
    commentsTotal: number;
    channelsTotal: number;
    activeBans: number;
  };
  note: string;
}

const T = {
  title: { ru: 'Настройки', en: 'Settings' },
  subtitle: { ru: 'Обзор системы и конфигурации (только чтение)', en: 'System & configuration overview (read-only)' },
  configSection: { ru: 'Конфигурация', en: 'Configuration' },
  systemSection: { ru: 'Система', en: 'System' },
  targetChannel: { ru: 'Целевой канал', en: 'Target channel' },
  botUsername: { ru: 'Бот авторизации', en: 'Auth bot' },
  deepseekModel: { ru: 'AI-модель', en: 'AI model' },
  deepseekEnabled: { ru: 'AI включён', en: 'AI enabled' },
  maxComments: { ru: 'Лимит коммантов/аккаунт', en: 'Max comments/account' },
  adminCount: { ru: 'Администраторов', en: 'Admins' },
  commentsTotal: { ru: 'Всего комментариев', en: 'Total comments' },
  channelsTotal: { ru: 'Каналов в базе', en: 'Channels in base' },
  activeBans: { ru: 'Активных банов', en: 'Active bans' },
  notSet: { ru: 'управляется в Dokploy', en: 'managed in Dokploy' },
};

function fmtNum(n: number, locale: Locale): string {
  return n.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US');
}

function Row({
  icon: Icon,
  label,
  value,
  muted,
}: {
  icon: typeof Hash;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </span>
      <span className={`text-sm tabular-nums ${muted ? 'text-muted-foreground italic' : 'font-medium text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}

export function SettingsPageClient() {
  const locale = (useCurrentLocale() as Locale) || 'ru';
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth(false);

  const [data, setData] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && user && !isAdmin(user)) {
      router.replace(`/${locale}/dashboard`);
    }
  }, [authLoading, user, locale, router]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/settings');
        if (res.ok) setData(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const val = (v: string | null) => (v ? { value: v, muted: false } : { value: T.notSet[locale], muted: true });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{T.title[locale]}</h1>
        <p className="text-sm text-muted-foreground">{T.subtitle[locale]}</p>
      </div>

      {loading || !data ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{T.systemSection[locale]}</CardTitle>
            </CardHeader>
            <CardContent className="py-0">
              <Row icon={MessageSquare} label={T.commentsTotal[locale]} value={fmtNum(data.system.commentsTotal, locale)} />
              <Row icon={Radio} label={T.channelsTotal[locale]} value={fmtNum(data.system.channelsTotal, locale)} />
              <Row icon={Ban} label={T.activeBans[locale]} value={fmtNum(data.system.activeBans, locale)} />
              <Row icon={ShieldCheck} label={T.adminCount[locale]} value={fmtNum(data.config.adminCount, locale)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{T.configSection[locale]}</CardTitle>
            </CardHeader>
            <CardContent className="py-0">
              <Row icon={Hash} label={T.targetChannel[locale]} {...val(data.config.targetChannel)} />
              <Row icon={Bot} label={T.botUsername[locale]} {...val(data.config.botUsername ? `@${data.config.botUsername}` : null)} />
              <Row icon={Sparkles} label={T.deepseekModel[locale]} {...val(data.config.deepseekModel)} />
              <Row icon={Sparkles} label={T.deepseekEnabled[locale]} {...val(data.config.deepseekEnabled)} />
              <Row icon={MessageSquare} label={T.maxComments[locale]} {...val(data.config.maxCommentsPerAccount)} />
            </CardContent>
          </Card>

          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {data.note}
          </p>
        </>
      )}
    </div>
  );
}
