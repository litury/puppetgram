import { DailyChart } from '@/components/DailyChart';
import { RecentPosts } from '@/components/RecentPosts';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function Home() {
  return (
    <main className="min-h-screen p-6 md:p-8 lg:p-12">
      {/* Page Header */}
      <div className="mx-auto max-w-400 mb-8 flex items-start justify-between gap-6 animate-fade-in">
        {/* Left: Title & Description */}
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-primary mb-1 animate-slide-up">
            Dashboard
          </h1>
          <p className="text-sm text-tertiary animate-slide-up" style={{ animationDelay: '50ms' }}>
            Real-time статистика комментирования в Telegram
          </p>
        </div>

        {/* Right: Theme Toggle */}
        <div className="shrink-0 animate-fade-in" style={{ animationDelay: '100ms' }}>
          <ThemeToggle />
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-400 h-[calc(100vh-10rem)] md:h-[calc(100vh-12rem)] lg:h-[calc(100vh-14rem)]">
        <div className="flex flex-col lg:flex-row gap-6 h-full">
          {/* Chart - grows */}
          <div className="flex-1 min-w-0 animate-scale-in" style={{ animationDelay: '150ms' }}>
            <DailyChart />
          </div>

          {/* Posts - fixed width on desktop */}
          <div className="w-full lg:w-120 shrink-0 animate-scale-in" style={{ animationDelay: '200ms' }}>
            <RecentPosts />
          </div>
        </div>
      </div>
    </main>
  );
}
