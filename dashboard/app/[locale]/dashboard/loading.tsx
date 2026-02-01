export default function DashboardLoading() {
  return (
    <main className="pt-20 sm:pt-24 px-6 pb-6 md:px-8 md:pb-8 lg:px-12 lg:pb-12">
      <div className="mx-auto max-w-7xl h-[calc(100vh-10rem)] md:h-[calc(100vh-12rem)] lg:h-[calc(100vh-14rem)]">
        <div className="flex flex-col lg:flex-row gap-6 h-full">
          {/* Chart skeleton */}
          <div className="flex-1 min-w-0 bg-neutral-900 rounded-xl p-6 border border-neutral-800 animate-pulse">
            <div className="h-8 w-32 bg-neutral-800 rounded mb-6" />
            <div className="h-full bg-neutral-850 rounded" />
          </div>

          {/* Posts skeleton */}
          <div className="w-full lg:w-120 shrink-0 bg-neutral-900 rounded-xl p-6 border border-neutral-800 animate-pulse">
            <div className="h-6 w-40 bg-neutral-800 rounded mb-4" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-neutral-850 rounded" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
