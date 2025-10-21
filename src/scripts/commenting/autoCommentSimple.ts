/**
 * Простой автокомментатор с ротацией
 * Минимальный код, максимальная ясность
 *
 * npm run comment:simple-rotation
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { GramClient } from '../../telegram/adapters/gramClient';
import { CommentPosterService, ICommentTarget, ICommentingOptionsWithAI } from '../../app/commentPoster';
import { AICommentGeneratorService } from '../../app/aiCommentGenerator';
import { AccountRotatorService } from '../../app/accountRotator/services/accountRotatorService';
import { IAccountInfo } from '../../app/accountRotator/interfaces/IAccountRotator';
import { SpamChecker } from '../../shared/services/spamChecker';
import { Logger } from '../../shared/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// Конфигурация
const CONFIG = {
    targetChannel: process.env.TARGET_CHANNEL || '',              // Канал от имени которого комментируем
    commentsPerAccount: 190,                // Лимит комментариев на аккаунт
    delayBetweenComments: 3000,            // Задержка между комментариями (мс)
    channelsFile: './input-channels/channels.txt',
    successfulFile: './input-channels/successful-channels.txt',
    aiEnabled: !!process.env.DEEPSEEK_API_KEY
};

/**
 * Простой класс автокомментирования
 */
class SimpleAutoCommenter {
    private client!: GramClient;
    private commentPoster!: CommentPosterService;
    private accountRotator: AccountRotatorService;
    private aiGenerator: AICommentGeneratorService;
    private spamChecker: SpamChecker;

    private targetChannelOwner: IAccountInfo | null = null;
    private targetChannelInfo: any = null;

    constructor() {
        // Инициализация сервисов
        this.accountRotator = new AccountRotatorService({
            maxCommentsPerAccount: CONFIG.commentsPerAccount,
            delayBetweenRotations: 5,
            saveProgress: true
        });

        this.aiGenerator = new AICommentGeneratorService({
            apiKey: process.env.DEEPSEEK_API_KEY || '',
            baseUrl: 'https://api.deepseek.com/v1',
            model: 'deepseek-chat',
            enabled: CONFIG.aiEnabled
        });

        this.spamChecker = new SpamChecker();

        // Инициализируем подавление TIMEOUT ошибок
        Logger.initTimeoutSuppression();

        Logger.info(`🚀 Автокомментатор | ${this.accountRotator.getAllAccounts().length} акк | лимит ${CONFIG.commentsPerAccount}`);
    }

    /**
     * Главный метод запуска
     */
    async start(): Promise<void> {
        try {
            const channels = await this.loadChannels();
            Logger.section(`Загружено ${channels.length} каналов`);

            await this.findTargetChannel();

            if (!this.targetChannelOwner || !this.targetChannelInfo) {
                throw new Error(`Канал ${CONFIG.targetChannel} не найден`);
            }

            await this.processChannels(channels);

            Logger.success('Работа завершена');

        } catch (error: any) {
            Logger.error('Критическая ошибка', error);
            await this.cleanup();
            process.exit(1);
        }
    }

