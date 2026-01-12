import { DailyChart } from '@/components/DailyChart';
import { RecentPosts } from '@/components/RecentPosts';

export default function Home() {
  return (
    <main className="h-screen p-4 md:p-6 lg:p-10 overflow-hidden">
      <div className="max-w-7xl mx-auto h-full">
        {/* Desktop: график слева, посты справа — оба фиксированной высоты */}
        <div className="flex flex-col lg:flex-row gap-6 md:gap-8 h-full">
          {/* Chart - на десктопе занимает больше места */}
          <div className="lg:flex-1 lg:min-w-0 flex flex-col min-h-0">
            <DailyChart />
          </div>

          {/* Posts - справа, фиксированная ширина, внутренний скролл */}
          <div className="lg:w-[420px] lg:flex-shrink-0 flex flex-col min-h-0 flex-1 lg:flex-initial">
            <RecentPosts />
          </div>
        </div>
      </div>
    </main>
  );
}
