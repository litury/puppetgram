/**
 * Вспомогательные функции для модуля автоматического комментирования
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import * as fs from 'fs';
import { ICommentTarget, ICommentMessage, ICommentTargetWithCache, IPostContent } from '../interfaces';

/**
 * Парсинг файла с целевыми каналами для комментирования
 * Поддерживает различные форматы: @username, https://t.me/username, username
 */
export function parseTargetsFromFile(_fileContent: string): ICommentTarget[] {
    const targets: ICommentTarget[] = [];
    const lines = _fileContent.split('\n');

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Пропускаем пустые строки и комментарии
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            continue;
        }

        const target = parseTargetFromLine(trimmedLine);
        if (target) {
            targets.push(target);
        }
    }

    return targets;
}

/**
 * Парсинг одной строки для извлечения информации о канале
 */
export function parseTargetFromLine(_line: string): ICommentTarget | null {
    const line = _line.trim();

    // Формат: https://t.me/username
    const telegramLinkMatch = line.match(/^https?:\/\/t\.me\/([a-zA-Z][a-zA-Z0-9_]{4,31})$/);
    if (telegramLinkMatch) {
        const username = telegramLinkMatch[1];
        return {
            channelUsername: username,
            channelUrl: `https://t.me/${username}`,
            isActive: true
        };
    }

    // Формат: @username
    const atMatch = line.match(/^@([a-zA-Z][a-zA-Z0-9_]{4,31})$/);
    if (atMatch) {
        const username = atMatch[1];
        return {
            channelUsername: username,
            channelUrl: `https://t.me/${username}`,
            isActive: true
        };
    }

    // Формат: username (простое имя)
    const simpleMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_]{4,31})$/);
    if (simpleMatch) {
        const username = simpleMatch[1];
        return {
            channelUsername: username,
            channelUrl: `https://t.me/${username}`,
            isActive: true
        };
    }

    return null;
}

/**
 * Генерация уникального ID сессии
 */
export function generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Случайный выбор комментария с учетом весов
 */
export function selectRandomComment(_messages: ICommentMessage[]): ICommentMessage {
    if (_messages.length === 0) {
        throw new Error('Список комментариев пуст');
    }

    // Если только одно сообщение, возвращаем его
    if (_messages.length === 1) {
        return _messages[0];
    }

    // Создаем взвешенный список
    const weightedMessages: ICommentMessage[] = [];
    _messages.forEach(msg => {
        for (let i = 0; i < msg.weight; i++) {
            weightedMessages.push(msg);
        }
    });

    // Выбираем случайный элемент
    const randomIndex = Math.floor(Math.random() * weightedMessages.length);
    return weightedMessages[randomIndex];
}

/**
 * Создание случайной задержки в заданном диапазоне
 */
export function generateRandomDelay(_minMs: number, _maxMs: number): number {
    return Math.floor(Math.random() * (_maxMs - _minMs + 1)) + _minMs;
}

/**
 * Создание задержки (Promise)
 */
export async function delayAsync(_milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, _milliseconds));
}

/**
 * Валидация имени канала
 */
export function isValidChannelUsername(_username: string): boolean {
    // Базовая валидация: только буквы, цифры и подчеркивания, длина от 5 до 32 символов
    return /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(_username);
}

/**
 * Очистка имени канала от лишних символов
 */
export function cleanChannelUsername(_input: string): string {
    return _input.replace(/[@\s]/g, '').toLowerCase();
}

/**
 * Сообщения по умолчанию для комментирования
 */
