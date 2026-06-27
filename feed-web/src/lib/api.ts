import { env } from '$env/dynamic/public';
import type { FeedPost } from './types';

/** Базовый URL ws-server (Bun+Elysia API). Переопределяется PUBLIC_WS_SERVER_URL. */
export const WS_SERVER_URL = env.PUBLIC_WS_SERVER_URL || 'http://localhost:4000';

type Fetch = typeof globalThis.fetch;

/** Ранжированная лента. fetchFn пробрасываем из load (SSR-совместимо). */
export async function fetchFeed(
  opts: { limit?: number; offset?: number; latest?: boolean; career?: boolean } = {},
  fetchFn: Fetch = fetch
): Promise<FeedPost[]> {
  const { limit = 50, offset = 0, latest = false, career = false } = opts;
  const path = career ? '/api/feed/career' : latest ? '/api/feed/latest' : '/api/feed';
  const url = `${WS_SERVER_URL}${path}?limit=${limit}&offset=${offset}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`feed fetch failed: ${res.status}`);
  const data = await res.json();
  return data.posts ?? [];
}

export async function fetchChannelPosts(username: string, fetchFn: Fetch = fetch): Promise<FeedPost[]> {
  const res = await fetchFn(`${WS_SERVER_URL}/api/feed/channel/${encodeURIComponent(username)}`);
  if (!res.ok) throw new Error(`channel fetch failed: ${res.status}`);
  const data = await res.json();
  return data.posts ?? [];
}
