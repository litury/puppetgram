import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

export interface Account {
    name: string;
    sessionKey: string;
    sessionValue?: string;
    username?: string;
    password?: string;
    apiId?: number;
    apiHash?: string;
    session?: string;
}

export class EnvAccountsParser {
    private envPath: string;
    private envContent: string;
    
    constructor(envPath?: string) {
        this.envPath = envPath || path.join(process.cwd(), '.env');
        this.envContent = '';
    }
    
    private loadEnvFile(): void {
        try {
            this.envContent = fs.readFileSync(this.envPath, 'utf-8');
        } catch (error) {
            throw new Error(`Не удалось прочитать файл .env: ${error}`);
        }
    }
    
    public parseAccounts(): Account[] {
        this.loadEnvFile();
        const accounts: Account[] = [];
        const lines = this.envContent.split('\n');

        let currentAccountName: string | null = null;
        let currentAccount: Partial<Account> = {};

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Проверяем, является ли строка комментарием с именем аккаунта
            if (line.startsWith('###') || line.startsWith('#')) {
                // Если у нас есть текущий аккаунт, добавляем его
                if (currentAccount.sessionKey && currentAccountName) {
                    accounts.push({
                        name: currentAccountName,
                        sessionKey: currentAccount.sessionKey,
                        sessionValue: currentAccount.sessionValue,
                        username: currentAccount.username,
                        password: currentAccount.password
                    });
                }

                // Извлекаем имя аккаунта из комментария
                const nameMatch = line.replace(/^#+\s*/, '').trim();
                if (nameMatch && !nameMatch.includes('Configuration') && !nameMatch.includes('=')) {
                    currentAccountName = nameMatch;
                    currentAccount = {}; // Сбрасываем текущий аккаунт
                }
            }
            // Проверяем SESSION_STRING
            else if (line.startsWith('SESSION_STRING')) {
                const sessionMatch = line.match(/^(SESSION_STRING[^=]*)="?([^"]+)"?/);
                if (sessionMatch && currentAccountName) {
                    currentAccount.sessionKey = sessionMatch[1];
                    currentAccount.sessionValue = sessionMatch[2];
                }
            }
            // Проверяем PASSWORD
            else if (line.startsWith('PASSWORD_')) {
                const passwordMatch = line.match(/^PASSWORD_[^=]*="?([^"]+)"?/);
                if (passwordMatch && currentAccountName) {
                    currentAccount.password = passwordMatch[1];
                }
            }
            // Проверяем USERNAME
            else if (line.startsWith('USERNAME_')) {
                const usernameMatch = line.match(/^USERNAME_[^=]*="?(@?[^"]+)"?/);
                if (usernameMatch && currentAccountName) {
                    currentAccount.username = usernameMatch[1];
                }
            }
        }

        // Добавляем последний аккаунт, если он есть
        if (currentAccount.sessionKey && currentAccountName) {
            accounts.push({
                name: currentAccountName,
                sessionKey: currentAccount.sessionKey,
                sessionValue: currentAccount.sessionValue,
                username: currentAccount.username,
                password: currentAccount.password
            });
        }

        return accounts;
    }
    
    /**
     * Получить доступные аккаунты с опциональной фильтрацией по префиксу
     * @param prefix - префикс для фильтрации (например, "PROFILE" для SESSION_STRING_PROFILE_*)
     * @returns Массив доступных аккаунтов
     */
    public getAvailableAccounts(prefix?: string): Account[] {
        const accounts = this.parseAccounts();
        // Загружаем переменные окружения
        dotenv.config();

        // Фильтруем по префиксу если указан
        let filteredAccounts = accounts;
        if (prefix) {
            filteredAccounts = accounts.filter(account =>
                account.sessionKey.startsWith(`SESSION_STRING_${prefix}_`)
            );
        }

        // Фильтруем только те аккаунты, у которых есть значения в process.env
        return filteredAccounts.filter(account => {
            const envValue = process.env[account.sessionKey];
            return envValue && envValue !== '';
        }).map(account => ({
            ...account,
            sessionValue: process.env[account.sessionKey],
            session: process.env[account.sessionKey],
            apiId: parseInt(process.env.API_ID || '0'),
            apiHash: process.env.API_HASH || ''
        }));
    }
    
    public getAccountByName(name: string): Account | undefined {
        const accounts = this.getAvailableAccounts();
        return accounts.find(account => 
            account.name.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(account.name.toLowerCase())
        );
    }
    
    public getAccountBySessionKey(sessionKey: string): Account | undefined {
        const accounts = this.getAvailableAccounts();
        return accounts.find(account => account.sessionKey === sessionKey);
    }
}