/**
 * AI-фильтрация подписанных каналов по тематике
 * Использует OpenAI/Deepseek API для анализа контента
 */

import prompts from 'prompts';
import { Api } from 'telegram';
import { GramJSServiceClient } from '../../shared/services/gramJSServiceClient';
import { EnvAccountsParser } from '../../shared/utils/envAccountsParser';
import { SpamChecker } from '../../shared/utils/spamChecker';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

// Интерфейсы для типизации
interface ChannelAnalysis {
    channelId: string;
    channelUsername: string;
    channelTitle: string;
    isPolitical: boolean;
    isUkrainian: boolean;
    isWarRelated: boolean;
    aiReason?: string;
    shouldUnsubscribe: boolean;
    lastPosts?: string[];
}

interface FilterConfig {
    name: string;
    enabled: boolean;
    systemPrompt: string;
    userPrompt: (posts: string[]) => string;
}

/**
 * Класс для AI-фильтрации каналов
 */
class ChannelAIFilter {
    private gramClient!: GramJSServiceClient;
    private openai!: OpenAI;
    private channels: any[] = [];
    private analysisResults: ChannelAnalysis[] = [];
    private selectedFilters: FilterConfig[] = [];

    // Конфигурация фильтров - легко добавлять новые
    private readonly FILTERS: FilterConfig[] = [
        {
            name: 'Политические каналы',
            enabled: false,
            systemPrompt: 'Ты эксперт по анализу контента. Определи является ли канал политическим. Отвечай только "ДА" или "НЕТ" и кратко объясни почему.',
            userPrompt: (posts) => `Проанализируй эти посты и определи является ли канал политическим:\n\n${posts.join('\n---\n')}`
        },
        {
            name: 'Каналы на нецелевом языке',
            enabled: false,
            systemPrompt: 'Ты лингвист. Определи является ли основной язык канала нецелевым. Отвечай только "ДА" или "НЕТ" и кратко объясни.',
            userPrompt: (posts) => `Определи язык этих постов (целевой или нет):\n\n${posts.join('\n---\n')}`
        },
        {
            name: 'Каналы про военные конфликты/войну',
            enabled: false,
            systemPrompt: 'Ты контент-аналитик. Определи посвящен ли канал военной тематике, военные конфликты или военным новостям. Отвечай только "ДА" или "НЕТ" и кратко объясни.',
            userPrompt: (posts) => `Определи является ли канал военным/про военные конфликты:\n\n${posts.join('\n---\n')}`
        }
    ];

    async start(): Promise<void> {
        console.log('🤖 AI-ФИЛЬТРАЦИЯ TELEGRAM КАНАЛОВ');
        console.log('═══════════════════════════════════════');

        try {
            // Выбор аккаунта
            await this.selectAccount();

            // Настройка AI
            await this.setupAI();

            // Выбор фильтров
            await this.selectFilters();

            // Инициализация Telegram
            await this.initialize();

            // Получение каналов
            await this.loadChannels();

            // Анализ каналов
            await this.analyzeChannels();

            // Показ результатов
            this.displayResults();

            // Опция отписки
            await this.handleUnsubscribe();

            // Экспорт результатов
            await this.exportResults();

        } catch (error) {
            console.error('❌ Ошибка:', error);
        } finally {
            await this.cleanup();
        }
    }

    private async selectAccount(): Promise<void> {
        const accountsParser = new EnvAccountsParser();
        const accounts = accountsParser.getAvailableAccounts();

        if (accounts.length === 0) {
            throw new Error('Не найдено аккаунтов в .env файле');
        }

        const response = await prompts({
            type: 'select',
            name: 'account',
            message: 'Выберите аккаунт для анализа:',
            choices: accounts.map(acc => ({
                title: `${acc.name} ${acc.username ? `@${acc.username}` : ''}`,
                value: acc
            }))
        });

        if (!response.account) {
            throw new Error('Аккаунт не выбран');
        }

        this.gramClient = new GramJSServiceClient();
        await this.gramClient.initialize(
            response.account.apiId,
            response.account.apiHash,
            response.account.session
        );

        console.log(`✅ Выбран аккаунт: ${response.account.name}`);
    }

