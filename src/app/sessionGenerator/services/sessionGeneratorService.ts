/**
 * Основной сервис для генерации сессий Telegram
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Logger } from 'telegram/extensions';
import { Api } from 'telegram';
import {
    ISessionGenerator,
    ISessionGenerationOptions,
    ISessionGenerationResult,
    ISessionInfo,
    IInteractiveAuthHandler,
    IAuthCredentials
} from '../interfaces';
import {
    validatePhoneNumber,
    formatPhoneNumber,
    validateCredentials,
    generateSessionId,
    maskPhoneNumber
} from '../parts';

export class SessionGeneratorService implements ISessionGenerator {
    private authHandler: IInteractiveAuthHandler;

    constructor(authHandler: IInteractiveAuthHandler) {
        this.authHandler = authHandler;
    }

    /**
     * Генерация новой сессии Telegram
     */
    async generateSession(_options: ISessionGenerationOptions): Promise<ISessionGenerationResult> {
        let client: TelegramClient | null = null;

        try {
            this.authHandler.displayMessage("🔐 Начинается процесс генерации сессии...");

            // Создаем клиент с пустой сессией
            const session = new StringSession("");
            client = new TelegramClient(
                session,
                _options.apiId,
                _options.apiHash,
                {
                    connectionRetries: _options.connectionRetries || 5,
                    useWSS: true,
                    baseLogger: new Logger(),
                    requestRetries: 3,
                    timeout: _options.timeout || 30000,
                    autoReconnect: false,
                    deviceModel: _options.deviceModel || "Desktop",
                    systemVersion: _options.systemVersion || "Windows 10",
                    appVersion: _options.appVersion || "1.0.0",
                }
            );

            this.authHandler.displayMessage("📱 Подключение к Telegram...");
            await client.connect();

            // Интерактивная авторизация
            const credentials = await this.p_collectCredentialsAsync();

            this.authHandler.displayMessage(`📞 Авторизация для номера ${maskPhoneNumber(credentials.phoneNumber)}...`);

            await client.start({
                phoneNumber: async () => credentials.phoneNumber,
                password: async () => {
                    if (credentials.password) {
                        return credentials.password;
                    }
                    this.authHandler.displayMessage("🔒 Требуется двухфакторная аутентификация");
                    return await this.authHandler.requestPassword();
                },
                phoneCode: async () => {
                    if (credentials.phoneCode) {
                        return credentials.phoneCode;
                    }
                    this.authHandler.displayMessage("📨 Введите код подтверждения из SMS/Telegram");
                    return await this.authHandler.requestPhoneCode();
                },
                onError: (err) => {
                    this.authHandler.displayError(`Ошибка авторизации: ${err.message}`);
                    throw err;
                },
            });

            // Получаем информацию о пользователе
            const me = await client.getMe() as Api.User;
            const sessionString = (client.session as StringSession).save();

            const result: ISessionGenerationResult = {
                sessionString: sessionString,
                phoneNumber: credentials.phoneNumber,
                userId: me.id?.toJSNumber(),
                username: me.username || undefined,
                firstName: me.firstName || undefined,
                lastName: me.lastName || undefined,
                generatedAt: new Date(),
                isValid: true
            };

            this.authHandler.displaySuccess("✅ Сессия успешно сгенерирована!");
            this.authHandler.displayMessage(`👤 Пользователь: ${me.firstName || ''} ${me.lastName || ''}`);
            if (me.username) {
                this.authHandler.displayMessage(`🏷️ Username: @${me.username}`);
            }

            await client.disconnect();
            return result;

        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn("Предупреждение при отключении клиента:", disconnectError);
                }
            }

            this.authHandler.displayError(`❌ Ошибка генерации сессии: ${error}`);
            throw error;
        }
    }

    /**
     * Генерация сессии по QR-коду (без SMS/кода).
     * Для аккаунтов с УЖЕ активной сессией: код входа не нужен — сканируешь QR
     * залогиненным Telegram (Настройки → Устройства → «Подключить устройство»).
     * Обходит SendCode-флуд. Для новых номеров без сессии не подходит (нечем сканировать).
     */
    async generateSessionViaQr(_options: ISessionGenerationOptions): Promise<ISessionGenerationResult> {
        let client: TelegramClient | null = null;

        try {
            this.authHandler.displayMessage("🔐 QR-логин: подготовка...");

            const session = new StringSession("");
            client = new TelegramClient(
                session,
                _options.apiId,
                _options.apiHash,
                {
                    connectionRetries: _options.connectionRetries || 5,
                    useWSS: true,
                    baseLogger: new Logger(),
                    requestRetries: 3,
                    timeout: _options.timeout || 30000,
                    autoReconnect: false,
                    deviceModel: _options.deviceModel || "Desktop",
                    systemVersion: _options.systemVersion || "Windows 10",
                    appVersion: _options.appVersion || "1.0.0",
                }
            );

            this.authHandler.displayMessage("📱 Подключение к Telegram...");
            await client.connect();

            // qrcode-terminal рисует QR прямо в консоли
            const qrcode = require("qrcode-terminal");

            await client.signInUserWithQrCode(
                { apiId: _options.apiId, apiHash: _options.apiHash },
                {
                    qrCode: async (code: { token: Buffer }) => {
                        const url = `tg://login?token=${code.token.toString("base64url")}`;
                        this.authHandler.displayMessage(
                            "\n📷 Отсканируй QR ниже: Telegram → Настройки → Устройства → «Подключить устройство»:\n"
                        );
                        qrcode.generate(url, { small: true });
                        this.authHandler.displayMessage("⏳ Жду подтверждения на телефоне (QR сам обновляется)...");
                    },
                    password: async (hint?: string) => {
                        this.authHandler.displayMessage(
                            `🔒 Требуется 2FA-пароль${hint ? ` (подсказка: ${hint})` : ""}`
                        );
                        return await this.authHandler.requestPassword();
                    },
                    onError: (err: Error) => {
                        // не прерываем (void): токен QR обновляется циклично; фатальные оборвут сами
                        this.authHandler.displayError(`QR: ${err.message}`);
                    },
                }
            );

            const me = (await client.getMe()) as Api.User;
            const sessionString = (client.session as StringSession).save();

            const result: ISessionGenerationResult = {
                sessionString: sessionString,
                phoneNumber: me.phone ? `+${me.phone}` : "",
                userId: me.id?.toJSNumber(),
                username: me.username || undefined,
                firstName: me.firstName || undefined,
                lastName: me.lastName || undefined,
                generatedAt: new Date(),
                isValid: true
            };

            this.authHandler.displaySuccess("✅ Сессия по QR успешно сгенерирована!");
            this.authHandler.displayMessage(`👤 Пользователь: ${me.firstName || ''} ${me.lastName || ''}`);
            if (me.username) {
                this.authHandler.displayMessage(`🏷️ Username: @${me.username}`);
            }

            await client.disconnect();
            return result;

        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn("Предупреждение при отключении клиента:", disconnectError);
                }
            }
            this.authHandler.displayError(`❌ Ошибка QR-генерации: ${error}`);
            throw error;
        }
    }

    /**
     * Валидация существующей сессии
     */
    async validateExistingSession(_sessionString: string): Promise<boolean> {
        let client: TelegramClient | null = null;

        try {
            const session = new StringSession(_sessionString);
            client = new TelegramClient(
                session,
                0, // Временные значения для валидации
                "",
                {
                    connectionRetries: 3,
                    timeout: 15000,
                    autoReconnect: false,
                }
            );

            await client.connect();
            const isAuthorized = await client.isUserAuthorized();
            await client.disconnect();

            return isAuthorized;
        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn("Предупреждение при отключении клиента:", disconnectError);
                }
            }
            return false;
        }
    }

    /**
     * Получение информации о сессии
     */
    async getSessionInfo(_sessionString: string): Promise<ISessionInfo> {
        let client: TelegramClient | null = null;

        try {
            // Используем конфигурацию из переменных окружения
            const apiId = Number(process.env.API_ID);
            const apiHash = process.env.API_HASH;

            if (!apiId || !apiHash) {
                throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
            }

            const session = new StringSession(_sessionString);
            client = new TelegramClient(
                session,
                apiId,
                apiHash,
                {
                    connectionRetries: 3,
                    timeout: 15000,
                    autoReconnect: false,
                }
            );

            await client.connect();

            if (!await client.isUserAuthorized()) {
                throw new Error("Сессия недействительна или истекла");
            }

            const me = await client.getMe() as Api.User;
            await client.disconnect();

            return {
                userId: me.id?.toJSNumber() || 0,
                username: me.username || undefined,
                firstName: me.firstName || undefined,
                lastName: me.lastName || undefined,
                phoneNumber: me.phone || undefined,
                isBot: me.bot || false,
                isPremium: me.premium || false,
                isVerified: me.verified || false,
            };

        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn("Предупреждение при отключении клиента:", disconnectError);
                }
            }
            throw error;
        }
    }

    /**
     * Сбор учетных данных через интерактивный интерфейс
     */
    private async p_collectCredentialsAsync(): Promise<IAuthCredentials> {
        const phoneNumber = await this.authHandler.requestPhoneNumber();
        const formattedPhone = formatPhoneNumber(phoneNumber);

        const credentials: IAuthCredentials = {
            phoneNumber: formattedPhone
        };

        // Валидация
        const validationErrors = validateCredentials(credentials);
        if (validationErrors.length > 0) {
            throw new Error(`Ошибки валидации: ${validationErrors.join(', ')}`);
        }

        return credentials;
    }
} 