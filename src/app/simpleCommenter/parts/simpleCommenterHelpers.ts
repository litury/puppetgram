/**
 * Вспомогательные функции для простого комментирования
 */

/**
 * Очистка username от лишних символов
 */
export function cleanUsername(_input: string): string {
    const trimmed = _input.trim();

    // Убираем https://t.me/
    const telegramLinkMatch = trimmed.match(/^https?:\/\/t\.me\/([a-zA-Z][a-zA-Z0-9_]{4,31})$/);
    if (telegramLinkMatch) {
        return telegramLinkMatch[1];
    }

    // Убираем @
    const atMatch = trimmed.match(/^@([a-zA-Z][a-zA-Z0-9_]{4,31})$/);
    if (atMatch) {
        return atMatch[1];
    }

    // Проверяем что это валидный username
    const simpleMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9_]{4,31})$/);
    if (simpleMatch) {
        return simpleMatch[1];
    }

    throw new Error(`Неверный формат username: ${_input}`);
}

/**
 * Генерация ID сессии
 */
export function generateSessionId(): string {
    return `simple_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Асинхронная задержка
 */
export async function delayAsync(_ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, _ms));
} 