    private async setupAI(): Promise<void> {
        // Выбор AI провайдера
        const provider = await prompts({
            type: 'select',
            name: 'provider',
            message: 'Выберите AI провайдера:',
            choices: [
                { title: 'OpenAI GPT', value: 'openai' },
                { title: 'Deepseek', value: 'deepseek' }
            ]
        });

        // Запрос API ключа
        const apiKey = await prompts({
            type: 'password',
            name: 'key',
            message: `Введите API ключ для ${provider.provider}:`
        });

        if (!apiKey.key) {
            throw new Error('API ключ не введен');
        }

        // Инициализация OpenAI клиента
        const baseURL = provider.provider === 'deepseek'
            ? 'https://api.deepseek.com/v1'
            : undefined;

        this.openai = new OpenAI({
            apiKey: apiKey.key,
            baseURL
        });

        console.log(`✅ AI провайдер настроен: ${provider.provider}`);
    }

    private async selectFilters(): Promise<void> {
        const response = await prompts({
            type: 'multiselect',
            name: 'filters',
            message: 'Выберите фильтры для применения:',
            choices: this.FILTERS.map(f => ({
                title: f.name,
                value: f
            }))
        });

        if (!response.filters || response.filters.length === 0) {
            throw new Error('Не выбрано ни одного фильтра');
        }

        this.selectedFilters = response.filters;
        console.log(`✅ Выбрано фильтров: ${this.selectedFilters.length}`);
    }

    private async initialize(): Promise<void> {
        console.log('\n📱 Подключение к Telegram...');
        await this.gramClient.connect();
        console.log('✅ Подключение установлено');
    }

    private async loadChannels(): Promise<void> {
        console.log('\n🔄 Загрузка всех подписанных каналов...');

        let dialogCount = 0;
        let channelCount = 0;

        // Получаем ВСЕ диалоги без ограничений
        for await (const dialog of this.gramClient.getClient().iterDialogs()) {
            dialogCount++;

            if (dialogCount % 100 === 0) {
                console.log(`   📋 Обработано диалогов: ${dialogCount}`);
            }

            // Фильтруем только каналы
            if (this.isChannel(dialog)) {
                this.channels.push(dialog);
                channelCount++;

                if (channelCount % 25 === 0) {
                    console.log(`   📺 Найдено каналов: ${channelCount}`);
                }
            }
        }

        console.log(`\n✅ Загружено каналов: ${channelCount}`);
    }

    private isChannel(dialog: any): boolean {
        const entity = dialog.entity;
        return entity &&
               entity.className === 'Channel' &&
               entity.broadcast === true;
    }

    private async analyzeChannels(): Promise<void> {
        console.log('\n🤖 АНАЛИЗ КАНАЛОВ С ПОМОЩЬЮ AI');
        console.log('═══════════════════════════════════');

        const maxChannels = await prompts({
            type: 'number',
            name: 'limit',
            message: `Сколько каналов проанализировать? (всего ${this.channels.length}):`,
            initial: Math.min(10, this.channels.length),
            min: 1,
            max: this.channels.length
        });

        const channelsToAnalyze = this.channels.slice(0, maxChannels.limit);

        for (let i = 0; i < channelsToAnalyze.length; i++) {
            const channel = channelsToAnalyze[i];
            console.log(`\n[${i + 1}/${channelsToAnalyze.length}] Анализирую: ${channel.title || channel.name}`);

            try {
                const analysis = await this.analyzeChannel(channel);
                this.analysisResults.push(analysis);

                // Показываем результат
                if (analysis.shouldUnsubscribe) {
                    console.log(`   ❌ Рекомендую отписаться`);
                    console.log(`   📝 Причина: ${analysis.aiReason}`);
                } else {
                    console.log(`   ✅ Канал прошел фильтры`);
                }

                // Пауза между запросами к AI
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error) {
                console.log(`   ⚠️ Ошибка анализа: ${error}`);
            }
        }
    }

    private async analyzeChannel(dialog: any): Promise<ChannelAnalysis> {
        const channel = dialog.entity;

        // Получаем последние посты
        const posts = await this.getChannelPosts(channel, 10);

        // Базовая информация
        const analysis: ChannelAnalysis = {
            channelId: channel.id.toString(),
            channelUsername: channel.username || '',
            channelTitle: channel.title || dialog.name || '',
            isPolitical: false,
            isUkrainian: false,
            isWarRelated: false,
            shouldUnsubscribe: false,
            lastPosts: posts
        };

        // Если нет постов - пропускаем
        if (posts.length === 0) {
            console.log('   ⚠️ Нет постов для анализа');
            return analysis;
        }

        // Применяем выбранные фильтры
        const reasons: string[] = [];

        for (const filter of this.selectedFilters) {
            const result = await this.applyFilter(filter, posts);

            if (result.matched) {
                reasons.push(`${filter.name}: ${result.reason}`);

                // Устанавливаем соответствующие флаги
                if (filter.name.includes('Политические')) analysis.isPolitical = true;
                if (filter.name.includes('нецелевом языке')) analysis.isUkrainian = true;
                if (filter.name.includes('военные конфликты')) analysis.isWarRelated = true;
            }
        }

        if (reasons.length > 0) {
            analysis.shouldUnsubscribe = true;
            analysis.aiReason = reasons.join('; ');
        }

        return analysis;
    }

