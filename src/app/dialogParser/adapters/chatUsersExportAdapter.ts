/**
 * Адаптер для экспорта результатов парсинга всех пользователей чата
 * Поддерживает экспорт в JSON, TXT и CSV форматы
 */

import fs from 'fs/promises';
import path from 'path';
import { IChatUsersParseResult, IUserMessage, IChatUserInfo } from '../interfaces';

export class ChatUsersExportAdapter {

    /**
     * Экспортирует результаты парсинга чата в указанные форматы
     */
    async exportAsync(_result: IChatUsersParseResult): Promise<string[]> {
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

        // Экспортируем статистику пользователей
        const statsFile = await this.exportUserStatsAsync(_result);
        if (statsFile) {
            exportedFiles.push(statsFile);
        }

        return exportedFiles;
    }

    /**
     * Экспорт в JSON формат
     */
    private async exportToJSONAsync(_result: IChatUsersParseResult): Promise<string[]> {
        const config = _result.exportConfig;
        const files: string[] = [];

        if (config.exportByUsers) {
            // Создаем отдельные файлы для каждого пользователя
            for (const user of _result.users) {
                const userMessages = _result.userMessages[user.id] || [];
                const fileName = `user_${user.id}_${this.sanitizeFileName(user.fullName)}.json`;
                const filePath = path.join(_result.exportPath, fileName);

                const userData = {
                    user,
                    chatInfo: {
                        id: _result.chatId,
                        title: _result.chatTitle,
                        type: _result.chatType
                    },
                    messages: userMessages,
                    totalMessages: userMessages.length,
                    exportDate: new Date().toISOString()
                };

                await fs.writeFile(filePath, JSON.stringify(userData, null, 2), 'utf-8');
                files.push(filePath);
            }
        } else {
            // Один файл со всеми пользователями
            const fileName = 'chat_users_full.json';
            const filePath = path.join(_result.exportPath, fileName);

            await fs.writeFile(filePath, JSON.stringify(_result, null, 2), 'utf-8');
            files.push(filePath);
        }

        return files;
    }

    /**
     * Экспорт в TXT формат
     */
    private async exportToTXTAsync(_result: IChatUsersParseResult): Promise<string[]> {
        const config = _result.exportConfig;
        const files: string[] = [];

        if (config.exportByUsers) {
            // Создаем отдельные файлы для каждого пользователя
            for (const user of _result.users) {
                const userMessages = _result.userMessages[user.id] || [];
                const fileName = `user_${user.id}_${this.sanitizeFileName(user.fullName)}.txt`;
                const filePath = path.join(_result.exportPath, fileName);

                const content = this.formatUserMessagesForTXT(user, userMessages, _result);
                await fs.writeFile(filePath, content, 'utf-8');
                files.push(filePath);
            }
        } else {
            // Один файл со всеми пользователями
            const fileName = 'chat_users_full.txt';
            const filePath = path.join(_result.exportPath, fileName);

            const header = `Пользователи чата: ${_result.chatTitle}\n` +
                `ID чата: ${_result.chatId}\n` +
                `Тип: ${_result.chatType}\n` +
                `Период: ${_result.dateRange.from.toLocaleDateString()} - ${_result.dateRange.to.toLocaleDateString()}\n` +
                `Всего сообщений: ${_result.totalMessages}\n` +
                `Всего пользователей: ${_result.totalUsers}\n\n`;

            let content = header;

            // Добавляем каждого пользователя
            for (const user of _result.users) {
                content += this.formatUserSectionForTXT(user, _result.userMessages[user.id] || []);
                content += '\n' + '='.repeat(80) + '\n\n';
            }

            await fs.writeFile(filePath, content, 'utf-8');
            files.push(filePath);
        }

        return files;
    }

