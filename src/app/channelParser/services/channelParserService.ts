import * as fs from 'fs';
import * as path from 'path';
import { MessageFetcher, IChannelInfo as IMessageFetcherChannelInfo } from '../../../telegram/adapters/services/messageFetcher';
import { createLogger } from '../../../shared/utils/logger';
import {
    IChannelParser,
    IChannelParseOptions,
    IChannelParseResult,
    IChannelInfo,
    IChannelMessage,
    IParseStats,
    IExportPaths
} from '../interfaces';
import { MediaDownloader, MessageProcessor } from '../adapters';

const log = createLogger('ChannelParser');

/**
 * Сервис для полного парсинга каналов Telegram
 */
export class ChannelParserService implements IChannelParser {
    private readonly p_messageFetcher: MessageFetcher;
    private readonly p_exportDirectory: string;

    constructor(_client: any, _exportDirectory: string = './exports/channel-parser', _gramClient?: any) {
        this.p_messageFetcher = new MessageFetcher(_client, _gramClient);
        this.p_exportDirectory = _exportDirectory;
    }

    /**
     * Полный парсинг канала с сохранением всего контента
     */
    async parseChannelAsync(_channelName: string, _options?: IChannelParseOptions): Promise<IChannelParseResult> {
        const startTime = Date.now();

        log.info(`\n🔍 Начинаем полный парсинг канала ${_channelName}...`);

        // Дефолтные опции
        const options: IChannelParseOptions = {
            downloadMedia: true,
            mediaDirectory: path.join(this.p_exportDirectory, 'media'),
            maxMediaSize: 50, // 50 MB
            mediaTypes: ['photo', 'video', 'document', 'audio'],
            includeDeleted: false,
            ...(_options || {})
        };

        try {
            // Получаем информацию о канале
            const channelInfo = await this.getChannelInfoAsync(_channelName);
            log.info(`📊 Канал: ${channelInfo.title} (${channelInfo.totalMessages} сообщений)`);

                    // Получаем все сообщения
        const messageLimit = options.messageLimit === 0 ? undefined : options.messageLimit;
        const rawMessages = await this.fetchAllMessagesAsync(_channelName, messageLimit);
            log.info(`📥 Получено ${rawMessages.length} сообщений`);

            // Создаем адаптеры для обработки
            const mediaDownloader = new MediaDownloader(this.p_exportDirectory, options);
            const messageProcessor = new MessageProcessor(mediaDownloader, _channelName);

            // Обрабатываем сообщения
            const processedMessages = await this.processMessagesAsync(
                rawMessages,
                messageProcessor,
                options
            );

            // Вычисляем статистику
            const stats = this.calculateStats(processedMessages, startTime);

            // Экспортируем данные
            const exportPaths = await this.exportDataAsync(
                channelInfo,
                processedMessages,
                stats,
                _channelName
            );

            log.info(`\n✅ Парсинг завершен за ${(stats.parseTime / 1000).toFixed(1)}с`);
            log.info(`📊 Обработано сообщений: ${stats.totalMessages}`);
            log.info(`📸 Скачано медиа: ${stats.downloadedMedia}`);
            log.info(`🔗 Найдено ссылок: ${stats.totalLinks}`);
            log.info(`📁 Файлы сохранены в: ${this.p_exportDirectory}`);

            return {
                channelInfo,
                messages: processedMessages,
                stats,
                exportPaths
            };

        } catch (error: unknown) {
            log.error(`❌ Ошибка парсинга канала ${_channelName}:`, error as Error);
            throw error;
        }
    }

    /**
 * Получение информации о канале
 */
    private async getChannelInfoAsync(_channelName: string): Promise<IChannelInfo> {
        const channelInfo = await this.p_messageFetcher.getChannelInfo(_channelName);

        return {
            id: Date.now().toString(), // Генерируем временный ID
            username: _channelName,
            title: channelInfo.title || '',
            description: undefined, // MessageFetcher не предоставляет описание
            participantsCount: 0, // MessageFetcher не предоставляет количество участников
            totalMessages: channelInfo.totalMessages || 0,
            createdAt: undefined // MessageFetcher не предоставляет дату создания
        };
    }

    /**
     * Получение всех сообщений канала
     */
    private async fetchAllMessagesAsync(_channelName: string, _limit?: number): Promise<any[]> {
        log.info(`📥 Получение ${_limit ? _limit : 'всех'} сообщений канала...`);

        // Если лимит не установлен или равен undefined, получаем все сообщения пакетами
        if (_limit === undefined) {
            return await this.fetchAllMessagesBatchAsync(_channelName);
        }

        // Получаем полные сообщения канала с медиа данными
        const messages = await this.p_messageFetcher.fetchFullMessages(_channelName, _limit);
        return messages;
    }

