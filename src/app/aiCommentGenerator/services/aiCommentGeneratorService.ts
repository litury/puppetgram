/**
 * Сервис для AI генерации осмысленных коротких комментариев
 * Следует стандартам компании согласно proj-struct-guideline.md
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { IPostContent } from '../../commentPoster/interfaces';
import { IAICommentGenerator, IAIServiceConfig, IAICommentResult } from '../interfaces';
import { shouldCommentOnPost, buildBusinessPrompt } from '../parts/promptBuilder';
import { createLogger } from '../../../shared/utils/logger';

const log = createLogger('AICommentGenerator');

const SKIPPED_CHANNELS_FILE = path.join(process.cwd(), 'skipped-channels.txt');
const CHANNELS_FILE = path.join(process.cwd(), 'input-channels/channels.txt');

/**
 * Сохраняет канал в файл пропущенных (политика/война/религия) и удаляет из основного списка
 */
function saveSkippedChannel(_channelUsername: string): void {
    try {
        const entry = `@${_channelUsername}\n`;

        // Читаем существующий файл пропущенных
        let existingSkipped = '';
        if (fs.existsSync(SKIPPED_CHANNELS_FILE)) {
            existingSkipped = fs.readFileSync(SKIPPED_CHANNELS_FILE, 'utf-8');
        }

        // Сохраняем в skipped-channels.txt если ещё нет
        if (!existingSkipped.includes(`@${_channelUsername}`)) {
            fs.appendFileSync(SKIPPED_CHANNELS_FILE, entry);
            log.info(`Канал сохранён в skipped-channels.txt`, { channel: _channelUsername });
        }

        // Удаляем из channels.txt
        if (fs.existsSync(CHANNELS_FILE)) {
            const channelsContent = fs.readFileSync(CHANNELS_FILE, 'utf-8');
            const lines = channelsContent.split('\n');
            const filteredLines = lines.filter(line => {
                const trimmed = line.trim();
                return trimmed !== _channelUsername && trimmed !== `@${_channelUsername}`;
            });
            fs.writeFileSync(CHANNELS_FILE, filteredLines.join('\n'));
            log.info(`Канал удалён из channels.txt`, { channel: _channelUsername });
        }
    } catch (error) {
        log.warn(`Не удалось обработать канал`, { error: String(error) });
    }
}

export class AICommentGeneratorService implements IAICommentGenerator {
    private readonly p_client: OpenAI;
    private readonly p_config: IAIServiceConfig;

    constructor(_config: IAIServiceConfig) {
        this.p_config = _config;
        this.p_client = new OpenAI({
            apiKey: _config.apiKey,
            baseURL: _config.baseUrl || 'https://api.deepseek.com/v1',
        });
    }

    /**
     * Генерирует осмысленный короткий комментарий на основе контента поста
     */
    async generateCommentAsync(_postContent: IPostContent): Promise<IAICommentResult> {
        try {
            // Проверяем, подходит ли пост для комментирования
            const shouldComment = shouldCommentOnPost(_postContent);
            if (!shouldComment.shouldComment) {
                return {
                    comment: '',
                    success: false,
                    error: shouldComment.reason || 'Пост не подходит для комментирования',
                    isValid: false
                };
            }

            if (!this.p_config.enabled) {
                return {
                    comment: '',
                    success: false,
                    error: 'AI генерация отключена',
                    isValid: false
                };
            }

            log.debug(`Генерирую комментарий`, { postId: _postContent.id, channel: _postContent.channelUsername });

            const prompt = buildBusinessPrompt(_postContent);
            log.debug(`Промпт подготовлен`, { length: prompt.length });

            const response = await this.p_client.chat.completions.create({
                model: this.p_config.model || 'deepseek-chat',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 80, // Достаточно для комментариев до 100 символов
                temperature: 0.7
            }, {
                timeout: this.p_config.timeout || 30000
            });

            const comment = response.choices[0]?.message?.content?.trim() || '';

            if (!comment) {
                return {
                    comment: '',
                    success: false,
                    error: 'AI не сгенерировал комментарий',
                    isValid: false
                };
            }

            // Проверяем, не вернул ли AI команду SKIP (политика, война, религия)
            if (comment.toUpperCase() === 'SKIP' || comment.toUpperCase().startsWith('SKIP')) {
                log.info(`AI пропустил пост (политика/война/религия)`, { channel: _postContent.channelUsername });
                saveSkippedChannel(_postContent.channelUsername);
                return {
                    comment: '',
                    success: false,
                    error: 'POST_SKIPPED: Пост содержит чувствительную тему',
                    isValid: false
                };
            }

            // Очищаем комментарий от кавычек и лишних символов
            const cleanedComment = this.cleanCommentText(comment);

            log.debug(`Комментарий готов`, { comment: cleanedComment, length: cleanedComment.length });

            return {
                comment: cleanedComment,
                success: true,
                isValid: true,
                error: undefined
            };

        } catch (error) {
            log.error('Ошибка генерации комментария', error as Error);
            return {
                comment: '',
                success: false,
                error: error instanceof Error ? error.message : String(error),
                isValid: false
            };
        }
    }

    /**
     * Очищает комментарий от кавычек и лишних символов
     */
    private cleanCommentText(_text: string): string {
        let cleaned = _text.trim();

        // Убираем внешние кавычки (одинарные и двойные)
        if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
            (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
            cleaned = cleaned.slice(1, -1).trim();
        }

        // Убираем кавычки в начале если они остались
        if (cleaned.startsWith('"') || cleaned.startsWith("'")) {
            cleaned = cleaned.substring(1).trim();
        }

        // Убираем кавычки в конце если они остались
        if (cleaned.endsWith('"') || cleaned.endsWith("'")) {
            cleaned = cleaned.slice(0, -1).trim();
        }

        return cleaned;
    }

    /**
     * Проверяет доступность AI сервиса
     */
    async checkHealthAsync(): Promise<boolean> {
        try {
            log.debug('Проверяю доступность AI сервиса...');

            const response = await this.p_client.chat.completions.create({
                model: this.p_config.model || 'deepseek-chat',
                messages: [{ role: 'user', content: 'Тест' }],
                max_tokens: 5
            }, {
                timeout: 10000
            });

            const isAvailable = Boolean(response.choices[0]?.message?.content);
            log.info(`AI сервис`, { status: isAvailable ? 'доступен' : 'недоступен' });

            return isAvailable;
        } catch (error) {
            log.warn(`AI сервис недоступен`, { error: error instanceof Error ? error.message : String(error) });
            return false;
        }
    }
}
