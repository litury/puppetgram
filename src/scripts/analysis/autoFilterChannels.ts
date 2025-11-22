/**
 * Автоматическая AI-фильтрация и отписка от нежелательных каналов
 * Использует Deepseek API для анализа контента
 *
 * Запуск: npm run filter:auto
 */

import * as dotenv from 'dotenv';

import { createLogger } from '../../shared/utils/logger';
const log = createLogger('AutoFilterChannels');
dotenv.config();

import { Api } from 'telegram';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { EnvAccountsParser } from '../../shared/utils/envAccountsParser';
import OpenAI from 'openai';
import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';

// Оптимизированная AI конфигурация для скорости
const AI_CONFIG = {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.1, // Минимальная температура для стабильности
    maxTokens: 50,   // Короткие ответы = быстрее
    timeout: 15000   // 15 сек timeout вместо стандартных 30
};

// Система чисто AI-агентов (без захардкоженных слов)
const FILTER_AGENTS = [
    {
        name: '🏛️ Аналитик политического контента',
        role: 'political_analyst',
        systemPrompt: `Ты аналитик контента. Определи является ли канал политическим по содержанию постов.

ПОЛИТИКА = каналы которые специализируются на:
- Обсуждении мировых лидеров и политических фигур
- Политических процессах и институтах
- Государственной политике и решениях властей
- Политических новостях и аналитике

НЕ ПОЛИТИКА = каналы про:
- IT, программирование, технологии
- Криптовалюты, финансы, бизнес
- Образование, курсы, обучение
- Развлечения, юмор, мемы
- Спорт, игры

ВАЖНО: Если в IT-канале упоминается слово "фронт" (фронтенд) - это НЕ политика!

Отвечай только "ДА" (политический канал) или "НЕТ" (не политический).`,
        check: (text: string) => text.toUpperCase().startsWith('ДА')
    },
    {
        name: '⚔️ Аналитик военной тематики',
        role: 'military_analyst',
        systemPrompt: `Ты аналитик контента. Определи является ли канал военным по содержанию постов.

ВОЕННЫЕ каналы специализируются на:
- Военных конфликтах и операциях
- Военной технике и вооружении
- Военных подразделениях и структурах
- Военных новостях и аналитике
- Геополитических конфликтах

НЕ ВОЕННЫЕ каналы про:
- IT разработку (даже если есть "фронтенд", "бэкенд")
- Обычные новости, политику, экономику
- Образование, технологии, бизнес
- Развлечения, юмор

ВАЖНО: "Джун на фронте" в IT-контексте = НЕ военный канал!

Отвечай только "ДА" (военный канал) или "НЕТ" (не военный).`,
        check: (text: string) => text.toUpperCase().startsWith('ДА')
    },
    {
        name: '💊 Аналитик запрещенного контента',
        role: 'narcotics_expert',
        systemPrompt: `Ты аналитик контента. Определи специализируется ли канал на запрещенных веществах.

ЗАПРЕЩЕННЫЙ КОНТЕНТ - каналы специализирующиеся на:
- Продаже или рекламе запрещенных веществ
- Инструкциях по употреблению или изготовлению
- Координации незаконных сделок
- Обсуждении способов обхода законов

ПРИЗНАКИ ЗАПРЕЩЕННОГО КОНТЕНТА:
- Упоминание "закладок", "кладов", нелегальных магазинов
- Реклама незаконных веществ и препаратов
- Инструкции по незаконным действиям
- Сленг связанный с незаконным оборотом

НЕ ЗАПРЕЩЕННЫЙ контент про:
- Медицину, фармацевтику (легальные лекарства)
- Здоровый образ жизни и фитнес
- Кулинарию и садоводство
- Образование и науку

ВАЖНО: Медицинские каналы про легальные препараты = НЕ запрещенный контент!

Отвечай "ДА" только если канал специализируется на незаконном контенте, иначе "НЕТ".`,
        check: (text: string) => text.toUpperCase().startsWith('ДА')
    },
    {
        name: '🌐 Лингвист-аналитик',
        role: 'language_expert',
        systemPrompt: `Ты лингвист. Определи основной язык канала по постам.

ЦЕЛЕВОЙ ЯЗЫК - признаки:
- Специфические окончания слов
- Характерная грамматика и синтаксис
- Уникальная лексика

НЕЦЕЛЕВОЙ ЯЗЫК - признаки:
- Технические термины (обычно международные)
- IT-лексика: программирование, разработка
- Бизнес-термины: стартап, маркетинг

ВАЖНО: Технические каналы часто используют международную терминологию!

Отвечай "ДА" только если канал на языке отличном от основного языка анализа, иначе "НЕТ".`,
        check: (text: string) => text.toUpperCase().startsWith('ДА')
    }
];

