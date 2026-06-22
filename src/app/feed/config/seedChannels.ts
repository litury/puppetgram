/**
 * Сид-каналы ленты (IT-ниша). MVP — руками собранный список.
 * Источник: env FEED_SEED_CHANNELS (через запятую) ИЛИ дефолтный список ниже.
 * Позже список расширяет feedCrawler (BFS по «похожим каналам» с relevance-gate).
 */

const DEFAULT_SEED = [
  // публичные IT/tech каналы-примеры (заменяются реальным списком через env)
  'durov',
  'telegram',
];

export function getSeedChannels(): string[] {
  const env = process.env.FEED_SEED_CHANNELS;
  const list = env
    ? env.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SEED;
  // нормализуем: без @, нижний регистр, уникальные
  return [...new Set(list.map((s) => s.replace('@', '').toLowerCase()))];
}
