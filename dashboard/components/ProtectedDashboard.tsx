'use client';

import { useAuth } from '@/hooks/useAuth';
import { DailyChart } from '@/components/DailyChart';
import { RecentPosts } from '@/components/RecentPosts';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * Защищённый дашборд — только для авторизованных пользователей
 */
export function ProtectedDashboard() {
  const { isLoading, isAuthenticated, user, logout } = useAuth();

  // Показываем loading пока проверяем авторизацию
  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-accent-500/20 border-t-accent-500 rounded-full animate-spin" />
          <p className="text-text-secondary text-sm">Проверка авторизации...</p>
        </div>
      </main>
    );
  }

  // Если не авторизован — useAuth автоматически редиректит на /login
  if (!isAuthenticated) {
    return null;
  }

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

        {/* Right: User & Theme Toggle */}
        <div className="flex items-center gap-4 shrink-0 animate-fade-in" style={{ animationDelay: '100ms' }}>
          {/* User info */}
          {user && (
            <div className="flex items-center gap-3">
              {user.photoUrl ? (
                <img
                  src={user.photoUrl}
                  alt={user.firstName || 'User'}
                  className="w-8 h-8 rounded-full border border-neutral-700"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-accent-500/20 flex items-center justify-center">
                  <span className="text-sm text-accent-400">
                    {(user.firstName || user.username || 'U')[0].toUpperCase()}
                  </span>
                </div>
              )}
              <div className="hidden sm:block">
                <p className="text-sm text-text-primary leading-tight">
                  {user.firstName || user.username || 'User'}
                </p>
                {user.username && (
                  <p className="text-xs text-text-tertiary">@{user.username}</p>
                )}
              </div>
              <button
                onClick={logout}
                className="text-text-tertiary hover:text-text-secondary text-xs transition-colors ml-2"
                title="Выйти"
              >
                Выйти
              </button>
            </div>
          )}

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
