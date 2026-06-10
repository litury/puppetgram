import * as fs from 'fs/promises';
import * as path from 'path';
import { IChannelMessage, IMediaFile } from '../../channelParser/interfaces/IChannelParser';
import {
    IVkContentExporter,
    IVkContentExporterConfig,
    IVkExportStats,
    IVkPost,
    IChannelExportFile,
    VkMediaType,
    DEFAULT_ALLOWED_MEDIA_TYPES
} from '../interfaces/IVkContentExporter';

export class VkContentExporterService implements IVkContentExporter {
    /**
     * Оставляет только медиа допустимых типов
     */
    private filterAllowedMedia(_media: IMediaFile[] | undefined, _allowed: VkMediaType[]): IMediaFile[] {
        if (!_media || _media.length === 0) {
            return [];
        }
        return _media.filter(m => _allowed.includes(m.type));
    }

    /**
     * Группирует сообщения по альбомам с сохранением порядка появления.
     * Сообщения без albumId образуют отдельную одиночную группу.
     */
    private groupByAlbum(_messages: IChannelMessage[]): IChannelMessage[][] {
        const groups: IChannelMessage[][] = [];
        const albumIndex = new Map<string, number>();

        for (const message of _messages) {
            const albumId = message.isPartOfAlbum && message.albumId ? message.albumId : undefined;

            if (albumId !== undefined) {
                if (albumIndex.has(albumId)) {
                    groups[albumIndex.get(albumId)!].push(message);
                } else {
                    albumIndex.set(albumId, groups.length);
                    groups.push([message]);
                }
            } else {
                groups.push([message]);
            }
        }

        return groups;
    }

    /**
     * Отбирает посты с медиа, объединяет альбомы, сохраняет оригинальный текст
     */
    exportMediaPosts(
        _channelData: IChannelExportFile,
        _config?: IVkContentExporterConfig
    ): { posts: IVkPost[]; stats: IVkExportStats } {
        const allowed = _config?.allowedMediaTypes ?? DEFAULT_ALLOWED_MEDIA_TYPES;
        const messages = _channelData.messages || [];

        // Сортируем по дате, чтобы порядок постов и частей альбома был хронологическим
        const sortedMessages = [...messages].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        const groups = this.groupByAlbum(sortedMessages);

        const posts: IVkPost[] = [];
        let albumMessagesMerged = 0;
        let albumPosts = 0;
        let postsWithEmptyText = 0;
        let mediaFilesTotal = 0;

        for (const group of groups) {
            // Собираем все допустимые медиа группы (для альбома — со всех частей)
            const media = group.flatMap(msg => this.filterAllowedMedia(msg.media, allowed));

            // Пропускаем посты без подходящего медиа
            if (media.length === 0) {
                continue;
            }

            // Текст: первая непустая подпись в группе (для альбома обычно у одной части)
            const content = (group.find(msg => (msg.text || '').trim().length > 0)?.text || '').trim();

            const isAlbum = group.length > 1;
            if (isAlbum) {
                albumPosts++;
                albumMessagesMerged += group.length;
            }
            if (content.length === 0) {
                postsWithEmptyText++;
            }
            mediaFilesTotal += media.length;

            posts.push({
                id: `vkpost_${group[0].id}`,
                content,
                originalDate: group[0].date,
                media,
                sourceMessageIds: group.map(msg => msg.id),
                isAlbum
            });
        }

        const stats: IVkExportStats = {
            totalMessages: messages.length,
            messagesWithMedia: messages.filter(m => this.filterAllowedMedia(m.media, allowed).length > 0).length,
            albumMessagesMerged,
            albumPosts,
            postsGenerated: posts.length,
            postsWithEmptyText,
            mediaFilesTotal
        };

        return { posts, stats };
    }

    /**
     * Сохраняет посты в JSON (+ TXT для просмотра)
     */
    async savePostsToFile(_posts: IVkPost[], _filePath: string): Promise<void> {
        const exportData = {
            metadata: {
                generatedAt: new Date().toISOString(),
                totalPosts: _posts.length,
                albumPosts: _posts.filter(p => p.isAlbum).length,
                mediaFilesTotal: _posts.reduce((sum, p) => sum + p.media.length, 0)
            },
            posts: _posts
        };

        const dir = path.dirname(_filePath);
        await fs.mkdir(dir, { recursive: true });

        await fs.writeFile(_filePath, JSON.stringify(exportData, null, 2), 'utf-8');

        // Текстовый файл для удобного просмотра
        const txtPath = _filePath.replace(/\.json$/, '.txt');
        const txtContent = _posts
            .map(post => {
                const mediaInfo = post.media.map(m => `[${m.type}] ${m.filename}`).join(', ');
                const albumMark = post.isAlbum ? ` (альбом ×${post.media.length})` : '';
                return `#${post.id}${albumMark}\n${post.content || '(без текста)'}\nМедиа: ${mediaInfo}\n---\n`;
            })
            .join('\n');

        await fs.writeFile(txtPath, txtContent, 'utf-8');

        console.log(`💾 Посты сохранены:`);
        console.log(`   • JSON: ${_filePath}`);
        console.log(`   • TXT:  ${txtPath}`);
    }
}
