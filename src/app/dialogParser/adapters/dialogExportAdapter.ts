/**
 * Адаптер для экспорта результатов парсинга диалогов
 * Поддерживает экспорт в JSON, TXT и CSV форматы
 */

import fs from 'fs/promises';
import path from 'path';
import { IDialogParseResult, IUserMessage, IUserMessageStats } from '../interfaces';

export class DialogExportAdapter {

    /**
     * Экспортирует результаты в указанные форматы
     */
    async exportAsync(_result: IDialogParseResult): Promise<string[]> {
        const exportedFiles: string[] = [];

        // Создаем директорию экспорта
        await this.ensureDirectoryExists(_result.exportPath);

        // Экспортируем в каждый указанный формат
        for (const format of _result.exportConfig?.formats || ['json']) {
            try {
                let filePaths: string[] = [];

                switch (format) {
                    case 'json':
                        filePaths = await this.exportToJSONAsync(_result);
                        break;
                    case 'txt':
                        filePaths = await this.exportToTXTAsync(_result);
                        break;
                    case 'csv':
                        filePaths = await this.exportToCSVAsync(_result);
                        break;
                }

                exportedFiles.push(...filePaths);

            } catch (error) {
                console.error(`❌ Ошибка экспорта в ${format}:`, error);
            }
        }

        // Экспортируем статистику
        const statsFile = await this.exportStatsAsync(_result);
        if (statsFile) {
            exportedFiles.push(statsFile);
        }

        return exportedFiles;
    }

    /**
     * Экспорт в JSON формат
     */
    private async exportToJSONAsync(_result: IDialogParseResult): Promise<string[]> {
        const config = _result.exportConfig;
        const files: string[] = [];

        if (config.splitByPeriod) {
            // Разделяем по периодам
            const groupedMessages = this.groupMessagesByPeriod(_result.messages, config.splitByPeriod);

            for (const [period, messages] of Object.entries(groupedMessages)) {
                const fileName = `dialogs_${period}.json`;
                const filePath = path.join(_result.exportPath, fileName);

                const periodResult = {
                    ..._result,
                    messages,
                    totalMessages: messages.length,
                    period
                };

                await fs.writeFile(filePath, JSON.stringify(periodResult, null, 2), 'utf-8');
                files.push(filePath);
            }
        } else if (config.maxMessagesPerFile && _result.messages.length > config.maxMessagesPerFile) {
            // Разделяем по количеству сообщений
            const chunks = this.chunkArray(_result.messages, config.maxMessagesPerFile);

            for (let i = 0; i < chunks.length; i++) {
                const fileName = `dialogs_part_${i + 1}.json`;
                const filePath = path.join(_result.exportPath, fileName);

                const chunkResult = {
                    ..._result,
                    messages: chunks[i],
                    totalMessages: chunks[i].length,
                    part: i + 1,
                    totalParts: chunks.length
                };

                await fs.writeFile(filePath, JSON.stringify(chunkResult, null, 2), 'utf-8');
                files.push(filePath);
            }
        } else {
            // Один файл
            const fileName = 'dialogs_full.json';
            const filePath = path.join(_result.exportPath, fileName);

            await fs.writeFile(filePath, JSON.stringify(_result, null, 2), 'utf-8');
            files.push(filePath);
        }

        return files;
    }

    /**
     * Экспорт в TXT формат
     */
    private async exportToTXTAsync(_result: IDialogParseResult): Promise<string[]> {
        const config = _result.exportConfig;
        const files: string[] = [];

        if (config.groupByChats) {
            // Группируем по чатам
            const messagesByChat = this.groupMessagesByChat(_result.messages);

            for (const [chatId, messages] of Object.entries(messagesByChat)) {
                const chat = _result.chats.find(c => c.id === chatId);
                const chatName = chat?.title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_') || chatId;
                const fileName = `chat_${chatName}.txt`;
                const filePath = path.join(_result.exportPath, fileName);

                const content = this.formatMessagesForTXT(messages, `Чат: ${chat?.title || chatId}`);
                await fs.writeFile(filePath, content, 'utf-8');
                files.push(filePath);
            }
        } else {
            // Один файл со всеми сообщениями
            const fileName = 'dialogs_full.txt';
            const filePath = path.join(_result.exportPath, fileName);

            const header = `Диалоги пользователя: ${_result.fullName}\n` +
                `Период: ${_result.dateRange.from.toLocaleDateString()} - ${_result.dateRange.to.toLocaleDateString()}\n` +
                `Всего сообщений: ${_result.totalMessages}\n` +
                `Всего чатов: ${_result.totalChats}\n\n`;

            const content = header + this.formatMessagesForTXT(_result.messages);
            await fs.writeFile(filePath, content, 'utf-8');
            files.push(filePath);
        }

        return files;
    }

