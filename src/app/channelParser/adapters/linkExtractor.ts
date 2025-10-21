import { IMessageLink } from '../interfaces';

/**
 * Адаптер для извлечения ссылок из сообщений
 */
export class LinkExtractor {
    /**
     * Извлечение всех ссылок из сообщения
     */
    static extractLinks(_message: any): IMessageLink[] {
        const links: IMessageLink[] = [];
        const text = _message.message || '';

        // Отладочная информация для первых 5 сообщений
        if (_message.id >= 1531 && _message.id <= 1535) {
            console.log(`🔗 DEBUG: Сообщение ${_message.id} имеет ${_message.entities?.length || 0} entities`);
            if (_message.entities) {
                _message.entities.forEach((entity: any, index: number) => {
                    console.log(`   Entity ${index}: type=${entity.type}, offset=${entity.offset}, length=${entity.length}`);
                    if (entity.url) console.log(`   URL: ${entity.url}`);
                });
            }
        }

        // Извлекаем ссылки из entities (форматирование Telegram)
        if (_message.entities) {
            for (const entity of _message.entities) {
                const link = this.processEntity(entity, text);
                if (link) {
                    links.push(link);
                }
            }
        }

        // Дополнительно ищем ссылки с помощью регулярных выражений
        const regexLinks = this.extractLinksWithRegex(text);
        links.push(...regexLinks);

        // Удаляем дубликаты
        return this.removeDuplicateLinks(links);
    }

    /**
     * Создание ссылки на оригинальный пост в Telegram
     */
    static createOriginalPostUrl(_channelUsername: string, _messageId: number): string {
        const cleanUsername = _channelUsername.replace('@', '');
        return `https://t.me/${cleanUsername}/${_messageId}`;
    }

    /**
     * Извлечение хэштегов из текста
     */
    static extractHashtags(_text: string): string[] {
        const hashtagRegex = /#[\w\u0400-\u04FF]+/g;
        const matches = _text.match(hashtagRegex);
        return matches ? Array.from(new Set(matches)) : [];
    }

    /**
     * Извлечение упоминаний из текста
     */
    static extractMentions(_text: string): string[] {
        const mentionRegex = /@[\w\u0400-\u04FF]+/g;
        const matches = _text.match(mentionRegex);
        return matches ? Array.from(new Set(matches)) : [];
    }

    /**
     * Обработка entity из Telegram
     */
    private static processEntity(_entity: any, _text: string): IMessageLink | null {
        const { offset, length, type } = _entity;
        const entityText = _text.substring(offset, offset + length);

        switch (type) {
            case 'url':
                return {
                    url: entityText,
                    text: entityText,
                    type: 'url',
                    offset,
                    length
                };

            case 'text_link':
                return {
                    url: _entity.url,
                    text: entityText,
                    type: 'text_link',
                    offset,
                    length
                };

            case 'mention':
                return {
                    url: `https://t.me/${entityText.replace('@', '')}`,
                    text: entityText,
                    type: 'mention',
                    offset,
                    length
                };

            case 'hashtag':
                return {
                    url: `https://t.me/hashtag/${entityText.replace('#', '')}`,
                    text: entityText,
                    type: 'hashtag',
                    offset,
                    length
                };

            case 'bot_command':
                return {
                    url: entityText,
                    text: entityText,
                    type: 'bot_command',
                    offset,
                    length
                };

            case 'email':
                return {
                    url: `mailto:${entityText}`,
                    text: entityText,
                    type: 'email',
                    offset,
                    length
                };

            case 'phone':
                return {
                    url: `tel:${entityText}`,
                    text: entityText,
                    type: 'phone',
                    offset,
                    length
                };

            case 'text_url':
            case 'url_link':
                // Дополнительные типы ссылок
                return {
                    url: _entity.url || entityText,
                    text: entityText,
                    type: 'text_link',
                    offset,
                    length
                };

            case 'code':
                // Код может содержать ссылки - проверяем
                if (this.looksLikeUrl(entityText)) {
                    return {
                        url: entityText.startsWith('http') ? entityText : `https://${entityText}`,
                        text: entityText,
                        type: 'url',
                        offset,
                        length
                    };
                }
                return null;

            case 'bold':
            case 'italic':
            case 'underline':
            case 'strikethrough':
                // Форматированный текст может содержать скрытые ссылки
                if (this.looksLikeUrl(entityText)) {
                    return {
                        url: entityText.startsWith('http') ? entityText : `https://${entityText}`,
                        text: entityText,
                        type: 'url',
                        offset,
                        length
                    };
                }
                return null;

            default:
                return null;
        }
    }

