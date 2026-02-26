'use client';

import { useState } from 'react';
import { DailyChart } from '@/components/DailyChart';
import { UserProfile } from '@/components/UserProfile';
import { useScopedI18n } from '@/locales/client';

type MobileTab = 'chart' | 'profile';

export function DashboardPageClient() {
  const t = useScopedI18n('dashboard');
  const [activeTab, setActiveTab] = useState<MobileTab>('chart');

  return (
    <main className="pt-20 sm:pt-24 px-6 pb-6 md:px-8 md:pb-8 lg:px-12 lg:pb-12 overflow-hidden">
      <div className="mx-auto max-w-7xl h-[calc(100vh-10rem)] md:h-[calc(100vh-12rem)] lg:h-[calc(100vh-14rem)]">

        {/* Mobile: tabs */}
        <div className="flex gap-1 bg-neutral-850 rounded-lg p-1 mb-4 lg:hidden">
          <button
            onClick={() => setActiveTab('chart')}
            className={`flex-1 px-4 py-2 text-sm rounded-md transition-all duration-200 ${
              activeTab === 'chart'
                ? 'bg-accent-500/10 text-accent-400 border border-accent-500/20'
                : 'text-secondary hover:text-primary hover:bg-neutral-800'
            }`}
          >
            {t('tabChart')}
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex-1 px-4 py-2 text-sm rounded-md transition-all duration-200 ${
              activeTab === 'profile'
                ? 'bg-accent-500/10 text-accent-400 border border-accent-500/20'
                : 'text-secondary hover:text-primary hover:bg-neutral-800'
            }`}
          >
            {t('tabProfile')}
          </button>
        </div>

        {/* Mobile: active tab content */}
        <div className="h-[calc(100%-3rem)] lg:hidden">
          {activeTab === 'chart' ? (
            <div className="h-full">
              <DailyChart />
            </div>
          ) : (
            <div className="h-full">
              <UserProfile />
            </div>
          )}
        </div>

        {/* Desktop: side-by-side layout */}
        <div className="hidden lg:flex gap-6 h-full">
          <div className="flex-1 min-w-0">
            <DailyChart />
          </div>
          <div className="w-120 shrink-0 h-full">
            <UserProfile />
          </div>
        </div>
      </div>
    </main>
  );
}
