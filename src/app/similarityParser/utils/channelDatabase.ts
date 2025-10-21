/**
 * Утилита для управления единой базой каналов
 * Обеспечивает эффективную фильтрацию дубликатов
 */

import * as fs from 'fs';
import * as path from 'path';

export interface IChannelDatabaseStats {
    mainDatabaseSize: number;
    parsedChannelsSize: number;
    totalUniqueChannels: number;
}

export class ChannelDatabase {
    private readonly mainDatabasePath: string;
    private readonly parsedChannelsPath: string;
    private mainDatabase: Set<string>;
    private parsedChannels: Set<string>;

    constructor() {
        const dbDir = path.resolve(__dirname, '../../../../channel-database');
        this.mainDatabasePath = path.join(dbDir, 'main-database.txt');
        this.parsedChannelsPath = path.join(dbDir, 'parsed-channels.txt');

        this.mainDatabase = new Set();
        this.parsedChannels = new Set();

        this.loadDatabases();
    }

    /**
     * Загрузка баз данных в память
     */
    private loadDatabases(): void {
        // Загружаем основную базу
        if (fs.existsSync(this.mainDatabasePath)) {
            const content = fs.readFileSync(this.mainDatabasePath, 'utf-8');
            const lines = content.split('\n');

            for (const line of lines) {
                const username = this.normalizeUsername(line);
                if (username) {
                    this.mainDatabase.add(username);
                }
            }
            console.log(`📚 Загружено ${this.mainDatabase.size} каналов из основной базы`);
        }

        // Загружаем базу спарсенных каналов (если файл существует)
        if (fs.existsSync(this.parsedChannelsPath)) {
            const content = fs.readFileSync(this.parsedChannelsPath, 'utf-8');
            const lines = content.split('\n');

            for (const line of lines) {
                const username = this.normalizeUsername(line);
                if (username && !username.startsWith('#')) {
                    this.parsedChannels.add(username);
                }
            }
            console.log(`🔍 Загружено ${this.parsedChannels.size} ранее спарсенных каналов`);
        }
    }

    /**
     * Нормализация юзернейма
     */
    private normalizeUsername(username: string): string {
        const trimmed = username.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return '';
        }
        return trimmed.replace(/^@/, '').toLowerCase();
    }

    /**
     * Проверка, существует ли канал в базах
     */
    public isChannelKnown(username: string): boolean {
        const normalized = this.normalizeUsername(username);
        return this.mainDatabase.has(normalized) || this.parsedChannels.has(normalized);
    }

    /**
     * Фильтрация списка каналов от дубликатов
     */
    public filterNewChannels(channels: string[]): string[] {
        const newChannels: string[] = [];

        for (const channel of channels) {
            const normalized = this.normalizeUsername(channel);
            if (!normalized) continue;

            if (!this.isChannelKnown(normalized)) {
                newChannels.push(`@${normalized}`);
            }
        }

        return newChannels;
    }

    /**
     * Добавление новых каналов в базу спарсенных
     */
    public addParsedChannels(channels: string[]): void {
        let addedCount = 0;
        const newChannels: string[] = [];

        for (const channel of channels) {
            const normalized = this.normalizeUsername(channel);
            if (normalized && !this.parsedChannels.has(normalized)) {
                this.parsedChannels.add(normalized);
                newChannels.push(`@${normalized}`);
                addedCount++;
            }
        }

        if (addedCount > 0) {
            // Дописываем в файл
            const content = '\n' + newChannels.join('\n');
            fs.appendFileSync(this.parsedChannelsPath, content, 'utf-8');
            console.log(`✅ Добавлено ${addedCount} новых каналов в базу спарсенных`);
        }
    }

    /**
     * Получение статистики
     */
    public getStats(): IChannelDatabaseStats {
        return {
            mainDatabaseSize: this.mainDatabase.size,
            parsedChannelsSize: this.parsedChannels.size,
            totalUniqueChannels: this.mainDatabase.size + this.parsedChannels.size
        };
    }

    /**
     * Очистка базы спарсенных каналов (для тестирования)
     */
    public clearParsedChannels(): void {
        this.parsedChannels.clear();
        fs.writeFileSync(this.parsedChannelsPath, '# Файл для хранения уже спарсенных каналов\n# Формат: @username\n# Автоматически обновляется после каждого парсинга', 'utf-8');
        console.log('🗑️  База спарсенных каналов очищена');
    }
}