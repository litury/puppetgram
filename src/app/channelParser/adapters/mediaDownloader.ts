import * as fs from 'fs';
import * as path from 'path';
import { IMediaFile, IChannelParseOptions } from '../interfaces';

/**
 * Адаптер для скачивания медиа файлов из Telegram
 */
export class MediaDownloader {
    private readonly p_baseDirectory: string;
    private readonly p_options: IChannelParseOptions;

    constructor(_baseDirectory: string, _options: IChannelParseOptions) {
        this.p_baseDirectory = _baseDirectory;
        this.p_options = _options;
    }

    /**
     * Скачивание медиа файла
     */
    async downloadMediaAsync(_client: any, _message: any, _channelName: string): Promise<IMediaFile[]> {
        const mediaFiles: IMediaFile[] = [];

        if (!_message.media) {
            return mediaFiles;
        }

        try {
            const mediaInfo = this.extractMediaInfo(_message.media);

            if (!mediaInfo || !this.shouldDownloadMedia(mediaInfo)) {
                return mediaFiles;
            }

            // Создаем директорию для медиа
            const mediaDir = path.join(this.p_baseDirectory, _channelName.replace(/[@\/]/g, ''), 'media');
            await this.ensureDirectoryExists(mediaDir);

            // Генерируем имя файла
            const filename = this.generateFilename(_message.id, mediaInfo);
            const filePath = path.join(mediaDir, filename);

            // Скачиваем файл
            if (this.p_options.downloadMedia) {
                try {
                    // Оптимизируем размер блока в зависимости от размера файла
                    const downloadOptions: any = {};
                    if (mediaInfo.size > 100 * 1024 * 1024) { // Файл больше 100MB
                        downloadOptions.chunkSize = 1024 * 1024; // 1MB блоки
                    } else if (mediaInfo.size > 10 * 1024 * 1024) { // Файл больше 10MB
                        downloadOptions.chunkSize = 512 * 1024; // 512KB блоки
                    } else {
                        downloadOptions.chunkSize = 256 * 1024; // 256KB блоки для маленьких файлов
                    }

                    console.log(`📥 Начинаю загрузку файла ${filename} (${this.formatFileSize(mediaInfo.size)})`);
                    const buffer = await _client.downloadMedia(_message.media, downloadOptions);
                    if (buffer) {
                        await fs.promises.writeFile(filePath, buffer);

                        mediaInfo.localPath = filePath;
                        mediaInfo.filename = filename;
                        mediaInfo.size = buffer.length;

                        console.log(`📥 Скачан медиа файл: ${filename}`);
                    }
                } catch (downloadError) {
                    console.warn(`⚠️  Ошибка скачивания медиа ${filename}: ${downloadError}`);
                    mediaInfo.downloadUrl = 'failed';
                }
            }

            mediaFiles.push(mediaInfo);

        } catch (error) {
            console.error(`❌ Ошибка обработки медиа в сообщении ${_message.id}:`, error);
        }

        return mediaFiles;
    }

    /**
     * Извлечение информации о медиа файле
     */
    private extractMediaInfo(_media: any): IMediaFile | null {
        if (!_media) return null;

        const mediaType = this.getMediaType(_media);
        if (!mediaType) return null;

        // Получаем информацию из вложенных объектов
        const document = _media.document;
        const photo = _media.photo;

        const mediaInfo: IMediaFile = {
            type: mediaType,
            filename: '',
            size: 0,
            mimeType: _media.mimeType || this.getMimeTypeByExtension(mediaType),
            duration: _media.duration,
            dimensions: undefined
        };

        // Дополнительная информация в зависимости от типа
        switch (mediaType) {
            case 'photo':
                if (photo) {
                    mediaInfo.size = photo.size || 0;
                    // Ищем наибольший размер фото
                    if (photo.sizes && photo.sizes.length > 0) {
                        const largestSize = photo.sizes[photo.sizes.length - 1];
                        mediaInfo.dimensions = {
                            width: largestSize.w || 0,
                            height: largestSize.h || 0
                        };
                    }
                }
                break;
            case 'video':
            case 'document':
                if (document) {
                    mediaInfo.filename = document.fileName || 'document';
                    mediaInfo.size = document.size || 0;
                    mediaInfo.mimeType = document.mimeType || mediaInfo.mimeType;
                    mediaInfo.duration = document.duration;

                    // Ищем размеры в атрибутах
                    if (document.attributes) {
                        for (const attr of document.attributes) {
                            if (attr.className === 'DocumentAttributeVideo') {
                                mediaInfo.dimensions = {
                                    width: attr.w || 0,
                                    height: attr.h || 0
                                };
                                mediaInfo.duration = attr.duration;
                            }
                        }
                    }
                }
                break;
            case 'audio':
            case 'voice':
                if (document) {
                    mediaInfo.duration = document.duration;
                    mediaInfo.size = document.size || 0;
                    mediaInfo.mimeType = document.mimeType || mediaInfo.mimeType;
                }
                break;
        }

        return mediaInfo;
    }

