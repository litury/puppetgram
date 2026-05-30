import { API_URL } from '@/lib/config';

/**
 * Обёртка над fetch для вызовов ws-server API.
 *
 * Добавляет заголовок `X-Session-Id` из localStorage. Это обязательно:
 * фронт (порт 3000/3001) и ws-server (4000) — разные origin, поэтому cookie
 * `session` cross-origin не отправляется, и сервер опознаёт сессию только по
 * заголовку. Сервер защищает /api/* через requireAuth.
 *
 * `path` — относительный путь от API_URL, напр. '/api/daily'.
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const sessionId =
    typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;

  const headers = new Headers(init.headers);
  if (sessionId) headers.set('X-Session-Id', sessionId);

  return fetch(`${API_URL}${path}`, { ...init, headers });
}
