import * as fs from 'fs';
import * as path from 'path';

// Временные интерфейсы для компиляции
interface IMessage {
    id: number;
    date: Date;
    message: string;
}

interface IBulkCommentCheckResponse {
    [key: string]: any;
}

export interface IExportOptions {
    format: 'json' | 'txt' | 'csv';
    filename?: string;
    includeMetadata?: boolean;
}

export interface IExportResult {
    filename: string;
    path: string;
    messageCount: number;
    totalCharacters: number;
}

export class ExportService {
    private static readonly EXPORT_DIR = './exports';

    constructor() {
        // Создаем папку exports если её нет
        if (!fs.existsSync(ExportService.EXPORT_DIR)) {
            fs.mkdirSync(ExportService.EXPORT_DIR, { recursive: true });
        }
    }

    /**
     * Экспорт сообщений в файл
     */
    static async exportMessages(
        messages: IMessage[],
        channelName: string,
        options: IExportOptions
    ): Promise<IExportResult> {
        // Создаем папку для экспорта если её нет
        if (!fs.existsSync(ExportService.EXPORT_DIR)) {
            fs.mkdirSync(ExportService.EXPORT_DIR, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const cleanChannelName = channelName.replace(/[@\/]/g, '');
        const filename = options.filename ||
            `${cleanChannelName}_${timestamp}.${options.format}`;

        const filepath = path.join(ExportService.EXPORT_DIR, filename);

        let content: string;

        switch (options.format) {
            case 'json':
                content = ExportService.exportToJson(messages, channelName, options.includeMetadata);
                break;
            case 'txt':
                content = ExportService.exportToText(messages, channelName, options.includeMetadata);
                break;
            case 'csv':
                content = ExportService.exportToCsv(messages, channelName, options.includeMetadata);
                break;
            default:
                throw new Error(`Неподдерживаемый формат: ${options.format}`);
        }

        fs.writeFileSync(filepath, content, 'utf-8');

        const totalCharacters = messages.reduce((sum, msg) => sum + msg.message.length, 0);

        return {
            filename,
            path: filepath,
            messageCount: messages.length,
            totalCharacters
        };
    }

    private static exportToJson(
        messages: IMessage[],
        channelName: string,
        includeMetadata: boolean = false
    ): string {
        const data: any = {
            messages: messages.map(msg => ({
                id: msg.id,
                text: msg.message,
                date: msg.date.toISOString()
            }))
        };

        if (includeMetadata) {
            data.metadata = {
                channelName,
                exportDate: new Date().toISOString(),
                totalMessages: messages.length,
                dateRange: {
                    from: messages.length > 0 ? messages[messages.length - 1].date.toISOString() : null,
                    to: messages.length > 0 ? messages[0].date.toISOString() : null
                }
            };
        }

        return JSON.stringify(data, null, 2);
    }

    private static exportToText(
        messages: IMessage[],
        channelName: string,
        includeMetadata: boolean = false
    ): string {
        let content = '';

        if (includeMetadata) {
            content += `=== Экспорт сообщений из канала ${channelName} ===\n`;
            content += `Дата экспорта: ${new Date().toLocaleString('ru-RU')}\n`;
            content += `Количество сообщений: ${messages.length}\n`;
            if (messages.length > 0) {
                content += `Период: ${messages[messages.length - 1].date.toLocaleString('ru-RU')} - ${messages[0].date.toLocaleString('ru-RU')}\n`;
            }
            content += '\n' + '='.repeat(50) + '\n\n';
        }

        messages.forEach((msg, index) => {
            if (includeMetadata) {
                content += `[${msg.date.toLocaleString('ru-RU')}] ID: ${msg.id}\n`;
            }
            content += `${msg.message}\n`;
            if (index < messages.length - 1) {
                content += '\n' + '-'.repeat(20) + '\n\n';
            }
        });

        return content;
    }

    private static exportToCsv(
        messages: IMessage[],
        channelName: string,
        includeMetadata: boolean = false
    ): string {
        let content = 'ID,Date,Message\n';

        messages.forEach(msg => {
            const escapedMessage = msg.message.replace(/"/g, '""').replace(/\n/g, '\\n');
            content += `${msg.id},"${msg.date.toISOString()}","${escapedMessage}"\n`;
        });

        return content;
    }

    /**
     * Создание текста для нейросети (только контент без метаданных)
     */
    static createNeuralNetworkText(messages: IMessage[]): string {
        return messages
            .map(msg => msg.message.trim())
            .filter(msg => msg.length > 0)
            .join('\n\n');
    }

    /**
 * Сохранение контента в файл
 */
    async saveToFile(content: string, filename: string, directory: string = 'exports'): Promise<void> {
        const fullPath = path.join(directory, filename);

        // Создаем директорию если её нет
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(fullPath, content, 'utf-8');
    }
}

// Создаем и экспортируем instance сервиса
export const exportService = new ExportService();