    /**
     * Пакетное получение всех сообщений канала для избежания таймаутов
     */
    private async fetchAllMessagesBatchAsync(_channelName: string): Promise<any[]> {
        const allMessages: any[] = [];
        const batchSize = 100; // Размер пакета
        let offsetId = 0;
        let hasMore = true;

        log.info('📦 Начинаем пакетное получение всех сообщений...');

        while (hasMore) {
            try {
                log.info(`📥 Получение пакета сообщений (offset: ${offsetId})...`);
                
                const messages = await this.p_messageFetcher.fetchFullMessagesBatch(
                    _channelName, 
                    batchSize, 
                    offsetId
                );

                if (messages.length === 0) {
                    hasMore = false;
                    break;
                }

                allMessages.push(...messages);
                log.info(`📦 Получено ${messages.length} сообщений, всего: ${allMessages.length}`);

                // Устанавливаем новый offset
                offsetId = messages[messages.length - 1].id;

                // Небольшая пауза между запросами для избежания rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error: unknown) {
                log.warn(`⚠️ Ошибка при получении пакета (offset: ${offsetId}):`, { error });
                
                // Пытаемся продолжить с следующего offset
                offsetId += batchSize;
                
                // Если много ошибок подряд, останавливаемся
                if (offsetId > allMessages.length + batchSize * 10) {
                    log.warn('⚠️ Слишком много ошибок, останавливаем пакетное получение');
                    hasMore = false;
                }

                // Пауза после ошибки
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        log.info(`✅ Пакетное получение завершено. Получено ${allMessages.length} сообщений`);
        return allMessages;
    }

    /**
     * Обработка сообщений
     */
    private async processMessagesAsync(
        _rawMessages: any[],
        _messageProcessor: MessageProcessor,
        _options: IChannelParseOptions
    ): Promise<IChannelMessage[]> {
        const processedMessages: IChannelMessage[] = [];
        const total = _rawMessages.length;

        log.info(`\n🔄 Обработка ${total} сообщений...`);

        for (let i = 0; i < _rawMessages.length; i++) {
            const rawMessage = _rawMessages[i];

            // Показываем прогресс каждые 100 сообщений
            if (i % 100 === 0) {
                log.info(`⏳ Обработано ${i}/${total} сообщений (${((i / total) * 100).toFixed(1)}%)`);
            }

            try {
                // Пропускаем удаленные сообщения если не нужны
                if (!_options.includeDeleted && MessageProcessor.isDeletedMessage(rawMessage)) {
                    continue;
                }

                // Обрабатываем сообщение
                const processedMessage = await _messageProcessor.processMessageAsync(
                    this.p_messageFetcher['client'], // Получаем клиент из приватного поля
                    rawMessage
                );

                processedMessages.push(processedMessage);

            } catch (error: unknown) {
                log.warn(`⚠️  Ошибка обработки сообщения ${rawMessage.id}:`, { error });
            }
        }

        log.info(`✅ Обработано ${processedMessages.length} сообщений`);
        return processedMessages;
    }

    /**
     * Вычисление статистики парсинга
     */
    private calculateStats(_messages: IChannelMessage[], _startTime: number): IParseStats {
        const stats: IParseStats = {
            totalMessages: _messages.length,
            messagesWithMedia: 0,
            downloadedMedia: 0,
            totalMediaSize: 0,
            totalLinks: 0,
            totalHashtags: 0,
            totalMentions: 0,
            parseTime: Date.now() - _startTime,
            errors: []
        };

        for (const message of _messages) {
            // Подсчитываем медиа
            if (message.media && message.media.length > 0) {
                stats.messagesWithMedia++;
                stats.downloadedMedia += message.media.length;
                stats.totalMediaSize += message.media.reduce((sum, media) => sum + media.size, 0);
            }

            // Подсчитываем ссылки
            if (message.links) {
                stats.totalLinks += message.links.length;
            }

            // Подсчитываем хэштеги и упоминания
            stats.totalHashtags += message.hashtags.length;
            stats.totalMentions += message.mentions.length;
        }

        return stats;
    }

    /**
     * Экспорт данных в различные форматы
     */
    private async exportDataAsync(
        _channelInfo: IChannelInfo,
        _messages: IChannelMessage[],
        _stats: IParseStats,
        _channelName: string
    ): Promise<IExportPaths> {
        // Создаем директорию для экспорта
        const channelDir = path.join(this.p_exportDirectory, _channelName.replace(/[@\/]/g, ''));
        await this.ensureDirectoryExists(channelDir);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const baseFilename = `${_channelName.replace(/[@\/]/g, '')}_${timestamp}`;

        // Пути к файлам
        const exportPaths: IExportPaths = {
            jsonFile: path.join(channelDir, `${baseFilename}.json`),
            textFile: path.join(channelDir, `${baseFilename}.txt`),
            csvFile: path.join(channelDir, `${baseFilename}.csv`),
            mediaDirectory: path.join(channelDir, 'media'),
            statsFile: path.join(channelDir, `${baseFilename}_stats.json`)
        };

        // Экспортируем в JSON
        await this.exportToJson(_channelInfo, _messages, _stats, exportPaths.jsonFile);

        // Экспортируем в TXT
        await this.exportToText(_messages, exportPaths.textFile);

        // Экспортируем в CSV
        await this.exportToCsv(_messages, exportPaths.csvFile);

        // Экспортируем статистику
        await this.exportStats(_stats, exportPaths.statsFile);

        return exportPaths;
    }

    /**
     * Экспорт в JSON формат
     */
    private async exportToJson(
        _channelInfo: IChannelInfo,
        _messages: IChannelMessage[],
        _stats: IParseStats,
        _filePath: string
    ): Promise<void> {
        const exportData = {
            metadata: {
                exportedAt: new Date().toISOString(),
                parser: 'ChannelParserService v1.0',
                channel: _channelInfo,
                stats: _stats
            },
            messages: _messages
        };

        await fs.promises.writeFile(_filePath, JSON.stringify(exportData, null, 2), 'utf-8');
        log.info(`💾 JSON экспорт: ${_filePath}`);
    }

    /**
     * Экспорт в текстовый формат
     */
    private async exportToText(_messages: IChannelMessage[], _filePath: string): Promise<void> {
        const textContent = _messages
            .map(message => MessageProcessor.formatForExport(message, false))
            .join('\n\n' + '='.repeat(50) + '\n\n');

        await fs.promises.writeFile(_filePath, textContent, 'utf-8');
        log.info(`📄 TXT экспорт: ${_filePath}`);
    }

    /**
     * Экспорт в CSV формат
     */
    private async exportToCsv(_messages: IChannelMessage[], _filePath: string): Promise<void> {
        const csvHeader = 'ID,Date,Text,Views,Forwards,HasMedia,MediaCount,LinksCount,HashtagsCount,MentionsCount,OriginalUrl\n';

        const csvContent = _messages.map(message => {
            const escapedText = message.text.replace(/"/g, '""').replace(/\n/g, ' ');
            return [
                message.id,
                message.date.toISOString(),
                `"${escapedText}"`,
                message.views,
                message.forwards,
                message.media ? 'true' : 'false',
                message.media ? message.media.length : 0,
                message.links ? message.links.length : 0,
                message.hashtags.length,
                message.mentions.length,
                message.originalUrl
            ].join(',');
        }).join('\n');

        await fs.promises.writeFile(_filePath, csvHeader + csvContent, 'utf-8');
        log.info(`📊 CSV экспорт: ${_filePath}`);
    }

    /**
     * Экспорт статистики
     */
    private async exportStats(_stats: IParseStats, _filePath: string): Promise<void> {
        const statsData = {
            ...(_stats),
            exportedAt: new Date().toISOString(),
            parseTimeFormatted: `${(_stats.parseTime / 1000).toFixed(1)}s`,
            totalMediaSizeFormatted: this.formatBytes(_stats.totalMediaSize)
        };

        await fs.promises.writeFile(_filePath, JSON.stringify(statsData, null, 2), 'utf-8');
        log.info(`📈 Статистика: ${_filePath}`);
    }

    /**
     * Создание директории если не существует
     */
    private async ensureDirectoryExists(_dirPath: string): Promise<void> {
        try {
            await fs.promises.mkdir(_dirPath, { recursive: true });
        } catch (error: unknown) {
            log.error(`❌ Ошибка создания директории ${_dirPath}:`, error as Error);
        }
    }

    /**
     * Форматирование размера в байтах
     */
    private formatBytes(_bytes: number): string {
        if (_bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(_bytes) / Math.log(k));

        return parseFloat((_bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
} 
