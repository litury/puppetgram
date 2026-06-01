/**
 * Анализ входящего канала и поиск релевантных каналов из подписок через AI
 * Использует агентскую систему для определения тематики и поиска похожих каналов
 *
 * Запуск: npm run find:similar
 */

import * as dotenv from 'dotenv';

import { createLogger } from '../../shared/utils/logger';
const log = createLogger('FindSimilarChannels');
dotenv.config();

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { EnvAccountsParser } from '../../shared/utils/envAccountsParser';
import OpenAI from 'openai';
import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';

// AI конфигурация
const AI_CONFIG = {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.2,
    maxTokens: 150,
    timeout: 20000
};

// Система анализа каналов через агентов
const ANALYSIS_AGENTS = [
    {
        name: '🎯 Тематический аналитик',
        role: 'topic_analyzer',
        systemPrompt: `Ты эксперт по анализу тематики каналов. Определи основную тематику канала и ключевые слова.

Анализируй посты и определи:
1. Основную тематику канала (IT, криптовалюты, бизнес, образование, развлечения, новости, финансы, маркетинг, дизайн, наука и т.д.)
2. Подтематики и специализацию
3. Ключевые понятия и термины
4. Целевую аудиторию

ФОРМАТ ОТВЕТА:
Тематика: [основная тема]
Подтемы: [список подтем через запятую]
Ключевые слова: [ключевые термины через запятую]
Аудитория: [описание целевой аудитории]

Отвечай кратко и конкретно.`,
        extract: (text: string) => {
            const lines = text.split('\n');
            const result: any = {};

            for (const line of lines) {
                if (line.startsWith('Тематика:')) result.topic = line.replace('Тематика:', '').trim();
                if (line.startsWith('Подтемы:')) result.subtopics = line.replace('Подтемы:', '').trim();
                if (line.startsWith('Ключевые слова:')) result.keywords = line.replace('Ключевые слова:', '').trim();
                if (line.startsWith('Аудитория:')) result.audience = line.replace('Аудитория:', '').trim();
            }

            return result;
        }
    },
    {
        name: '📊 Контент-аналитик',
        role: 'content_analyzer',
        systemPrompt: `Ты аналитик контента. Определи стиль, формат и качество контента канала.

Анализируй посты и определи:
1. Стиль подачи (официальный, неформальный, образовательный, развлекательный, новостной)
2. Формат контента (статьи, новости, мемы, обучение, аналитика, реклама)
3. Качество контента (высокое, среднее, низкое)
4. Частота постинга (активный, умеренный, редкий)

ФОРМАТ ОТВЕТА:
Стиль: [стиль подачи]
Формат: [основные форматы через запятую]
Качество: [оценка качества]
Активность: [оценка активности]

Отвечай кратко и конкретно.`,
        extract: (text: string) => {
            const lines = text.split('\n');
            const result: any = {};

            for (const line of lines) {
                if (line.startsWith('Стиль:')) result.style = line.replace('Стиль:', '').trim();
                if (line.startsWith('Формат:')) result.format = line.replace('Формат:', '').trim();
                if (line.startsWith('Качество:')) result.quality = line.replace('Качество:', '').trim();
                if (line.startsWith('Активность:')) result.activity = line.replace('Активность:', '').trim();
            }

            return result;
        }
    },
    {
        name: '🔍 Поисковик похожих каналов',
        role: 'similarity_finder',
        systemPrompt: `Ты эксперт по поиску релевантных каналов. Сравни анализируемый канал с каналом из подписок и определи их похожесть.

Сравнивай по критериям:
1. Тематическое совпадение (та же тема или смежная)
2. Целевая аудитория (тот же типаж читателей)
3. Стиль и формат контента
4. Качество контента

ОЦЕНКА ПОХОЖЕСТИ:
- ВЫСОКАЯ (90-100%): Практически идентичная тематика и стиль
- СРЕДНЯЯ (60-89%): Похожая тематика или аудитория
- НИЗКАЯ (30-59%): Есть общие элементы, но разные направления
- НИКАК (0-29%): Совершенно разные каналы

ФОРМАТ ОТВЕТА:
Похожесть: [ВЫСОКАЯ/СРЕДНЯЯ/НИЗКАЯ/НИКАК]
Совпадения: [что общего]
Различия: [чем отличаются]
Процент: [число]%

Отвечай кратко и обоснованно.`,
        extract: (text: string) => {
            const lines = text.split('\n');
            let similarity = 'НИКАК';
            let percentage = 0;
            let matches = '';
            let differences = '';

            for (const line of lines) {
                if (line.startsWith('Похожесть:')) {
                    similarity = line.replace('Похожесть:', '').trim();
                }
                if (line.startsWith('Процент:')) {
                    const match = line.match(/(\d+)%/);
                    if (match) percentage = parseInt(match[1]);
                }
                if (line.startsWith('Совпадения:')) matches = line.replace('Совпадения:', '').trim();
                if (line.startsWith('Различия:')) differences = line.replace('Различия:', '').trim();
            }

            return { similarity, percentage, matches, differences };
        }
    }
];

