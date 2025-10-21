/**
 * Вспомогательные функции для парсинга похожих каналов
 * Следует стандартам компании согласно frontend-coding-standards.md
 */

import { ISimilarityParsingOptions, ISimilarChannel } from '../interfaces';

/**
 * Валидация опций парсинга
 * @param _options - опции для валидации
 * @returns валидированные опции с дефолтными значениями
 * @throws Error если опции невалидны
 */
export function validateParsingOptions(_options: ISimilarityParsingOptions): Required<ISimilarityParsingOptions> {
    if (!_options.targetChannelCount || _options.targetChannelCount < 1) {
        throw new Error('targetChannelCount должен быть больше 0');
    }

    const firstLevelLimit = _options.firstLevelLimit ?? 100;
    const minSubscribers = _options.minSubscribers ?? 0;
    const maxSubscribers = _options.maxSubscribers === 0 || _options.maxSubscribers === undefined ? Number.MAX_SAFE_INTEGER : _options.maxSubscribers;

    return {
        sourceChannel: _options.sourceChannel,
        targetChannelCount: _options.targetChannelCount,
        firstLevelLimit: Math.min(firstLevelLimit, 100), // Telegram API limit
        removeDuplicates: _options.removeDuplicates ?? true,
        minSubscribers: Math.max(minSubscribers, 0),
        maxSubscribers: maxSubscribers
    };
}

/**
 * Очистка имени канала от лишних символов
 * @param _channelName - имя канала
 * @returns очищенное имя канала
 */
export function cleanChannelName(_channelName: string): string {
    return _channelName.replace(/[@\s]/g, '').toLowerCase();
}

/**
 * Нормализация имени канала для поиска
 * @param _channelName - имя канала
 * @returns нормализованное имя
 */
export function normalizeChannelName(_channelName: string): string {
    return cleanChannelName(_channelName);
}

/**
 * Удаление дубликатов каналов по ID и username
 * @param _channels - массив каналов
 * @returns массив уникальных каналов
 */
export function removeDuplicateChannels(_channels: ISimilarChannel[]): ISimilarChannel[] {
    const uniqueByIdMap = new Map<string, ISimilarChannel>();
    const uniqueByUsernameMap = new Map<string, ISimilarChannel>();

    // Сначала удаляем дубликаты по ID
    for (const channel of _channels) {
        if (!uniqueByIdMap.has(channel.id)) {
            uniqueByIdMap.set(channel.id, channel);
        }
    }

    // Затем удаляем дубликаты по username среди уникальных по ID
    for (const channel of uniqueByIdMap.values()) {
        if (channel.username) {
            const normalizedUsername = channel.username.toLowerCase();
            if (!uniqueByUsernameMap.has(normalizedUsername)) {
                uniqueByUsernameMap.set(normalizedUsername, channel);
            }
        } else {
            // Каналы без username добавляем как есть
            uniqueByUsernameMap.set(`no_username_${channel.id}`, channel);
        }
    }

    return Array.from(uniqueByUsernameMap.values());
}

/**
 * Подсчет количества удаленных дубликатов
 * @param _originalCount - изначальное количество
 * @param _uniqueCount - количество после удаления дубликатов
 * @returns количество удаленных дубликатов
 */
export function calculateDuplicatesRemoved(_originalCount: number, _uniqueCount: number): number {
    return Math.max(0, _originalCount - _uniqueCount);
}

/**
 * Создание задержки для избежания превышения лимитов API
 * @param _ms - время задержки в миллисекундах
 * @returns Promise, который разрешается через указанное время
 */
export async function delayAsync(_ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, _ms));
}

/**
 * Генерация случайной задержки для имитации человеческого поведения
 * @param _minMs - минимальная задержка
 * @param _maxMs - максимальная задержка
 * @returns случайное время задержки
 */
export function generateRandomDelay(_minMs: number = 1000, _maxMs: number = 3000): number {
    return Math.floor(Math.random() * (_maxMs - _minMs + 1)) + _minMs;
}

/**
 * Преобразование сырых данных Telegram API в ISimilarChannel
 * @param _apiData - сырые данные от API
 * @param _searchDepth - глубина поиска
 * @returns объект ISimilarChannel
 */
export function mapApiDataToChannel(_apiData: any, _searchDepth: number = 1): ISimilarChannel {
    return {
        id: _apiData.id ? _apiData.id.toString() : '',
        title: _apiData.title || 'Без названия',
        username: _apiData.username || undefined,
        description: _apiData.about || undefined,
        subscribersCount: _apiData.participantsCount || undefined,
        isVerified: _apiData.verified || false,
        searchDepth: _searchDepth
    };
}

/**
 * Фильтрация каналов по типу (только публичные каналы)
 * @param _apiChats - массив чатов от API
 * @returns отфильтрованные каналы
 */
export function filterChannelsFromApiChats(_apiChats: any[]): any[] {
    return _apiChats.filter(chat =>
        chat &&
        chat.className === 'Channel' &&
        chat.broadcast !== false // Исключаем группы
    );
}

/**
 * Обработка результата API и преобразование в массив каналов
 * @param _apiResult - результат от Telegram API
 * @param _searchDepth - глубина поиска
 * @param _minSubscribers - минимальное количество подписчиков
 * @param _maxSubscribers - максимальное количество подписчиков
 * @returns массив похожих каналов
 */
export function processApiResult(
    _apiResult: any,
    _searchDepth: number = 1,
    _minSubscribers: number = 0,
    _maxSubscribers: number = Number.MAX_SAFE_INTEGER
): ISimilarChannel[] {
    if (!_apiResult || !_apiResult.chats || !Array.isArray(_apiResult.chats)) {
        return [];
    }

    const filteredChats = filterChannelsFromApiChats(_apiResult.chats);

    return filteredChats
        .map(chat => mapApiDataToChannel(chat, _searchDepth))
        .filter(channel => {
            const subscribers = channel.subscribersCount || 0;
            return subscribers >= _minSubscribers && subscribers <= _maxSubscribers;
        });
}

/**
 * Форматирование времени выполнения
 * @param _ms - время в миллисекундах
 * @returns отформатированная строка времени
 */
export function formatProcessingTime(_ms: number): string {
    if (_ms < 1000) {
        return `${_ms}мс`;
    }

    const seconds = Math.floor(_ms / 1000);
    const remainingMs = _ms % 1000;

    if (seconds < 60) {
        return remainingMs > 0 ? `${seconds}.${Math.floor(remainingMs / 100)}с` : `${seconds}с`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    return `${minutes}м ${remainingSeconds}с`;
}

/**
 * Проверка валидности имени канала
 * @param _channelName - имя канала для проверки
 * @returns true если имя валидно
 */
export function isValidChannelName(_channelName: string): boolean {
    const cleanName = cleanChannelName(_channelName);

    // Telegram username должен быть от 5 до 32 символов
    // и содержать только буквы, цифры и подчеркивания
    return (
        cleanName.length >= 5 &&
        cleanName.length <= 32 &&
        /^[a-zA-Z][a-zA-Z0-9_]*$/.test(cleanName)
    );
}