export function getDefaultCommentMessages(): ICommentMessage[] {
    return [
        {
            text: "Отличный пост! 👍",
            weight: 8,
            category: 'appreciation'
        },
        {
            text: "Очень интересно, спасибо за информацию! 🔥",
            weight: 7,
            category: 'appreciation'
        },
        {
            text: "Полезная статья! 📚",
            weight: 6,
            category: 'appreciation'
        },
        {
            text: "Качественный контент! ✨",
            weight: 5,
            category: 'appreciation'
        },
        {
            text: "Супер! Очень актуально 🎯",
            weight: 4,
            category: 'general'
        },
        {
            text: "Спасибо за шейр! 🙌",
            weight: 3,
            category: 'appreciation'
        },
        {
            text: "Хорошая подача материала! 👌",
            weight: 2,
            category: 'appreciation'
        },
        {
            text: "А есть ли еще материалы по этой теме? 🤔",
            weight: 1,
            category: 'question'
        }
    ];
}

/**
 * Чтение и парсинг файла с целями
 */
export function loadTargetsFromFile(_filePath: string): ICommentTarget[] {
    try {
        if (!fs.existsSync(_filePath)) {
            throw new Error(`Файл не найден: ${_filePath}`);
        }

        const fileContent = fs.readFileSync(_filePath, 'utf-8');
        return parseTargetsFromFile(fileContent);
    } catch (error) {
        throw new Error(`Ошибка при чтении файла ${_filePath}: ${error}`);
    }
}

/**
 * Сканирование папки с входными файлами
 */
export function scanTargetFiles(_directoryPath: string): string[] {
    try {
        if (!fs.existsSync(_directoryPath)) {
            return [];
        }

        return fs.readdirSync(_directoryPath)
            .filter(file => file.endsWith('.txt') && !file.startsWith('.'))
            .map(file => `${_directoryPath}/${file}`)
            .filter(filePath => fs.statSync(filePath).isFile());
    } catch (error) {
        console.warn(`Предупреждение: не удалось сканировать папку ${_directoryPath}:`, error);
        return [];
    }
}

/**
 * Подсчет статистики ошибок
 */
export function calculateErrorStats(_errors: string[]): { [errorType: string]: number } {
    const stats: { [errorType: string]: number } = {};

    _errors.forEach(error => {
        // Извлекаем тип ошибки из сообщения
        const errorType = extractErrorType(error);
        stats[errorType] = (stats[errorType] || 0) + 1;
    });

    return stats;
}

/**
 * Категоризация ошибок для статистики
 */
function categorizeError(_error: string): string {
    const lowerError = _error.toLowerCase();

    if (lowerError.includes('flood')) return 'FLOOD_WAIT';
    if (lowerError.includes('banned') || lowerError.includes('restricted')) return 'BANNED';
    if (lowerError.includes('not found') || lowerError.includes('username')) return 'CHANNEL_NOT_FOUND';
    if (lowerError.includes('permission') || lowerError.includes('forbidden')) return 'PERMISSION_DENIED';
    if (lowerError.includes('private') || lowerError.includes('join')) return 'PRIVATE_CHANNEL';
    if (lowerError.includes('timeout') || lowerError.includes('network')) return 'NETWORK_ERROR';
    if (lowerError.includes('comment') || lowerError.includes('discussion')) return 'COMMENTS_DISABLED';

    return 'OTHER';
}

/**
 * Форматирование длительности в читаемый формат
 */
