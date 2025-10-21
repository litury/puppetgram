/**
 * Автоматическая AI-фильтрация и выход из нежелательных групп и чатов
 * Использует Deepseek API для анализа контента
 *
 * Запуск: npm run filter:groups
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Api } from 'telegram';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { EnvAccountsParser } from '../../shared/utils/envAccountsParser';
import OpenAI from 'openai';
import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';

// Оптимизированная AI конфигурация с увеличенными задержками для групп
const AI_CONFIG = {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.1,
    maxTokens: 50,
    timeout: 20000   // Увеличенный timeout для групп
};

// Система чисто AI-агентов (без захардкоженных слов)
const FILTER_AGENTS = [
    {
        name: '🏛️ Аналитик политического контента',
        role: 'political_analyst',
        systemPrompt: `Ты политический аналитик. Определи является ли группа/чат политическим по содержанию сообщений.

ПОЛИТИЧЕСКИЕ группы специализируются на:
- Обсуждении мировых лидеров и политических фигур
- Политических процессах и институтах
- Государственной политике и решениях властей
- Политических новостях и аналитике

НЕ ПОЛИТИЧЕСКИЕ группы про:
- IT, программирование, технологии
- Криптовалюты, финансы, бизнес
- Образование, курсы, обучение
- Развлечения, юмор, мемы
- Спорт, игры, хобби

ВАЖНО: Если в IT-группе упоминается "фронт" (фронтенд) - это НЕ политика!

Отвечай только "ДА" (политическая группа) или "НЕТ" (не политическая).`,
        check: (text: string) => text.toUpperCase().startsWith('ДА')
    },
    {
        name: '⚔️ Аналитик военной тематики',
        role: 'military_analyst',
        systemPrompt: `Ты военный эксперт. Определи является ли группа/чат военным по содержанию сообщений.

ВОЕННЫЕ группы специализируются на:
- Военных конфликтах и операциях
- Военной технике и вооружении
- Военных подразделениях и структурах
- Военных новостях и аналитике
- Военных городах в контексте боевых действий

НЕ ВОЕННЫЕ группы про:
- IT разработку (даже если есть "фронтенд", "бэкенд")
- Обычные новости, политику, экономику
- Образование, технологии, бизнес
- Развлечения, юмор

ВАЖНО: IT-группы с техническими терминами = НЕ военные!

Отвечай только "ДА" (военная группа) или "НЕТ" (не военная).`,
        check: (text: string) => text.toUpperCase().startsWith('ДА')
    },
    {
        name: '💊 Аналитик запрещенного контента',
        role: 'narcotics_expert',
        systemPrompt: `Ты эксперт по выявлению наркотического контента. Определи специализируется ли группа/чат на наркотиках.

НАРКОТИЧЕСКИЕ группы специализируются на:
- Продаже или рекламе запрещенных веществ
- Психоактивных веществах
- Синтетических запрещенных препаратах
- "Закладках", "кладах", магазинах наркотиков
- Инструкциях по употреблению или изготовлению

ПРИМЕРЫ НАРКОТИЧЕСКОГО КОНТЕНТА:
- "Реклама запрещенных веществ"
- "Псилоцибиновые грибы", "мухоморы для трипа"
- "Закладки готовы", "новые клады"
- "Сленг связанный с незаконным оборотом"

НЕ НАРКОТИЧЕСКИЕ группы про:
- Медицину, фармацевтику (легальные лекарства)
- Кулинарию (обычные грибы для еды)
- Садоводство (выращивание овощей)
- Здоровый образ жизни

ВАЖНО: Медицинские группы про легальные лекарства = НЕ наркотические!

Отвечай "ДА" только если группа специализируется на незаконных наркотиках, иначе "НЕТ".`,
        check: (text: string) => text.toUpperCase().startsWith('ДА')
    },
    {
        name: '🌐 Лингвист-аналитик',
        role: 'language_expert',
        systemPrompt: `Ты лингвист. Определи основной язык группы/чата по сообщениям.

НЕЦЕЛЕВОЙ ЯЗЫК - признаки:
- Специфические окончания слов
- Характерная грамматика и синтаксис
- Специфическая лексика
- Географические названия

ЦЕЛЕВОЙ ЯЗЫК - признаки:
- Характерные слова: России, что, также, или, нужно
- Окончания: -ние, -ться, -тся
- Города: Москва, Санкт-Петербург
- Техническая лексика: программирование, разработка, биткоин

ВАЖНО: Криптовалютные и IT-термины обычно на целевом языке!

Отвечай "ДА" только если группа преимущественно на языке отличном от целевого, иначе "НЕТ".`,
        check: (text: string) => text.toUpperCase().startsWith('ДА')
    }
];

// Простой логгер
class Logger {
    static header(text: string) {
        console.log(`\n${'═'.repeat(50)}`);
        console.log(`  ${text}`);
        console.log('═'.repeat(50));
    }

    static info(text: string) {
        console.log(`ℹ️  ${text}`);
    }

    static success(text: string) {
        console.log(`✅ ${text}`);
    }

    static error(text: string) {
        console.log(`❌ ${text}`);
    }

    static warning(text: string) {
        console.log(`⚠️  ${text}`);
    }

    static progress(current: number, total: number, text: string = '') {
        const percent = Math.round((current / total) * 100);
        console.log(`[${current}/${total}] ${percent}% - ${text}`);
    }
}

/**
 * Основной класс автоматической фильтрации групп и чатов
 */
