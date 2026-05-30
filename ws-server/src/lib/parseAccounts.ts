/**
 * Парсинг имён аккаунтов-марионеток из env-переменных.
 *
 * Бот хранит аккаунты как `USERNAME_N` (а также варианты `USERNAME_PROFILE_N`,
 * `USERNAME_PARSER_N`, `USERNAME_USA_N`). Имя аккаунта = username без `@`
 * (так же, как в comments.account_name).
 *
 * Это лишь один из источников ростера для /api/accounts — ws-server в проде
 * может не иметь этих переменных (они на боте). Поэтому endpoint объединяет
 * env-имена с данными из БД (недавние авторы, активные баны, flood_wait).
 */
export function parseAccountUsernames(env: NodeJS.ProcessEnv = process.env): string[] {
  const names = new Set<string>();

  for (const [key, rawValue] of Object.entries(env)) {
    if (!/^USERNAME(_|$)/i.test(key)) continue;
    if (!rawValue) continue;

    const cleaned = rawValue
      .trim()
      .replace(/^["']|["']$/g, '') // снять кавычки если есть
      .replace(/^@/, '') // снять @
      .trim();

    if (cleaned) names.add(cleaned);
  }

  return [...names];
}
