/**
 * Извлечение контента поста для AI генерации
 */

import { TelegramClient } from 'telegram';
import { IPostContent } from '../../commentPoster/interfaces';

/**
 * Извлекает контент последнего поста из канала
 */
export async function extractPostContent(_client: TelegramClient, _channelUsername: string): Promise<IPostContent> {
    const messages = await _client.getMessages(_channelUsername, { limit: 1 });

    if (!messages || messages.length === 0) {
        throw new Error('Нет сообщений в канале');
    }

    const message = messages[0];

    // Определяем тип медиа
    let mediaType = 'text';
    if (message.media) {
        if ('poll' in message.media) {
            mediaType = 'poll';
        } else if ('document' in message.media && message.media.document) {
            const doc = message.media.document as any;
            if (doc.mimeType?.includes('video')) {
                mediaType = 'video';
            } else if (doc.attributes?.some((attr: any) => attr.className === 'DocumentAttributeSticker')) {
                mediaType = 'sticker';
            } else {
                mediaType = 'document';
            }
        } else if ('photo' in message.media) {
            mediaType = 'photo';
        }
    }

    return {
        id: message.id,
        text: message.text || '',
        date: message.date ? new Date(message.date * 1000) : new Date(),
        views: message.views || 0,
        forwards: 0, // Не доступно в API
        reactions: 0, // Упрощенно
        hasMedia: !!message.media,
        mediaType: mediaType as any,
        channelId: '', // Будет заполнено позже
        channelUsername: _channelUsername,
        channelTitle: '', // Будет заполнено позже
        messageLength: (message.text || '').length,
        hasLinks: /https?:\/\//.test(message.text || ''),
        hashtags: (message.text || '').match(/#\w+/g) || [],
        mentions: (message.text || '').match(/@\w+/g) || []
    };
} 