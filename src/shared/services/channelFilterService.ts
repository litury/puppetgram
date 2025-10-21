/**
 * Lightweight AI-based channel filtering service
 * Filters out political and Ukrainian channels to reduce costs
 */

import OpenAI from 'openai';

export interface IFilterAgent {
    name: string;
    role: string;
    systemPrompt: string;
    check: (text: string) => boolean;
}

export interface IFilterResult {
    shouldSkip: boolean;
    reason?: string;
    agent?: string;
}

export interface IChannelFilterConfig {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    maxPostsToAnalyze?: number;
}

export class ChannelFilterService {
    private openai: OpenAI;
    private config: IChannelFilterConfig;

    // Simplified filter agents (only political and Ukrainian)
    private readonly FILTER_AGENTS: IFilterAgent[] = [
        {
            name: '🏛️ Политический эксперт',
            role: 'political_analyst',
            systemPrompt: `Ты политический аналитик. Определи является ли канал политическим по содержанию постов.

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
            name: '🌐 Лингвист-аналитик',
            role: 'language_expert',
            systemPrompt: `Ты лингвист. Определи основной язык канала по постам.

НЕЦЕЛЕВОЙ ЯЗЫК - признаки:
- Специфическая лексика языка
- Специфические окончания слов
- Географические названия

ЦЕЛЕВОЙ ЯЗЫК - признаки:
- Характерные слова: России, что, также, или, нужно
- Окончания: -ние, -ться, -тся
- Города: Москва, Санкт-Петербург
- Техническая лексика: программирование, разработка, биткоин

ВАЖНО: Криптовалютные и IT-термины обычно на целевом языке!

Отвечай "ДА" только если канал преимущественно на языке отличном от целевого, иначе "НЕТ".`,
            check: (text: string) => text.toUpperCase().startsWith('ДА')
        }
    ];

    constructor(config: IChannelFilterConfig) {
        this.config = {
            baseUrl: 'https://api.deepseek.com/v1',
            model: 'deepseek-chat',
            temperature: 0.1,
            maxTokens: 50,
            timeout: 15000,
            maxPostsToAnalyze: 5,
            ...config
        };

        this.openai = new OpenAI({
            apiKey: this.config.apiKey,
            baseURL: this.config.baseUrl
        });
    }

    /**
     * Check if channel should be filtered out
     */
    async shouldFilterChannel(posts: string[]): Promise<IFilterResult> {
        if (!posts || posts.length === 0) {
            return { shouldSkip: false };
        }

        // Analyze only first few posts for speed
        const postsToAnalyze = posts.slice(0, this.config.maxPostsToAnalyze);

        // Check each agent (political first, then language)
        for (const agent of this.FILTER_AGENTS) {
            try {
                const result = await this.runFilterAgent(agent, postsToAnalyze);

                if (result.matched) {
                    return {
                        shouldSkip: true,
                        reason: result.reason,
                        agent: agent.name
                    };
                }

                // Small delay between agents to respect rate limits
                await new Promise(resolve => setTimeout(resolve, 200));

            } catch (error) {
                console.warn(`Filter agent ${agent.name} failed:`, error);
                continue; // Continue with next agent if one fails
            }
        }

        return { shouldSkip: false };
    }

    /**
     * Run single filter agent on posts
     */
    private async runFilterAgent(agent: IFilterAgent, posts: string[]): Promise<{matched: boolean, reason: string}> {
        try {
            // Format posts for analysis (keep them short)
            const content = posts
                .map((post, index) => `${index + 1}. ${post.substring(0, 200)}`)
                .join('\n');

            const response = await this.openai.chat.completions.create({
                model: this.config.model!,
                messages: [
                    { role: 'system', content: agent.systemPrompt },
                    {
                        role: 'user',
                        content: `Анализируй посты:\n${content}`
                    }
                ],
                temperature: this.config.temperature,
                max_tokens: this.config.maxTokens
            }, {
                timeout: this.config.timeout
            });

            const answer = response.choices[0].message.content || '';
            const matched = agent.check(answer);
            const reason = answer.substring(0, 50).replace(/\n/g, ' ');

            return { matched, reason };

        } catch (error: any) {
            if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
                return { matched: false, reason: 'Timeout' };
            }
            if (error.status === 429) {
                return { matched: false, reason: 'Rate limit' };
            }
            throw error; // Re-throw for handling upstream
        }
    }

    /**
     * Get channel posts for analysis
     */
    async getChannelPosts(telegramClient: any, channel: any, limit: number = 5): Promise<string[]> {
        const posts: string[] = [];

        try {
            const messages = await telegramClient.getMessages(channel, { limit });

            for (const message of messages) {
                if (message.text) {
                    // Trim long posts
                    const text = message.text.length > 300
                        ? message.text.substring(0, 300) + '...'
                        : message.text;
                    posts.push(text);
                }
            }
        } catch (error) {
            console.warn('Failed to fetch posts for filtering:', error);
        }

        return posts;
    }
}