    /**
     * Экспорт в CSV формат
     */
    private async exportToCSVAsync(_result: IDialogParseResult): Promise<string[]> {
        const fileName = 'dialogs.csv';
        const filePath = path.join(_result.exportPath, fileName);

        // CSV заголовки
        const headers = [
            'id', 'date', 'chat_title', 'chat_type', 'text', 'has_media', 'media_type',
            'reply_to_text', 'reply_to_username', 'forwarded_from', 'is_edited', 'text_length'
        ].join(',');

        // CSV строки
        const rows = _result.messages.map(msg => [
            msg.id,
            msg.date.toISOString(),
            this.escapeCsvField(msg.chatTitle),
            msg.chatType,
            this.escapeCsvField(msg.text),
            msg.hasMedia,
            msg.mediaType || '',
            this.escapeCsvField(msg.replyToText || ''),
            msg.replyToUsername || '',
            msg.forwardedFrom || '',
            msg.isEdited,
            msg.text.length
        ].join(','));

        const content = [headers, ...rows].join('\n');
        await fs.writeFile(filePath, content, 'utf-8');

        return [filePath];
    }

    /**
     * Экспорт статистики
     */
    private async exportStatsAsync(_result: IDialogParseResult): Promise<string | null> {
        try {
            // Импортируем сервис здесь для вычисления статистики
            const { DialogParserService } = await import('../services/dialogParserService');
            const tempService = new DialogParserService({} as any);
            const stats = tempService.calculateMessageStats(_result.messages);

            const fileName = 'statistics.json';
            const filePath = path.join(_result.exportPath, fileName);

            const statsWithMetadata = {
                user: {
                    id: _result.userId,
                    username: _result.username,
                    fullName: _result.fullName
                },
                period: _result.dateRange,
                totals: {
                    messages: _result.totalMessages,
                    chats: _result.totalChats
                },
                statistics: stats,
                exportDate: new Date().toISOString()
            };

            await fs.writeFile(filePath, JSON.stringify(statsWithMetadata, null, 2), 'utf-8');
            return filePath;

        } catch (error) {
            console.error('Ошибка создания статистики:', error);
            return null;
        }
    }

    /**
     * Форматирует сообщения для TXT файла
     */
    private formatMessagesForTXT(_messages: IUserMessage[], _header?: string): string {
        const lines: string[] = [];

        if (_header) {
            lines.push(_header);
            lines.push('='.repeat(_header.length));
            lines.push('');
        }

        for (const msg of _messages) {
            lines.push(`[${msg.date.toLocaleString()}] ${msg.chatTitle}`);

            if (msg.replyToText) {
                lines.push(`  ↳ Ответ на: "${msg.replyToText.substring(0, 100)}${msg.replyToText.length > 100 ? '...' : ''}"`);
            }

            lines.push(`  ${msg.text}`);

            if (msg.hasMedia) {
                lines.push(`  📎 Медиа: ${msg.mediaType}`);
                if (msg.mediaCaption) {
                    lines.push(`  📝 Подпись: ${msg.mediaCaption}`);
                }
            }

            if (msg.isEdited) {
                lines.push(`  ✏️ Отредактировано: ${msg.editDate?.toLocaleString()}`);
            }

            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Группирует сообщения по чатам
     */
    private groupMessagesByChat(_messages: IUserMessage[]): { [chatId: string]: IUserMessage[] } {
        const grouped: { [chatId: string]: IUserMessage[] } = {};

        for (const message of _messages) {
            if (!grouped[message.chatId]) {
                grouped[message.chatId] = [];
            }
            grouped[message.chatId].push(message);
        }

        return grouped;
    }

    /**
     * Группирует сообщения по периодам
     */
    private groupMessagesByPeriod(
        _messages: IUserMessage[],
        _period: 'day' | 'week' | 'month' | 'year'
    ): { [period: string]: IUserMessage[] } {
        const grouped: { [period: string]: IUserMessage[] } = {};

        for (const message of _messages) {
            let periodKey: string;
            const date = message.date;

            switch (_period) {
                case 'day':
                    periodKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
                    break;
                case 'week':
                    const weekStart = new Date(date);
                    weekStart.setDate(date.getDate() - date.getDay());
                    periodKey = `week_${weekStart.toISOString().split('T')[0]}`;
                    break;
                case 'month':
                    periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    break;
                case 'year':
                    periodKey = String(date.getFullYear());
                    break;
            }

            if (!grouped[periodKey]) {
                grouped[periodKey] = [];
            }
            grouped[periodKey].push(message);
        }

        return grouped;
    }

    /**
     * Разбивает массив на части
     */
    private chunkArray<T>(_array: T[], _chunkSize: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < _array.length; i += _chunkSize) {
            chunks.push(_array.slice(i, i + _chunkSize));
        }
        return chunks;
    }

    /**
     * Экранирует поле для CSV
     */
    private escapeCsvField(_field: string): string {
        if (_field.includes(',') || _field.includes('"') || _field.includes('\n')) {
            return `"${_field.replace(/"/g, '""')}"`;
        }
        return _field;
    }

    /**
     * Создает директорию если она не существует
     */
    private async ensureDirectoryExists(_dirPath: string): Promise<void> {
        try {
            await fs.access(_dirPath);
        } catch {
            await fs.mkdir(_dirPath, { recursive: true });
        }
    }
} 