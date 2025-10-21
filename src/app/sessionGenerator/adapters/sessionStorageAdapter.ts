/**
 * Адаптер для хранения сессий в файловой системе
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import * as path from 'path';
import { ISessionStorage, ISessionGenerationResult } from '../interfaces';
import {
    saveSessionToFile,
    loadSessionFromFile,
    getSessionFiles,
    deleteSessionFile,
    generateSessionFilename,
    ensureDirectoryExists
} from '../parts';

export class SessionStorageAdapter implements ISessionStorage {
    private readonly p_storageDirectory: string;

    constructor(storageDirectory: string = './data/accounts/sessions') {
        this.p_storageDirectory = storageDirectory;
        ensureDirectoryExists(this.p_storageDirectory);
    }

    /**
     * Сохранение сессии в файл
     */
    async saveSession(
        _result: ISessionGenerationResult,
        _filename?: string
    ): Promise<string> {
        try {
            const filename = _filename || generateSessionFilename(_result.phoneNumber, _result.generatedAt);
            const filePath = path.join(this.p_storageDirectory, filename);

            saveSessionToFile(_result, filePath);

            return filename;
        } catch (error) {
            throw new Error(`Ошибка сохранения сессии: ${error}`);
        }
    }

    /**
     * Загрузка сессии из файла
     */
    async loadSession(_filename: string): Promise<ISessionGenerationResult> {
        try {
            const filePath = path.join(this.p_storageDirectory, _filename);
            return loadSessionFromFile(filePath);
        } catch (error) {
            throw new Error(`Ошибка загрузки сессии: ${error}`);
        }
    }

    /**
     * Получение списка всех сессий
     */
    async listSessions(): Promise<string[]> {
        try {
            const sessionFiles = getSessionFiles(this.p_storageDirectory);
            return sessionFiles.map(filePath => path.basename(filePath));
        } catch (error) {
            console.warn(`Предупреждение при получении списка сессий: ${error}`);
            return [];
        }
    }

    /**
     * Удаление сессии
     */
    async deleteSession(_filename: string): Promise<boolean> {
        try {
            const filePath = path.join(this.p_storageDirectory, _filename);
            return deleteSessionFile(filePath);
        } catch (error) {
            console.error(`Ошибка удаления сессии ${_filename}: ${error}`);
            return false;
        }
    }

    /**
     * Получение информации о хранилище
     */
    getStorageInfo(): { directory: string; totalSessions: number } {
        const sessionFiles = getSessionFiles(this.p_storageDirectory);
        return {
            directory: this.p_storageDirectory,
            totalSessions: sessionFiles.length
        };
    }

    /**
     * Очистка всех сессий (с подтверждением)
     */
    async clearAllSessions(): Promise<number> {
        try {
            const sessionFiles = getSessionFiles(this.p_storageDirectory);
            let deletedCount = 0;

            for (const filePath of sessionFiles) {
                if (deleteSessionFile(filePath)) {
                    deletedCount++;
                }
            }

            return deletedCount;
        } catch (error) {
            throw new Error(`Ошибка очистки сессий: ${error}`);
        }
    }
} 