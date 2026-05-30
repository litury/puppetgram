'use client';

import { type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';

/**
 * Клиентский guard для дашборда (статический экспорт → middleware недоступен).
 * Пока проверяется сессия — скелетон; нет сессии — useAuth сам редиректит на /login.
 * Реальная защита данных — в ws-server (requireAuth на /api/*).
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth(true);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500/20 border-t-accent-500" />
      </div>
    );
  }

  // useAuth(true) уже инициировал redirect на /login — ничего не рендерим
  if (!isAuthenticated) return null;

  return <>{children}</>;
}
