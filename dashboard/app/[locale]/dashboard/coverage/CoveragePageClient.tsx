'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Users, Radio } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useCurrentLocale } from '@/locales/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';

type Locale = 'ru' | 'en';

interface Bucket {
  label: string;
  channels: number;
  reach: number;
}
interface Coverage {
  totalReach: number;
  channelsWithData: number;
  doneReach: number;
  doneChannels: number;
  buckets: Bucket[];
}

const T = {
  title: { ru: 'Охват', en: 'Coverage' },
  subtitle: {
    ru: 'Потенциальная аудитория спарсенной базы каналов',
    en: 'Potential audience of the parsed channel base',
  },
  totalReach: { ru: 'Потенциальный охват', en: 'Potential reach' },
  totalReachHint: { ru: 'суммарная аудитория каналов в базе', en: 'total audience of channels in base' },
  channels: { ru: 'Каналов с аудиторией', en: 'Channels with audience' },
  channelsHint: { ru: 'в спарсенной базе', en: 'in the parsed base' },
  byReach: { ru: 'По охвату', en: 'By reach' },
  byChannels: { ru: 'По числу каналов', en: 'By channel count' },
  chartTitle: { ru: 'Распределение по размеру каналов', en: 'Distribution by channel size' },
  reachUnit: { ru: 'подписчиков', en: 'subscribers' },
  channelsUnit: { ru: 'каналов', en: 'channels' },
};

const BAR_COLORS = ['#a291f7', '#8b7cf6', '#6d5cd6', '#fbbf24', '#6ee7b7'];

function fmtCompact(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}
function fmtFull(n: number, locale: Locale): string {
  return n.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US');
}

export function CoveragePageClient() {
  const locale = (useCurrentLocale() as Locale) || 'ru';
  const [data, setData] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<'reach' | 'channels'>('reach');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/coverage');
        if (res.ok) setData(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const chartData = useMemo(
    () =>
      (data?.buckets ?? []).map((b) => ({
        label: b.label,
        value: metric === 'reach' ? b.reach : b.channels,
      })),
    [data, metric]
  );

  const unit = metric === 'reach' ? T.reachUnit[locale] : T.channelsUnit[locale];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{T.title[locale]}</h1>
        <p className="text-sm text-muted-foreground">{T.subtitle[locale]}</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="gap-1">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Users className="h-4 w-4" />
              {T.totalReach[locale]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-9 w-32" />
            ) : (
              <div className="text-3xl font-semibold text-foreground">
                {fmtCompact(data?.totalReach ?? 0, locale)}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{T.totalReachHint[locale]}</p>
          </CardContent>
        </Card>

        <Card className="gap-1">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Radio className="h-4 w-4" />
              {T.channels[locale]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-9 w-32" />
            ) : (
              <div className="text-3xl font-semibold text-foreground">
                {fmtFull(data?.channelsWithData ?? 0, locale)}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{T.channelsHint[locale]}</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{T.chartTitle[locale]}</CardTitle>
          <Tabs value={metric} onValueChange={(v) => setMetric(v as 'reach' | 'channels')}>
            <TabsList>
              <TabsTrigger value="reach">{T.byReach[locale]}</TabsTrigger>
              <TabsTrigger value="channels">{T.byChannels[locale]}</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <div className="w-full">
              <ResponsiveContainer width="100%" height={288}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                  />
                  <YAxis
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => fmtCompact(Number(v), locale)}
                    width={48}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--accent)', opacity: 0.3 }}
                    contentStyle={{
                      background: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: '0.5rem',
                      color: 'var(--popover-foreground)',
                    }}
                    itemStyle={{ color: 'var(--popover-foreground)' }}
                    labelStyle={{ color: 'var(--muted-foreground)' }}
                    formatter={(value) => [`${fmtFull(Number(value), locale)} ${unit}`, '']}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
