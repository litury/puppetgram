/**
 * Автокомментатор для USA-аккаунтов через прокси (ПАРАЛЛЕЛЬНЫЙ)
 *
 * Особенности:
 * - Загружает только SESSION_STRING_USA_* аккаунты
 * - Автоматически подключает PROXY_USA_N к SESSION_STRING_USA_N
 * - Проверяет здоровье прокси перед запуском
 * - ВСЕ аккаунты работают ПАРАЛЛЕЛЬНО
 * - Каждый аккаунт берёт каналы из общей очереди
 * - Легковесный метод: 3 API-запроса вместо 7
 *
 * Запуск: npm run comment:usa
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import { randomUUID } from "crypto";

import { GramClientWithProxy } from "../../../telegram/adapters/gramClientWithProxy";
import { CommentPosterService, ICommentTarget } from "../../commentPoster";
import { AICommentGeneratorService } from "../../aiCommentGenerator";
import { SpamChecker } from "../../../shared/services/spamChecker";
import { createLogger } from "../../../shared/utils/logger";
import { parseProxyUrl, ProxyConfig } from "../../../shared/utils/proxyParser";
import { checkProxyHealth } from "../../../shared/utils/proxyChecker";
import { USA_COMMENTING_PATHS } from "../config/commentingConfig";

// =============================================
// КОНФИГУРАЦИЯ
// =============================================

const CONFIG = {
    // Лимиты
    delayBetweenComments: 20000, 
    maxFloodWaitSeconds: 600,

    // Файлы
    channelsFile: USA_COMMENTING_PATHS.inputs.channelsFile,
    successfulFile: USA_COMMENTING_PATHS.outputs.successfulFile,
    unavailableFile: USA_COMMENTING_PATHS.outputs.unavailableFile,

    // AI
    aiEnabled: !!process.env.DEEPSEEK_API_KEY,

    // Таймауты
    operationTimeoutMs: 60000,
    proxyHealthCheckTimeout: 15000,
};

// =============================================
// ТИПЫ
// =============================================

interface USAAccount {
    number: string;
    sessionKey: string;
    sessionValue: string;
    proxyUrl: string;
    proxyConfig: ProxyConfig;
    commentsCount: number;
    isActive: boolean;
    client?: GramClientWithProxy;
    commentPoster?: CommentPosterService;
    aiGenerator?: AICommentGeneratorService;
}

interface WorkerStats {
    accountNumber: string;
    commentsCount: number;
    errorsCount: number;
    floodWaits: number;
    isRunning: boolean;
}

// =============================================
// ОБЩАЯ ОЧЕРЕДЬ КАНАЛОВ (потокобезопасная)
// =============================================

class ChannelQueue {
    private channels: ICommentTarget[] = [];
    private index: number = 0;
    private lock: boolean = false;
    private processedChannels: Set<string> = new Set();

    constructor(channels: ICommentTarget[]) {
        this.channels = channels;
    }

    async getNext(): Promise<ICommentTarget | null> {
        // Простой лок для избежания дублирования
        while (this.lock) {
            await new Promise(r => setTimeout(r, 10));
        }
        this.lock = true;

        try {
            while (this.index < this.channels.length) {
                const channel = this.channels[this.index];
                this.index++;

                // Пропускаем уже обработанные
                if (!this.processedChannels.has(channel.channelUsername)) {
                    this.processedChannels.add(channel.channelUsername);
                    return channel;
                }
            }
            return null;
        } finally {
            this.lock = false;
        }
    }

    getRemaining(): number {
        return this.channels.length - this.index;
    }

    getProcessed(): number {
        return this.processedChannels.size;
    }
}

// =============================================
// ОСНОВНОЙ КЛАСС
// =============================================

class USAAutoCommenter {
    private spamChecker: SpamChecker;
    private log: ReturnType<typeof createLogger>;
    private sessionId: string;

    private accounts: USAAccount[] = [];
    private channelQueue!: ChannelQueue;
    private workerStats: Map<string, WorkerStats> = new Map();
    private isShuttingDown: boolean = false;

    // Файловые операции с блокировкой
    private fileLock: boolean = false;

    constructor() {
        this.sessionId = randomUUID();
        this.log = createLogger("AutoCommentUSA", { sessionId: this.sessionId });
        this.spamChecker = new SpamChecker();

        this.log.info("🚀 USA Автокомментатор (ПАРАЛЛЕЛЬНЫЙ) инициализирован", {
            delayBetweenComments: CONFIG.delayBetweenComments,
            aiEnabled: CONFIG.aiEnabled,
        });
    }

    /**
     * Загрузка USA аккаунтов и их прокси из .env
     */
    private loadUSAAccounts(): void {
        this.log.info("Загрузка USA аккаунтов...");

        // Уменьшено с 20 до 8 для экономии памяти (каждый аккаунт ~100MB)
        for (let i = 1; i <= 8; i++) {
            const sessionKey = `SESSION_STRING_USA_${i}`;
            const proxyKey = `PROXY_USA_${i}`;

            const sessionValue = process.env[sessionKey];
            const proxyUrl = process.env[proxyKey];

            if (sessionValue && proxyUrl) {
                const proxyConfig = parseProxyUrl(proxyUrl);

                if (proxyConfig) {
                    this.accounts.push({
                        number: String(i),
                        sessionKey,
                        sessionValue,
                        proxyUrl,
                        proxyConfig,
                        commentsCount: 0,
                        isActive: false,
                    });
                }
            }
        }

        if (this.accounts.length === 0) {
            throw new Error(
                "Не найдено ни одного USA аккаунта!\n" +
                "Добавьте в .env:\n" +
                "  SESSION_STRING_USA_1=\"...\"\n" +
                "  PROXY_USA_1=socks5://..."
            );
        }

        this.log.info(`Загружено ${this.accounts.length} USA аккаунтов`);
    }

    /**
     * Проверка здоровья всех прокси
     */
    private async checkAllProxies(): Promise<void> {
        this.log.info("Проверка здоровья прокси...");

        const deadAccounts: string[] = [];

        for (const account of this.accounts) {
            process.stdout.write(`  Проверка USA_${account.number}... `);

            const health = await checkProxyHealth(account.proxyConfig, CONFIG.proxyHealthCheckTimeout);

            if (!health.alive) {
                console.log("❌ DEAD");
                deadAccounts.push(account.number);
            } else if (health.countryCode !== "US") {
                console.log(`⚠️ ${health.countryCode} (не USA)`);
                deadAccounts.push(account.number);
            } else {
                console.log(`✅ ${health.ip} (${health.isp?.substring(0, 20)})`);
            }
        }

        if (deadAccounts.length > 0) {
            this.accounts = this.accounts.filter(a => !deadAccounts.includes(a.number));
        }

        if (this.accounts.length === 0) {
            throw new Error("Все прокси мертвы!");
        }

        this.log.info(`Готово к работе: ${this.accounts.length} аккаунтов с живыми прокси`);
    }

    /**
     * Подключение одного аккаунта
     */
    private async connectAccount(account: USAAccount): Promise<void> {
        // Создаём свой AI генератор для каждого аккаунта (избегаем race conditions)
        account.aiGenerator = new AICommentGeneratorService({
            apiKey: process.env.DEEPSEEK_API_KEY || "",
            baseUrl: "https://api.deepseek.com/v1",
            model: "deepseek-chat",
            enabled: CONFIG.aiEnabled,
        });

        account.client = new GramClientWithProxy(account.sessionValue, account.proxyConfig);
        await account.client.connect();

        account.commentPoster = new CommentPosterService(account.client.getClient());
        account.isActive = true;

        // Проверка на спам
        const isSpammed = await this.spamChecker.isAccountSpammedReliable(
            account.client.getClient(),
            `USA_${account.number}`
        );

        if (isSpammed) {
            throw new Error(`Аккаунт USA_${account.number} в спаме`);
        }

        this.log.info(`✅ Подключен USA_${account.number}`);
    }

    /**
     * Загрузка каналов из файла
     */
    private loadChannels(): ICommentTarget[] {
        if (!fs.existsSync(CONFIG.channelsFile)) {
            throw new Error(`Файл каналов не найден: ${CONFIG.channelsFile}`);
        }

        const content = fs.readFileSync(CONFIG.channelsFile, "utf-8");
        const lines = content
            .split("\n")
            .map(line => line.trim())
            .filter(line => line && !line.startsWith("#"));

        return lines.map(username => ({
            channelUsername: username.replace("@", ""),
            channelUrl: `https://t.me/${username.replace("@", "")}`,
            isActive: true,
        }));
    }

    /**
     * Сохранение успешного канала (с блокировкой)
     */
    private async saveSuccessfulChannel(channelUsername: string): Promise<void> {
        while (this.fileLock) await new Promise(r => setTimeout(r, 10));
        this.fileLock = true;

        try {
            const dir = require("path").dirname(CONFIG.successfulFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            let content = "";
            if (fs.existsSync(CONFIG.successfulFile)) {
                content = fs.readFileSync(CONFIG.successfulFile, "utf-8");
            }

            if (!content.includes(channelUsername)) {
                fs.appendFileSync(CONFIG.successfulFile, `${channelUsername}\n`, "utf-8");
            }
        } finally {
            this.fileLock = false;
        }
    }

    /**
     * Сохранение неудачного канала (с блокировкой)
     */
    private async saveUnavailableChannel(channelUsername: string, error: string): Promise<void> {
        while (this.fileLock) await new Promise(r => setTimeout(r, 10));
        this.fileLock = true;

        try {
            const dir = require("path").dirname(CONFIG.unavailableFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            let content = "";
            if (fs.existsSync(CONFIG.unavailableFile)) {
                content = fs.readFileSync(CONFIG.unavailableFile, "utf-8");
            }

            if (!content.includes(channelUsername)) {
                // Формат: канал | ошибка
                fs.appendFileSync(CONFIG.unavailableFile, `${channelUsername} | ${error}\n`, "utf-8");
            }
        } finally {
            this.fileLock = false;
        }
    }

    /**
     * Удаление канала из исходного файла (с блокировкой)
     */
    private async removeChannelFromFile(channelUsername: string): Promise<void> {
        while (this.fileLock) await new Promise(r => setTimeout(r, 10));
        this.fileLock = true;

        try {
            if (!fs.existsSync(CONFIG.channelsFile)) return;

            const content = fs.readFileSync(CONFIG.channelsFile, "utf-8");
            const lines = content.split("\n").filter(line => {
                const clean = line.trim().replace("@", "");
                return clean && clean !== channelUsername;
            });

            fs.writeFileSync(CONFIG.channelsFile, lines.join("\n") + "\n", "utf-8");
        } finally {
            this.fileLock = false;
        }
    }

    /**
     * Обёртка для таймаута
     */
    private async withTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number,
        errorMessage: string
    ): Promise<T> {
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
        });

        return Promise.race([promise, timeoutPromise]).finally(() => {
            clearTimeout(timeoutId);
        });
    }

    /**
     * Воркер для одного аккаунта (работает параллельно)
     */
    private async runWorker(account: USAAccount): Promise<void> {
        const stats: WorkerStats = {
            accountNumber: account.number,
            commentsCount: 0,
            errorsCount: 0,
            floodWaits: 0,
            isRunning: true,
        };
        this.workerStats.set(account.number, stats);

        this.log.info(`🔄 [USA_${account.number}] Воркер запущен`);

        while (!this.isShuttingDown) {
            // Получаем следующий канал из очереди
            const channel = await this.channelQueue.getNext();

            if (!channel) {
                this.log.info(`✅ [USA_${account.number}] Все каналы обработаны`);
                break;
            }

            try {
                // Отправляем комментарий
                const result = await this.withTimeout(
                    account.commentPoster!.postCommentLightWithAIAsync(
                        channel.channelUsername,
                        account.aiGenerator!
                    ),
                    CONFIG.operationTimeoutMs,
                    "Timeout"
                );

                if (!result.success) {
                    throw new Error(result.error || "Комментарий не отправлен");
                }

                // Успех!
                stats.commentsCount++;
                account.commentsCount++;

                await this.saveSuccessfulChannel(channel.channelUsername);
                await this.removeChannelFromFile(channel.channelUsername);

                this.log.info(`✅ [USA_${account.number}] @${channel.channelUsername}`, {
                    comment: (result.comment || "").substring(0, 40) + "...",
                    total: stats.commentsCount,
                    remaining: this.channelQueue.getRemaining(),
                });

            } catch (error: any) {
                const errorMsg = error.message || error.toString();

                // FLOOD_WAIT — ждём
                if (errorMsg.includes("FLOOD_WAIT") || error.code === 420) {
                    const waitMatch = errorMsg.match(/FLOOD_WAIT[_\s]*(\d+)|wait of (\d+) seconds/i);
                    const waitSeconds = waitMatch ? parseInt(waitMatch[1] || waitMatch[2]) : 60;

                    stats.floodWaits++;

                    if (waitSeconds > CONFIG.maxFloodWaitSeconds) {
                        this.log.error(`⛔ [USA_${account.number}] FLOOD_WAIT ${waitSeconds}s слишком большой, останавливаю воркер`);
                        break;
                    }

                    this.log.warn(`⏳ [USA_${account.number}] FLOOD_WAIT ${waitSeconds}s, ожидание...`);
                    await new Promise(r => setTimeout(r, waitSeconds * 1000));
                    continue; // Повторяем с этим же каналом? Нет, берём следующий
                }

                stats.errorsCount++;

                // Сохраняем неудачный канал
                await this.saveUnavailableChannel(channel.channelUsername, errorMsg.substring(0, 50));
                await this.removeChannelFromFile(channel.channelUsername);

                this.log.warn(`❌ [USA_${account.number}] @${channel.channelUsername}`, {
                    error: errorMsg.substring(0, 80),
                });
            }

            // Задержка между комментариями
            await new Promise(r => setTimeout(r, CONFIG.delayBetweenComments));
        }

        stats.isRunning = false;
        this.log.info(`🏁 [USA_${account.number}] Воркер завершён: ${stats.commentsCount} комментариев`);
    }

    /**
     * Основной запуск
     */
    async start(): Promise<void> {
        const startTime = Date.now();

        try {
            // 1. Загрузка аккаунтов
            this.loadUSAAccounts();

            // 2. Проверка прокси
            await this.checkAllProxies();

            // 3. Загрузка каналов
            const channels = this.loadChannels();
            this.channelQueue = new ChannelQueue(channels);
            this.log.info(`📋 Загружено ${channels.length} каналов`);

            // 4. Подключение ВСЕХ аккаунтов параллельно
            this.log.info("🔌 Подключение всех аккаунтов...");
            const connectPromises = this.accounts.map(async (account) => {
                try {
                    await this.connectAccount(account);
                    return { account, success: true };
                } catch (error: any) {
                    this.log.warn(`❌ Не удалось подключить USA_${account.number}: ${error.message}`);
                    return { account, success: false };
                }
            });

            const connectResults = await Promise.all(connectPromises);
            const connectedAccounts = connectResults
                .filter(r => r.success)
                .map(r => r.account);

            if (connectedAccounts.length === 0) {
                throw new Error("Не удалось подключить ни один аккаунт!");
            }

            this.log.info(`✅ Подключено ${connectedAccounts.length}/${this.accounts.length} аккаунтов`);
            this.log.info(`\n🚀 ЗАПУСК ${connectedAccounts.length} ПАРАЛЛЕЛЬНЫХ ВОРКЕРОВ\n`);

            // 5. Запускаем воркеры параллельно!
            const workerPromises = connectedAccounts.map(account => this.runWorker(account));

            // Ждём завершения всех воркеров
            await Promise.all(workerPromises);

            // 6. Статистика
            const duration = Math.round((Date.now() - startTime) / 1000 / 60);
            let totalComments = 0;
            let totalErrors = 0;

            this.log.info("\n" + "=".repeat(50));
            this.log.info("📊 ИТОГИ:");

            this.workerStats.forEach((stats, num) => {
                totalComments += stats.commentsCount;
                totalErrors += stats.errorsCount;
                this.log.info(`   USA_${num}: ${stats.commentsCount} ✅ | ${stats.errorsCount} ❌ | ${stats.floodWaits} ⏳`);
            });

            this.log.info("-".repeat(50));
            this.log.info(`   ВСЕГО: ${totalComments} комментариев`);
            this.log.info(`   Ошибок: ${totalErrors}`);
            this.log.info(`   Длительность: ${duration} минут`);
            this.log.info(`   Скорость: ${(totalComments / (duration || 1)).toFixed(1)} комм/мин`);
            this.log.info("=".repeat(50));

        } catch (error) {
            this.log.error("Критическая ошибка", error as Error);
            throw error;
        } finally {
            // Cleanup
            this.isShuttingDown = true;

            for (const account of this.accounts) {
                if (account.client) {
                    try {
                        await account.client.disconnect();
                    } catch {
                        // Игнорируем
                    }
                }
            }
        }
    }
}

// =============================================
// ЗАПУСК
// =============================================

const commenter = new USAAutoCommenter();
commenter.start().catch(error => {
    console.error("Фатальная ошибка:", error);
    process.exit(1);
});