    /**
     * Загрузка каналов из файла
     */
    private async loadChannels(): Promise<ICommentTarget[]> {
        if (!fs.existsSync(CONFIG.channelsFile)) {
            throw new Error('Файл channels.txt не найден');
        }

        const content = fs.readFileSync(CONFIG.channelsFile, 'utf-8');
        const lines = content.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));

        return lines.map(username => ({
            channelUsername: username.replace('@', ''),
            channelUrl: `https://t.me/${username.replace('@', '')}`,
            isActive: true
        }));
    }

    /**
     * Поиск канала целевого канала среди аккаунтов
     */
    private async findTargetChannel(): Promise<void> {
        Logger.section(`Поиск канала ${CONFIG.targetChannel}`);

        const accounts = this.accountRotator.getAllAccounts();

        for (const account of accounts) {
            Logger.progress(`  ${account.name}... `);

            // Подключаемся БЕЗ проверки спама
            await this.connectAccount(account, true);

            // Ищем канал
            const channels = await this.commentPoster.getUserChannelsAsync();
            const targetChannel = channels.find(ch =>
                ch.username?.toLowerCase() === CONFIG.targetChannel.replace('@', '').toLowerCase()
            );

            if (targetChannel) {
                Logger.success(`Найден на ${account.name}`);

                // Теперь проверяем спам
                const isSpammed = await this.spamChecker.isAccountSpammed(
                    this.client.getClient(),
                    account.name
                );

                if (isSpammed) {
                    Logger.warn(`${account.name} в спаме`);

                    const cleanAccount = await this.findCleanAccount(accounts, account);
                    if (!cleanAccount) {
                        throw new Error('Все аккаунты в спаме');
                    }

                    Logger.rotation(account.name, cleanAccount.name, 'передача канала');
                    await this.transferChannel(account, cleanAccount);

                    await this.connectAccount(cleanAccount, true);
                    this.targetChannelOwner = cleanAccount;
                    this.targetChannelInfo = targetChannel;
                } else {
                    this.targetChannelOwner = account;
                    this.targetChannelInfo = targetChannel;
                }

                this.accountRotator.setActiveAccount(this.targetChannelOwner.name);
                return;
            }
        }
    }

    /**
     * Подключение к аккаунту
     */
    private async connectAccount(account: IAccountInfo, skipSpamCheck = false): Promise<void> {
        // Отключаем старый клиент
        if (this.client) {
            await this.client.disconnect();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Подключаем новый
        process.env.SESSION_STRING = account.sessionValue;
        this.client = new GramClient();
        await this.client.connect();
        this.commentPoster = new CommentPosterService(this.client.getClient());

        // Проверка спама только если нужно
        if (!skipSpamCheck) {
            const isSpammed = await this.spamChecker.isAccountSpammed(
                this.client.getClient(),
                account.name
            );

            if (isSpammed) {
                throw new Error(`Аккаунт ${account.name} в спаме`);
            }
        }
    }

    /**
     * Обработка каналов с комментированием
     */
    private async processChannels(channels: ICommentTarget[]): Promise<void> {
        Logger.section('Комментирование');

        for (const channel of channels) {
            // Проверяем необходимость ротации
            if (this.accountRotator.shouldRotate()) {
                await this.rotateToNextAccount();
            }

            const currentAccount = this.accountRotator.getCurrentAccount();

            this.accountRotator.incrementCommentCount();

            try {
                const result = await this.commentChannel(channel);

                await this.saveSuccessfulChannel(channel.channelUsername);

                const counters = `${currentAccount.commentsCount}/${currentAccount.maxCommentsPerSession}`;
                Logger.action(currentAccount.name, counters, channel.channelUsername, '✅', result);

            } catch (error: any) {
                const errorMsg = error.message || error;

                if (error.code === 420 || errorMsg.includes('FloodWaitError') || errorMsg.includes('FLOOD')) {
                    const seconds = error.seconds || this.extractSecondsFromError(errorMsg);
                    Logger.floodWait(seconds);
                    await this.cleanup();
                    process.exit(1);
                }

                const counters = `${currentAccount.commentsCount}/${currentAccount.maxCommentsPerSession}`;
                Logger.action(currentAccount.name, counters, channel.channelUsername, '❌', this.simplifyError(errorMsg));

                // Проверяем на спам
                if (errorMsg.includes('USER_BANNED_IN_CHANNEL') ||
                    errorMsg.includes('CHAT_GUEST_SEND_FORBIDDEN')) {

                    const isSpammed = await this.spamChecker.isAccountSpammed(
                        this.client.getClient(),
                        currentAccount.name
                    );

                    if (isSpammed && currentAccount.name === this.targetChannelOwner?.name) {
                        Logger.warn('Владелец канала в спаме');
                        await this.handleOwnerSpam();
                    }
                }
            }

            // Удаляем из файла
            await this.removeChannelFromFile(channel.channelUsername);

            // Задержка
            await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenComments));
        }
    }

    /**
     * Комментирование одного канала с проверкой существующих комментариев
     */
    private async commentChannel(channel: ICommentTarget): Promise<string> {
        if (!this.targetChannelInfo) {
            throw new Error('Целевой канал не установлен');
        }

        // Проверяем существующие комментарии перед отправкой
        const hasExisting = await this.checkExistingComment(channel.channelUsername);
        if (hasExisting) {
            await this.saveSuccessfulChannel(channel.channelUsername);
            return 'Уже есть';
        }

        const options: ICommentingOptionsWithAI = {
            targets: [channel],
            messages: [],
            delayBetweenComments: 0,
            maxCommentsPerSession: 1,
            randomizeOrder: false,
            skipRecentlyCommented: false,
            dryRun: false,
            useAI: CONFIG.aiEnabled,
            aiGenerator: this.aiGenerator,
            sendAsOptions: {
                useChannelAsSender: true,
                selectedChannelId: this.targetChannelInfo.username,
                selectedChannelTitle: this.targetChannelInfo.title
            }
        };

        const result = await this.commentPoster.postCommentsWithAIAsync(options);

        if (result.successfulComments === 0) {
            throw new Error(result.results[0]?.error || 'Не удалось');
        }

        // Возвращаем полный комментарий для лога
        return result.results[0]?.commentText || '';
    }

    /**
     * Проверка существующих комментариев от целевого канала
     */
    private async checkExistingComment(channelUsername: string): Promise<boolean> {
        try {
            // Получаем последний пост канала
            const messages = await this.client.getClient().getMessages(channelUsername, { limit: 1 });
            if (!messages || messages.length === 0) {
                return false;
            }

            const lastMessage = messages[0];
            if (!lastMessage.id) {
                return false;
            }

            // Получаем комментарии к посту
            try {
                const discussion = await this.client.getClient().getMessages(channelUsername, {
                    replyTo: lastMessage.id,
                    limit: 50
                });

                if (discussion && discussion.length > 0) {
                    // Проверяем комментарии от нашего канала
                    const hasOurComment = discussion.some(comment => {
                        const fromId = comment.fromId;
                        return fromId &&
                            fromId.className === 'PeerChannel' &&
                            fromId.channelId &&
                            this.targetChannelInfo?.id &&
                            fromId.channelId.toString() === this.targetChannelInfo.id.toString();
                    });

                    return hasOurComment;
                }
            } catch {
                return false;
            }

            return false;

        } catch (error) {
            return false;
        }
    }

    /**
     * Ротация на следующий аккаунт
     */
    private async rotateToNextAccount(): Promise<void> {
        const currentAccount = this.accountRotator.getCurrentAccount();
        const rotationResult = await this.accountRotator.rotateToNextAccount();

        if (!rotationResult.success) {
            throw new Error('Не удалось выполнить ротацию');
        }

        const newAccount = rotationResult.newAccount;

        if (currentAccount.name === this.targetChannelOwner?.name) {
            Logger.rotation(currentAccount.name, newAccount.name, 'передача канала');
            await this.transferChannel(currentAccount, newAccount);
            this.targetChannelOwner = newAccount;
        } else {
            Logger.rotation(currentAccount.name, newAccount.name, 'лимит исчерпан');
        }

        await this.connectAccount(newAccount);
    }

    /**
     * Обработка спама владельца канала
     */
    private async handleOwnerSpam(): Promise<void> {
        if (!this.targetChannelOwner) return;

        const accounts = this.accountRotator.getAllAccounts();
        const cleanAccount = await this.findCleanAccount(accounts, this.targetChannelOwner);

        if (!cleanAccount) {
            throw new Error('Все аккаунты в спаме, работа невозможна');
        }

        Logger.rotation(this.targetChannelOwner.name, cleanAccount.name, 'спам');
        await this.transferChannel(this.targetChannelOwner, cleanAccount);

        this.targetChannelOwner = cleanAccount;
        this.accountRotator.setActiveAccount(cleanAccount.name);

        await this.connectAccount(cleanAccount);
    }

    /**
     * Поиск чистого аккаунта
     */
    private async findCleanAccount(accounts: IAccountInfo[], exclude: IAccountInfo): Promise<IAccountInfo | null> {
        for (const account of accounts) {
            if (account.name === exclude.name) continue;

            await this.connectAccount(account, true);
            const isSpammed = await this.spamChecker.isAccountSpammed(
                this.client.getClient(),
                account.name
            );

            if (!isSpammed) {
                return account;
            }
        }
        return null;
    }

    /**
     * Передача канала между аккаунтами с валидацией
     */
    private async transferChannel(from: IAccountInfo, to: IAccountInfo): Promise<void> {
        console.log(`\n📺 Передача канала: ${from.name} → ${to.name}`);

        // Шаг 1: Валидация владения каналом
        console.log(`🔍 Проверка владения каналом...`);
        try {
            await this.connectAccount(from);
            const userChannels = await this.commentPoster.getUserChannelsAsync();
            const hasChannel = userChannels.some(ch =>
                ch.username?.toLowerCase() === CONFIG.targetChannel.replace('@', '').toLowerCase()
            );

            if (!hasChannel) {
                console.log(`❌ ${from.name} не владеет ${CONFIG.targetChannel}`);
                console.log(`🔄 Поиск реального владельца...`);
                await this.findTargetChannel();
                return;
            }

            console.log(`✅ Подтверждено: ${from.name} владеет ${CONFIG.targetChannel}`);

        } catch (validationError) {
            console.log(`⚠️  Ошибка валидации: ${validationError}`);
            return;
        }

        // Шаг 2: Выполнение передачи
        try {
            const { ChannelOwnershipRotatorService } = await import('../../app/ownershipRotator/services/channelOwnershipRotatorService');

            const password = process.env[`PASSWORD_${from.sessionKey.replace('SESSION_STRING_', '')}`];
            if (!password) {
                throw new Error(`Пароль 2FA не найден для ${from.name}`);
            }

            if (!to.username) {
                throw new Error(`Username не найден для ${to.name}`);
            }

            console.log(`🔐 Инициализация передачи...`);
            const service = new ChannelOwnershipRotatorService();
            const result = await service.transferOwnershipAsync({
                sessionString: from.sessionValue,
                channelIdentifier: CONFIG.targetChannel.replace('@', ''),
                targetUserIdentifier: to.username.replace('@', ''),
                password
            });

            if (!result.success) {
                // Детальная обработка ошибок
                const errorMsg = result.error || 'Неизвестная ошибка';

                if (errorMsg.includes('CHAT_ADMIN_REQUIRED')) {
                    console.log(`❌ ${from.name} не является администратором канала`);
                } else if (errorMsg.includes('PASSWORD_HASH_INVALID')) {
                    console.log(`❌ Неверный пароль 2FA для ${from.name}`);
                } else if (errorMsg.includes('USER_NOT_MUTUAL_CONTACT')) {
                    console.log(`❌ ${to.username} не является контактом канала`);
                } else {
                    console.log(`❌ Ошибка передачи: ${errorMsg}`);
                }
                throw new Error(errorMsg);
            }

            console.log(`✅ Канал ${CONFIG.targetChannel} успешно передан → ${to.name}`);

            // Обновляем владельца
            this.targetChannelOwner = to;
            this.accountRotator.setActiveAccount(to.name);

        } catch (error: any) {
            console.log(`❌ Не удалось передать канал: ${error.message}`);
            throw error;
        }
    }

    /**
     * Сохранение успешного канала с проверкой дубликатов
     */
    private async saveSuccessfulChannel(channelUsername: string): Promise<void> {
        try {
            const cleanUsername = channelUsername.replace('@', '');

            // Создаем файл если его нет
            if (!fs.existsSync(CONFIG.successfulFile)) {
                fs.writeFileSync(CONFIG.successfulFile, '# Успешные каналы (автоматически пополняется)\n', 'utf-8');
            }

            // Проверяем, есть ли уже канал в файле
            const existingContent = fs.readFileSync(CONFIG.successfulFile, 'utf-8');
            if (existingContent.includes(cleanUsername)) {
                return; // Канал уже сохранен
            }

            // Добавляем новый канал
            const content = `@${cleanUsername}\n`;
            fs.appendFileSync(CONFIG.successfulFile, content, 'utf-8');

        } catch (error) {
            console.log(`  ⚠️  Ошибка сохранения в успешные: ${error}`);
        }
    }

    /**
     * Удаление канала из файла
     */
    private async removeChannelFromFile(channelUsername: string): Promise<void> {
        try {
            const content = fs.readFileSync(CONFIG.channelsFile, 'utf-8');
            const lines = content.split('\n');
            const filtered = lines.filter(line => {
                const clean = line.trim().replace('@', '');
                return clean !== channelUsername.replace('@', '');
            });
            fs.writeFileSync(CONFIG.channelsFile, filtered.join('\n'), 'utf-8');
        } catch { }
    }

    /**
     * Форматирование времени в удобный вид
     */
    private formatTime(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) return `${hours}ч ${minutes}м`;
        if (minutes > 0) return `${minutes}м ${secs}с`;
        return `${secs}с`;
    }

    /**
     * Извлечение секунд из сообщения об ошибке
     */
    private extractSecondsFromError(errorMsg: string): number {
        // Просто ищем любое число в сообщении об ошибке
        const match = errorMsg.match(/\d+/);
        return match ? parseInt(match[0]) : 0;
    }

    /**
     * Упрощение текста ошибки для лучшей читаемости
     */
    private simplifyError(errorMsg: string): string {
        if (errorMsg.includes('CHAT_GUEST_SEND_FORBIDDEN')) {
            return 'Нужно вступить в канал';
        }
        if (errorMsg.includes('MSG_ID_INVALID')) {
            return 'Неверный ID сообщения';
        }
        if (errorMsg.includes('USER_BANNED_IN_CHANNEL')) {
            return 'Аккаунт забанен в канале';
        }
        if (errorMsg.includes('CHANNELS_TOO_MUCH')) {
            return 'Превышен лимит каналов';
        }

        // Возвращаем первые 50 символов для других ошибок
        return errorMsg.length > 50 ? errorMsg.substring(0, 50) + '...' : errorMsg;
    }

    /**
     * Очистка ресурсов
     */
    private async cleanup(): Promise<void> {
        try {
            await this.client?.disconnect();
        } catch { }
    }
}

// Запуск
async function main() {
    const commenter = new SimpleAutoCommenter();
    await commenter.start();
}

main().catch(error => {
    console.error('💥 Критическая ошибка:', error);
    process.exit(1);
});