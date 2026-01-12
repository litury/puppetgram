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

    constructor(envPath?: string) {
        this.envPath = envPath || path.join(process.cwd(), '.env');
    }

    public parseAccounts(): Account[] {
        // Загружаем переменные окружения
        dotenv.config({ path: this.envPath });

        const accounts: Account[] = [];

        // Ищем все SESSION_STRING_* переменные
        for (const [key, value] of Object.entries(process.env)) {
            if (key.startsWith('SESSION_STRING_') && value) {
                // Извлекаем суффикс (например, "1", "USA_1", "PROFILE_2")
                const suffix = key.replace('SESSION_STRING_', '');

                // Получаем username и password по тому же суффиксу
                const username = process.env[`USERNAME_${suffix}`];
                const password = process.env[`PASSWORD_${suffix}`];

                // Имя аккаунта = username без @ или суффикс
                const name = username ? username.replace('@', '') : `Account_${suffix}`;

                accounts.push({
                    name,
                    sessionKey: key,
                    sessionValue: value,
                    username,
                    password
                });
            }
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