/**
 * Auth helpers (client-side).
 *
 * Дашборд — статический экспорт (output: 'export'), поэтому серверной
 * валидации нет: реальная граница безопасности живёт в ws-server (requireAuth /
 * requireAdmin на каждом /api/*). Эти хелперы нужны только для UX — спрятать
 * админ-секции и показать имя пользователя.
 */

export interface AuthUser {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
}

/**
 * Список Telegram ID админов. Берётся из NEXT_PUBLIC_ADMIN_TELEGRAM_IDS
 * (запятая-разделённый список, вшивается на этапе сборки), с фолбэком на
 * известного владельца (@pravku, Юрий).
 */
const ADMIN_TELEGRAM_IDS: number[] = (
  process.env.NEXT_PUBLIC_ADMIN_TELEGRAM_IDS || '703552444'
)
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));

export function isAdmin(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return ADMIN_TELEGRAM_IDS.includes(user.telegramId);
}

/** Прочитать сохранённого пользователя из localStorage (выставляет login-flow). */
export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('user');
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}
