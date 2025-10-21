/**
 * Автоматический модуль комментирования с ротацией аккаунтов
 * Комментирует каналы с автоматической сменой аккаунтов после 150 комментариев
 * 
 * Запуск: npm run comment:auto-rotation
 */

import { GramClient } from '../../telegram/adapters/gramClient';
import { CommentPosterService, ICommentTarget, ICommentingOptionsWithAI, ICommentingResponseWithAI } from '../../app/commentPoster';
import { AICommentGeneratorService } from '../../app/aiCommentGenerator';
import { AccountRotatorService } from '../../app/accountRotator/services/accountRotatorService';
import { IAccountInfo, IRotationResult } from '../../app/accountRotator/interfaces/IAccountRotator';
import { createStopMessage, analyzeFloodWaitError } from '../../shared/utils/floodWaitHandler';
import { EnvAccountsParser } from '../../shared/utils/envAccountsParser';
import { SpamChecker, ISpamCheckResult } from '../../shared/services/spamChecker';
import { ChannelJoinerService, IJoinTarget, IJoinAttemptResult } from '../../app/channelJoiner';
import * as fs from 'fs';
import * as path from 'path';

// Конфигурация модуля
const MODULE_CONFIG = {
    channelsDir: './input-channels', // Директория с файлами каналов
    channelsFile: 'channels.txt', // Основной файл с каналами
    processedChannelsFile: 'processed.txt', // Файл обработанных каналов
    maxCommentsPerAccount: 150,
    delayBetweenComments: 3000,
    delayBetweenRotations: 10000,
    enableAI: true,
    dryRun: false,
    targetChannel: process.env.TARGET_CHANNEL || '',
    maxCycles: 0,
    autoRestart: false,
    logLevel: 'INFO', // ERROR, WARN, INFO, DEBUG
    // Новые параметры для стабильности соединения
    connectionTimeout: 120000, // 2 минуты timeout для операций
    maxRetries: 3, // Максимум повторных попыток при ошибках
    retryDelay: 5000, // Задержка между повторными попытками
    reconnectOnTimeout: true // Переподключение при таймаутах
};

// AI конфигурация
const AI_CONFIG = {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    enabled: !!process.env.DEEPSEEK_API_KEY && MODULE_CONFIG.enableAI,
    timeout: 30000
};

interface IRotationSession {
    sessionId: string;
    startTime: Date;
    totalChannels: number;
    processedChannels: number;
    totalComments: number;
    totalRotations: number;
    currentAccount: string;
    isActive: boolean;
    cycleCount: number;
    errors: string[];
}

// Киберпанк AI логирование система
class CyberLogger {
    private static getTimestamp(): string {
        return new Date().toISOString().slice(11, 19);
    }
    
    // Основные системные сообщения
    static sys(message: string) {
        console.log(`\n>> SYS [${this.getTimestamp()}] ${message}`);
    }
    
    // AI операции
    static ai(message: string) {
        console.log(`   AI  │ ${message}`);
    }
    
    // Операции с аккаунтами
    static acc(account: string, status: string) {
        console.log(`   ACC │ ${account} :: ${status}`);
    }
    
    // Состояние процесса
    static proc(current: number, total: number, target?: string) {
        const bar = '█'.repeat(Math.floor((current / total) * 20));
        const empty = '▒'.repeat(20 - bar.length);
        console.log(`   [${bar}${empty}] ${current}/${total} ${target || ''}`);
    }
    
    // Критические ошибки
    static err(message: string) {
        console.log(`\n!! ERR [${this.getTimestamp()}] ${message}\n`);
    }
    
    // Успешные операции
    static ok(message: string) {
        console.log(`   ✓   │ ${message}`);
    }
    
    // Предупреждения
    static warn(message: string) {
        console.log(`   !   │ ${message}`);
    }
    
    // Технические данные
    static data(key: string, value?: string | number) {
        if (value !== undefined) {
            console.log(`   DAT │ ${key}: ${value}`);
        } else {
            console.log(`   DAT │ ${key}`);
        }
    }
    
    // Разделители секций
    static section(name: string) {
        console.log(`\n═══ ${name.toUpperCase()} ═══`);
    }
}

class AutoCommentWithRotationService {
    private gramClient!: GramClient;
    private accountRotator: AccountRotatorService;
    private commentPoster!: CommentPosterService;
    private aiGenerator: AICommentGeneratorService;
    private channelJoiner!: ChannelJoinerService;
    private session: IRotationSession;
    private channels: ICommentTarget[] = [];
    private targetChannelAccount: IAccountInfo | null = null;
    private spamChecker: SpamChecker;
    // Удалено: processedChannels - теперь сразу удаляем из файла

    constructor() {
        // Подавляем лишние логи gramJS
        const originalConsoleLog = console.log;
        const originalConsoleWarn = console.warn;
        
        console.log = (...args) => {
            // Проверяем, что args не пустой
            if (!args || args.length === 0) return;

            // Безопасное получение сообщения
            const message = String(args[0] || '');

            if (message.includes('[INFO]') ||
                message.includes('[WARN]') ||
                message.includes('Подключение к Telegram') ||
                message.includes('Успешно подключено к Telegram') ||
                message.includes('connection closed')) {
                return; // Подавляем эти логи
            }
            originalConsoleLog.apply(console, args);
        };
        
        console.warn = (...args) => {
            // Проверяем, что args не пустой
            if (!args || args.length === 0) return;

            // Безопасное получение сообщения
            const message = String(args[0] || '');

            if (message.includes('Disconnecting') || message.includes('connection closed')) {
                return;
            }
            originalConsoleWarn.apply(console, args);
        };

        // Инициализация сессии
        this.session = {
            sessionId: `rotation_${Date.now()}`,
            startTime: new Date(),
            totalChannels: 0,
            processedChannels: 0,
            totalComments: 0,
            totalRotations: 0,
            currentAccount: '',
            isActive: true,
            cycleCount: 0,
            errors: []
        };

        // Инициализация SpamChecker
        this.spamChecker = new SpamChecker();

        // Создаем ротатор аккаунтов СНАЧАЛА
        this.accountRotator = new AccountRotatorService({
            maxCommentsPerAccount: MODULE_CONFIG.maxCommentsPerAccount,
            delayBetweenRotations: MODULE_CONFIG.delayBetweenRotations / 1000,
            saveProgress: true // Включаем сохранение состояния для отслеживания прогресса
        });
        
        // GramClient будем создавать в initialize() после установки сессии
        this.aiGenerator = new AICommentGeneratorService(AI_CONFIG);

        CyberLogger.sys('ROTATION MODULE ONLINE');
        CyberLogger.data('COMMENT_LIMIT', MODULE_CONFIG.maxCommentsPerAccount);
        CyberLogger.data('AI_STATUS', AI_CONFIG.enabled ? 'ACTIVE' : 'OFFLINE');
    }

