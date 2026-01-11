/**
 * Утилита для проверки здоровья SOCKS5 прокси
 * Проверяет доступность туннеля и получает информацию об IP
 */

import { SocksClient, SocksClientOptions } from 'socks';
import { ProxyConfig } from './proxyParser';

/**
 * Результат проверки здоровья прокси
 */
export interface ProxyHealthResult {
    alive: boolean;
    ip?: string;
    country?: string;
    countryCode?: string;
    city?: string;
    isp?: string;
    latencyMs?: number;
    error?: string;
}

/**
 * Проверяет здоровье прокси и получает информацию об IP
 *
 * @param proxyConfig - конфигурация прокси
 * @param timeoutMs - таймаут в миллисекундах (по умолчанию 10000)
 */
export async function checkProxyHealth(
    proxyConfig: ProxyConfig,
    timeoutMs: number = 10000
): Promise<ProxyHealthResult> {
    const startTime = Date.now();

    try {
        // Подключаемся к ip-api.com через SOCKS5 прокси
        const options: SocksClientOptions = {
            proxy: {
                host: proxyConfig.ip,
                port: proxyConfig.port,
                type: 5,
                userId: proxyConfig.username,
                password: proxyConfig.password
            },
            command: 'connect',
            destination: {
                host: 'ip-api.com',
                port: 80
            },
            timeout: timeoutMs
        };

        const { socket } = await SocksClient.createConnection(options);

        // Отправляем HTTP запрос для получения IP информации
        const request = 'GET /json HTTP/1.1\r\nHost: ip-api.com\r\nConnection: close\r\n\r\n';
        socket.write(request);

        // Читаем ответ
        const response = await new Promise<string>((resolve, reject) => {
            let data = '';
            const timeout = setTimeout(() => {
                socket.destroy();
                reject(new Error('Response timeout'));
            }, timeoutMs);

            socket.on('data', (chunk) => {
                data += chunk.toString();
            });

            socket.on('end', () => {
                clearTimeout(timeout);
                resolve(data);
            });

            socket.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        socket.destroy();

        // Парсим JSON из ответа
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return {
                alive: true,
                latencyMs: Date.now() - startTime,
                error: 'Could not parse IP info response'
            };
        }

        const ipInfo = JSON.parse(jsonMatch[0]);

        return {
            alive: true,
            ip: ipInfo.query,
            country: ipInfo.country,
            countryCode: ipInfo.countryCode,
            city: ipInfo.city,
            isp: ipInfo.isp,
            latencyMs: Date.now() - startTime
        };

    } catch (error: any) {
        return {
            alive: false,
            latencyMs: Date.now() - startTime,
            error: error.message || 'Connection failed'
        };
    }
}

/**
 * Быстрая проверка доступности прокси (без получения IP информации)
 *
 * @param proxyConfig - конфигурация прокси
 * @param timeoutMs - таймаут в миллисекундах (по умолчанию 5000)
 */
export async function isProxyAlive(
    proxyConfig: ProxyConfig,
    timeoutMs: number = 5000
): Promise<boolean> {
    try {
        const options: SocksClientOptions = {
            proxy: {
                host: proxyConfig.ip,
                port: proxyConfig.port,
                type: 5,
                userId: proxyConfig.username,
                password: proxyConfig.password
            },
            command: 'connect',
            destination: {
                host: 'google.com',
                port: 80
            },
            timeout: timeoutMs
        };

        const { socket } = await SocksClient.createConnection(options);
        socket.destroy();
        return true;

    } catch {
        return false;
    }
}

/**
 * Форматирует результат проверки для вывода в консоль
 */
export function formatHealthResult(result: ProxyHealthResult, proxyName: string): string {
    if (!result.alive) {
        return `${proxyName}: ❌ DEAD (${result.error})`;
    }

    const parts = [
        `${proxyName}: ✅ OK`,
        `IP: ${result.ip || 'unknown'}`,
        `Country: ${result.countryCode || 'unknown'}`,
        `ISP: ${result.isp || 'unknown'}`,
        `Latency: ${result.latencyMs}ms`
    ];

    return parts.join(' | ');
}
