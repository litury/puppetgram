/**
 * Модуль для построения промптов AI генерации осмысленных комментариев
 * Создает короткие релевантные комментарии до 100 символов
 */

import { IPostContent } from '../../commentPoster/interfaces';
import { IPostSuitabilityCheck } from '../interfaces';

/**
 * Санитизирует текст для безопасной передачи в JSON/API
 * Удаляет некорректные escape-последовательности и control characters
 */
function sanitizeTextForApi(_text: string): string {
    return _text
        // Удаляем некорректные hex escape (\x без 2 hex цифр)
        .replace(/\\x(?![0-9a-fA-F]{2})/g, '')
        // Удаляем некорректные unicode escape (\u без 4 hex цифр)
        .replace(/\\u(?![0-9a-fA-F]{4})/g, '')
        // Удаляем control characters (кроме \n, \r, \t)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        // Заменяем null bytes
        .replace(/\0/g, '');
}

/**
 * Промпт для генерации осмысленных коротких комментариев
 */
const SMART_COMMENT_PROMPT = ` Ты Фронтенд разработчик в чате! Напиши короткий комментарий к посту (до 80 символов).

Правила:
- Если пост на русском — на русском. Иначе — на английском.
- Без эмодзи, без тире! 
- Без формальностей и кацеляризмов!
- Если не по теме фронтенд то задай общий вопрос!

- Не пересказывай пост
- Не выдумывай проблемы 
- Не используй: отлично, интересно, полезно, прозрачность, практика

Если пост про политику, войну или религию — ответь: SKIP`;

/**
 * Проверяет, подходит ли пост для комментирования
 */
export function shouldCommentOnPost(_postContent: IPostContent): IPostSuitabilityCheck {
    // Пропускаем посты только с медиа без текста
    if (!_postContent.text || _postContent.text.trim().length < 10) {
        return {
            shouldComment: false,
            reason: 'Пост содержит только медиа без текста'
        };
    }

    // Пропускаем опросы
    if (_postContent.mediaType === 'poll') {
        return {
            shouldComment: false,
            reason: 'Пост является опросом'
        };
    }

    // Пропускаем посты со стикерами
    if (_postContent.mediaType === 'sticker') {
        return {
            shouldComment: false,
            reason: 'Пост содержит только стикер'
        };
    }

    // Пропускаем слишком короткие посты
    if (_postContent.text.trim().length < 20) {
        return {
            shouldComment: false,
            reason: 'Пост слишком короткий для осмысленного комментария'
        };
    }

    return { shouldComment: true };
}

/**
 * Строит промпт для AI генерации осмысленного комментария
 */
export function buildBusinessPrompt(_postContent: IPostContent): string {
    const parts: string[] = [];

    // Добавляем базовый промпт
    parts.push(SMART_COMMENT_PROMPT);

    // Добавляем контекст канала
    parts.push(`\n--- КОНТЕКСТ ---`);
    parts.push(`Канал: @${_postContent.channelUsername}`);

    // Добавляем текст поста для анализа
    parts.push(`\n--- ПОСТ ---`);
    // Ограничиваем длину поста для промпта и санитизируем
    const rawText = _postContent.text.length > 500
        ? _postContent.text.substring(0, 500) + '...'
        : _postContent.text;
    const postText = sanitizeTextForApi(rawText);
    parts.push(`"${postText}"`);

    // Добавляем дополнительную информацию если есть
    if (_postContent.hasMedia) {
        parts.push(`\nПост содержит медиа: ${_postContent.mediaType}`);
    }

    if (_postContent.hashtags && _postContent.hashtags.length > 0) {
        parts.push(`\nХештеги: ${_postContent.hashtags.join(', ')}`);
    }

    // Добавляем финальную инструкцию
    parts.push('\n--- ЗАДАЧА ---');
    parts.push('Напиши ТОЛЬКО осмысленный комментарий. Если пост на русском — на русском, иначе — на английском. До 80 символов.');

    return parts.join('\n');
}
