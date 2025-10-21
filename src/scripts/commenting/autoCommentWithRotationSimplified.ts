/**
 * Упрощенный автокомментатор с ротацией аккаунтов
 * Минимум кода, максимум стабильности
 *
 * Запуск: npm run comment:auto-rotation-simple
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { GramClient } from '../../telegram/adapters/gramClient';
import { CommentPosterService, ICommentTarget, ICommentingOptionsWithAI } from '../../app/commentPoster';
import { AICommentGeneratorService } from '../../app/aiCommentGenerator';
import { AccountRotatorService } from '../../app/accountRotator/services/accountRotatorService';
import { IAccountInfo } from '../../app/accountRotator/interfaces/IAccountRotator';
import { SpamChecker } from '../../shared/services/spamChecker';
import { analyzeFloodWaitError, createStopMessage } from '../../shared/utils/floodWaitHandler';
import * as fs from 'fs';
import * as path from 'path';

// Простая конфигурация
const CONFIG = {
    targetChannel: process.env.TARGET_CHANNEL || '',
    commentsPerAccount: 150,
    delayBetweenComments: 3000, // 3 секунды
    delayBetweenRotations: 10000, // 10 секунд
    channelsFile: './input-channels/channels.txt',
    successfulChannelsFile: './input-channels/successful-channels.txt',
    aiEnabled: !!process.env.DEEPSEEK_API_KEY,
    aiApiKey: process.env.DEEPSEEK_API_KEY || '',
    aiBaseUrl: 'https://api.deepseek.com/v1',
    aiModel: 'deepseek-chat'
};

class SimpleAutoCommenter {
    private gramClient!: GramClient;
    private commentPoster!: CommentPosterService;
    private aiGenerator: AICommentGeneratorService;
    private accountRotator: AccountRotatorService;
    private spamChecker: SpamChecker;
    private channels: ICommentTarget[] = [];
    private targetChannelOwner: IAccountInfo | null = null;
    private targetChannelInfo: any = null;

    // Статистика
    private stats = {
        totalProcessed: 0,
        totalComments: 0,
        totalRotations: 0,
        startTime: new Date()
    };

    constructor() {
        // Инициализация сервисов
        this.accountRotator = new AccountRotatorService({
            maxCommentsPerAccount: CONFIG.commentsPerAccount,
            delayBetweenRotations: CONFIG.delayBetweenRotations / 1000,
            saveProgress: true
        });

        this.aiGenerator = new AICommentGeneratorService({
            apiKey: CONFIG.aiApiKey,
            baseUrl: CONFIG.aiBaseUrl,
            model: CONFIG.aiModel,
            enabled: CONFIG.aiEnabled
        });

        this.spamChecker = new SpamChecker();

        console.log(`\n🚀 Автокомментатор запущен`);
        console.log(`📋 Аккаунтов загружено: ${this.accountRotator.getAllAccounts().length}`);
        console.log(`🤖 AI: ${CONFIG.aiEnabled ? 'включен' : 'выключен'}`);
        console.log(`💬 Лимит: ${CONFIG.commentsPerAccount} комментариев на аккаунт\n`);
    }

    async start(): Promise<void> {
        try {
            await this.initialize();
            await this.processChannels();
            this.showStatistics();
        } catch (error) {
            this.handleError(error);
        } finally {
            await this.cleanup();
        }
    }

    private async initialize(): Promise<void> {
        console.log('🔄 Инициализация...\n');

        // Подключение первого аккаунта
        const firstAccount = this.accountRotator.getCurrentAccount();
        await this.connectAccount(firstAccount);

        // Проверка AI
        if (CONFIG.aiEnabled) {
            const aiHealthy = await this.aiGenerator.checkHealthAsync();
            if (!aiHealthy) {
                console.log('⚠️  AI недоступен, продолжаю без него');
                CONFIG.aiEnabled = false;
            }
        }

        // Загрузка каналов
        await this.loadChannels();

        // Поиск владельца целевого канала
        await this.findTargetChannelOwner();
    }

    private async connectAccount(account: IAccountInfo): Promise<void> {
        console.log(`👤 Подключение ${account.name}...`);

        // Отключение старого клиента если есть
        if (this.gramClient) {
            await this.gramClient.disconnect();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Подключение нового
        process.env.SESSION_STRING = account.sessionValue;
        this.gramClient = new GramClient();
        await this.gramClient.connect();
        this.commentPoster = new CommentPosterService(this.gramClient.getClient());

        // Проверка на спам
        const isSpammed = await this.spamChecker.isAccountSpammed(
            this.gramClient.getClient(),
            account.name
        );

        if (isSpammed) {
            console.log(`🚫 ${account.name} в спаме!`);
            throw new Error(`Аккаунт ${account.name} заспамлен`);
        }
    }

    private async loadChannels(): Promise<void> {
        // Создаем директорию если нет
        const channelsDir = path.dirname(CONFIG.channelsFile);
        if (!fs.existsSync(channelsDir)) {
            fs.mkdirSync(channelsDir, { recursive: true });
        }

        // Проверяем файл
        if (!fs.existsSync(CONFIG.channelsFile)) {
            fs.writeFileSync(CONFIG.channelsFile, '# Добавьте каналы по одному на строку\n', 'utf-8');
            throw new Error('Файл channels.txt пуст, добавьте каналы');
        }

        // Читаем каналы
        const content = fs.readFileSync(CONFIG.channelsFile, 'utf-8');
        const channelUsernames = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));

        if (channelUsernames.length === 0) {
            throw new Error('Нет каналов для обработки');
        }

        this.channels = channelUsernames.map(username => ({
            channelUsername: username.replace('@', ''),
            channelUrl: `https://t.me/${username.replace('@', '')}`,
            isActive: true
        }));

        console.log(`📚 Загружено ${this.channels.length} каналов\n`);
    }

    private async findTargetChannelOwner(): Promise<void> {
        if (!CONFIG.targetChannel) return;

        console.log(`🔍 Поиск канала ${CONFIG.targetChannel}...\n`);

        const allAccounts = this.accountRotator.getAllAccounts();

        for (const account of allAccounts) {
            try {
                await this.connectAccount(account);
                const channels = await this.commentPoster.getUserChannelsAsync();

                const targetChannel = channels.find(ch =>
                    ch.username?.toLowerCase() === CONFIG.targetChannel.replace('@', '').toLowerCase()
                );

                if (targetChannel) {
                    console.log(`✅ Канал найден на ${account.name}\n`);
                    this.targetChannelOwner = account;
                    this.targetChannelInfo = targetChannel;
                    this.accountRotator.setActiveAccount(account.name);
                    return;
                }
            } catch (error) {
                continue;
            }
        }

        throw new Error(`Канал ${CONFIG.targetChannel} не найден ни на одном аккаунте`);
    }

    private async processChannels(): Promise<void> {
        let channelIndex = 0;

        while (channelIndex < this.channels.length) {
            const currentAccount = this.accountRotator.getCurrentAccount();

            // Проверка необходимости ротации
            if (this.accountRotator.shouldRotate()) {
                await this.rotateAccount();
                this.stats.totalRotations++;
            }

            // Обработка канала
            const channel = this.channels[channelIndex];
            console.log(`\n📝 ${currentAccount.name} (${currentAccount.commentsCount}/${CONFIG.commentsPerAccount})`);
            console.log(`   Канал: @${channel.channelUsername}`);

            try {
                await this.commentChannel(channel);
                this.stats.totalComments++;
                console.log(`   ✅ Успешно`);

                // Сохраняем успешный канал
                await this.saveSuccessfulChannel(channel.channelUsername);

            } catch (error: any) {
                console.log(`   ❌ Ошибка: ${error.message || error}`);
            }

            // Удаляем из файла
            await this.removeChannelFromFile(channel.channelUsername);

            this.accountRotator.incrementCommentCount();
            this.stats.totalProcessed++;
            channelIndex++;

            // Задержка между комментариями
            if (channelIndex < this.channels.length) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenComments));
            }
        }

        console.log('\n✅ Все каналы обработаны');
    }

    private async commentChannel(channel: ICommentTarget): Promise<void> {
        // Проверяем, что есть владелец канала
        if (!this.targetChannelOwner || !this.targetChannelInfo) {
            throw new Error('Целевой канал не найден');
        }

        // Проверяем дубликаты
        const hasComment = await this.checkExistingComment(channel.channelUsername);
        if (hasComment) {
            console.log(`   ⏭️  Уже прокомментирован`);
            return;
        }

        // Настройки комментирования
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

        // Отправка
        const result = await this.commentPoster.postCommentsWithAIAsync(options);

        if (result.successfulComments === 0) {
            const error = result.results[0]?.error || 'Неизвестная ошибка';
            throw new Error(error);
        }
    }

    private async checkExistingComment(channelUsername: string): Promise<boolean> {
        try {
            const messages = await this.gramClient.getClient().getMessages(channelUsername, { limit: 1 });
            if (!messages || messages.length === 0) return false;

            const lastMessage = messages[0];
            if (!lastMessage.id) return false;

            const discussion = await this.gramClient.getClient().getMessages(channelUsername, {
                replyTo: lastMessage.id,
                limit: 30
            });

            if (!discussion || discussion.length === 0) return false;

            // Проверяем есть ли комментарий от нашего канала
            return discussion.some(comment => {
                const fromId = comment.fromId;
                return fromId &&
                       fromId.className === 'PeerChannel' &&
                       fromId.channelId?.toString() === this.targetChannelInfo?.id?.toString();
            });

        } catch {
            return false;
        }
    }

    private async rotateAccount(): Promise<void> {
        console.log('\n🔄 Ротация аккаунта...');

        const previousAccount = this.accountRotator.getCurrentAccount();
        const rotationResult = await this.accountRotator.rotateToNextAccount();

        if (!rotationResult.success) {
            throw new Error('Не удалось выполнить ротацию');
        }

        console.log(`   ${previousAccount.name} → ${rotationResult.newAccount.name}`);

        // Если предыдущий владел каналом - передаем
        if (this.targetChannelOwner?.name === previousAccount.name) {
            await this.transferChannel(previousAccount, rotationResult.newAccount);
            this.targetChannelOwner = rotationResult.newAccount;
        }

        // Подключаем новый аккаунт
        await this.connectAccount(rotationResult.newAccount);
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenRotations));
    }

    private async transferChannel(fromAccount: IAccountInfo, toAccount: IAccountInfo): Promise<void> {
        console.log(`   📺 Передача канала ${toAccount.name}...`);

        try {
            const { ChannelOwnershipRotatorService } = await import('../../app/ownershipRotator/services/channelOwnershipRotatorService');

            const password = process.env[`PASSWORD_${fromAccount.sessionKey.replace('SESSION_STRING_', '')}`];
            if (!password) {
                throw new Error(`Пароль не найден для ${fromAccount.name}`);
            }

            const service = new ChannelOwnershipRotatorService();
            const result = await service.transferOwnershipAsync({
                sessionString: fromAccount.sessionValue,
                channelIdentifier: process.env.TARGET_CHANNEL || '',
                targetUserIdentifier: toAccount.username?.replace('@', '') || '',
                password
            });

            if (!result.success) {
                throw new Error(result.error || 'Ошибка передачи');
            }

            console.log(`   ✅ Канал передан`);

        } catch (error: any) {
            console.log(`   ⚠️  Не удалось передать канал: ${error.message}`);
        }
    }

    private async removeChannelFromFile(channelUsername: string): Promise<void> {
        try {
            const content = fs.readFileSync(CONFIG.channelsFile, 'utf-8');
            const lines = content.split('\n');
            const filtered = lines.filter(line => {
                const clean = line.trim().replace('@', '');
                return clean !== channelUsername.replace('@', '');
            });
            fs.writeFileSync(CONFIG.channelsFile, filtered.join('\n'), 'utf-8');
        } catch {}
    }

    private async saveSuccessfulChannel(channelUsername: string): Promise<void> {
        try {
            const cleanUsername = channelUsername.replace('@', '');

            // Проверяем существование файла
            let content = '';
            if (fs.existsSync(CONFIG.successfulChannelsFile)) {
                content = fs.readFileSync(CONFIG.successfulChannelsFile, 'utf-8');
                if (content.includes(cleanUsername)) return;
            }

            // Добавляем
            fs.appendFileSync(CONFIG.successfulChannelsFile, `@${cleanUsername}\n`, 'utf-8');

        } catch {}
    }

    private showStatistics(): void {
        const duration = Date.now() - this.stats.startTime.getTime();
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);

        console.log('\n📊 Статистика:');
        console.log(`   • Обработано каналов: ${this.stats.totalProcessed}`);
        console.log(`   • Отправлено комментариев: ${this.stats.totalComments}`);
        console.log(`   • Ротаций: ${this.stats.totalRotations}`);
        console.log(`   • Время работы: ${minutes}м ${seconds}с`);
    }

    private handleError(error: any): void {
        const floodAnalysis = analyzeFloodWaitError(error);
        if (floodAnalysis.isFloodWait) {
            console.error('\n' + createStopMessage(floodAnalysis.seconds, 'АВТОКОММЕНТИРОВАНИЕ'));
            process.exit(2);
        } else {
            console.error('\n❌ Критическая ошибка:', error.message || error);
            process.exit(1);
        }
    }

    private async cleanup(): Promise<void> {
        try {
            await this.gramClient?.disconnect();
        } catch {}
    }
}

// Запуск
async function main() {
    const commenter = new SimpleAutoCommenter();
    await commenter.start();
}

main().catch(error => {
    console.error('💥 Ошибка:', error);
    process.exit(1);
});