// Простой логгер
}

/**
 * Основной класс автоматической фильтрации
 */
class AutoChannelFilter {
    private client!: TelegramClient;
    private openai!: OpenAI;
    private channels: any[] = [];
    private unsubscribeList: any[] = [];
    private apiId: number = parseInt(process.env.API_ID || '0');
    private apiHash: string = process.env.API_HASH || '';
    private stats = {
        total: 0,
        analyzed: 0,
        political: 0,
        ukrainian: 0,
        warRelated: 0,
        narcotics: 0,  // Новая статистика
        unsubscribed: 0,
        errors: 0
    };

    async run(): Promise<void> {
        log.info('🤖 АВТОМАТИЧЕСКАЯ AI-ФИЛЬТРАЦИЯ КАНАЛОВ');

        // Проверка API ключа
        if (!AI_CONFIG.apiKey) {
            log.error('Не найден DEEPSEEK_API_KEY в переменных окружения!');
            log.info('Установите: export DEEPSEEK_API_KEY="ваш_ключ"');
            process.exit(1);
        }

        try {
            // 1. Инициализация и выбор аккаунта
            await this.initialize();

            // Показываем предупреждение ПОСЛЕ выбора аккаунта
            log.info('⚠️ АКТИВНЫЕ АГЕНТЫ');
            log.warn('Будут применены следующие AI-агенты:');
            FILTER_AGENTS.forEach(f => log.info(`  ${f.name}`));
            log.warn('Каналы с политическим, военным, запрещенным контентом будут удалены!');

            // Запрос подтверждения
            const confirm = await prompts({
                type: 'confirm',
                name: 'proceed',
                message: 'Продолжить с этими агентами?',
                initial: true
            });

            if (!confirm.proceed) {
                log.info('Операция отменена пользователем');
                process.exit(0);
            }

            // 2. Загрузка каналов
            await this.loadChannels();

            // 3. Анализ каналов
            await this.analyzeChannels();

            // 4. Отписка происходит непосредственно в цикле анализа
            log.info('🏁 Отписка завершена в режиме real-time');

            // 5. Финальная статистика
            this.showFinalStats();

        } catch (error) {
            log.error(`Критическая ошибка: ${error}`);
        } finally {
            await this.cleanup();
        }
    }

    private async initialize(): Promise<void> {
        // Выбор аккаунта
        log.info('👥 ВЫБОР АККАУНТА');

        const accountsParser = new EnvAccountsParser();
        const accounts = accountsParser.getAvailableAccounts();

        if (accounts.length === 0) {
            throw new Error('Не найдено аккаунтов в .env файле');
        }

        log.info(`Найдено аккаунтов: ${accounts.length}`);

        // Показываем выбор аккаунта
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

        // Инициализация OpenAI/Deepseek
        this.openai = new OpenAI({
            apiKey: AI_CONFIG.apiKey,
            baseURL: AI_CONFIG.baseUrl
        });

        log.info('Инициализация завершена');
    }