    /**
     * Основной метод запуска автокомментирования
     */
    async start(): Promise<void> {
        try {
            // Инициализация
            await this.initialize();

            // Основной цикл
            await this.runMainLoop();

            // Завершение
            await this.finalize();

        } catch (error) {
            await this.handleCriticalError(error);
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Инициализация всех компонентов
     */
    private async initialize(): Promise<void> {
        CyberLogger.section('INITIALIZATION');

        const firstAccount = this.accountRotator.getCurrentAccount();
        process.env.SESSION_STRING = firstAccount.sessionValue;
        CyberLogger.acc(firstAccount.name, 'ACTIVE');
        
        // Создаем GramClient и подключаемся
        this.gramClient = new GramClient();
        await this.gramClient.connect();
        this.commentPoster = new CommentPosterService(this.gramClient.getClient());
        this.channelJoiner = new ChannelJoinerService(this.gramClient.getClient());

        if (AI_CONFIG.enabled) {
            const aiHealthy = await this.aiGenerator.checkHealthAsync();
            if (!aiHealthy) {
                CyberLogger.warn('AI_SERVICE :: OFFLINE');
                AI_CONFIG.enabled = false;
            } else {
                CyberLogger.ai('CORE SYSTEMS ONLINE');
            }
        }
        
        // Загрузка каналов
        await this.loadChannels();

        // Поиск аккаунта с целевым каналом
        await this.findAccountWithTargetChannel();
        
        CyberLogger.sys('INITIALIZATION COMPLETE - READY FOR DEPLOYMENT');
    }

    /**
     * Создание директории для каналов
     */
    private ensureChannelsDirectory(): void {
        if (!fs.existsSync(MODULE_CONFIG.channelsDir)) {
            fs.mkdirSync(MODULE_CONFIG.channelsDir, { recursive: true });
        }
    }

    /**
     * Загрузка каналов для комментирования
     */
    private async loadChannels(): Promise<void> {
        this.ensureChannelsDirectory();

        const channelsFilePath = path.join(MODULE_CONFIG.channelsDir, MODULE_CONFIG.channelsFile);

        // Создаем файл каналов если его нет
        if (!fs.existsSync(channelsFilePath)) {
            const sampleChannels = [
                '# Пример каналов для комментирования:',
                '# durov',
                '# telegram',
                '# Добавьте свои каналы здесь, по одному на строку'
            ].join('\n');

            fs.writeFileSync(channelsFilePath, sampleChannels, 'utf-8');
            CyberLogger.warn('SAMPLE_FILE_CREATED - ADD_CHANNELS_AND_RESTART');
            throw new Error('Нужно добавить каналы в файл');
        }

        // Загружаем все каналы из channels.txt
        const channelsContent = fs.readFileSync(channelsFilePath, 'utf-8');
        const channelUsernames = channelsContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));

        if (channelUsernames.length === 0) {
            throw new Error('Список каналов пуст - все каналы обработаны!');
        }

        // Преобразуем в объекты каналов
        this.channels = channelUsernames.map(username => ({
            channelUsername: username.replace('@', ''),
            channelUrl: `https://t.me/${username.replace('@', '')}`,
            isActive: true
        }));

        this.session.totalChannels = this.channels.length;
        CyberLogger.data('CHANNELS_LOADED', this.channels.length);
    }

    /**
     * Удалить обработанный канал из основного файла channels.txt
     */
    private async removeChannelFromFile(channelUsername: string): Promise<void> {
        const channelsFilePath = path.join(MODULE_CONFIG.channelsDir, MODULE_CONFIG.channelsFile);
        
        try {
            // Читаем текущие каналы
            const channelsContent = fs.readFileSync(channelsFilePath, 'utf-8');
            const lines = channelsContent.split('\n');
            
            // Фильтруем - удаляем обработанный канал
            const filteredLines = lines.filter(line => {
                const cleanLine = line.trim().replace('@', '');
                const targetUsername = channelUsername.replace('@', '');
                return cleanLine !== targetUsername;
            });
            
            // Перезаписываем файл
            fs.writeFileSync(channelsFilePath, filteredLines.join('\n'), 'utf-8');
            
            const removedCount = lines.length - filteredLines.length;
            
        } catch (error) {
            CyberLogger.warn(`FILE_OPERATION_ERROR: ${error}`);
        }
    }