    /**
     * Определение типа медиа
     */
    private getMediaType(_media: any): IMediaFile['type'] | null {
        const className = _media.className || _media.constructor?.name || '';

        if (className.includes('Photo')) return 'photo';
        if (className.includes('Video')) return 'video';
        if (className.includes('Document')) {
            // Дополнительная проверка для документов
            const mimeType = _media.mimeType || '';
            if (mimeType.startsWith('image/')) return 'photo';
            if (mimeType.startsWith('video/')) return 'video';
            if (mimeType.startsWith('audio/')) return 'audio';
            return 'document';
        }
        if (className.includes('Audio')) return 'audio';
        if (className.includes('Voice')) return 'voice';
        if (className.includes('Animation')) return 'animation';
        if (className.includes('Sticker')) return 'sticker';

        return null;
    }

    /**
     * Проверка, нужно ли скачивать медиа
     */
    private shouldDownloadMedia(_mediaInfo: IMediaFile): boolean {
        // Проверяем тип медиа
        if (this.p_options.mediaTypes && !this.p_options.mediaTypes.includes(_mediaInfo.type)) {
            return false;
        }

        // Проверяем размер файла (0 означает без ограничений)
        if (this.p_options.maxMediaSize && this.p_options.maxMediaSize > 0 && _mediaInfo.size > this.p_options.maxMediaSize * 1024 * 1024) {
            return false;
        }

        return true;
    }

    /**
     * Генерация имени файла
     */
    private generateFilename(_messageId: number, _mediaInfo: IMediaFile): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const extension = this.getExtensionByType(_mediaInfo.type, _mediaInfo.mimeType);

        return `${_messageId}_${timestamp}.${extension}`;
    }

    /**
     * Получение расширения файла по типу
     */
    private getExtensionByType(_type: IMediaFile['type'], _mimeType?: string): string {
        if (_mimeType) {
            const mimeExtensions: Record<string, string> = {
                'image/jpeg': 'jpg',
                'image/png': 'png',
                'image/gif': 'gif',
                'image/webp': 'webp',
                'video/mp4': 'mp4',
                'video/webm': 'webm',
                'audio/mpeg': 'mp3',
                'audio/ogg': 'ogg',
                'audio/wav': 'wav'
            };

            if (mimeExtensions[_mimeType]) {
                return mimeExtensions[_mimeType];
            }
        }

        // Дефолтные расширения по типу
        const defaultExtensions: Record<IMediaFile['type'], string> = {
            'photo': 'jpg',
            'video': 'mp4',
            'document': 'bin',
            'audio': 'mp3',
            'voice': 'ogg',
            'animation': 'gif',
            'sticker': 'webp'
        };

        return defaultExtensions[_type] || 'bin';
    }

    /**
     * Получение MIME типа по расширению
     */
    private getMimeTypeByExtension(_type: IMediaFile['type']): string {
        const mimeTypes: Record<IMediaFile['type'], string> = {
            'photo': 'image/jpeg',
            'video': 'video/mp4',
            'document': 'application/octet-stream',
            'audio': 'audio/mpeg',
            'voice': 'audio/ogg',
            'animation': 'image/gif',
            'sticker': 'image/webp'
        };

        return mimeTypes[_type] || 'application/octet-stream';
    }

    /**
     * Создание директории если не существует
     */
    private async ensureDirectoryExists(_dirPath: string): Promise<void> {
        try {
            await fs.promises.mkdir(_dirPath, { recursive: true });
        } catch (error) {
            console.error(`❌ Ошибка создания директории ${_dirPath}:`, error);
        }
    }

    /**
     * Форматирование размера файла в читаемый вид
     */
    private formatFileSize(_bytes: number): string {
        if (_bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(_bytes) / Math.log(k));

        return parseFloat((_bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
} 