// Простой логгер

interface ChannelAnalysis {
    topic?: string;
    subtopics?: string;
    keywords?: string;
    audience?: string;
    style?: string;
    format?: string;
    quality?: string;
    activity?: string;
}

interface SimilarChannel {
    title: string;
    username: string;
    similarity: string;
    percentage: number;
    matches: string;
    differences: string;
}

/**
 * Основной класс поиска релевантных каналов
 */
class SimilarChannelsFinder {
    private client!: TelegramClient;
    private openai!: OpenAI;
    private apiId: number = parseInt(process.env.API_ID || '0');
    private apiHash: string = process.env.API_HASH || '';
    private subscribedChannels: any[] = [];
    private targetChannelAnalysis!: ChannelAnalysis;

    async run(): Promise<void> {
        log.info('🎯 ПОИСК РЕЛЕВАНТНЫХ КАНАЛОВ ЧЕРЕЗ AI');

        // Проверка API ключа
        if (!AI_CONFIG.apiKey) {
            log.error('Не найден DEEPSEEK_API_KEY в переменных окружения!');
            log.info('Установите: export DEEPSEEK_API_KEY="ваш_ключ"');
            process.exit(1);
        }

        try {
            // 1. Инициализация
            await this.initialize();

            // 2. Ввод целевого канала
            const targetChannel = await this.getTargetChannel();

            // 3. Анализ целевого канала
            this.targetChannelAnalysis = await this.analyzeTargetChannel(targetChannel);

            // 4. Загрузка подписанных каналов
            await this.loadSubscribedChannels();

            // 5. Поиск похожих каналов
            const similarChannels = await this.findSimilarChannels();

            // 6. Показ результатов
            this.displayResults(targetChannel, similarChannels);

            // 7. Сохранение отчета
            await this.saveReport(targetChannel, similarChannels);

        } catch (error) {
            log.error(`Критическая ошибка: ${error}`);
        } finally {
            await this.cleanup();
        }
    }

    private async initialize(): Promise<void> {
        log.info('👥 ВЫБОР АККАУНТА');

        const accountsParser = new EnvAccountsParser();
        const accounts = accountsParser.getAvailableAccounts();

        if (accounts.length === 0) {
            throw new Error('Не найдено аккаунтов в .env файле');
        }

        log.info(`Найдено аккаунтов: ${accounts.length}`);

        const accountChoice = await prompts({
            type: 'select',
            name: 'account',
            message: 'Выберите аккаунт для анализа:',
            choices: accounts.map(acc => ({
                title: `${acc.name} ${acc.username ? `(@${acc.username})` : ''}`,
                value: acc
            }))
        });

        if (!accountChoice.account) {
            log.error('Аккаунт не выбран');
            process.exit(0);
        }

        const account = accountChoice.account;
        log.info(`Выбран аккаунт: ${account.name}`);

        // Подключение к Telegram
        log.info('Подключение к Telegram...');
        this.client = new TelegramClient(
            new StringSession(account.sessionValue || ''),
            this.apiId,
            this.apiHash,
            { connectionRetries: 5 }
        );

        await this.client.connect();
        log.info('Подключен к Telegram');

        // Инициализация AI
        this.openai = new OpenAI({
            apiKey: AI_CONFIG.apiKey,
            baseURL: AI_CONFIG.baseUrl
        });

        log.info('Инициализация завершена');
    }