    /**
     * Поиск аккаунта с доступным целевым каналом
     * ВАЖНО: Сначала находим канал, потом проверяем на спам
     */
    private async findAccountWithTargetChannel(): Promise<void> {
        if (!MODULE_CONFIG.targetChannel) {
            return;
        }

        CyberLogger.section('TARGET CHANNEL SCAN');
        CyberLogger.data('SCANNING_FOR', MODULE_CONFIG.targetChannel);
        
        const allAccounts = this.accountRotator.getAllAccounts();
        let foundAccount: IAccountInfo | null = null;
        let targetChannel: any = null;
        let needsTransfer = false;

        for (const account of allAccounts) {
            CyberLogger.acc(account.name, 'SCANNING...');
            
            try {
                await this.switchTelegramAccount(account, true); // true = пропустить проверку спама при поиске
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                const userChannels = await this.commentPoster.getUserChannelsAsync();
                
                const foundChannel = userChannels.find(channel =>
                    channel.username?.toLowerCase() === MODULE_CONFIG.targetChannel.replace('@', '').toLowerCase()
                );
                
                if (foundChannel) {
                    CyberLogger.ok(`CHANNEL FOUND :: ${foundChannel.title}`);
                    
                    const spamCheckResult = await this.spamChecker.checkAccountSpamStatus(
                        this.gramClient.getClient(), 
                        account.name
                    );
                    
                    if (spamCheckResult.isSpammed) {
                        CyberLogger.warn(`SPAM_DETECTED :: TRANSFER_REQUIRED`);
                        needsTransfer = true;
                        foundAccount = account;
                        targetChannel = foundChannel;
                        break;
                    } else {
                        CyberLogger.acc(account.name, 'CLEAN :: READY');
                        foundAccount = account;
                        targetChannel = foundChannel;
                        break;
                    }
                } else {
                    CyberLogger.acc(account.name, 'NO_CHANNEL');
                }
                
            } catch (error) {
                CyberLogger.warn(`SCAN_ERROR :: ${account.name}`);
                continue;
            }
        }

        if (needsTransfer && foundAccount && targetChannel) {
            CyberLogger.section('CHANNEL TRANSFER PROTOCOL');
            
            const cleanAccount = await this.findNextCleanAccount(foundAccount);
            if (!cleanAccount) {
                CyberLogger.err('ALL_ACCOUNTS_COMPROMISED :: SYSTEM_HALT');
                throw new Error('КРИТИЧЕСКАЯ ОШИБКА: Все аккаунты в спаме. Невозможно работать.');
            }
            
            console.log(`📺 Передаю канал ${targetChannel.title} с ${foundAccount.name} на ${cleanAccount.name}`);
            
            try {
                await this.transferChannelToNextAccount(cleanAccount);
                console.log(`✅ Канал успешно передан на ${cleanAccount.name}`);
                
                // Обновляем информацию о владельце
                this.targetChannelAccount = cleanAccount;
                this.accountRotator.setActiveAccount(cleanAccount.name);
                
                // Переключаемся на нового владельца
                await this.switchTelegramAccount(cleanAccount);
                
            } catch (transferError) {
                console.error(`❌ Не удалось передать канал: ${transferError}`);
                throw new Error(`КРИТИЧЕСКАЯ ОШИБКА: Не удалось передать канал с заспамленного аккаунта`);
            }
            
        } else if (foundAccount && targetChannel) {
            // Канал найден на чистом аккаунте
            this.targetChannelAccount = foundAccount;
            console.log(`🎯 Будет использован: ${foundAccount.name} -> ${targetChannel.title}`);
            this.accountRotator.setActiveAccount(foundAccount.name);
        } else {
            console.log(`❌ ${MODULE_CONFIG.targetChannel} не найден ни на одном аккаунте!`);
            throw new Error(`КРИТИЧЕСКАЯ ОШИБКА: Канал ${MODULE_CONFIG.targetChannel} не найден. Скрипт не может работать без канала для отправки.`);
        }
    }
    
    /**
     * Найти следующий чистый аккаунт для передачи канала
     */
    private async findNextCleanAccount(excludeAccount: IAccountInfo): Promise<IAccountInfo | null> {
        const allAccounts = this.accountRotator.getAllAccounts();
        
        for (const account of allAccounts) {
            if (account.name === excludeAccount.name) continue;
            
            console.log(`🔍 Проверяю ${account.name} на спам...`);
            
            try {
                await this.switchTelegramAccount(account, true); // Пропускаем проверку спама при переключении
                
                const spamCheckResult = await this.spamChecker.checkAccountSpamStatus(
                    this.gramClient.getClient(), 
                    account.name
                );
                
                if (!spamCheckResult.isSpammed) {
                    console.log(`✅ ${account.name} чистый - подходит для передачи`);
                    return account;
                } else {
                    console.log(`🚫 ${account.name} тоже в спаме`);
                }
                
            } catch (error) {
                console.log(`⚠️ Ошибка проверки ${account.name}: ${error}`);
                continue;
            }
        }
        
        return null;
    }

