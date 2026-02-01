'use client';

import { DailyChart } from '@/components/DailyChart';
import { RecentPosts } from '@/components/RecentPosts';
import { Header } from '@/components/Header';

export default function DashboardPage() {
  return (
    <div className="min-h-screen">
      <Header currentPage="dashboard" />

      {/* Main Content with top padding for fixed nav */}
      <main className="pt-20 sm:pt-24 px-6 pb-6 md:px-8 md:pb-8 lg:px-12 lg:pb-12">
        <div className="mx-auto max-w-400 h-[calc(100vh-10rem)] md:h-[calc(100vh-12rem)] lg:h-[calc(100vh-14rem)]">
          <div className="flex flex-col lg:flex-row gap-6 h-full">
            {/* Chart - grows */}
            <div className="flex-1 min-w-0">
              <DailyChart />
            </div>

            {/* Posts - fixed width on desktop */}
            <div className="w-full lg:w-120 shrink-0">
              <RecentPosts />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