    private async getTargetChannel(): Promise<any> {
        log.info('🎯 ВВОД ЦЕЛЕВОГО КАНАЛА');

        const channelInput = await prompts({
            type: 'text',
            name: 'channel',
            message: 'Введите @username или ссылку на канал для анализа:',
            validate: value => value.length > 0 ? true : 'Введите валидное имя канала'
        });

        if (!channelInput.channel) {
            log.error('Канал не введен');
            process.exit(0);
        }

        let channelName = channelInput.channel.trim();

        // Очищаем ссылку до username
        if (channelName.includes('t.me/')) {
            channelName = channelName.split('t.me/')[1].split('/')[0];
        }
        if (!channelName.startsWith('@')) {
            channelName = '@' + channelName;
        }

        log.info(`Анализируем канал: ${channelName}`);

        try {
            const channel = await this.client.getEntity(channelName);
            const title = (channel as any).title || (channel as any).firstName || channelName;
            log.info(`✅ Канал найден: ${title}`);
            return channel;
        } catch (error) {
            log.error(`Не удалось найти канал ${channelName}: ${error}`);
            process.exit(1);
        }
    }

    private async analyzeTargetChannel(channel: any): Promise<ChannelAnalysis> {
        log.info('🔍 АНАЛИЗ ЦЕЛЕВОГО КАНАЛА');

        const channelTitle = (channel as any).title || (channel as any).firstName || 'Канал';
        log.info(`Анализирую канал: ${channelTitle}`);

        // Получаем посты для анализа
        const posts = await this.getChannelPosts(channel, 8);

        if (posts.length === 0) {
            log.warn('Нет доступных постов для анализа');
            return {};
        }

        log.info(`Получено ${posts.length} постов для анализа`);

        let analysis: ChannelAnalysis = {};

        // Запускаем анализ через первых двух агентов
        for (const agent of ANALYSIS_AGENTS.slice(0, 2)) {
            log.info(`Запуск: ${agent.name}`);

            const result = await this.runAnalysisAgent(agent, posts);
            analysis = { ...analysis, ...result };

            // Пауза между агентами
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Показываем результат анализа
        this.displayChannelAnalysis(channelTitle, analysis);

        return analysis;
    }

    private async loadSubscribedChannels(): Promise<void> {
        log.info('📋 ЗАГРУЗКА ПОДПИСАННЫХ КАНАЛОВ');

        log.info('Сканирую ваши подписки...');

        let dialogCount = 0;
        let channelCount = 0;

        try {
            for await (const dialog of this.client.iterDialogs()) {
                dialogCount++;

                if (this.isChannel(dialog)) {
                    this.subscribedChannels.push(dialog);
                    channelCount++;

                    if (channelCount % 25 === 0) {
                        log.info(`   📺 Найдено каналов: ${channelCount}`);
                    }

                    // Лимит для тестирования
                    if (channelCount >= 100) {
                        log.warn('Достигнут лимит 100 каналов для анализа');
                        break;
                    }
                }

                // Пауза для избежания лимитов
                if (dialogCount % 500 === 0) {
                    log.info('⏸️ Пауза...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            log.info(`✅ Загружено ${channelCount} каналов из подписок`);

            if (channelCount === 0) {
                log.warn('❌ Нет каналов в подписках для сравнения');
                process.exit(0);
            }

        } catch (error: any) {
            log.error(`Ошибка загрузки каналов: ${error.message || error}`);
            process.exit(1);
        }
    }

    private async findSimilarChannels(): Promise<SimilarChannel[]> {
        log.info('🔍 ПОИСК ПОХОЖИХ КАНАЛОВ');

        const maxChannelsToCheck = 20; // Лимит для тестирования
        const channelsToCheck = this.subscribedChannels.slice(0, maxChannelsToCheck);

        log.info(`Анализируем ${channelsToCheck.length} каналов на похожесть...`);

        const similarChannels: SimilarChannel[] = [];
        const comparisonAgent = ANALYSIS_AGENTS[2]; // Агент сравнения

        for (let i = 0; i < channelsToCheck.length; i++) {
            const channel = channelsToCheck[i];
            const channelName = channel.title || channel.name || 'Без названия';

            log.info(`[${i + 1}/${channelsToCheck.length}] Сравниваю с: ${channelName}`);

            try {
                // Получаем посты канала для сравнения
                const posts = await this.getChannelPosts(channel.entity, 5);

                if (posts.length === 0) {
                    log.warn(`  Пропускаю ${channelName} - нет постов`);
                    continue;
                }

                // Сравниваем с целевым каналом
                const similarity = await this.compareSimilarity(comparisonAgent, posts);

                if (similarity.percentage >= 30) { // Порог релевантности
                    similarChannels.push({
                        title: channelName,
                        username: channel.entity?.username || '',
                        similarity: similarity.similarity,
                        percentage: similarity.percentage,
                        matches: similarity.matches,
                        differences: similarity.differences
                    });

                    log.info(`  🎯 ${similarity.similarity} (${similarity.percentage}%): ${channelName}`);
                } else {
                    log.info(`  ⏭️ Не релевантен (${similarity.percentage}%): ${channelName}`);
                }

                // Пауза между проверками
                await new Promise(resolve => setTimeout(resolve, 800));

            } catch (error) {
                log.warn(`  ⚠️ Ошибка анализа ${channelName}: ${error}`);
            }
        }

        // Сортируем по релевантности
        similarChannels.sort((a, b) => b.percentage - a.percentage);

        return similarChannels;
    }

    private async getChannelPosts(channel: any, limit: number): Promise<string[]> {
        const posts: string[] = [];

        try {
            const messages = await this.client.getMessages(channel, { limit });

            for (const message of messages) {
                if (message.text) {
                    const text = message.text.length > 250
                        ? message.text.substring(0, 250) + '...'
                        : message.text;
                    posts.push(text);
                }
            }
        } catch (error) {
            // Игнорируем ошибки получения постов
        }

        return posts;
    }

    private async runAnalysisAgent(agent: any, posts: string[]): Promise<any> {
        try {
            const content = posts
                .map((post, index) => `${index + 1}. ${post.substring(0, 200)}`)
                .join('\n\n');

            const response = await this.openai.chat.completions.create({
                model: AI_CONFIG.model,
                messages: [
                    { role: 'system', content: agent.systemPrompt },
                    { role: 'user', content: `Анализируй эти посты канала:\n\n${content}` }
                ],
                temperature: AI_CONFIG.temperature,
                max_tokens: AI_CONFIG.maxTokens
            }, {
                timeout: AI_CONFIG.timeout
            });

            const answer = response.choices[0].message.content || '';
            return agent.extract(answer);

        } catch (error: any) {
            log.warn(`Ошибка агента ${agent.name}: ${error.message || error}`);
            return {};
        }
    }

    private async compareSimilarity(agent: any, channelPosts: string[]): Promise<any> {
        try {
            const targetInfo = this.formatTargetChannelInfo();
            const channelContent = channelPosts
                .map((post, index) => `${index + 1}. ${post.substring(0, 150)}`)
                .join('\n');

            const response = await this.openai.chat.completions.create({
                model: AI_CONFIG.model,
                messages: [
                    { role: 'system', content: agent.systemPrompt },
                    {
                        role: 'user',
                        content: `ЦЕЛЕВОЙ КАНАЛ:\n${targetInfo}\n\nСРАВНИВАЕМЫЙ КАНАЛ - ПОСТЫ:\n${channelContent}\n\nСравни их похожесть:`
                    }
                ],
                temperature: AI_CONFIG.temperature,
                max_tokens: AI_CONFIG.maxTokens
            }, {
                timeout: AI_CONFIG.timeout
            });

            const answer = response.choices[0].message.content || '';
            return agent.extract(answer);

        } catch (error: any) {
            return { similarity: 'НИКАК', percentage: 0, matches: '', differences: '' };
        }
    }

    private formatTargetChannelInfo(): string {
        const analysis = this.targetChannelAnalysis;
        return `Тематика: ${analysis.topic || 'не определена'}
Подтемы: ${analysis.subtopics || 'не определены'}
Ключевые слова: ${analysis.keywords || 'не определены'}
Стиль: ${analysis.style || 'не определен'}
Формат: ${analysis.format || 'не определен'}
Качество: ${analysis.quality || 'не определено'}`;
    }

    private isChannel(dialog: any): boolean {
        const entity = dialog.entity;
        return entity &&
               entity.className === 'Channel' &&
               entity.broadcast === true;
    }

    private displayChannelAnalysis(channelTitle: string, analysis: ChannelAnalysis): void {
        log.info(`📊 РЕЗУЛЬТАТ АНАЛИЗА: ${channelTitle}`);

        console.log(`
┌─────────────────────────────────────────────────────────┐
│ 🎯 ТЕМАТИКА: ${(analysis.topic || 'не определена').padEnd(42)} │
│ 📂 ПОДТЕМЫ:  ${(analysis.subtopics || 'не определены').padEnd(42)} │
│ 🔑 КЛЮЧЕВЫЕ СЛОВА: ${(analysis.keywords || 'не определены').substring(0, 36).padEnd(36)} │
│ 👥 АУДИТОРИЯ: ${(analysis.audience || 'не определена').padEnd(41)} │
├─────────────────────────────────────────────────────────┤
│ 🎨 СТИЛЬ: ${(analysis.style || 'не определен').padEnd(46)} │
│ 📄 ФОРМАТ: ${(analysis.format || 'не определен').padEnd(45)} │
│ ⭐ КАЧЕСТВО: ${(analysis.quality || 'не определено').padEnd(43)} │
│ 📈 АКТИВНОСТЬ: ${(analysis.activity || 'не определена').padEnd(41)} │
└─────────────────────────────────────────────────────────┘`);
    }

    private displayResults(targetChannel: any, similarChannels: SimilarChannel[]): void {
        log.info('🎯 РЕЛЕВАНТНЫЕ КАНАЛЫ');

        if (similarChannels.length === 0) {
            log.warn('😔 Не найдено релевантных каналов в ваших подписках');
            return;
        }

        log.info(`🎉 Найдено ${similarChannels.length} релевантных каналов:`);

        similarChannels.forEach((channel, index) => {
            const emoji = channel.percentage >= 80 ? '🔥' :
                         channel.percentage >= 60 ? '✨' : '👍';

            console.log(`\n${emoji} ${index + 1}. ${channel.title} ${channel.username ? `(@${channel.username})` : ''}`);
            console.log(`   📊 Похожесть: ${channel.similarity} (${channel.percentage}%)`);
            console.log(`   ✅ Совпадения: ${channel.matches}`);
            if (channel.differences) {
                console.log(`   🔄 Различия: ${channel.differences}`);
            }
        });
    }

    private async saveReport(targetChannel: any, similarChannels: SimilarChannel[]): Promise<void> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `similar-channels-${timestamp}.json`;
        const filepath = path.join('./exports', filename);

        if (!fs.existsSync('./exports')) {
            fs.mkdirSync('./exports');
        }

        const report = {
            timestamp: new Date().toISOString(),
            targetChannel: {
                title: (targetChannel as any).title || (targetChannel as any).firstName || 'Канал',
                username: (targetChannel as any).username || '',
                analysis: this.targetChannelAnalysis
            },
            similarChannels: similarChannels,
            totalAnalyzed: this.subscribedChannels.length,
            foundSimilar: similarChannels.length
        };

        fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
        log.info(`💾 Отчет сохранен: ${filename}`);
    }

    private async cleanup(): Promise<void> {
        if (this.client) {
            await this.client.disconnect();
        }
    }
}

// Запуск
if (require.main === module) {
    const finder = new SimilarChannelsFinder();
    finder.run().catch(console.error);
}