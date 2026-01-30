'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/config';

interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
}

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: User | null;
}

/**
 * Hook для проверки авторизации
 * Проверяет сессию на сервере и редиректит на /login если не авторизован
 */
export function useAuth(redirectToLogin = true): AuthState & { logout: () => Promise<void> } {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    user: null,
  });

  useEffect(() => {
    async function checkAuth() {
      try {
        // Получаем sessionId из localStorage
        const sessionId = localStorage.getItem('sessionId');

        if (!sessionId) {
          setState({ isLoading: false, isAuthenticated: false, user: null });
          if (redirectToLogin) {
            router.replace('/login');
          }
          return;
        }

        // Проверяем сессию на сервере
        const response = await fetch(`${API_URL}/auth/session`, {
          headers: {
            'X-Session-Id': sessionId,
          },
        });

        const data = await response.json();

        if (data.authenticated && data.user) {
          setState({
            isLoading: false,
            isAuthenticated: true,
            user: data.user,
          });
        } else {
          // Сессия невалидна — очищаем
          localStorage.removeItem('sessionId');
          localStorage.removeItem('user');
          setState({ isLoading: false, isAuthenticated: false, user: null });
          if (redirectToLogin) {
            router.replace('/login');
          }
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        setState({ isLoading: false, isAuthenticated: false, user: null });
        if (redirectToLogin) {
          router.replace('/login');
        }
      }
    }

    checkAuth();
  }, [router, redirectToLogin]);

  const logout = useCallback(async () => {
    try {
      const sessionId = localStorage.getItem('sessionId');
      if (sessionId) {
        await fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            'X-Session-Id': sessionId,
          },
        });
      }
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      localStorage.removeItem('sessionId');
      localStorage.removeItem('user');
      document.cookie = 'session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      router.replace('/login');
    }
  }, [router]);

  return { ...state, logout };
}
