/**
 * Вспомогательные функции для модуля передачи владения каналами
 * Содержит утилиты для работы с идентификаторами и валидации
 */

import { TelegramClient } from 'telegram';
import { Api } from 'telegram/tl';
import { StringSession } from 'telegram/sessions';
import bigInt from 'big-integer';

/**
 * Создает клиент Telegram с заданной сессией
 * @param _sessionString - строка сессии
 * @returns Promise с настроенным клиентом
 */
export async function createTelegramClientAsync(_sessionString: string): Promise<TelegramClient> {
    const apiId = Number(process.env.API_ID);
    const apiHash = process.env.API_HASH;

    if (!apiId || !apiHash) {
        throw new Error('API_ID и API_HASH должны быть указаны в .env файле');
    }

    const client = new TelegramClient(
        new StringSession(_sessionString),
        apiId,
        apiHash,
        {
            connectionRetries: 5,
            timeout: 30000,
            autoReconnect: false,
            deviceModel: 'Desktop',
            systemVersion: 'Windows 10',
            appVersion: '1.0.0',
            langCode: 'ru',
            systemLangCode: 'ru'
        }
    );

    await client.connect();

    if (!await client.isUserAuthorized()) {
        throw new Error('Сессия недействительна или истекла');
    }

    return client;
}

/**
 * Безопасно отключает клиент Telegram
 * @param _client - клиент для отключения
 */
export async function disconnectClientSafelyAsync(_client: TelegramClient | null): Promise<void> {
    if (_client) {
        try {
            await _client.disconnect();
        } catch (error) {
            console.warn('⚠️ Предупреждение при отключении клиента:', error);
        }
    }
}

/**
 * Нормализует идентификатор канала (убирает @ и лишние символы)
 * @param _identifier - идентификатор для нормализации
 * @returns нормализованный идентификатор
 */
export function normalizeChannelIdentifier(_identifier: string): string {
    return _identifier.replace(/^@/, '').trim();
}

/**
 * Нормализует идентификатор пользователя (убирает @ и лишние символы)
 * @param _identifier - идентификатор для нормализации
 * @returns нормализованный идентификатор
 */
export function normalizeUserIdentifier(_identifier: string): string {
    return _identifier.replace(/^@/, '').trim();
}

/**
 * Проверяет, является ли идентификатор числовым ID
 * @param _identifier - идентификатор для проверки
 * @returns true если числовой ID
 */
export function isNumericId(_identifier: string): boolean {
    return /^\d+$/.test(_identifier);
}

/**
 * Создает InputChannel из идентификатора канала
 * @param _client - клиент Telegram
 * @param _identifier - идентификатор канала
 * @returns Promise с InputChannel
 */
export async function createInputChannelAsync(
    _client: TelegramClient,
    _identifier: string
): Promise<Api.InputChannel> {
    const normalizedId = normalizeChannelIdentifier(_identifier);

    if (isNumericId(normalizedId)) {
        // Для числового ID нужно получить accessHash
        const channel = await _client.invoke(new Api.channels.GetChannels({
            id: [new Api.InputChannel({
                channelId: bigInt(normalizedId),
                accessHash: bigInt(0) // Временно используем 0
            })]
        }));

        if (channel.chats.length > 0) {
            const chat = channel.chats[0] as Api.Channel;
            return new Api.InputChannel({
                channelId: chat.id,
                accessHash: chat.accessHash || bigInt(0)
            });
        }
        throw new Error(`Канал с ID ${normalizedId} не найден`);
    } else {
        // Для username используем резолвер
        const resolved = await _client.invoke(new Api.contacts.ResolveUsername({
            username: normalizedId
        }));

        if (resolved.chats.length > 0) {
            const chat = resolved.chats[0] as Api.Channel;
            return new Api.InputChannel({
                channelId: chat.id,
                accessHash: chat.accessHash || bigInt(0)
            });
        }
        throw new Error(`Канал @${normalizedId} не найден`);
    }
}

/**
 * Создает InputUser из идентификатора пользователя
 * @param _client - клиент Telegram
 * @param _identifier - идентификатор пользователя
 * @returns Promise с InputUser
 */