    private async getChannelPosts(channel: any, limit: number): Promise<string[]> {
        const posts: string[] = [];

        try {
            const messages = await this.gramClient.getClient().getMessages(channel, { limit });

            for (const message of messages) {
                if (message.text) {
                    // Обрезаем длинные посты
                    const text = message.text.length > 500
                        ? message.text.substring(0, 500) + '...'
                        : message.text;
                    posts.push(text);
                }
            }
        } catch (error) {
            console.log('   ⚠️ Не удалось получить посты');
        }

        return posts;
    }

    private async applyFilter(filter: FilterConfig, posts: string[]): Promise<{matched: boolean, reason: string}> {
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: filter.systemPrompt },
                    { role: 'user', content: filter.userPrompt(posts.slice(0, 5)) } // Берем первые 5 постов
                ],
                temperature: 0.3,
                max_tokens: 100
            });

            const answer = response.choices[0].message.content || '';
            const matched = answer.toUpperCase().includes('ДА');
            const reason = answer.split('\n')[1] || answer; // Берем объяснение

            return { matched, reason };

        } catch (error) {
            console.log(`   ⚠️ Ошибка AI: ${error}`);
            return { matched: false, reason: 'Ошибка анализа' };
        }
    }

    private displayResults(): void {
        console.log('\n📊 РЕЗУЛЬТАТЫ АНАЛИЗА');
        console.log('═══════════════════════════════════');

        const toUnsubscribe = this.analysisResults.filter(r => r.shouldUnsubscribe);
        const toKeep = this.analysisResults.filter(r => !r.shouldUnsubscribe);

        console.log(`\n✅ Оставить: ${toKeep.length} каналов`);
        console.log(`❌ Отписаться: ${toUnsubscribe.length} каналов`);

        if (toUnsubscribe.length > 0) {
            console.log('\n📋 Каналы для отписки:');
            toUnsubscribe.forEach((ch, i) => {
                console.log(`${i + 1}. ${ch.channelTitle} (@${ch.channelUsername})`);
                console.log(`   Причина: ${ch.aiReason}`);
            });
        }
    }

    private async handleUnsubscribe(): Promise<void> {
        const toUnsubscribe = this.analysisResults.filter(r => r.shouldUnsubscribe);

        if (toUnsubscribe.length === 0) {
            console.log('\n✅ Нет каналов для отписки');
            return;
        }

        const confirm = await prompts({
            type: 'confirm',
            name: 'proceed',
            message: `Отписаться от ${toUnsubscribe.length} каналов?`,
            initial: false
        });

        if (!confirm.proceed) {
            console.log('⏸️ Отписка отменена');
            return;
        }

        console.log('\n🗑️ Отписываюсь от каналов...');
        let unsubscribed = 0;

        for (const channel of toUnsubscribe) {
            try {
                await this.gramClient.getClient().invoke(
                    new Api.channels.LeaveChannel({
                        channel: channel.channelUsername || channel.channelId
                    })
                );
                unsubscribed++;
                console.log(`   ✅ Отписался от: ${channel.channelTitle}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.log(`   ❌ Ошибка отписки от ${channel.channelTitle}`);
            }
        }

        console.log(`\n✅ Отписался от ${unsubscribed} каналов`);
    }

    private async exportResults(): Promise<void> {
        const doExport = await prompts({
            type: 'confirm',
            name: 'export',
            message: 'Сохранить результаты в файл?',
            initial: true
        });

        if (!doExport.export) return;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `ai-filter-results-${timestamp}.json`;
        const filepath = path.join('./exports', filename);

        // Создаем папку если не существует
        if (!fs.existsSync('./exports')) {
            fs.mkdirSync('./exports');
        }

        const exportData = {
            timestamp: new Date().toISOString(),
            filters: this.selectedFilters.map(f => f.name),
            totalAnalyzed: this.analysisResults.length,
            toUnsubscribe: this.analysisResults.filter(r => r.shouldUnsubscribe).length,
            results: this.analysisResults
        };

        fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2));
        console.log(`\n💾 Результаты сохранены: ${filename}`);
    }

    private async cleanup(): Promise<void> {
        if (this.gramClient) {
            await this.gramClient.cleanup();
        }
    }
}

// Запуск скрипта
if (require.main === module) {
    const filter = new ChannelAIFilter();
    filter.start().catch(console.error);
}