import { fetchFeed } from '$lib/api';
import type { PageLoad } from './$types';

/** SSR-загрузка первой страницы ленты (быстрый первый экран + индексация). */
export const load: PageLoad = async ({ fetch }) => {
  try {
    // Временно: первый экран = свежесть (latest), как и вкладка «Сигнал». Вернём score-ранг позже.
    const posts = await fetchFeed({ limit: 50, offset: 0, latest: true }, fetch);
    return { posts, error: null };
  } catch (e) {
    return { posts: [], error: (e as Error).message };
  }
};
