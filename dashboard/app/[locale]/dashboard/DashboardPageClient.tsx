'use client';

import { DailyChart } from '@/components/DailyChart';
import { useScopedI18n } from '@/locales/client';

export function DashboardPageClient() {
  const t = useScopedI18n('dashboard');

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t('tabChart')}</h1>
      </div>
      <div className="h-[calc(100vh-12rem)] min-h-[420px]">
        <DailyChart />
      </div>
    </div>
  );
}
