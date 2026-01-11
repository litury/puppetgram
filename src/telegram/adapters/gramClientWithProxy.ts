/**
 * GramClient с поддержкой SOCKS5 прокси
 * Используется для USA-аккаунтов которые требуют подключения через USA IP
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Logger } from "telegram/extensions";
import * as dotenv from "dotenv";
import { createLogger } from "../../shared/utils/logger";
import { ProxyConfig } from "../../shared/utils/proxyParser";

dotenv.config();

const log = createLogger("GramClientWithProxy");

/**
 * USA device configuration для мимикрии под реального пользователя
 */
const USA_DEVICE_CONFIG = {
    deviceModel: "iPhone 15 Pro",
    systemVersion: "iOS 17.4",
    appVersion: "10.5.2",
    langCode: "en",
    systemLangCode: "en-US",
};

export class GramClientWithProxy {
    private client: TelegramClient;
    private session: StringSession;
    private proxyConfig: ProxyConfig | undefined;

    constructor(sessionString: string, proxyConfig?: ProxyConfig) {
        this.session = new StringSession(sessionString);
        this.proxyConfig = proxyConfig;

        if (!process.env.API_ID || !process.env.API_HASH) {
            throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
        }

        // Тихий логгер для подавления TIMEOUT ошибок
        const logger = new Logger("none" as any);

        // Базовые опции клиента
        const clientOptions: any = {
            connectionRetries: 5,
            useWSS: false,
            baseLogger: logger,
            requestRetries: 3,
            autoReconnect: true,
            // USA device info для мимикрии
            ...USA_DEVICE_CONFIG,
        };

        // Добавляем прокси если указан
        if (proxyConfig) {
            clientOptions.proxy = {
                socksType: proxyConfig.socksType,
                ip: proxyConfig.ip,
                port: proxyConfig.port,
                username: proxyConfig.username,
                password: proxyConfig.password,
            };

            log.debug("Клиент создан с прокси", {
                proxyHost: proxyConfig.ip,
                proxyPort: proxyConfig.port,
            });
        }

        this.client = new TelegramClient(
            this.session,
            Number(process.env.API_ID),
            process.env.API_HASH,
            clientOptions
        );
    }

    async connect(): Promise<void> {
        try {
            const proxyInfo = this.proxyConfig
                ? `через прокси ${this.proxyConfig.ip}:${this.proxyConfig.port}`
                : "напрямую";

            log.debug(`Подключение к Telegram ${proxyInfo}...`);
            await this.client.connect();

            // Проверяем авторизацию
            const authorized = await this.client.isUserAuthorized();
            if (!authorized) {
                throw new Error(
                    "Пользователь не авторизован. Запустите скрипт авторизации (npm run auth)"
                );
            }

            log.debug(`Успешно подключено к Telegram ${proxyInfo}`);
        } catch (error) {
            log.error("Ошибка подключения", error as Error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        try {
            await this.client.disconnect();
        } catch (error) {
            log.warn("Ошибка при отключении", { error });
        }
    }

    getClient(): TelegramClient {
        return this.client;
    }

    /**
     * Проверяет, используется ли прокси
     */
    hasProxy(): boolean {
        return !!this.proxyConfig;
    }

    /**
     * Получить информацию о прокси
     */
    getProxyInfo(): { host: string; port: number } | null {
        if (!this.proxyConfig) return null;
        return {
            host: this.proxyConfig.ip,
            port: this.proxyConfig.port,
        };
    }

    /**
     * Безопасное выполнение операций с повторными попытками
     */
    async executeWithRetry<T>(operation: () => Promise<T>, maxRetries: number = 3): Promise<T> {
        let lastError: Error;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error: any) {
                lastError = error;

                log.warn(`Попытка ${attempt}/${maxRetries} не удалась`, { error: error.message });

                if (this.isConnectionError(error)) {
                    if (attempt < maxRetries) {
                        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                        log.debug(`Ожидание перед повторной попыткой`, { delay });
                        await new Promise(resolve => setTimeout(resolve, delay));

                        try {
                            if (!this.client.connected) {
                                log.debug("Переподключение к Telegram...");
                                await this.client.connect();
                            }
                        } catch (reconnectError) {
                            log.warn("Ошибка переподключения", { error: reconnectError });
                        }
                    }
                } else {
                    throw error;
                }
            }
        }

        throw lastError!;
    }

    private isConnectionError(error: any): boolean {
        const connectionErrorMessages = [
            'TIMEOUT',
            'CONNECTION_DEVICE_ERROR',
            'NETWORK_ERROR',
            'Socket connection failed',
            'Connection closed',
            'connection closed',
            'ECONNRESET',
            'ENOTFOUND',
            'ETIMEDOUT',
            'SOCKS'  // Ошибки прокси
        ];

        const errorMessage = error.message || error.toString();
        return connectionErrorMessages.some(msg =>
            errorMessage.includes(msg)
        );
    }
}
