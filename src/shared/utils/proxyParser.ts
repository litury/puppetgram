/**
 * Утилита для парсинга SOCKS5 прокси URL
 * Поддерживает формат: socks5://host:port:user:pass
 */

import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Конфигурация прокси для GramJS TelegramClient
 */
export interface ProxyConfig {
    socksType: 5;
    ip: string;
    port: number;
    username: string;
    password: string;
}

/**
 * Расширенная информация о прокси
 */
export interface ProxyInfo extends ProxyConfig {
    rawUrl: string;
    hardsession?: string;
    country?: string;
}

/**
 * Парсит URL прокси в конфигурацию для GramJS
 *
 * Поддерживаемые форматы:
 * - socks5://host:port:user:pass
 * - socks5://user:pass@host:port
 *
 * @example
 * parseProxyUrl('socks5://proxy.com:1080:myuser:mypass')
 * // => { socksType: 5, ip: 'proxy.com', port: 1080, username: 'myuser', password: 'mypass' }
 */
export function parseProxyUrl(url: string): ProxyConfig | null {
    if (!url || !url.startsWith('socks5://')) {
        return null;
    }

    // Убираем протокол
    const withoutProtocol = url.replace('socks5://', '');

    // Формат 1: host:port:user:pass (bpproxy.at использует этот формат)
    const colonFormat = withoutProtocol.match(/^([^:]+):(\d+):([^:]+):(.+)$/);
    if (colonFormat) {
        return {
            socksType: 5,
            ip: colonFormat[1],
            port: parseInt(colonFormat[2], 10),
            username: colonFormat[3],
            password: colonFormat[4]
        };
    }

    // Формат 2: user:pass@host:port (стандартный формат)
    const atFormat = withoutProtocol.match(/^([^:]+):([^@]+)@([^:]+):(\d+)$/);
    if (atFormat) {
        return {
            socksType: 5,
            ip: atFormat[3],
            port: parseInt(atFormat[4], 10),
            username: atFormat[1],
            password: atFormat[2]
        };
    }

    return null;
}

/**
 * Парсит URL прокси и извлекает дополнительную информацию
 * (hardsession ID, страну и т.д.)
 */
export function parseProxyUrlExtended(url: string): ProxyInfo | null {
    const config = parseProxyUrl(url);
    if (!config) return null;

    const info: ProxyInfo = {
        ...config,
        rawUrl: url
    };

    // Извлекаем hardsession ID из пароля (формат: ...hardsession-XXXX)
    const hardsessionMatch = config.password.match(/hardsession-([a-zA-Z0-9]+)/);
    if (hardsessionMatch) {
        info.hardsession = hardsessionMatch[1];
    }

    // Извлекаем страну из пароля (формат: ...country-XX...)
    const countryMatch = config.password.match(/country-([A-Z]{2})/);
    if (countryMatch) {
        info.country = countryMatch[1];
    }

    return info;
}

/**
 * Получает прокси для аккаунта из .env по номеру
 *
 * @param sessionNumber - номер сессии (например "1", "USA_1", "PROFILE_1")
 * @param prefix - префикс переменной (по умолчанию "PROXY")
 *
 * @example
 * // Для PROXY_USA_1
 * getProxyForAccount('USA_1')
 *
 * // Для PROXY_3
 * getProxyForAccount('3')
 */
export function getProxyForAccount(sessionNumber: string, prefix: string = 'PROXY'): ProxyConfig | null {
    const envKey = `${prefix}_${sessionNumber}`;
    const proxyUrl = process.env[envKey];

    if (!proxyUrl) {
        return null;
    }

    return parseProxyUrl(proxyUrl);
}

/**
 * Загружает все прокси из .env по паттерну
 *
 * @param pattern - паттерн для поиска (например "PROXY_USA_")
 * @returns Массив прокси с их ключами
 */
export function loadAllProxies(pattern: string = 'PROXY_USA_'): Array<{ key: string; config: ProxyInfo }> {
    const proxies: Array<{ key: string; config: ProxyInfo }> = [];

    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith(pattern) && value) {
            const config = parseProxyUrlExtended(value);
            if (config) {
                proxies.push({ key, config });
            }
        }
    }

    // Сортируем по номеру (PROXY_USA_1, PROXY_USA_2, ...)
    return proxies.sort((a, b) => {
        const numA = parseInt(a.key.replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.key.replace(/\D/g, ''), 10) || 0;
        return numA - numB;
    });
}