class AutoGroupFilter {
    private client!: TelegramClient;
    private openai!: OpenAI;
    private groups: any[] = [];
    private apiId: number = parseInt(process.env.API_ID || '0');
    private apiHash: string = process.env.API_HASH || '';
    private stats = {
        total: 0,
        analyzed: 0,
        political: 0,
        ukrainian: 0,
        warRelated: 0,
        narcotics: 0,
        leftGroups: 0,
        errors: 0
    };

    async run(): Promise<void> {
        Logger.header('🤖 АВТОМАТИЧЕСКАЯ AI-ФИЛЬТРАЦИЯ ГРУПП И ЧАТОВ');

        // Проверка API ключа
        if (!AI_CONFIG.apiKey) {
            Logger.error('Не найден DEEPSEEK_API_KEY в переменных окружения!');
            Logger.info('Установите: export DEEPSEEK_API_KEY="ваш_ключ"');
            process.exit(1);
        }

        try {
            // 1. Инициализация и выбор аккаунта
            await this.initialize();

            // Показываем предупреждение ПОСЛЕ выбора аккаунта
            Logger.header('⚠️ АКТИВНЫЕ АГЕНТЫ');
            Logger.warning('Будут применены следующие AI-агенты:');
            FILTER_AGENTS.forEach(f => Logger.info(`  ${f.name}`));
            Logger.warning('Группы с политическим, военным, запрещенным контентом будут покинуты!');

            // Запрос подтверждения
            const confirm = await prompts({
                type: 'confirm',
                name: 'proceed',
                message: 'Продолжить с этими агентами?',
                initial: true
            });

            if (!confirm.proceed) {
                Logger.info('Операция отменена пользователем');
                process.exit(0);
            }

            // 2. Загрузка групп и чатов
            await this.loadGroups();

            // 3. Анализ групп
            await this.analyzeGroups();

            // 4. Финальная статистика
            this.showFinalStats();

        } catch (error) {
            Logger.error(`Критическая ошибка: ${error}`);
        } finally {
            await this.cleanup();
        }
    }

    private async initialize(): Promise<void> {
        // Выбор аккаунта
        Logger.header('👥 ВЫБОР АККАУНТА');

        const accountsParser = new EnvAccountsParser();
        const accounts = accountsParser.getAvailableAccounts();

        if (accounts.length === 0) {
            throw new Error('Не найдено аккаунтов в .env файле');
        }

        Logger.info(`Найдено аккаунтов: ${accounts.length}`);

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
            Logger.error('Аккаунт не выбран');
            process.exit(0);
        }

        const account = accountChoice.account;
        Logger.success(`Выбран аккаунт: ${account.name}`);

