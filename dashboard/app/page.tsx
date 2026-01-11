import { StatsCard } from '@/components/StatsCard';
import { DailyChart } from '@/components/DailyChart';
import { ActivityFeed } from '@/components/ActivityFeed';

export default function Home() {
  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Commenting Dashboard
          </h1>
          <p className="text-white/60">
            Live statistics of commenting activity
          </p>
        </header>

        {/* Two-column layout on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column: Stats + Chart */}
          <div className="flex flex-col gap-6 lg:h-[448px]">
            <StatsCard />
            <DailyChart />
          </div>

          {/* Right column: Activity Feed - same height as left column */}
          <div className="lg:h-[448px]">
            <ActivityFeed />
          </div>
        </div>
      </div>
    </main>
  );
}
