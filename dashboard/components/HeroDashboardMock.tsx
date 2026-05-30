'use client';

import Image from 'next/image';
import { LayoutDashboard, Bot, Radio, MessageSquare, BarChart3, Settings } from 'lucide-react';
import { useScopedI18n, useCurrentLocale } from '@/locales/client';

// Лейблы навигации — как в AppSidebar (per-locale, не в i18n)
const NAV = [
  { icon: LayoutDashboard, ru: 'Обзор', en: 'Overview' },
  { icon: Bot, ru: 'Аккаунты', en: 'Accounts' },
  { icon: Radio, ru: 'Каналы', en: 'Channels' },
  { icon: MessageSquare, ru: 'Комментарии', en: 'Comments' },
  { icon: BarChart3, ru: 'Охват', en: 'Coverage' },
  { icon: Settings, ru: 'Настройки', en: 'Settings' },
] as const;

// Статичный репрезентативный путь графика (viewBox 0..100 x 0..40)
const CHART_LINE =
  'M0,30 L6,28 L12,31 L18,20 L24,24 L30,12 L36,16 L42,9 L48,14 L54,7 L60,15 L66,10 L72,18 L78,8 L84,13 L90,6 L96,11 L100,9';
const CHART_AREA = `${CHART_LINE} L100,40 L0,40 Z`;

export function HeroDashboardMock() {
  const t = useScopedI18n('dashboard');
  const locale = useCurrentLocale();

  return (
    <div
      aria-hidden
      className="pointer-events-none flex aspect-[16/10] w-full select-none bg-background text-left text-foreground"
    >
      {/* Sidebar */}
      <aside className="hidden w-44 shrink-0 flex-col border-r border-border bg-card p-3 sm:flex">
        <div className="flex items-center gap-2 px-1 pb-4">
          <Image src="/puppetgram-logo.png" alt="" width={24} height={24} className="size-6" />
          <span className="text-sm font-semibold text-foreground">Puppetgram</span>
        </div>
        <p className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          {locale === 'ru' ? 'Навигация' : 'Navigation'}
        </p>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item, i) => {
            const Icon = item.icon;
            const active = i === 0;
            return (
              <span
                key={i}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                  active ? 'bg-accent-500/10 font-medium text-accent-400' : 'text-muted-foreground'
                }`}
              >
                <Icon className="size-3.5" />
                {item[locale]}
              </span>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
          <span className="flex size-7 items-center justify-center rounded-full bg-accent-500/15 text-xs font-semibold text-accent-400">
            Ю
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">Юрий</p>
            <p className="truncate text-[10px] text-muted-foreground">@pravku</p>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-6">
        <h3 className="text-sm font-semibold text-foreground">{t('statistics')}</h3>

        <div className="flex flex-1 flex-col rounded-xl border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('activity')}</p>

          <div className="mt-2 flex items-baseline gap-4 border-b border-border pb-4">
            <div>
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">146 521</span>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{t('total')}</p>
            </div>
            <span className="h-8 w-px bg-border" />
            <div>
              <span className="text-lg font-semibold tabular-nums tracking-tight text-accent-500">+812</span>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{t('today')}</p>
            </div>
          </div>

          <div className="mb-3 mt-3 flex w-fit gap-1 rounded-lg bg-accent-500/5 p-1">
            <span className="rounded-md bg-accent-500/10 px-2.5 py-1 text-[10px] font-medium text-accent-400">
              {t('daily')}
            </span>
            <span className="rounded-md px-2.5 py-1 text-[10px] text-muted-foreground">{t('hourly')}</span>
          </div>

          {/* График */}
          <div className="relative min-h-0 flex-1">
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="size-full">
              <defs>
                <linearGradient id="heroMockFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b7cf6" stopOpacity="0.18" />
                  <stop offset="95%" stopColor="#8b7cf6" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {[10, 20, 30].map((y) => (
                <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="currentColor" strokeWidth="0.2" className="text-border" />
              ))}
              <path d={CHART_AREA} fill="url(#heroMockFill)" />
              <path d={CHART_LINE} fill="none" stroke="#8b7cf6" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