export function formatDuration(_durationMs: number): string {
    const seconds = Math.floor(_durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}ч ${minutes % 60}м ${seconds % 60}с`;
    } else if (minutes > 0) {
        return `${minutes}м ${seconds % 60}с`;
    } else {
        return `${seconds}с`;
    }
}

/**
 * Создание резервной копии файла с результатами
 */
export function createBackup(_originalPath: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = _originalPath.replace(/\.([^.]+)$/, `_backup_${timestamp}.$1`);

    try {
        if (fs.existsSync(_originalPath)) {
            fs.copyFileSync(_originalPath, backupPath);
        }
        return backupPath;
    } catch (error) {
        console.warn('Предупреждение: не удалось создать резервную копию:', error);
        return _originalPath;
    }
}

/**
 * Проверяет, является ли канал активным
 */
export function isChannelActive(_target: ICommentTarget | ICommentTargetWithCache): boolean {
    return _target.isActive;
}

/**
 * Конвертирует обычную цель в цель с кэшем (если возможно)
 */
export function convertToTargetWithCache(_target: ICommentTarget, _channelId?: string, _accessHash?: string): ICommentTargetWithCache | null {
    if (!_channelId || !_accessHash) {
        return null;
    }

    return {
        channelId: _channelId,
        accessHash: _accessHash,
        channelUsername: _target.channelUsername,
        channelTitle: _target.channelTitle || _target.channelUsername,
        commentsEnabled: true, // Предполагаем, что включены
        commentsPolicy: 'enabled',
        canPostComments: true,
        canReadComments: true,
        targetPostId: _target.targetPostId,
        isActive: _target.isActive
    };
}

// === НОВЫЕ ФУНКЦИИ ДЛЯ РАБОТЫ С КОНТЕНТОМ ПОСТОВ ===

/**
 * Извлекает контент поста из Telegram сообщения
 */
export function extractPostContent(_message: any, _channelId: string, _channelUsername: string, _channelTitle: string): IPostContent {
    const text = _message.message || '';
    const hasMedia = _message.media && _message.media.className !== 'MessageMediaEmpty';

    return {
        id: _message.id,
        text: text,
        date: new Date(_message.date * 1000),
        views: _message.views || 0,
        forwards: _message.forwards || 0,
        reactions: extractReactionsCount(_message),
        hasMedia: hasMedia,
        mediaType: hasMedia ? getMediaType(_message.media) : undefined,
        channelId: _channelId,
        channelUsername: _channelUsername,
        channelTitle: _channelTitle,
        messageLength: text.length,
        hasLinks: containsLinks(text),
        hashtags: extractHashtags(text),
        mentions: extractMentions(text)
    };
}

/**
 * Извлекает количество реакций из сообщения
 */
export function extractReactionsCount(_message: any): number {
    if (!_message.reactions || !_message.reactions.results) return 0;

    return _message.reactions.results.reduce((total: number, reaction: any) => {
        return total + (reaction.count || 0);
    }, 0);
}

/**
 * Определяет тип медиа контента
 */
export function getMediaType(_media: any): IPostContent['mediaType'] {
    if (!_media) return undefined;

    const mediaClass = _media.className;
    switch (mediaClass) {
        case 'MessageMediaPhoto': return 'photo';
        case 'MessageMediaDocument':
            // Дополнительная проверка для документов
            if (_media.document?.mimeType?.startsWith('video/')) return 'video';
            if (_media.document?.mimeType?.startsWith('audio/')) return 'audio';
            return 'document';
        case 'MessageMediaVideo': return 'video';
        case 'MessageMediaAudio': return 'audio';
        case 'MessageMediaContact': return 'contact';
        case 'MessageMediaGeo':
        case 'MessageMediaGeoLive':
        case 'MessageMediaVenue': return 'location';
        case 'MessageMediaPoll': return 'poll';
        default: return 'document';
    }
}

/**
 * Проверяет наличие ссылок в тексте
 */
export function containsLinks(_text: string): boolean {
    const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(@[a-zA-Z0-9_]+)|(t\.me\/[^\s]+)/g;
    return urlRegex.test(_text);
}

/**
 * Извлекает хэштеги из текста
 */
export function extractHashtags(_text: string): string[] {
    const hashtagRegex = /#[a-zA-Zа-яА-Я0-9_]+/g;
    const matches = _text.match(hashtagRegex);
    return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

/**
 * Извлекает упоминания из текста
 */
export function extractMentions(_text: string): string[] {
    const mentionRegex = /@[a-zA-Z0-9_]+/g;
    const matches = _text.match(mentionRegex);
    return matches ? matches.map(mention => mention.toLowerCase()) : [];
}

/**
 * Вычисляет статистику контента для массива постов
 */
export function calculateContentStats(_posts: IPostContent[]): {
    totalPosts: number;
    postsWithText: number;
    postsWithMedia: number;
    averageViews: number;
    averageForwards: number;
    averageReactions: number;
    topHashtags: string[];
    mediaTypeDistribution: { [mediaType: string]: number };
} {
    if (_posts.length === 0) {
        return {
            totalPosts: 0,
            postsWithText: 0,
            postsWithMedia: 0,
            averageViews: 0,
            averageForwards: 0,
            averageReactions: 0,
            topHashtags: [],
            mediaTypeDistribution: {}
        };
    }

    const postsWithText = _posts.filter(p => p.text.trim().length > 0).length;
    const postsWithMedia = _posts.filter(p => p.hasMedia).length;

    const totalViews = _posts.reduce((sum, p) => sum + p.views, 0);
    const totalForwards = _posts.reduce((sum, p) => sum + p.forwards, 0);
    const totalReactions = _posts.reduce((sum, p) => sum + p.reactions, 0);

    // Собираем все хэштеги
    const allHashtags: string[] = [];
    _posts.forEach(p => allHashtags.push(...p.hashtags));

    // Подсчитываем частоту хэштегов
    const hashtagCounts: { [hashtag: string]: number } = {};
    allHashtags.forEach(tag => {
        hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
    });

    // Топ хэштеги
    const topHashtags = Object.entries(hashtagCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([tag]) => tag);

    // Распределение типов медиа
    const mediaTypeDistribution: { [mediaType: string]: number } = {};
    _posts.forEach(p => {
        if (p.hasMedia && p.mediaType) {
            mediaTypeDistribution[p.mediaType] = (mediaTypeDistribution[p.mediaType] || 0) + 1;
        }
    });

    return {
        totalPosts: _posts.length,
        postsWithText,
        postsWithMedia,
        averageViews: Math.round(totalViews / _posts.length),
        averageForwards: Math.round(totalForwards / _posts.length),
        averageReactions: Math.round(totalReactions / _posts.length),
        topHashtags,
        mediaTypeDistribution
    };
}

/**
 * Форматирует контент поста для отображения
 */
export function formatPostContent(_post: IPostContent): string {
    const preview = _post.text.length > 100 ?
        _post.text.substring(0, 100) + '...' :
        _post.text;

    return `📄 Пост #${_post.id} от ${_post.date.toLocaleString('ru-RU')}
📺 Канал: ${_post.channelTitle} (@${_post.channelUsername})
📝 Текст: "${preview}"
📊 Метрики: ${_post.views} просмотров, ${_post.forwards} пересылок, ${_post.reactions} реакций
🎬 Медиа: ${_post.hasMedia ? `Да (${_post.mediaType})` : 'Нет'}
🏷️ Хэштеги: ${_post.hashtags.join(', ') || 'Нет'}
👥 Упоминания: ${_post.mentions.join(', ') || 'Нет'}`;
}

/**
 * Извлекает тип ошибки из сообщения об ошибке
 */
function extractErrorType(_errorMessage: string): string {
    if (_errorMessage.includes('FLOOD_WAIT')) return 'FLOOD_WAIT';
    if (_errorMessage.includes('CHAT_WRITE_FORBIDDEN')) return 'CHAT_WRITE_FORBIDDEN';
    if (_errorMessage.includes('USER_BANNED_IN_CHANNEL')) return 'USER_BANNED_IN_CHANNEL';
    if (_errorMessage.includes('CHAT_GUEST_SEND_FORBIDDEN')) return 'CHAT_GUEST_SEND_FORBIDDEN';
    if (_errorMessage.includes('CHANNEL_PRIVATE')) return 'CHANNEL_PRIVATE';
    if (_errorMessage.includes('USERNAME_NOT_OCCUPIED')) return 'USERNAME_NOT_OCCUPIED';
    if (_errorMessage.includes('MSG_ID_INVALID')) return 'MSG_ID_INVALID';
    if (_errorMessage.includes('недоступны')) return 'COMMENTS_DISABLED';
    if (_errorMessage.includes('Нет сообщений')) return 'NO_MESSAGES';
    return 'OTHER';
} 