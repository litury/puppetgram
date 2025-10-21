import { Api } from 'telegram';

/**
 * Вспомогательные функции для работы с комментариями каналов
 */

/**
 * Проверяет является ли канал каналом (а не группой)
 */
export function isChannel(chat: any): boolean {
    return chat && chat.className === 'Channel' && chat.broadcast === true;
}

/**
 * Проверяет есть ли у канала связанная дискуссионная группа
 * ОБНОВЛЕНО: использует linkedChatId из GetFullChannel
 */
export function hasLinkedDiscussion(channel: any): boolean {
    return !!(channel && channel.linkedChatId);
}

/**
 * Определяет политику комментариев с учетом требований членства
 * ОБНОВЛЕНО: учитывает join_to_send и join_request флаги
 */
export function determineCommentsPolicy(channel: any): 'enabled' | 'disabled' | 'restricted' | 'members_only' | 'approval_required' | 'unknown' {
    if (!channel) return 'unknown';

    // 🎯 ГЛАВНАЯ ПРОВЕРКА: есть ли linkedChatId из GetFullChannel
    if (!channel.linkedChatId) {
        return 'disabled';
    }

    // Комментарии технически включены, но проверяем ограничения доступа

    // Если требуется одобрение администрации для вступления
    if (channel.joinRequest) {
        return 'approval_required';
    }

    // Если нужно вступить в канал чтобы отправлять сообщения (и комментарии)
    if (channel.joinToSend) {
        return 'members_only';
    }

    // Проверяем права на отправку сообщений для обычных пользователей
    if (channel.defaultBannedRights) {
        const rights = channel.defaultBannedRights;

        // Если запрещено отправлять сообщения (но есть linkedChatId)
        if (rights.sendMessages) {
            return 'restricted';
        }

        // Если есть частичные ограничения
        if (rights.sendMedia || rights.sendStickers || rights.sendGifs) {
            return 'restricted';
        }
    }

    // Комментарии полностью доступны
    return 'enabled';
}

/**
 * Определяет требования доступа к комментариям
 */
export function getAccessRequirements(channel: any): {
    joinToSend: boolean;
    joinRequest: boolean;
    membershipRequired: boolean;
} {
    const joinToSend = !!channel.joinToSend;
    const joinRequest = !!channel.joinRequest;
    const membershipRequired = joinToSend || joinRequest;

    return {
        joinToSend,
        joinRequest,
        membershipRequired
    };
}

/**
 * Генерирует URL для канала
 */
export function generateChannelUrl(username?: string): string | undefined {
    if (!username) return undefined;
    return `https://t.me/${username}`;
}

/**
 * Форматирует статус комментариев для отображения с новыми статусами
 */
export function formatCommentsStatus(policy: string): string {
    const statusEmojis = {
        enabled: '✅ Доступны всем',
        disabled: '❌ Отключены',
        restricted: '⚠️ Ограничены',
        members_only: '👥 Только участникам',
        approval_required: '🔒 Требует одобрения',
        unknown: '❓ Неизвестно'
    };

    return statusEmojis[policy as keyof typeof statusEmojis] || '❓ Неизвестно';
}

/**
 * Генерирует рекомендации с учетом новых ограничений
 */
export function generateRecommendations(channelInfo: any): string[] {
    const recommendations: string[] = [];
    const policy = determineCommentsPolicy(channelInfo);
    const accessReqs = getAccessRequirements(channelInfo);

    switch (policy) {
        case 'disabled':
            recommendations.push('💡 Рассмотрите возможность создания дискуссионной группы для комментариев');
            recommendations.push('📢 Это увеличит вовлеченность аудитории');
            break;

        case 'enabled':
            recommendations.push('✅ Комментарии полностью доступны - отлично для взаимодействия');
            if (channelInfo.participantsCount > 1000) {
                recommendations.push('🎯 Рассмотрите модерацию для больших каналов');
            }
            break;

        case 'members_only':
            recommendations.push('👥 Комментарии только для участников - хорошо для эксклюзивности');
            recommendations.push('⚖️ Учтите, что это может снизить общую активность');
            break;

        case 'approval_required':
            recommendations.push('🔒 Требуется одобрение - максимальный контроль качества аудитории');
            recommendations.push('⏰ Готовьтесь к дополнительной работе по модерации заявок');
            break;

        case 'restricted':
            recommendations.push('⚠️ Частичные ограничения могут снизить активность комментариев');
            recommendations.push('🔧 Рассмотрите оптимизацию настроек прав');
            break;

        case 'unknown':
            recommendations.push('❓ Невозможно определить настройки комментариев');
            recommendations.push('🔍 Рекомендуется ручная проверка настроек канала');
            break;
    }

    // Дополнительные рекомендации
    if (accessReqs.membershipRequired) {
        recommendations.push('🔗 Рекомендуется добавить ссылку на дискуссионную группу в описание канала');
    }

    return recommendations;
}

/**
 * Создает задержку для избежания rate limiting
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Очищает имя канала от лишних символов
 */
export function cleanChannelName(channelName: string): string {
    return channelName.replace(/^@/, '').trim();
}

/**
 * Проверяет валидность имени канала
 */
export function isValidChannelName(channelName: string): boolean {
    const cleaned = cleanChannelName(channelName);
    // Базовая валидация: только буквы, цифры и подчеркивания, длина от 5 до 32 символов
    return /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(cleaned);
}

/**
 * Парсинг различных форматов каналов из файла
 */
export function parseChannelFromLine(line: string): string | null {
    const trimmed = line.trim();

    // Пропускаем пустые строки и комментарии
    if (!trimmed || trimmed.startsWith('#')) {
        return null;
    }

    // Формат: https://t.me/channel_name
    const telegramLinkMatch = trimmed.match(/^https?:\/\/t\.me\/([a-zA-Z][a-zA-Z0-9_]{4,31})$/);
    if (telegramLinkMatch) {
        return telegramLinkMatch[1];
    }

    // Формат: @channel_name
    const atMatch = trimmed.match(/^@([a-zA-Z][a-zA-Z0-9_]{4,31})$/);
    if (atMatch) {
        return atMatch[1];
    }

    // Формат: channel_name (простое имя)
    const simpleMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9_]{4,31})$/);
    if (simpleMatch) {
        return simpleMatch[1];
    }

    // Если ничего не подошло
    return null;
}

/**
 * Чтение и парсинг файла с каналами
 */
export function parseChannelsFromFile(content: string): string[] {
    return content
        .split('\n')
        .map(parseChannelFromLine)
        .filter((channel): channel is string => channel !== null);
}

/**
 * Извлекает информацию о связанной дискуссионной группе
 */
export function extractLinkedDiscussionInfo(linkedChat: any): { id: string; title: string; username?: string; url?: string } | undefined {
    if (!linkedChat) return undefined;

    const info = {
        id: linkedChat.id?.toString() || '',
        title: linkedChat.title || 'Неизвестная группа',
        username: linkedChat.username
    };

    return {
        ...info,
        url: info.username ? `https://t.me/${info.username}` : undefined
    };
} 