    /**
     * Экспорт в CSV формат
     */
    private async exportToCSVAsync(_result: IChatUsersParseResult): Promise<string[]> {
        const files: string[] = [];

        // CSV с сообщениями
        const messagesFileName = 'chat_messages.csv';
        const messagesFilePath = path.join(_result.exportPath, messagesFileName);

        const messageHeaders = [
            'message_id', 'user_id', 'username', 'full_name', 'date', 'text',
            'has_media', 'is_edited', 'text_length'
        ].join(',');

        const messageRows: string[] = [];
        for (const user of _result.users) {
            const userMessages = _result.userMessages[user.id] || [];
            for (const message of userMessages) {
                messageRows.push([
                    message.id,
                    message.userId,
                    this.escapeCsvField(message.username || ''),
                    this.escapeCsvField(user.fullName),
                    message.date.toISOString(),
                    this.escapeCsvField(message.text),
                    message.hasMedia,
                    message.isEdited,
                    message.text.length
                ].join(','));
            }
        }

        const messagesContent = [messageHeaders, ...messageRows].join('\n');
        await fs.writeFile(messagesFilePath, messagesContent, 'utf-8');
        files.push(messagesFilePath);

        // CSV с пользователями
        const usersFileName = 'chat_users.csv';
        const usersFilePath = path.join(_result.exportPath, usersFileName);

        const userHeaders = [
            'user_id', 'username', 'first_name', 'last_name', 'full_name',
            'message_count', 'first_message_date', 'last_message_date', 'is_bot'
        ].join(',');

        const userRows = _result.users.map(user => [
            user.id,
            this.escapeCsvField(user.username || ''),
            this.escapeCsvField(user.firstName || ''),
            this.escapeCsvField(user.lastName || ''),
            this.escapeCsvField(user.fullName),
            user.messageCount,
            user.firstMessageDate?.toISOString() || '',
            user.lastMessageDate?.toISOString() || '',
            user.isBot
        ].join(','));

        const usersContent = [userHeaders, ...userRows].join('\n');
        await fs.writeFile(usersFilePath, usersContent, 'utf-8');
        files.push(usersFilePath);

        return files;
    }

    /**
     * Экспорт статистики пользователей
     */
    private async exportUserStatsAsync(_result: IChatUsersParseResult): Promise<string | null> {
        try {
            const fileName = 'chat_statistics.json';
            const filePath = path.join(_result.exportPath, fileName);

            const stats = {
                chat: {
                    id: _result.chatId,
                    title: _result.chatTitle,
                    type: _result.chatType
                },
                period: _result.dateRange,
                totals: {
                    messages: _result.totalMessages,
                    users: _result.totalUsers
                },
                topUsers: _result.users.slice(0, 20).map(user => ({
                    id: user.id,
                    fullName: user.fullName,
                    username: user.username,
                    messageCount: user.messageCount,
                    firstMessage: user.firstMessageDate,
                    lastMessage: user.lastMessageDate
                })),
                exportDate: new Date().toISOString()
            };

            await fs.writeFile(filePath, JSON.stringify(stats, null, 2), 'utf-8');
            return filePath;

        } catch (error) {
            console.error('Ошибка создания статистики чата:', error);
            return null;
        }
    }

    /**
     * Форматирует сообщения пользователя для TXT файла
     */
    private formatUserMessagesForTXT(_user: IChatUserInfo, _messages: IUserMessage[], _result: IChatUsersParseResult): string {
        const header = `Сообщения пользователя: ${_user.fullName}\n` +
            `Username: @${_user.username || 'не указан'}\n` +
            `ID: ${_user.id}\n` +
            `Чат: ${_result.chatTitle}\n` +
            `Всего сообщений: ${_messages.length}\n` +
            `Период: ${_user.firstMessageDate?.toLocaleDateString()} - ${_user.lastMessageDate?.toLocaleDateString()}\n\n`;

        const lines = [header];

        for (const msg of _messages) {
            lines.push(`[${msg.date.toLocaleString()}]`);
            lines.push(`${msg.text}`);

            if (msg.hasMedia) {
                lines.push(`📎 Медиа: ${msg.mediaType || 'unknown'}`);
            }

            if (msg.isEdited) {
                lines.push(`✏️ Отредактировано`);
            }

            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Форматирует раздел пользователя для общего TXT файла
     */
    private formatUserSectionForTXT(_user: IChatUserInfo, _messages: IUserMessage[]): string {
        const header = `👤 ${_user.fullName} (@${_user.username || 'no_username'})\n` +
            `ID: ${_user.id} | Сообщений: ${_user.messageCount}\n` +
            `Период: ${_user.firstMessageDate?.toLocaleDateString()} - ${_user.lastMessageDate?.toLocaleDateString()}\n\n`;

        const lines = [header];

        // Показываем первые 10 сообщений для примера
        const samplesToShow = Math.min(10, _messages.length);
        for (let i = 0; i < samplesToShow; i++) {
            const msg = _messages[i];
            lines.push(`[${msg.date.toLocaleString()}] ${msg.text.substring(0, 100)}${msg.text.length > 100 ? '...' : ''}`);
        }

        if (_messages.length > samplesToShow) {
            lines.push(`... и еще ${_messages.length - samplesToShow} сообщений`);
        }

        return lines.join('\n');
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
     * Создает безопасное имя файла
     */
    private sanitizeFileName(_name: string): string {
        return _name
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .toLowerCase()
            .substring(0, 30);
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