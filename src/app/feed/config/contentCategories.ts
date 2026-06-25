/**
 * Причины-ярлыки классификации (reason). Позитивное определение: IT vs не-IT.
 * IT-ярлыки = показываем в ленте; не-IT = отсеиваем (видны только в аналитике).
 * Фильтр ленты выводится из reason (без отдельной колонки is_it).
 */

// Причины НЕ-IT (всё прочее считается IT). 'media' — пост без текста (не классифицируем).
export const NON_IT_REASONS = ['politics', 'news', 'ads', 'spam', 'offtopic', 'other', 'media'] as const;

/** IT-релевантен ли пост по его reason-ярлыку (показывать ли в ленте). */
export function isItReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return !(NON_IT_REASONS as readonly string[]).includes(reason);
}