    /**
     * Извлечение ссылок с помощью регулярных выражений
     */
    private static extractLinksWithRegex(_text: string): IMessageLink[] {
        const links: IMessageLink[] = [];

        // Расширенное регулярное выражение для поиска URL
        const patterns = [
            // HTTP/HTTPS ссылки
            /https?:\/\/[^\s\)]+/gi,
            // Домены без протокола (с точкой и доменной зоной)
            /(?<![\w.-])(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s\)]*)?/gi,
            // Ethereum адреса
            /0x[a-fA-F0-9]{40}/g,
            // ENS домены
            /[\w-]+\.eth(?:\.limo)?/gi,
            // Bitcoin адреса
            /(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{39,59})/g
        ];

        patterns.forEach(regex => {
            let match;
            while ((match = regex.exec(_text)) !== null) {
                const url = match[0];

                // Очищаем URL от лишних символов в конце
                const cleanUrl = this.cleanUrl(url);

                // Проверяем, что эта ссылка не была уже найдена
                const existingLink = links.find(link =>
                    link.url === cleanUrl ||
                    (link.offset <= match!.index && link.offset + link.length >= match!.index + cleanUrl.length)
                );

                if (!existingLink && this.isValidUrl(cleanUrl)) {
                    links.push({
                        url: cleanUrl,
                        text: cleanUrl,
                        type: 'url',
                        offset: match.index,
                        length: cleanUrl.length
                    });
                }
            }
        });

        return links;
    }

    /**
     * Очистка URL от лишних символов
     */
    private static cleanUrl(_url: string): string {
        // Убираем лишние символы в конце
        return _url.replace(/[.,;:!?)\]}>]*$/, '');
    }

    /**
     * Проверка валидности URL
     */
    private static isValidUrl(_url: string): boolean {
        // Минимальная длина
        if (_url.length < 4) return false;

        // Проверяем, что это не только цифры
        if (/^\d+$/.test(_url)) return false;

        // Проверяем наличие точки для доменов
        if (!_url.includes('.') && !_url.startsWith('http') && !_url.startsWith('0x')) {
            return false;
        }

        // Исключаем очевидно не URL строки
        const excludePatterns = [
            /^\d+\.\d+$/, // версии типа 1.0
            /^[a-zA-Z]+\.[a-zA-Z]{1}$/, // короткие расширения
        ];

        return !excludePatterns.some(pattern => pattern.test(_url));
    }

    /**
     * Удаление дубликатов ссылок
     */
    private static removeDuplicateLinks(_links: IMessageLink[]): IMessageLink[] {
        const seen = new Set<string>();
        return _links.filter(link => {
            const key = `${link.url}_${link.offset}_${link.length}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    /**
     * Проверка, является ли ссылка внешней
     */
    static isExternalLink(_url: string): boolean {
        const telegramDomains = ['t.me', 'telegram.org', 'telegram.me'];
        try {
            const urlObj = new URL(_url);
            return !telegramDomains.some(domain => urlObj.hostname.includes(domain));
        } catch {
            return false;
        }
    }

    /**
     * Получение домена из URL
     */
    static extractDomain(_url: string): string {
        try {
            const urlObj = new URL(_url);
            return urlObj.hostname;
        } catch {
            return 'unknown';
        }
    }

    /**
     * Проверка, похож ли текст на URL
     */
    private static looksLikeUrl(_text: string): boolean {
        // Базовые проверки
        if (_text.length < 4) return false;

        // Содержит протокол
        if (/^https?:\/\//.test(_text)) return true;

        // Содержит домен с точкой
        if (/\w+\.\w{2,}/.test(_text)) return true;

        // Ethereum адреса
        if (/^0x[a-fA-F0-9]{40}$/.test(_text)) return true;

        // ENS домены
        if (/\.eth(\.limo)?$/.test(_text)) return true;

        return false;
    }
} 