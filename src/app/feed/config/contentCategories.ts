/**
 * Таксономия контента ленты — фикс-список категорий для авто-классификации.
 * IT-категории = показываем в ленте; не-IT = отсеиваем (видны только в аналитике).
 */

export const IT_CATEGORIES = [
  'dev',         // разработка/программирование
  'ai_ml',       // ИИ/ML/data science
  'devops',      // инфра/облака/SRE
  'security',    // ИБ/безопасность
  'data',        // БД/аналитика данных
  'hardware',    // железо/гаджеты/электроника
  'startup_biz', // IT-стартапы/продукты/бизнес в IT
  'design',      // UI/UX/продуктовый дизайн
  'career',      // карьера/вакансии в IT
  'science',     // наука/технологии
] as const;

export const NON_IT_CATEGORIES = [
  'politics',  // политика
  'news',      // общие новости (не IT)
  'ads',       // реклама/проданные посты
  'spam',      // спам/мусор
  'offtopic',  // прочее не по теме (лайфстайл, мемы не про IT и т.п.)
  'media',     // пост без текста (только медиа) — не классифицируем по тексту
] as const;

export const ALL_CATEGORIES: readonly string[] = [...IT_CATEGORIES, ...NON_IT_CATEGORIES];

export type ContentCategory = (typeof IT_CATEGORIES)[number] | (typeof NON_IT_CATEGORIES)[number];

/** IT-релевантна ли категория (показывать ли в ленте). */
export function isItCategory(category: string): boolean {
  return (IT_CATEGORIES as readonly string[]).includes(category);
}