    private async loadChannels(): Promise<void> {
        log.info('📋 ЗАГРУЗКА КАНАЛОВ');

        log.info('Сканирую подписки на каналы...');

        let dialogCount = 0;
        let channelCount = 0;
        let groupCount = 0;
        let userCount = 0;
        const maxChannels = 500; // Максимум каналов для загрузки

        try {
            // Используем iterDialogs как в parseSubscribedChannels
            for await (const dialog of this.client.iterDialogs()) {
                dialogCount++;

                // Подсчитываем типы диалогов
                const entity = dialog.entity;
                if (entity) {
                    if (entity.className === 'User') {
                        userCount++;
                    } else if (entity.className === 'Channel' && !entity.broadcast) {
                        groupCount++;
                    } else if (this.isChannel(dialog)) {
                        this.channels.push(dialog);
                        channelCount++;

                        // Показываем прогресс по каналам
                        if (channelCount % 25 === 0) {
                            log.info(`   📺 Найдено каналов: ${channelCount}`);
                        }

                        // Останавливаемся если достигли лимита
                        if (channelCount >= maxChannels) {
                            log.warn(`Достигнут лимит ${maxChannels} каналов`);
                            break;
                        }
                    }
                }

                // Показываем прогресс сканирования с деталями
                if (dialogCount % 200 === 0) {
                    log.info(`Просканировано: ${dialogCount} (каналы: ${channelCount}, группы: ${groupCount}, чаты: ${userCount})`);
                }

                // Добавляем паузу каждые 500 диалогов чтобы избежать FloodWait
                if (dialogCount % 500 === 0) {
                    log.info(`⏸️ Пауза для избежания лимитов...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            this.stats.total = this.channels.length;

            log.info(`✅ Сканирование завершено!`);
            log.info(`   📊 Просканировано диалогов: ${dialogCount}`);
            log.info(`   📺 Найдено каналов: ${channelCount}`);
            log.info(`   👥 Найдено групп: ${groupCount}`);
            log.info(`   💬 Найдено чатов: ${userCount}`);

            if (this.stats.total === 0) {
                log.warn('❌ Нет каналов для анализа');
                log.info('💡 Убедитесь что выбранный аккаунт подписан на broadcast каналы');
                process.exit(0);
            }

        } catch (error: any) {
            if (error.errorMessage === 'FLOOD_WAIT') {
                log.error(`⏱️ FloodWait: подождите ${error.seconds} секунд и попробуйте снова`);
            } else {
                log.error(`Ошибка загрузки: ${error.message || error}`);
            }
            process.exit(1);
        }
    }

    private isChannel(dialog: any): boolean {
        const entity = dialog.entity;
        return entity &&
               entity.className === 'Channel' &&
               entity.broadcast === true;
    }

    private async analyzeChannels(): Promise<void> {
        log.info('🔍 ПАКЕТНЫЙ АНАЛИЗ КАНАЛОВ');

        // Настройки пакетной обработки с контролем лимитов
        const batchSize = 4; // Увеличим до 4 каналов параллельно
        const batchDelayMs = 2000; // Увеличим паузу для соблюдения rate limits
        const requestDelayMs = 200; // Пауза между AI запросами

        // Спрашиваем сколько каналов анализировать
        const limitChoice = await prompts({
            type: 'number',
            name: 'limit',
            message: `Сколько каналов проанализировать? (всего ${this.channels.length}):`,
            initial: Math.min(50, this.channels.length),
            min: 1,
            max: this.channels.length
        });

        if (!limitChoice.limit) {
            log.error('Количество не выбрано');
            return;
        }

        const channelsToAnalyze = this.channels.slice(0, limitChoice.limit);
        const totalBatches = Math.ceil(channelsToAnalyze.length / batchSize);

        log.info(`Пакетная обработка: ${channelsToAnalyze.length} каналов в ${totalBatches} пакетах по ${batchSize}`);

        // Обрабатываем каналы пакетами
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const startIndex = batchIndex * batchSize;
            const endIndex = Math.min(startIndex + batchSize, channelsToAnalyze.length);
            const batch = channelsToAnalyze.slice(startIndex, endIndex);

            log.info(`\n📦 Пакет ${batchIndex + 1}/${totalBatches} (${batch.length} каналов)`);

            // Обрабатываем все каналы в пакете параллельно
            const batchPromises = batch.map((channel, index) =>
                this.analyzeChannelInBatch(channel, startIndex + index + 1, channelsToAnalyze.length)
            );

            const batchResults = await Promise.all(batchPromises);

            // Обрабатываем результаты пакета и сразу отписываемся
            for (const result of batchResults) {
                if (result && result.shouldUnsubscribe) {
                    await this.unsubscribeFromChannel(result.channel, result.reasons);
                }
            }

            // Пауза между пакетами для соблюдения rate limits
            if (batchIndex < totalBatches - 1) {
                log.info(`⏸️ Пауза ${batchDelayMs}мс перед следующим пакетом...`);
                await new Promise(resolve => setTimeout(resolve, batchDelayMs));
            }
        }

        log.info(`\n✅ Проанализировано: ${this.stats.analyzed} каналов`);
        log.info(`🗑️ Отписался: ${this.stats.unsubscribed} каналов`);
    }

    private async getChannelPosts(channel: any, limit: number): Promise<string[]> {
        const posts: string[] = [];

        try {
            const messages = await this.client.getMessages(channel, { limit });

            for (const message of messages) {
                if (message.text) {
                    // Обрезаем длинные посты
                    const text = message.text.length > 300
                        ? message.text.substring(0, 300) + '...'
                        : message.text;
                    posts.push(text);
                }
            }
        } catch (error) {
            // Игнорируем ошибки получения постов
        }

        return posts;
    }

    /**
     * Запускает AI агента для анализа постов
     */
    private async runAIAgent(agent: any, posts: string[]): Promise<{matched: boolean, reason: string}> {
        try {
            // Оптимизируем количество постов для скорости
            const postsToAnalyze = posts.slice(0, 4);

            // Сокращенный формат для экономии токенов
            const content = postsToAnalyze
                .map((post, index) => `${index + 1}. ${post.substring(0, 200)}`) // Короче посты
                .join('\n');

            const response = await this.openai.chat.completions.create({
                model: AI_CONFIG.model,
                messages: [
                    { role: 'system', content: agent.systemPrompt },
                    {
                        role: 'user',
                        content: `Анализируй посты:\n${content}`
                    }
                ],
                temperature: AI_CONFIG.temperature,
                max_tokens: AI_CONFIG.maxTokens
            }, {
                timeout: AI_CONFIG.timeout
            });

            const answer = response.choices[0].message.content || '';
            const matched = agent.check(answer);

            // Короткая причина
            const reason = answer.substring(0, 50).replace(/\n/g, ' ');

            return { matched, reason };

        } catch (error: any) {
            // Улучшенная обработка ошибок API
            if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
                return { matched: false, reason: 'Timeout' };
            }
            if (error.status === 429) {
                return { matched: false, reason: 'Rate limit' };
            }
            return { matched: false, reason: 'API Error' };
        }
    }

    /**
     * Обрабатывает один канал в пакете
     */
    private async analyzeChannelInBatch(channel: any, channelNumber: number, totalChannels: number): Promise<any> {
        const channelName = channel.title || channel.name || 'Без названия';

        try {
            // Получаем минимум постов для скорости
            const posts = await this.getChannelPosts(channel.entity, 5);

            if (posts.length === 0) {
                log.info(`[${channelNumber}/${totalChannels}] ⏭️ ${channelName} - пропущен (нет постов)`);
                this.stats.analyzed++;
                return null;
            }

            // Умная система анализа с ранней остановкой
            let shouldUnsubscribe = false;
            const reasons: string[] = [];

            // Проверяем агентов по очереди для ранней остановки
            for (let i = 0; i < FILTER_AGENTS.length; i++) {
                const agent = FILTER_AGENTS[i];

                // Добавляем небольшую задержку между запросами для соблюдения rate limits
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

                const result = await this.runAIAgent(agent, posts);

                if (result.matched) {
                    shouldUnsubscribe = true;
                    reasons.push(`${agent.name}: ${result.reason}`);

                    // Обновляем статистику
                    if (agent.name.includes('Политический')) this.stats.political++;
                    if (agent.name.includes('Лингвист')) this.stats.ukrainian++;
                    if (agent.name.includes('Военный')) this.stats.warRelated++;
                    if (agent.name.includes('Нарко')) this.stats.narcotics++;  // Новая статистика

                    // РАННЯЯ ОСТАНОВКА: если один агент сработал - больше не проверяем
                    log.info(`    🔥 Ранняя остановка: ${agent.name} сработал`);
                    break;
                }
            }

            // Логируем результат
            if (shouldUnsubscribe) {
                log.error(`[${channelNumber}/${totalChannels}] ❌ ${channelName} - фильтры: ${reasons.join('; ')}`);
            } else {
                log.info(`[${channelNumber}/${totalChannels}] ✅ ${channelName} - прошел все фильтры`);
            }

            this.stats.analyzed++;

            return {
                channel,
                channelName,
                shouldUnsubscribe,
                reasons
            };

        } catch (error) {
            log.error(`[${channelNumber}/${totalChannels}] ⚠️ Ошибка анализа ${channelName}: ${error}`);
            this.stats.errors++;
            return null;
        }
    }

    /**
     * Немедленная отписка от канала
     */
    private async unsubscribeFromChannel(channel: any, reasons: string[]): Promise<void> {
        const channelName = channel.title || channel.name || 'Без названия';

        try {
            await this.client.invoke(
                new Api.channels.LeaveChannel({
                    channel: channel.entity
                })
            );

            this.stats.unsubscribed++;
            log.info(`  🗑️ Отписался от ${channelName}`);
            log.info(`     Причина: ${reasons.join('; ')}`);

        } catch (error) {
            log.error(`  ❌ Не удалось отписаться от ${channelName}: ${error}`);
            this.stats.errors++;
        }
    }

    private showFinalStats(): void {
        log.info('📊 ФИНАЛЬНАЯ СТАТИСТИКА');

        console.log(`
┌─────────────────────────────────────┐
│ 📺 Всего каналов:        ${this.stats.total.toString().padStart(10)} │
│ 🔍 Проанализировано:     ${this.stats.analyzed.toString().padStart(10)} │
├─────────────────────────────────────┤
│ 🏛️  Политических:        ${this.stats.political.toString().padStart(10)} │
│ 🌐 Нецелевого языка:     ${this.stats.ukrainian.toString().padStart(10)} │
│ ⚔️  Военной тематики:    ${this.stats.warRelated.toString().padStart(10)} │
│ 💊 Запрещенного контента: ${this.stats.narcotics.toString().padStart(9)} │
├─────────────────────────────────────┤
│ 🗑️  Отписался:           ${this.stats.unsubscribed.toString().padStart(10)} │
│ ❌ Ошибок:               ${this.stats.errors.toString().padStart(10)} │
└─────────────────────────────────────┘
        `);

        // Сохраняем отчет
        this.saveReport();
    }

    private saveReport(): void {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `filter-report-${timestamp}.json`;
        const filepath = path.join('./exports', filename);

        if (!fs.existsSync('./exports')) {
            fs.mkdirSync('./exports');
        }

        const report = {
            timestamp: new Date().toISOString(),
            stats: this.stats,
            agents: FILTER_AGENTS.map(f => f.name),
            unsubscribedChannels: this.unsubscribeList.map(ch => ({
                title: ch.title || ch.name,
                username: ch.entity?.username || null
            }))
        };

        fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
        log.info(`Отчет сохранен: ${filename}`);
    }

    private async cleanup(): Promise<void> {
        if (this.client) {
            await this.client.disconnect();
        }
    }
}

// Запуск
if (require.main === module) {
    const filter = new AutoChannelFilter();
    filter.run().catch(console.error);
}