export async function createInputUserAsync(
    _client: TelegramClient,
    _identifier: string
): Promise<Api.InputUser> {
    const normalizedId = normalizeUserIdentifier(_identifier);

    if (isNumericId(normalizedId)) {
        // Для числового ID нужно получить accessHash
        const users = await _client.invoke(new Api.users.GetUsers({
            id: [new Api.InputUser({
                userId: bigInt(normalizedId),
                accessHash: bigInt(0) // Временно используем 0
            })]
        }));

        if (users.length > 0) {
            const user = users[0] as Api.User;
            return new Api.InputUser({
                userId: user.id,
                accessHash: user.accessHash || bigInt(0)
            });
        }
        throw new Error(`Пользователь с ID ${normalizedId} не найден`);
    } else {
        // Для username используем резолвер
        const resolved = await _client.invoke(new Api.contacts.ResolveUsername({
            username: normalizedId
        }));

        if (resolved.users.length > 0) {
            const user = resolved.users[0] as Api.User;
            return new Api.InputUser({
                userId: user.id,
                accessHash: user.accessHash || bigInt(0)
            });
        }
        throw new Error(`Пользователь @${normalizedId} не найден`);
    }
}

/**
 * Получает InputUser из списка администраторов канала
 * Обходит FLOOD_WAIT на resolveUsername, используя API администраторов
 *
 * @param _client - клиент Telegram
 * @param _inputChannel - InputChannel канала
 * @param _targetIdentifier - username или userId целевого пользователя
 * @returns Promise с InputUser
 */
export async function getUserFromChannelAdmins(
    _client: TelegramClient,
    _inputChannel: Api.InputChannel,
    _targetIdentifier: string
): Promise<Api.InputUser> {
    const normalizedId = normalizeUserIdentifier(_targetIdentifier);

    // Получаем список администраторов канала
    const participants = await _client.invoke(new Api.channels.GetParticipants({
        channel: _inputChannel,
        filter: new Api.ChannelParticipantsAdmins(),
        offset: 0,
        limit: 100,
        hash: bigInt(0)
    }));

    // Проверяем тип результата
    if (!(participants instanceof Api.channels.ChannelParticipants)) {
        throw new Error(`Не удалось получить список администраторов канала`);
    }

    // Ищем нужного пользователя
    for (const user of participants.users) {
        if (!(user instanceof Api.User)) continue;

        // Проверяем по User ID
        if (isNumericId(normalizedId)) {
            if (user.id.toString() === normalizedId) {
                return new Api.InputUser({
                    userId: user.id,
                    accessHash: user.accessHash || bigInt(0)
                });
            }
        } else {
            // Проверяем по username
            if (user.username && user.username.toLowerCase() === normalizedId.toLowerCase()) {
                return new Api.InputUser({
                    userId: user.id,
                    accessHash: user.accessHash || bigInt(0)
                });
            }
        }
    }

    throw new Error(`Пользователь ${normalizedId} не найден среди администраторов канала. Убедитесь, что пользователь добавлен как админ.`);
}

/**
 * Маскирует строку сессии для безопасного логирования
 * @param _sessionString - строка сессии
 * @returns замаскированная строка
 */
export function maskSessionString(_sessionString: string): string {
    if (_sessionString.length <= 20) {
        return '*'.repeat(_sessionString.length);
    }
    return _sessionString.slice(0, 10) + '*'.repeat(_sessionString.length - 20) + _sessionString.slice(-10);
}

/**
 * Форматирует ошибки Telegram API в читаемые сообщения
 * @param _error - ошибка для форматирования
 * @returns читаемое сообщение об ошибке
 */
export function formatTelegramError(_error: any): string {
    if (!_error) return 'Неизвестная ошибка';

    // Если это строка, возвращаем как есть
    if (typeof _error === 'string') return _error;

    // Если это объект ошибки с message
    if (_error.message) {
        const message = _error.message;

        // Форматируем типичные ошибки Telegram API
        if (message.includes('PASSWORD_HASH_INVALID')) {
            return 'Неверный пароль 2FA';
        }
        if (message.includes('PASSWORD_MISSING')) {
            return '2FA не настроена для этого аккаунта';
        }
        if (message.includes('SESSION_TOO_FRESH')) {
            return 'Сессия слишком новая, попробуйте через 24 часа';
        }
        if (message.includes('PASSWORD_TOO_FRESH')) {
            return 'Пароль 2FA изменен недавно, попробуйте через 24 часа';
        }
        if (message.includes('CHANNEL_PRIVATE')) {
            return 'Канал приватный или вы не являетесь участником';
        }
        if (message.includes('CHAT_ADMIN_REQUIRED')) {
            return 'Требуются права администратора канала';
        }
        if (message.includes('USER_ID_INVALID')) {
            return 'Неверный ID пользователя или пользователь не найден';
        }

        return message;
    }

    // Если это другой тип объекта, пытаемся его строкифицировать
    return _error.toString() || 'Неизвестная ошибка';
}

/**
 * Генерирует уникальный ID для операции передачи
 * @returns уникальный идентификатор
 */
export function generateTransferSessionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `transfer_${timestamp}_${random}`;
} 