        // Подключение к Telegram
        Logger.info('Подключение к Telegram...');
        this.client = new TelegramClient(
            new StringSession(account.sessionValue || ''),
            this.apiId,
            this.apiHash,
            { connectionRetries: 5 }
        );

        await this.client.connect();
        Logger.success('Подключен к Telegram');

        // Инициализация OpenAI/Deepseek
        this.openai = new OpenAI({
            apiKey: AI_CONFIG.apiKey,
            baseURL: AI_CONFIG.baseUrl
        });

        Logger.success('Инициализация завершена');
    }

    private async loadGroups(): Promise<void> {
        Logger.header('📋 ЗАГРУЗКА ГРУПП И ЧАТОВ');

        Logger.info('Сканирую участие в группах и чатах...');

        let dialogCount = 0;
        let groupCount = 0;
        let chatCount = 0;
        let channelCount = 0;
        const maxGroups = 500; // Максимум групп для загрузки

        try {
            // Используем iterDialogs для получения всех диалогов
            for await (const dialog of this.client.iterDialogs()) {
                dialogCount++;

                // Подсчитываем типы диалогов
                const entity = dialog.entity;
                if (entity) {
                    if (entity.className === 'User') {
                        chatCount++;
                    } else if (entity.className === 'Channel' && entity.broadcast) {
                        channelCount++;
                    } else if (this.isGroupOrChat(dialog)) {
                        this.groups.push(dialog);
                        groupCount++;

                        // Показываем прогресс по группам
                        if (groupCount % 25 === 0) {
                            Logger.info(`   👥 Найдено групп/чатов: ${groupCount}`);
                        }

                        // Останавливаемся если достигли лимита
                        if (groupCount >= maxGroups) {
                            Logger.warning(`Достигнут лимит ${maxGroups} групп`);
                            break;
                        }
                    }
                }

                // Показываем прогресс сканирования с деталями
                if (dialogCount % 200 === 0) {
                    Logger.info(`Просканировано: ${dialogCount} (каналы: ${channelCount}, группы: ${groupCount}, чаты: ${chatCount})`);
                }

                // Увеличенная пауза каждые 300 диалогов для групп
                if (dialogCount % 300 === 0) {
                    Logger.info(`⏸️ Пауза для избежания лимитов...`);
                    await new Promise(resolve => setTimeout(resolve, 3000)); // 3 секунды
                }
            }

            this.stats.total = this.groups.length;

            Logger.success(`✅ Сканирование завершено!`);
            Logger.info(`   📊 Просканировано диалогов: ${dialogCount}`);
            Logger.info(`   📺 Пропущено каналов: ${channelCount}`);
            Logger.info(`   👥 Найдено групп: ${groupCount}`);
            Logger.info(`   💬 Пропущено личных чатов: ${chatCount}`);

            if (this.stats.total === 0) {
                Logger.warning('❌ Нет групп для анализа');
                Logger.info('💡 Убедитесь что выбранный аккаунт состоит в группах или чатах');
                process.exit(0);
            }

        } catch (error: any) {
            if (error.errorMessage === 'FLOOD_WAIT') {
                Logger.error(`⏱️ FloodWait: подождите ${error.seconds} секунд и попробуйте снова`);
            } else {
                Logger.error(`Ошибка загрузки: ${error.message || error}`);
            }
            process.exit(1);
        }
    }

    private isGroupOrChat(dialog: any): boolean {
        const entity = dialog.entity;
        return entity &&
               entity.className === 'Channel' &&
               !entity.broadcast; // Группы это каналы без broadcast
    }

    private async analyzeGroups(): Promise<void> {
        Logger.header('🔍 ПАКЕТНЫЙ АНАЛИЗ ГРУПП');

        // Настройки пакетной обработки с увеличенными задержками для групп
        const batchSize = 2; // Уменьшаем до 2 групп параллельно
        const batchDelayMs = 5000; // Увеличиваем паузу до 5 секунд между пакетами

        // Спрашиваем сколько групп анализировать
        const limitChoice = await prompts({
            type: 'number',
            name: 'limit',
            message: `Сколько групп проанализировать? (всего ${this.groups.length}):`,
            initial: Math.min(30, this.groups.length),
            min: 1,
            max: this.groups.length
        });

        if (!limitChoice.limit) {
            Logger.error('Количество не выбрано');
            return;
        }

        const groupsToAnalyze = this.groups.slice(0, limitChoice.limit);
        const totalBatches = Math.ceil(groupsToAnalyze.length / batchSize);

        Logger.info(`Пакетная обработка: ${groupsToAnalyze.length} групп в ${totalBatches} пакетах по ${batchSize}`);

        // Обрабатываем группы пакетами
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const startIndex = batchIndex * batchSize;
            const endIndex = Math.min(startIndex + batchSize, groupsToAnalyze.length);
            const batch = groupsToAnalyze.slice(startIndex, endIndex);

            Logger.info(`\n📦 Пакет ${batchIndex + 1}/${totalBatches} (${batch.length} групп)`);

            // Обрабатываем все группы в пакете параллельно
            const batchPromises = batch.map((group, index) =>
                this.analyzeGroupInBatch(group, startIndex + index + 1, groupsToAnalyze.length)
            );

            const batchResults = await Promise.all(batchPromises);

            // Обрабатываем результаты пакета и сразу выходим из групп
            for (const result of batchResults) {
                if (result && result.shouldLeave) {
                    await this.leaveGroup(result.group, result.reasons);
                }
            }

            // Увеличенная пауза между пакетами для групп
            if (batchIndex < totalBatches - 1) {
                Logger.info(`⏸️ Пауза ${batchDelayMs}мс перед следующим пакетом...`);
                await new Promise(resolve => setTimeout(resolve, batchDelayMs));
            }
        }

        Logger.info(`\n✅ Проанализировано: ${this.stats.analyzed} групп`);
        Logger.info(`🚪 Покинул: ${this.stats.leftGroups} групп`);
    }

    /**
     * Обрабатывает одну группу в пакете
     */
    private async analyzeGroupInBatch(group: any, groupNumber: number, totalGroups: number): Promise<any> {
        const groupName = group.title || group.name || 'Без названия';

        try {
            // Получаем сообщения (меньше для групп из-за большего объема)
            const messages = await this.getGroupMessages(group.entity, 3);

            if (messages.length === 0) {
                Logger.info(`[${groupNumber}/${totalGroups}] ⏭️ ${groupName} - пропущена (нет сообщений)`);
                this.stats.analyzed++;
                return null;
            }

            // Умная система анализа с ранней остановкой
            let shouldLeave = false;
            const reasons: string[] = [];

            // Проверяем агентов по очереди для ранней остановки
            for (let i = 0; i < FILTER_AGENTS.length; i++) {
                const agent = FILTER_AGENTS[i];

                // Увеличенная задержка между запросами для групп
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                const result = await this.runAIAgent(agent, messages);

                if (result.matched) {
                    shouldLeave = true;
                    reasons.push(`${agent.name}: ${result.reason}`);

                    // Обновляем статистику
                    if (agent.name.includes('Политический')) this.stats.political++;
                    if (agent.name.includes('Лингвист')) this.stats.ukrainian++;
                    if (agent.name.includes('Военный')) this.stats.warRelated++;
                    if (agent.name.includes('Нарко')) this.stats.narcotics++;

                    // РАННЯЯ ОСТАНОВКА: если один агент сработал - больше не проверяем
                    Logger.info(`    🔥 Ранняя остановка: ${agent.name} сработал`);
                    break;
                }
            }

            // Логируем результат
            if (shouldLeave) {
                Logger.error(`[${groupNumber}/${totalGroups}] ❌ ${groupName} - фильтры: ${reasons.join('; ')}`);
            } else {
                Logger.success(`[${groupNumber}/${totalGroups}] ✅ ${groupName} - прошла все фильтры`);
            }

            this.stats.analyzed++;

            return {
                group,
                groupName,
                shouldLeave,
                reasons
            };

        } catch (error) {
            Logger.error(`[${groupNumber}/${totalGroups}] ⚠️ Ошибка анализа ${groupName}: ${error}`);
            this.stats.errors++;
            return null;
        }
    }

    private async getGroupMessages(group: any, limit: number): Promise<string[]> {
        const messages: string[] = [];

        try {
            const messageEntities = await this.client.getMessages(group, { limit });

            for (const message of messageEntities) {
                if (message.text) {
                    // Обрезаем длинные сообщения
                    const text = message.text.length > 200
                        ? message.text.substring(0, 200) + '...'
                        : message.text;
                    messages.push(text);
                }
            }
        } catch (error) {
            // Игнорируем ошибки получения сообщений
        }

        return messages;
    }

    /**
     * Запускает AI агента для анализа сообщений
     */
    private async runAIAgent(agent: any, messages: string[]): Promise<{matched: boolean, reason: string}> {
        try {
            // Оптимизируем количество сообщений для скорости
            const messagesToAnalyze = messages.slice(0, 3);

            // Сокращенный формат для экономии токенов
            const content = messagesToAnalyze
                .map((message, index) => `${index + 1}. ${message.substring(0, 150)}`) // Еще короче для групп
                .join('\n');

            const response = await this.openai.chat.completions.create({
                model: AI_CONFIG.model,
                messages: [
                    { role: 'system', content: agent.systemPrompt },
                    {
                        role: 'user',
                        content: `Анализируй сообщения:\n${content}`
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
            const reason = answer.substring(0, 40).replace(/\n/g, ' ');

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
     * Немедленный выход из группы
     */
    private async leaveGroup(group: any, reasons: string[]): Promise<void> {
        const groupName = group.title || group.name || 'Без названия';

        try {
            await this.client.invoke(
                new Api.channels.LeaveChannel({
                    channel: group.entity
                })
            );

            this.stats.leftGroups++;
            Logger.success(`  🚪 Покинул группу ${groupName}`);
            Logger.info(`     Причина: ${reasons.join('; ')}`);

            // Пауза после выхода из группы
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            Logger.error(`  ❌ Не удалось покинуть группу ${groupName}: ${error}`);
            this.stats.errors++;
        }
    }

    private showFinalStats(): void {
        Logger.header('📊 ФИНАЛЬНАЯ СТАТИСТИКА');

        console.log(`
┌─────────────────────────────────────┐
│ 👥 Всего групп:          ${this.stats.total.toString().padStart(10)} │
│ 🔍 Проанализировано:     ${this.stats.analyzed.toString().padStart(10)} │
├─────────────────────────────────────┤
│ 🏛️  Политических:        ${this.stats.political.toString().padStart(10)} │
│ 🇺🇦 Нецелевого языка:          ${this.stats.ukrainian.toString().padStart(10)} │
│ ⚔️  Военной тематики:       ${this.stats.warRelated.toString().padStart(10)} │
│ 💊 Запрещенного контента:        ${this.stats.narcotics.toString().padStart(10)} │
├─────────────────────────────────────┤
│ 🚪 Покинул групп:        ${this.stats.leftGroups.toString().padStart(10)} │
│ ❌ Ошибок:               ${this.stats.errors.toString().padStart(10)} │
└─────────────────────────────────────┘
        `);

        // Сохраняем отчет
        this.saveReport();
    }

    private saveReport(): void {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `group-filter-report-${timestamp}.json`;
        const filepath = path.join('./exports', filename);

        if (!fs.existsSync('./exports')) {
            fs.mkdirSync('./exports');
        }

        const report = {
            timestamp: new Date().toISOString(),
            stats: this.stats,
            agents: FILTER_AGENTS.map(f => f.name),
            type: 'groups_and_chats'
        };

        fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
        Logger.success(`Отчет сохранен: ${filename}`);
    }

    private async cleanup(): Promise<void> {
        if (this.client) {
            await this.client.disconnect();
        }
    }
}

// Запуск
if (require.main === module) {
    const filter = new AutoGroupFilter();
    filter.run().catch(console.error);
}