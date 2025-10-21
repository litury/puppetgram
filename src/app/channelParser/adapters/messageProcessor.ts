import { IChannelMessage, IReaction, IForwardInfo } from '../interfaces';
import { LinkExtractor } from './linkExtractor';
import { MediaDownloader } from './mediaDownloader';

/**
 * Адаптер для обработки сообщений Telegram
 */
export class MessageProcessor {
    private readonly p_mediaDownloader: MediaDownloader;
    private readonly p_channelUsername: string;

    constructor(_mediaDownloader: MediaDownloader, _channelUsername: string) {
        this.p_mediaDownloader = _mediaDownloader;
        this.p_channelUsername = _channelUsername;
    }

    /**
 * Обработка сообщения и извлечение всей информации
 */
    async processMessageAsync(_client: any, _message: any): Promise<IChannelMessage> {
        const text = _message.message || '';

        // Отладочная информация о медиа (только для первых 5 медиа файлов)
        if ((_message.media || _message.photo || _message.video || _message.document) && _message.id >= 1529) {
            console.log(`📸 Обработка медиа в сообщении ${_message.id}: ${_message.media?.className}`);
        }

        // Извлекаем ссылки
        const links = LinkExtractor.extractLinks(_message);

        // Извлекаем хэштеги и упоминания
        const hashtags = LinkExtractor.extractHashtags(text);
        const mentions = LinkExtractor.extractMentions(text);

        // Скачиваем медиа
        const media = await this.p_mediaDownloader.downloadMediaAsync(_client, _message, this.p_channelUsername);

        // Создаем ссылку на оригинальный пост
        const originalUrl = LinkExtractor.createOriginalPostUrl(this.p_channelUsername, _message.id);

        // Обрабатываем реакции
        const reactions = this.extractReactions(_message);

        // Обрабатываем информацию о пересылке
        const forwardedFrom = this.extractForwardInfo(_message);

        // Определяем альбом
        const albumInfo = this.extractAlbumInfo(_message);

        const processedMessage: IChannelMessage = {
            id: _message.id,
            text: text,
            date: _message.date instanceof Date ? _message.date : new Date(_message.date * 1000),
            editDate: _message.editDate ? new Date(_message.editDate * 1000) : undefined,
            author: _message.postAuthor || undefined,
            authorSignature: _message.authorSignature || undefined,
            views: _message.views || 0,
            forwards: _message.forwards || 0,
            reactions: reactions,
            media: media.length > 0 ? media : undefined,
            links: links.length > 0 ? links : undefined,
            originalUrl: originalUrl,
            hashtags: hashtags,
            mentions: mentions,
            isPartOfAlbum: albumInfo.isPartOfAlbum,
            albumId: albumInfo.albumId,
            replyTo: _message.replyTo?.replyToMsgId || undefined,
            forwardedFrom: forwardedFrom
        };

        return processedMessage;
    }

    /**
     * Извлечение реакций из сообщения
     */
    private extractReactions(_message: any): IReaction[] {
        const reactions: IReaction[] = [];

        if (_message.reactions && _message.reactions.results) {
            for (const reaction of _message.reactions.results) {
                reactions.push({
                    emoji: reaction.reaction?.emoticon || '❤️',
                    count: reaction.count || 0
                });
            }
        }

        return reactions;
    }

    /**
     * Извлечение информации о пересылке
     */
    private extractForwardInfo(_message: any): IForwardInfo | undefined {
        if (!_message.fwdFrom) {
            return undefined;
        }

        const fwd = _message.fwdFrom;
        const forwardInfo: IForwardInfo = {};

        // Канал, откуда переслано
        if (fwd.fromId && fwd.fromId.channelId) {
            forwardInfo.fromChannel = `channel_${fwd.fromId.channelId}`;
        }

        // ID оригинального сообщения
        if (fwd.channelPost) {
            forwardInfo.originalMessageId = fwd.channelPost;
        }

        // Дата оригинального сообщения
        if (fwd.date) {
            forwardInfo.originalDate = new Date(fwd.date * 1000);
        }

        // Автор оригинального сообщения
        if (fwd.postAuthor) {
            forwardInfo.originalAuthor = fwd.postAuthor;
        }

        return Object.keys(forwardInfo).length > 0 ? forwardInfo : undefined;
    }

    /**
     * Извлечение информации об альбоме
     */
    private extractAlbumInfo(_message: any): { isPartOfAlbum: boolean; albumId?: string } {
        if (_message.groupedId) {
            return {
                isPartOfAlbum: true,
                albumId: _message.groupedId.toString()
            };
        }

        return {
            isPartOfAlbum: false
        };
    }

    /**
     * Проверка, является ли сообщение удаленным
     */
    static isDeletedMessage(_message: any): boolean {
        return _message.className === 'MessageEmpty' ||
            _message.deleted === true ||
            (!_message.message && !_message.media);
    }

    /**
     * Получение размера текста сообщения
     */
    static getMessageSize(_message: IChannelMessage): number {
        let size = _message.text.length;

        // Добавляем размер медиа файлов
        if (_message.media) {
            size += _message.media.reduce((total, media) => total + media.size, 0);
        }

        return size;
    }

    /**
     * Проверка, содержит ли сообщение медиа
     */
    static hasMedia(_message: IChannelMessage): boolean {
        return _message.media !== undefined && _message.media.length > 0;
    }

    /**
     * Получение всех внешних ссылок из сообщения
     */
    static getExternalLinks(_message: IChannelMessage): string[] {
        if (!_message.links) return [];

        return _message.links
            .filter(link => LinkExtractor.isExternalLink(link.url))
            .map(link => link.url);
    }

    /**
     * Форматирование сообщения для экспорта
     */
    static formatForExport(_message: IChannelMessage, _includeMetadata: boolean = true): string {
        let result = _message.text;

        if (_includeMetadata) {
            result += `\n\n--- Метаданные ---`;
            result += `\nID: ${_message.id}`;
            result += `\nДата: ${_message.date.toLocaleString('ru-RU')}`;
            result += `\nПросмотры: ${_message.views}`;
            result += `\nПересылки: ${_message.forwards}`;
            result += `\nОригинальная ссылка: ${_message.originalUrl}`;

            if (_message.hashtags.length > 0) {
                result += `\nХэштеги: ${_message.hashtags.join(', ')}`;
            }

            if (_message.mentions.length > 0) {
                result += `\nУпоминания: ${_message.mentions.join(', ')}`;
            }

            if (_message.media && _message.media.length > 0) {
                result += `\nМедиа файлы: ${_message.media.length}`;
                _message.media.forEach((media, index) => {
                    result += `\n  ${index + 1}. ${media.type} - ${media.filename}`;
                });
            }

            if (_message.links && _message.links.length > 0) {
                const externalLinks = MessageProcessor.getExternalLinks(_message);
                if (externalLinks.length > 0) {
                    result += `\nВнешние ссылки: ${externalLinks.join(', ')}`;
                }
            }
        }

        return result;
    }
} 