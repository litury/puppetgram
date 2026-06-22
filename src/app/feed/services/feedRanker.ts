/**
 * feedRanker — скоринг поста (стадия ranking). Чистая функция, ранкер сменный.
 *
 * Принципы (см. план): только ОТНОСИТЕЛЬНЫЕ метрики (engagement/views + overperformance vs
 * baseline канала) — размер канала НЕ участвует, чтобы миллионники-помойки не доминировали.
 * Веса в пропорциях X-heavy-ranker (reply ≫ forward > reaction). Свежесть — экспоненциальный
 * time-decay (период полураспада часы–день под IT-новости).
 */

export interface RankInput {
  views?: number | null;
  forwards?: number | null;
  repliesCount?: number | null;
  totalReactions?: number | null;
  postedAt?: Date | null;
  baselineViews?: number | null; // медиана просмотров канала (overperformance)
}

// Пропорции весов из X heavy ranker (reply 13.5, retweet 1.0, fav 0.5).
export const WEIGHTS = {
  reply: 13.5,
  forward: 1.0,
  reaction: 0.5,
  overperformance: 8.0, // вклад «выстрелил относительно своей нормы»
};

// Период полураспада свежести (часы). IT/новости протухают быстро.
export const HALF_LIFE_HOURS = 12;

/** Экспоненциальный decay свежести: 1.0 на свежем, 0.5 через HALF_LIFE_HOURS, и т.д. */
export function freshnessDecay(postedAt?: Date | null, now: number = Date.now()): number {
  if (!postedAt) return 0.5;
  const ageHours = Math.max(0, (now - postedAt.getTime()) / 3_600_000);
  return Math.exp((-Math.LN2 * ageHours) / HALF_LIFE_HOURS);
}

/**
 * Посчитать score. Относительное качество × свежесть.
 * Если views нет/ноль — engagement-составляющие 0 (защита от деления на ноль).
 */
export function scorePost(input: RankInput, now: number = Date.now()): number {
  const views = input.views && input.views > 0 ? input.views : 0;
  const er = views
    ? (WEIGHTS.reply * (input.repliesCount || 0) +
        WEIGHTS.forward * (input.forwards || 0) +
        WEIGHTS.reaction * (input.totalReactions || 0)) /
      views
    : 0;

  let over = 0;
  if (input.baselineViews && input.baselineViews > 0 && views) {
    // Отношение к медиане канала, мягко ограничиваем сверху (логарифм гасит выбросы).
    over = WEIGHTS.overperformance * Math.log1p(views / input.baselineViews);
  }

  const quality = er + over;
  return quality * freshnessDecay(input.postedAt, now);
}
