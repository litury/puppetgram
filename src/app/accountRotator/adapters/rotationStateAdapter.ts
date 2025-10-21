/**
 * Адаптер для работы с состоянием ротации
 * Обеспечивает сохранение и загрузку состояния ротации
 */

import { IRotationState, IAccountInfo, IRotationConfig } from '../interfaces/IAccountRotator';
import * as fs from 'fs';
import * as path from 'path';

export interface IRotationStateFile {
    version: string;
    timestamp: string;
    rotationState: IRotationState;
    accounts: Omit<IAccountInfo, 'sessionValue'>[];
    config: IRotationConfig;
    metadata: {
        totalSessions: number;
        lastResetDate?: string;
        dailyStats: {
            date: string;
            commentsPosted: number;
            rotationsPerformed: number;
        }[];
    };
}

export class RotationStateAdapter {
    private static readonly VERSION = '1.0.0';
    private static readonly DEFAULT_STATE_FILE = './data/rotation-state.json';
    private static readonly BACKUP_DIRECTORY = './data/backups';

    /**
     * Сохранить состояние ротации в файл
     */
    static async saveState(
        rotationState: IRotationState,
        accounts: IAccountInfo[],
        config: IRotationConfig,
        filePath?: string
    ): Promise<{ success: boolean; filePath: string; error?: string }> {
        const targetPath = filePath || this.DEFAULT_STATE_FILE;

        try {
            // Создаем директорию если не существует
            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Создаем резервную копию если файл существует
            if (fs.existsSync(targetPath)) {
                await this.createBackup(targetPath);
            }

            // Подготавливаем данные (без sessionValue)
            const safeAccounts = accounts.map(account => {
                const { sessionValue, ...safeAccount } = account;
                return safeAccount;
            });

            // Загружаем существующие метаданные или создаем новые
            let metadata = {
                totalSessions: 1,
                dailyStats: [] as any[]
            };

            if (fs.existsSync(targetPath)) {
                try {
                    const existingData: IRotationStateFile = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
                    metadata = existingData.metadata || metadata;
                    metadata.totalSessions++;
                } catch (error) {
                    console.warn('⚠️ Не удалось загрузить существующие метаданные');
                }
            }

            // Обновляем дневную статистику
            const today = new Date().toISOString().split('T')[0];
            const todayStats = metadata.dailyStats.find(s => s.date === today);
            
            if (todayStats) {
                todayStats.commentsPosted = rotationState.totalCommentsPosted;
            } else {
                metadata.dailyStats.push({
                    date: today,
                    commentsPosted: rotationState.totalCommentsPosted,
                    rotationsPerformed: accounts.filter(a => a.lastUsed).length
                });
            }

            // Ограничиваем историю 30 днями
            metadata.dailyStats = metadata.dailyStats
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 30);

            const stateFile: IRotationStateFile = {
                version: this.VERSION,
                timestamp: new Date().toISOString(),
                rotationState,
                accounts: safeAccounts,
                config,
                metadata
            };

            fs.writeFileSync(targetPath, JSON.stringify(stateFile, null, 2), 'utf-8');

            return {
                success: true,
                filePath: targetPath
            };

        } catch (error) {
            return {
                success: false,
                filePath: targetPath,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Загрузить состояние ротации из файла
     */
    static async loadState(filePath?: string): Promise<{
        success: boolean;
        data?: IRotationStateFile;
        error?: string;
    }> {
        const targetPath = filePath || this.DEFAULT_STATE_FILE;

        if (!fs.existsSync(targetPath)) {
            return {
                success: false,
                error: 'Файл состояния не найден'
            };
        }

        try {
            const fileContent = fs.readFileSync(targetPath, 'utf-8');
            const data: IRotationStateFile = JSON.parse(fileContent);

            // Проверяем версию файла
            if (data.version && data.version !== this.VERSION) {
                console.warn(`⚠️ Версия файла состояния (${data.version}) отличается от текущей (${this.VERSION})`);
            }

            // Валидируем структуру данных
            if (!data.rotationState || !data.accounts || !Array.isArray(data.accounts)) {
                throw new Error('Неверная структура файла состояния');
            }

            return {
                success: true,
                data
            };

        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Создать резервную копию файла состояния
     */
    private static async createBackup(originalPath: string): Promise<void> {
        try {
            // Создаем директорию для бэкапов
            if (!fs.existsSync(this.BACKUP_DIRECTORY)) {
                fs.mkdirSync(this.BACKUP_DIRECTORY, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFilename = `rotation-state-backup-${timestamp}.json`;
            const backupPath = path.join(this.BACKUP_DIRECTORY, backupFilename);

            fs.copyFileSync(originalPath, backupPath);
            
            // Ограничиваем количество бэкапов (оставляем последние 10)
            this.cleanupBackups();
            
        } catch (error) {
            console.warn('⚠️ Не удалось создать резервную копию:', error);
        }
    }

    /**
     * Очистка старых резервных копий
     */
    private static cleanupBackups(): void {
        try {
            if (!fs.existsSync(this.BACKUP_DIRECTORY)) {
                return;
            }

            const backupFiles = fs.readdirSync(this.BACKUP_DIRECTORY)
                .filter(file => file.startsWith('rotation-state-backup-') && file.endsWith('.json'))
                .map(file => ({
                    name: file,
                    path: path.join(this.BACKUP_DIRECTORY, file),
                    mtime: fs.statSync(path.join(this.BACKUP_DIRECTORY, file)).mtime
                }))
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            // Удаляем файлы старше 10-го по счету
            if (backupFiles.length > 10) {
                const filesToDelete = backupFiles.slice(10);
                filesToDelete.forEach(file => {
                    try {
                        fs.unlinkSync(file.path);
                    } catch (error) {
                        console.warn(`⚠️ Не удалось удалить старый бэкап ${file.name}:`, error);
                    }
                });
            }

        } catch (error) {
            console.warn('⚠️ Ошибка при очистке бэкапов:', error);
        }
    }

    /**
     * Получить статистику по файлу состояния
     */
    static async getStateFileStats(filePath?: string): Promise<{
        exists: boolean;
        size?: number;
        lastModified?: Date;
        version?: string;
        accountsCount?: number;
        totalComments?: number;
    }> {
        const targetPath = filePath || this.DEFAULT_STATE_FILE;

        if (!fs.existsSync(targetPath)) {
            return { exists: false };
        }

        try {
            const stats = fs.statSync(targetPath);
            const loadResult = await this.loadState(filePath);

            const result: any = {
                exists: true,
                size: stats.size,
                lastModified: stats.mtime
            };

            if (loadResult.success && loadResult.data) {
                result.version = loadResult.data.version;
                result.accountsCount = loadResult.data.accounts.length;
                result.totalComments = loadResult.data.rotationState.totalCommentsPosted;
            }

            return result;

        } catch (error) {
            return {
                exists: true,
                size: 0
            };
        }
    }

    /**
     * Сбросить файл состояния
     */
    static async resetStateFile(filePath?: string): Promise<{ success: boolean; error?: string }> {
        const targetPath = filePath || this.DEFAULT_STATE_FILE;

        try {
            if (fs.existsSync(targetPath)) {
                // Создаем бэкап перед удалением
                await this.createBackup(targetPath);
                fs.unlinkSync(targetPath);
            }

            return { success: true };

        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Получить список доступных бэкапов
     */
    static getBackupsList(): { filename: string; date: Date; size: number }[] {
        try {
            if (!fs.existsSync(this.BACKUP_DIRECTORY)) {
                return [];
            }

            return fs.readdirSync(this.BACKUP_DIRECTORY)
                .filter(file => file.startsWith('rotation-state-backup-') && file.endsWith('.json'))
                .map(file => {
                    const filePath = path.join(this.BACKUP_DIRECTORY, file);
                    const stats = fs.statSync(filePath);
                    return {
                        filename: file,
                        date: stats.mtime,
                        size: stats.size
                    };
                })
                .sort((a, b) => b.date.getTime() - a.date.getTime());

        } catch (error) {
            console.warn('⚠️ Ошибка при получении списка бэкапов:', error);
            return [];
        }
    }
}