    /**
     * Поиск целевого канала для отправки от его имени
     * КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: Скрипт не работает без канала
     */
    private async findTargetChannel(): Promise<any> {
        if (!MODULE_CONFIG.targetChannel || !this.targetChannelAccount) {
            throw new Error('КРИТИЧЕСКАЯ ОШИБКА: Целевой канал не найден. Комментирование от личных аккаунтов запрещено.');
        }

        // Проверяем, что мы на аккаунте с доступом к каналу
        const currentAccount = this.accountRotator.getCurrentAccount();
        if (currentAccount.name !== this.targetChannelAccount.name) {
            console.log(`🔄 Переключение на аккаунт с целевым каналом: ${this.targetChannelAccount.name}`);
            await this.switchTelegramAccount(this.targetChannelAccount);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        console.log(`🔍 Получение информации о канале ${MODULE_CONFIG.targetChannel}...`);

        const userChannels = await this.commentPoster.getUserChannelsAsync();
        
        const targetChannel = userChannels.find(channel =>
            channel.username?.toLowerCase() === MODULE_CONFIG.targetChannel.replace('@', '').toLowerCase()
        );

        if (!targetChannel) {
            throw new Error(`КРИТИЧЕСКАЯ ОШИБКА: Канал ${MODULE_CONFIG.targetChannel} недоступен на аккаунте ${currentAccount.name}. Скрипт остановлен.`);
        }

        console.log(`✅ Целевой канал подтвержден: ${targetChannel.title} (@${targetChannel.username})`);
        return targetChannel;
    }

    /**
     * Основной цикл выполнения
     */
    private async runMainLoop(): Promise<void> {
        CyberLogger.section('MAIN PROCESSING LOOP');
        
        // Получаем канал от правильного владельца
        let targetChannel = await this.findTargetChannel();
        let channelIndex = 0;
        let completedCycles = 0;

        while (this.session.isActive) {
            if (MODULE_CONFIG.maxCycles > 0 && completedCycles >= MODULE_CONFIG.maxCycles) {
                CyberLogger.data('CYCLE_LIMIT_REACHED', MODULE_CONFIG.maxCycles);
                break;
            }

            // Синхронизируем текущий аккаунт с ротатором
            const currentAccount = this.accountRotator.getCurrentAccount();
            this.session.currentAccount = currentAccount.name;
            
            // Проверяем соответствие аккаунта владельцу канала
            if (this.targetChannelAccount && currentAccount.name !== this.targetChannelAccount.name) {
                CyberLogger.warn('ACCOUNT_SYNC_ISSUE :: CORRECTING');
                
                this.accountRotator.setActiveAccount(this.targetChannelAccount.name);
                const syncedAccount = this.accountRotator.getCurrentAccount();
                this.session.currentAccount = syncedAccount.name;
                
                CyberLogger.acc(syncedAccount.name, 'SYNCED');
            }

            console.log(`
🤖 ${currentAccount.name}: ${currentAccount.commentsCount}/${currentAccount.maxCommentsPerSession} нейрокомментариев`);

            await this.switchTelegramAccount(currentAccount);
            await new Promise(resolve => setTimeout(resolve, MODULE_CONFIG.delayBetweenRotations));

            while (!this.accountRotator.shouldRotate() && channelIndex < this.channels.length) {
                const channel = this.channels[channelIndex];
                const totalChannelsProcessed = this.session.processedChannels;
                const totalChannelsInFile = this.session.totalChannels;
                
                // Любое обращение к каналу считается
                this.accountRotator.incrementCommentCount();
                this.session.processedChannels++;
                
                let commentSuccess = false;
                try {
                    await this.commentChannel(channel, targetChannel);
                    this.session.totalComments++;
                    commentSuccess = true;
                    
                    // Добавляем в успешные каналы
                    await this.addToSuccessfulChannels(channel.channelUsername);
                    
                    console.log(`✅ @${channel.channelUsername}`);

                } catch (error) {
                    console.log(`❌ @${channel.channelUsername}`);
                    this.session.errors.push(`@${channel.channelUsername}: ${error}`);
                    
                    // Проверка на спам при ошибках
                    const errorAnalysis = SpamChecker.analyzeError(error);
                    if (errorAnalysis.shouldCheckSpam) {
                        CyberLogger.data('SPAM_CHECK', 'ERROR_TRIGGERED');
                        
                        try {
                            const currentAccount = this.accountRotator.getCurrentAccount();
                            const isSpammed = await this.spamChecker.isAccountSpammed(
                                this.gramClient.getClient(), 
                                currentAccount.name
                            );
                            
                            if (isSpammed) {
                                CyberLogger.warn(`SPAM_DETECTED :: ${currentAccount.name} :: TRANSFER_REQUIRED`);
                                await this.handleSpamDetection();
                                return;
                            }
                        } catch (spamCheckError) {
                            CyberLogger.warn('SPAM_CHECK_FAILED');
                        }
                    }
                    
                    if (this.isCriticalError(error)) {
                        throw error;
                    }
                }

                await this.removeChannelFromFile(channel.channelUsername);

                channelIndex++;

                if (channelIndex < this.channels.length) {
                    await new Promise(resolve => setTimeout(resolve, MODULE_CONFIG.delayBetweenComments)); // Используем конфиг
                }
            }

            if (channelIndex >= this.channels.length) {
                CyberLogger.section('NEW CYCLE INITIATED');
                channelIndex = 0;
                completedCycles++;
                this.session.cycleCount = completedCycles;
                
                try {
                    await this.loadChannels();
                    CyberLogger.data('CHANNELS_RELOADED', this.channels.length);
                } catch (error) {
                    if (error instanceof Error && error.message.includes('пуст')) {
                        CyberLogger.sys('ALL TARGETS PROCESSED :: MISSION COMPLETE');
                        this.session.isActive = false;
                        break;
                    }
                    throw error;
                }
                
                if (this.accountRotator.isFullCycleComplete()) {
                    this.accountRotator.resetAccountCounters();
                }
            }

            if (this.accountRotator.shouldRotate()) {
                const rotationResult = await this.performAccountRotation();
                if (!rotationResult.success) {
                    CyberLogger.err(`ROTATION_FAILED :: ${rotationResult.reason}`);
                    break;
                }
                
                // После ротации нужно заново найти целевой канал
                const newAccount = this.accountRotator.getCurrentAccount();
                if (this.targetChannelAccount && newAccount.name === this.targetChannelAccount.name) {
                    try {
                        targetChannel = await this.findTargetChannel();
                        CyberLogger.data('Target channel restored after rotation');
                    } catch (error) {
                        // Игнорируем ошибку - канал появится после обновления API
                        CyberLogger.data('Channel check skipped - API sync pending');
                        // Не выбрасываем ошибку, продолжаем работу
                    }
                }
            }
        }
    }

    /**
     * Переключение Telegram клиента на другой аккаунт
     */
    private async switchTelegramAccount(account: IAccountInfo, skipSpamCheck: boolean = false): Promise<void> {
        try {
            await this.gramClient.disconnect();
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            process.env.SESSION_STRING = account.sessionValue;
            this.gramClient = new GramClient();
            await this.gramClient.connect();
            
            this.commentPoster = new CommentPosterService(this.gramClient.getClient());
            this.channelJoiner = new ChannelJoinerService(this.gramClient.getClient());
            
            if (!skipSpamCheck) {
                const spamCheckResult = await this.spamChecker.checkAccountSpamStatus(
                    this.gramClient.getClient(), 
                    account.name
                );
                
                if (spamCheckResult.floodWait) {
                    CyberLogger.err(`FLOOD_WAIT detected for ${account.name}, exiting`);
                    process.exit(1);
                } else if (spamCheckResult.isSpammed) {
                    if (this.targetChannelAccount && this.targetChannelAccount.name === account.name) {
                        await this.handleSpamDetection();
                    }
                    throw new Error(`SPAM_DETECTED: Account ${account.name} is spammed`);
                }
            }
            
        } catch (error: any) {
            const errorString = error.message || error.toString() || '';
            if (error.isFloodWait || errorString.includes('FLOOD_WAIT')) {
                CyberLogger.err(`FLOOD_WAIT error for ${account.name}, exiting`);
                process.exit(1);
            } else if (!errorString.includes('SPAM_DETECTED')) {
                CyberLogger.warn(`Spam check failed for ${account.name}, continuing`);
            } else {
                throw error;
            }
        }
    }

    /**
     * Комментирование одного канала
     * УПРОЩЕНО: Минимум операций, только проверка дубликатов и отправка
     */
    private async commentChannel(channel: ICommentTarget, targetChannel?: any): Promise<void> {
        const currentAccount = this.accountRotator.getCurrentAccount();
        
        if (!targetChannel) {
            throw new Error('Target channel not available');
        }
        
        // Проверка дубликатов комментариев
        const hasExistingComment = await this.checkExistingComments(channel.channelUsername, targetChannel);
        
        if (hasExistingComment) {
            console.log(`⏭️  @${channel.channelUsername} - уже прокомментирован`);
            await this.addToSuccessfulChannels(channel.channelUsername);
            return;
        }

        // Настройки комментирования
        const sendAsOptions = {
            useChannelAsSender: true,
            selectedChannelId: targetChannel.username,
            selectedChannelTitle: targetChannel.title
        };

        const options: ICommentingOptionsWithAI = {
            targets: [channel],
            messages: [],
            delayBetweenComments: MODULE_CONFIG.delayBetweenComments,
            maxCommentsPerSession: 1,
            randomizeOrder: false,
            skipRecentlyCommented: false,
            dryRun: MODULE_CONFIG.dryRun,
            useAI: AI_CONFIG.enabled,
            aiGenerator: this.aiGenerator,
            sendAsOptions
        };

        // Отправка комментария
        const result: ICommentingResponseWithAI = await this.commentPoster.postCommentsWithAIAsync(options);

        if (result.successfulComments > 0) {
            const commentText = result.results[0]?.commentText || 'unknown';
            console.log(`  💬 ${commentText.substring(0, 50)}${commentText.length > 50 ? '...' : ''}`);
        } else if (result.results.length > 0) {
            const error = result.results[0]?.error || 'Unknown error';
            
            // Обработка ошибок доступа
            if (error.includes('CHAT_GUEST_SEND_FORBIDDEN') || 
                error.includes('USER_BANNED_IN_CHANNEL') ||
                error.includes('CHANNELS_TOO_MUCH')) {
                throw new Error(`Access denied to channel`);
            }
            
            throw new Error(error);
        } else {
            throw new Error('No comment results');
        }
    }

    /**
     * Выполнение ротации аккаунта с автоматической передачей канала
     */
    private async performAccountRotation(): Promise<IRotationResult> {
        console.log(`🔄 Ротация...`);
        
        try {
            const currentAccount = this.accountRotator.getCurrentAccount();
            const rotationResult = await this.accountRotator.rotateToNextAccount();
            
            if (rotationResult.success) {
                this.session.totalRotations++;
                CyberLogger.acc(`${rotationResult.previousAccount.name} → ${rotationResult.newAccount.name}`, 'ROTATED');
                
                // Автоматическая передача канала целевого канала
                if (this.targetChannelAccount && currentAccount.name === this.targetChannelAccount.name) {
                    CyberLogger.data('TRANSFER_INIT', `${currentAccount.name} → ${rotationResult.newAccount.name}`);
                    
                    try {
                        await this.transferChannelToNextAccount(rotationResult.newAccount);
                        CyberLogger.ok(`TRANSFER_COMPLETE :: ${rotationResult.newAccount.name}`);
                        this.targetChannelAccount = rotationResult.newAccount;
                    } catch (transferError) {
                        CyberLogger.err(`TRANSFER_ERROR :: ${transferError}`);
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            
            return rotationResult;
            
        } catch (error) {
            return {
                success: false,
                previousAccount: this.accountRotator.getCurrentAccount(),
                newAccount: this.accountRotator.getCurrentAccount(),
                reason: `Ошибка ротации: ${error}`,
                rotationTime: new Date()
            };
        }
    }

    /**
     * Передача канала целевого канала следующему аккаунту
     * ВАЖНО: Передача происходит с текущего владельца канала
     */
    private async transferChannelToNextAccount(nextAccount: IAccountInfo): Promise<void> {
        if (!this.targetChannelAccount) {
            throw new Error('Не определен текущий владелец канала целевого канала');
        }
        
        CyberLogger.data('Starting channel ownership transfer');
        CyberLogger.data(`From: ${this.targetChannelAccount.name} to ${nextAccount.name}`);
        
        // Импортируем ChannelOwnershipRotatorService
        const { ChannelOwnershipRotatorService } = await import('../../app/ownershipRotator/services/channelOwnershipRotatorService');
        
        // Получаем пароль текущего владельца (от кого передаем)
        const ownerPassword = this.getPasswordForSessionKey(this.targetChannelAccount.sessionKey);
        if (!ownerPassword) {
            throw new Error(`Пароль не найден для текущего владельца ${this.targetChannelAccount.name}`);
        }
        
        // Username целевого аккаунта (кому передаем)
        const targetUsername = nextAccount.username;
        if (!targetUsername) {
            throw new Error(`Username не найден для аккаунта ${nextAccount.name}`);
        }
        
        // Подготовка запроса на передачу - используем сессию ТЕКУЩЕГО ВЛАДЕЛЬЦА
        const transferRequest = {
            sessionString: this.targetChannelAccount.sessionValue, // Сессия текущего владельца
            channelIdentifier: process.env.TARGET_CHANNEL || '',
            targetUserIdentifier: targetUsername.replace('@', ''),
            password: ownerPassword // Пароль текущего владельца
        };
        
        CyberLogger.data(`Executing transfer using session: ${this.targetChannelAccount.name}`);
        
        try {
            // Выполнение передачи
            const ownershipService = new ChannelOwnershipRotatorService();
            const result = await ownershipService.transferOwnershipAsync(transferRequest);
            
            if (!result.success) {
                throw new Error(`Передача не удалась: ${result.error || 'Неизвестная ошибка'}`);
            }
            
            CyberLogger.sys(`Channel ownership transferred to ${nextAccount.name}`);
            
            // ВАЖНО: Обновляем информацию о текущем владельце канала
            this.targetChannelAccount = nextAccount;
            
        } catch (error: any) {
            const errorMessage = error.message || error.toString();
            
            // Детальная обработка ошибок передачи
            if (errorMessage.includes('CHAT_ADMIN_REQUIRED')) {
                throw new Error(`${this.targetChannelAccount.name} не является владельцем канала целевого канала. Возможно, канал уже был передан другому аккаунту.`);
            } else if (errorMessage.includes('PASSWORD_HASH_INVALID')) {
                throw new Error(`Неверный пароль 2FA для ${this.targetChannelAccount.name}. Проверьте PASSWORD_${this.targetChannelAccount.sessionKey.replace('SESSION_STRING_', '')} в .env`);
            } else {
                throw error;
            }
        }
    }

    /**
     * Получение пароля для сессии из .env
     */
    private getPasswordForSessionKey(sessionKey: string): string | null {
        const env = process.env;
        
        const passwordMap: { [key: string]: string } = {
            'SESSION_STRING_1': env.PASSWORD_1 || '',
            'SESSION_STRING_2': env.PASSWORD_2 || '',
            'SESSION_STRING_3': env.PASSWORD_3 || '',
            'SESSION_STRING_4': env.PASSWORD_4 || '',
            'SESSION_STRING_5': env.PASSWORD_5 || '',
            'SESSION_STRING_6': env.PASSWORD_6 || '',
            'SESSION_STRING_7': env.PASSWORD_7 || ''
        };
        
        return passwordMap[sessionKey] || null;
    }

    /**
     * Получение username для сессии из .env
     */
    private getUsernameForSessionKey(sessionKey: string): string | null {
        const env = process.env;
        
        const usernameMap: { [key: string]: string } = {
            'SESSION_STRING_1': env.USERNAME_1 || '',
            'SESSION_STRING_2': env.USERNAME_2 || '',
            'SESSION_STRING_3': env.USERNAME_3 || '',
            'SESSION_STRING_4': env.USERNAME_4 || '',
            'SESSION_STRING_5': env.USERNAME_5 || '',
            'SESSION_STRING_6': env.USERNAME_6 || '',
            'SESSION_STRING_7': env.USERNAME_7 || ''
        };
        
        return usernameMap[sessionKey] || null;
    }

    /**
     * Проверка на критические ошибки
     */
    private isCriticalError(error: any): boolean {
        const errorMessage = (error?.message || error || '').toString().toLowerCase();
        
        const criticalErrors = [
            'flood wait',
            'flood_wait',
            'too many requests',
            'network error',
            'connection failed'
        ];

        return criticalErrors.some(critical => errorMessage.includes(critical));
    }


    /**
     * Обработка критических ошибок
     */
    private async handleCriticalError(error: any): Promise<void> {
        console.error(`\n💥 === КРИТИЧЕСКАЯ ОШИБКА ===`);
        
        // Анализируем ошибку FloodWait
        const floodAnalysis = analyzeFloodWaitError(error);
        if (floodAnalysis.isFloodWait) {
            console.error(createStopMessage(floodAnalysis.seconds, 'АВТОКОММЕНТИРОВАНИЕ С РОТАЦИЕЙ'));
            console.error(`💡 Рекомендация: Перезапустите через ${floodAnalysis.hours} часов`);
        } else {
            console.error(`❌ Ошибка:`, error?.message || error);
        }

        this.session.isActive = false;
    }

    /**
     * Завершение работы модуля
     */
    private async finalize(): Promise<void> {
        console.log(`\n🏁 === ЗАВЕРШЕНИЕ РАБОТЫ ===`);
        
        const summary = this.accountRotator.getRotationSummary();
        const duration = new Date().getTime() - this.session.startTime.getTime();
        
        console.log(`📊 Итоговая статистика:`);
        console.log(`   • Сессия: ${this.session.sessionId}`);
        console.log(`   • Длительность: ${this.formatDuration(duration)}`);
        console.log(`   • Обработано каналов: ${this.session.processedChannels}/${this.session.totalChannels}`);
        console.log(`   • Всего комментариев: ${summary.totalCommentsPosted}`);
        console.log(`   • Использовано аккаунтов: ${summary.totalAccountsUsed}`);
        console.log(`   • Выполнено ротаций: ${summary.totalRotations}`);
        console.log(`   • Завершенных циклов: ${summary.completeCycles}`);
        console.log(`   • Ошибок: ${this.session.errors.length}`);
        
        if (summary.totalAccountsUsed > 0) {
            console.log(`   • Среднее комментариев на аккаунт: ${Math.round(summary.averageCommentsPerAccount)}`);
        }

        if (this.session.errors.length > 0) {
            console.log(`\n⚠️ Ошибки (последние 5):`);
            this.session.errors.slice(-5).forEach((error, index) => {
                console.log(`   ${index + 1}. ${error}`);
            });
        }


        console.log(`\n✅ Автокомментирование с ротацией завершено успешно!`);
        
        // Автоматический рестарт если включен
        if (MODULE_CONFIG.autoRestart && MODULE_CONFIG.maxCycles > 0) {
            console.log(`\n🔄 Автоматический рестарт включен...`);
            setTimeout(() => {
                this.start();
            }, 30000); // Рестарт через 30 секунд
        }
    }

    /**
     * 🎯 MVP: Загрузка списка успешных каналов из файла
     */
    private async loadSuccessfulChannels(): Promise<string[]> {
        const successfulFilePath = path.join(MODULE_CONFIG.channelsDir, 'successful-channels.txt');
        
        try {
            if (!fs.existsSync(successfulFilePath)) {
                console.log('📄 Создаю файл successful-channels.txt...');
                await fs.promises.writeFile(successfulFilePath, '# Успешные каналы (автоматически пополняется)\n', 'utf8');
                return [];
            }
            
            const content = await fs.promises.readFile(successfulFilePath, 'utf8');
            const successful = content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'))
                .map(line => line.replace('@', ''));
                
            console.log(`✅ Загружено ${successful.length} успешных каналов`);
            return successful;
            
        } catch (error) {
            console.log(`⚠️ Ошибка загрузки successful-channels.txt: ${error}`);
            return [];
        }
    }

    /**
     * 🎯 MVP: Динамическое добавление успешного канала в файл
     */
    private async addToSuccessfulChannels(channelUsername: string): Promise<void> {
        const successfulFilePath = path.join(MODULE_CONFIG.channelsDir, 'successful-channels.txt');
        const cleanUsername = channelUsername.replace('@', '');
        
        try {
            // Проверяем, есть ли канал уже в файле
            const existingContent = fs.existsSync(successfulFilePath) 
                ? await fs.promises.readFile(successfulFilePath, 'utf8') 
                : '';
                
            if (existingContent.includes(cleanUsername)) {
                return; // Канал уже есть
            }
            
            // Добавляем новый успешный канал
            const newLine = `@${cleanUsername}\n`;
            
            await fs.promises.appendFile(successfulFilePath, newLine, 'utf8');
            console.log(`💾 @${cleanUsername} добавлен в успешные каналы`);
            
        } catch (error) {
            console.log(`⚠️ Ошибка сохранения @${cleanUsername} в successful-channels.txt: ${error}`);
        }
    }

    /**
     * 🔄 Обертка для операций с повторными попытками и обработкой таймаутов
     */
    private async executeWithRetry<T>(operation: () => Promise<T>, operationName: string, retries = MODULE_CONFIG.maxRetries): Promise<T> {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                // Устанавливаем таймаут для операции
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('OPERATION_TIMEOUT')), MODULE_CONFIG.connectionTimeout);
                });
                
                const result = await Promise.race([operation(), timeoutPromise]);
                return result;
                
            } catch (error: any) {
                const errorMessage = error?.message || error?.toString() || 'Unknown error';
                
                // Проверяем, является ли ошибка таймаутом или сетевой ошибкой
                const isRetryableError = 
                    errorMessage.includes('TIMEOUT') ||
                    errorMessage.includes('OPERATION_TIMEOUT') ||
                    errorMessage.includes('network') ||
                    errorMessage.includes('connection') ||
                    errorMessage.includes('INTERNAL_SERVER_ERROR');
                
                // КРИТИЧЕСКАЯ ПРОВЕРКА: Проверка спама при USER_BANNED_IN_CHANNEL
                if (errorMessage.includes('USER_BANNED_IN_CHANNEL')) {
                    console.log(`🚨 Получена ошибка USER_BANNED_IN_CHANNEL в ${operationName} - проверяю аккаунт на спам...`);
                    
                    try {
                        const currentAccount = this.accountRotator.getCurrentAccount();
                        const isSpammed = await this.spamChecker.isAccountSpammed(
                            this.gramClient.getClient(), 
                            currentAccount.name
                        );
                        
                        if (isSpammed) {
                            console.log(`🚫 СПАМ ПОДТВЕРЖДЕН! Аккаунт ${currentAccount.name} в спаме - передаю канал дальше`);
                            await this.handleSpamDetection();
                            throw new Error(`SPAM_DETECTED: Аккаунт ${currentAccount.name} в спаме, канал передан следующему аккаунту`);
                        } else {
                            console.log(`✅ Аккаунт ${currentAccount.name} чистый - ошибка по другой причине`);
                        }
                    } catch (spamCheckError) {
                        console.log(`⚠️ Ошибка проверки спама: ${spamCheckError}`);
                    }
                }

                if (!isRetryableError || attempt === retries) {
                    console.log(`❌ ${operationName} не удалась (попытка ${attempt}/${retries}): ${errorMessage}`);
                    throw error;
                }
                
                console.log(`⚠️ ${operationName} ошибка (попытка ${attempt}/${retries}): ${errorMessage}`);
                console.log(`⏳ Повтор через ${MODULE_CONFIG.retryDelay}мс...`);
                await new Promise(resolve => setTimeout(resolve, MODULE_CONFIG.retryDelay));
                
                // При таймауте - пытаемся переподключиться
                if (MODULE_CONFIG.reconnectOnTimeout && errorMessage.includes('TIMEOUT')) {
                    console.log(`🔄 Переподключение после таймаута...`);
                    try {
                        await this.gramClient.disconnect();
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await this.gramClient.connect();
                        this.commentPoster = new CommentPosterService(this.gramClient.getClient());
                        this.channelJoiner = new ChannelJoinerService(this.gramClient.getClient());
                        console.log(`✅ Переподключение успешно`);
                    } catch (reconnectError) {
                        console.log(`⚠️ Ошибка переподключения: ${reconnectError}`);
                    }
                }
            }
        }
        
        throw new Error(`${operationName} не удалась после ${retries} попыток`);
    }

    /**
     * Проверка существующих комментариев от целевого канала в канале
     * УПРОЩЕНО: Минимум операций, быстрая проверка
     */
    private async checkExistingComments(channelUsername: string, targetChannel: any): Promise<boolean> {
        try {
            // Получаем ТОЛЬКО последний пост канала
            const messages = await this.gramClient.getClient().getMessages(channelUsername, { 
                limit: 1
            });
            
            if (!messages || messages.length === 0) {
                return false;
            }
            
            // Берем последний пост
            const lastMessage = messages[0];
            if (!lastMessage.id) {
                return false;
            }
            
            try {
                // Получаем комментарии к последнему посту (увеличим лимит до 50 для надежности)
                const discussion = await this.gramClient.getClient().getMessages(channelUsername, {
                    replyTo: lastMessage.id,
                    limit: 50
                });
                
                if (discussion && discussion.length > 0) {
                    // Проверяем, есть ли наш комментарий от целевого канала
                    const hasOurComment = discussion.some(comment => {
                        const fromId = comment.fromId;
                        return fromId && 
                               fromId.className === 'PeerChannel' &&
                               fromId.channelId && 
                               targetChannel.id && 
                               fromId.channelId.toString() === targetChannel.id.toString();
                    });
                    
                    if (hasOurComment) {
                        return true;
                    }
                }
            } catch (commentError) {
                // При ошибке получения комментариев считаем, что их нет
                return false;
            }
            
            return false;
            
        } catch (error) {
            // При ошибке считаем, что комментариев нет
            return false;
        }
    }

    /**
     * 🚫 Обработка обнаружения спама - передача канала
     */
    private async handleSpamDetection(): Promise<void> {
        try {
            console.log(`🔄 Обнаружен спам - обработка...`);
            
            const currentAccount = this.accountRotator.getCurrentAccount();
            console.log(`🚫 Заспамленный аккаунт: ${currentAccount.name}`);
            
            // Проверяем, владеет ли заспамленный аккаунт каналом
            if (this.targetChannelAccount && this.targetChannelAccount.name === currentAccount.name) {
                console.log(`⚠️ КРИТИЧНО: Владелец канала целевого канала (${currentAccount.name}) в спаме!`);
                console.log(`📺 Необходима передача канала на чистый аккаунт...`);
                
                // Находим следующий чистый аккаунт
                const cleanAccount = await this.findNextCleanAccount(currentAccount);
                
                if (!cleanAccount) {
                    throw new Error(`КРИТИЧЕСКАЯ ОШИБКА: Все аккаунты в спаме. Невозможно передать канал.`);
                }
                
                console.log(`🎯 Найден чистый аккаунт для передачи: ${cleanAccount.name}`);
                
                // Валидация перед передачей - проверяем, что мы действительно можем передать
                console.log(`🔍 Валидация владения каналом перед передачей...`);
                try {
                    // Переключаемся на заспамленного владельца для передачи
                    await this.switchTelegramAccount(currentAccount, true); // Пропускаем проверку спама
                    
                    // Проверяем, что канал действительно есть у этого аккаунта
                    const userChannels = await this.commentPoster.getUserChannelsAsync();
                    const hasChannel = userChannels.some(ch => 
                        ch.username?.toLowerCase() === (process.env.TARGET_CHANNEL || '').toLowerCase()
                    );
                    
                    if (!hasChannel) {
                        console.log(`❌ Канал целевого канала не найден на ${currentAccount.name}`);
                        console.log(`🔄 Возможно, канал уже передан. Ищем реального владельца...`);
                        
                        // Пытаемся найти реального владельца
                        await this.findAccountWithTargetChannel();
                        return;
                    }
                    
                    console.log(`✅ Подтверждено: ${currentAccount.name} владеет целевого канала`);
                    
                } catch (validationError) {
                    console.log(`⚠️ Ошибка валидации: ${validationError}`);
                }
                
                // Выполняем передачу канала
                try {
                    await this.transferChannelToNextAccount(cleanAccount);
                    console.log(`✅ Канал целевого канала успешно передан на ${cleanAccount.name}`);
                    
                    // Обновляем владельца канала
                    this.targetChannelAccount = cleanAccount;
                    
                    // Устанавливаем нового владельца как активный аккаунт
                    this.accountRotator.setActiveAccount(cleanAccount.name);
                    
                } catch (transferError) {
                    console.error(`❌ Не удалось передать канал: ${transferError}`);
                    throw transferError;
                }
                
            } else {
                console.log(`ℹ️ Аккаунт ${currentAccount.name} не владеет каналом - простая ротация`);
                
                // Простая ротация на следующий аккаунт
                const rotationResult = await this.accountRotator.rotateToNextAccount();
                if (rotationResult.success) {
                    console.log(`✅ Ротация: ${rotationResult.previousAccount.name} → ${rotationResult.newAccount.name}`);
                }
            }
            
        } catch (error) {
            console.log(`❌ Ошибка обработки спама: ${error}`);
            throw error;
        }
    }

    /**
     * Очистка ресурсов
     */
    private async cleanup(): Promise<void> {
        try {
            await this.gramClient.disconnect();
            console.log(`👋 Отключение от Telegram`);
        } catch (error) {
            console.warn(`⚠️ Ошибка при очистке ресурсов:`, error);
        }
    }

    /**
     * Форматирование длительности
     */
    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
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
}

/**
 * Точка входа в модуль
 */
async function main() {
    const autoCommenter = new AutoCommentWithRotationService();
    await autoCommenter.start();
}

// Запуск модуля с обработкой ошибок
main().catch(error => {
    // Финальная обработка критических ошибок
    const floodAnalysis = analyzeFloodWaitError(error);
    if (floodAnalysis.isFloodWait) {
        console.error('\n' + createStopMessage(floodAnalysis.seconds, 'АВТОКОММЕНТИРОВАНИЕ С РОТАЦИЕЙ'));
        process.exit(2); // Специальный код для FloodWait
    } else {
        console.error('💥 Необработанная критическая ошибка:', error);
        process.exit(1);
    }
});
