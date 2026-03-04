/**
 * Построение промпта для vision-модели (Gemini) для медиа-постов без текста
 */

import { IPostContent } from '../../commentPoster/interfaces';

/**
 * Промпт для генерации комментариев по изображению/видео
 */
const VISION_COMMENT_PROMPT = `Ты видишь изображение из поста в Telegram-канале.

Напиши один короткий вопрос по теме изображения.

Правила:
- До 80 символов
- На языке канала (определи по названию и тексту)
- Без эмодзи, без тире
- Без формальностей (отлично, интересно, круто)
- Не описывай изображение
- НЕ пиши свои рассуждения, только вопрос
- Если изображение содержит политику, войну, религию — ответь SKIP

Ответь ТОЛЬКО вопросом.`;

/**
 * Проверяет, подходит ли пост для vision-анализа
 */
export function isVisionCandidate(_postContent: IPostContent): boolean {
    if (!_postContent.mediaBase64) return false;
    if (!_postContent.hasMedia) return false;

    const visionTypes = ['photo'];
    return visionTypes.includes(_postContent.mediaType || '');
}

/**
 * Строит multi-modal сообщения для OpenAI-совместимого API (OpenRouter/Gemini)
 */
export function buildVisionMessages(_postContent: IPostContent): Array<{
    role: string;
    content: Array<{ type: string; text?: string; image_url?: { url: string } }>;
}> {
    const textParts: string[] = [VISION_COMMENT_PROMPT];
    textParts.push(`\nКанал: @${_postContent.channelUsername} (${_postContent.channelTitle})`);

    if (_postContent.text && _postContent.text.trim().length > 0) {
        textParts.push(`Текст поста: "${_postContent.text.trim().substring(0, 200)}"`);
    }

    if (_postContent.hashtags.length > 0) {
        textParts.push(`Хештеги: ${_postContent.hashtags.join(', ')}`);
    }

    return [{
        role: 'user',
        content: [
            { type: 'text', text: textParts.join('\n') },
            {
                type: 'image_url',
                image_url: {
                    url: `data:image/jpeg;base64,${_postContent.mediaBase64}`
                }
            }
        ]
    }];
}
