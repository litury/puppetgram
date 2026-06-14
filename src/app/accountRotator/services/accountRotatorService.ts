/**
 * Основной сервис ротации аккаунтов для автоматического комментирования
 * Управляет переключением между аккаунтами после достижения лимита комментариев
 */

import { createLogger } from '../../../shared/utils/logger';
import {
    IAccountInfo,
    IRotationState,
    IRotationConfig,
    IRotationResult,
    IAccountRotationSummary,
    IAccountRotator
} from '../interfaces/IAccountRotator';
import { EnvAccountsParser, Account } from '../../../shared/utils/envAccountsParser';
import * as fs from 'fs';
import * as path from 'path';

const log = createLogger('AccountRotator');

export class AccountRotatorService implements IAccountRotator {
    private accounts: IAccountInfo[] = [];
    private currentAccountIndex: number = 0;
    private rotationState: IRotationState;
    private config: IRotationConfig;
    private rotationCount: number = 0;
    private sessionStartTime: Date;

    constructor(_config?: Partial<IRotationConfig>) {
        this.sessionStartTime = new Date();

        // Конфигурация по умолчанию
        this.config = {
            delayBetweenRotations: 5, // 5 секунд между ротациями
            resetCountersDaily: true,
            saveProgress: true,
            progressFilePath: './rotation-state.json',
            ..._config
        };

        // Инициализация состояния ротации
        this.rotationState = {
            currentAccountIndex: 0,
            totalAccounts: 0,
            totalCommentsPosted: 0,
            sessionStartTime: this.sessionStartTime,
            cycleCount: 0,
            isRotationEnabled: true
        };

        this.initializeAccounts();
    }

    /**
     * Инициализация аккаунтов из переменных окружения
     */
    private initializeAccounts(): void {
        log.info('>> SYS ACCOUNT_ROTATION_MODULE :: ONLINE');

        const parser = new EnvAccountsParser();
        const envAccounts = parser.getAvailableAccounts();

        // Пустой env не фатален — пул может прийти из БД (loadCommenterPool переопределит accounts).
        if (envAccounts.length === 0) {
            log.warn('Нет аккаунтов в env — ожидаем пул из БД');
            this.accounts = [];
            this.rotationState.totalAccounts = 0;
            this.rotationState.currentAccountIndex = 0;
            return;
        }

        // Преобразуем аккаунты из env в формат для ротации
        this.accounts = envAccounts.map((account: Account, index: number) => {
            // Получаем дополнительную информацию из env переменных
            const sessionNumber = account.sessionKey.replace('SESSION_STRING_', '');
            const username = process.env[`USERNAME_${sessionNumber}`];
            const password = process.env[`PASSWORD_${sessionNumber}`];
            const userId = process.env[`USER_ID_${sessionNumber}`];

            return {
                sessionKey: account.sessionKey,
                sessionValue: account.sessionValue || '',
                name: account.name,
                username: username ? username.replace('@', '') : undefined,
                userId: userId,
                password: password,
                commentsCount: 0,
                isActive: index === 0, // Первый аккаунт активен по умолчанию
                lastUsed: undefined,
            } as IAccountInfo;
        });

        this.rotationState.totalAccounts = this.accounts.length;
        this.rotationState.currentAccountIndex = 0;

        log.info(`   DAT │ ACCOUNTS_LOADED: ${this.accounts.length}`);
    }

    /**
     * Получить текущий активный аккаунт
     */
    getCurrentAccount(): IAccountInfo {
        return this.accounts[this.currentAccountIndex];
    }

    /**
     * Выполнить ротацию к следующему аккаунту (по флуду/спаму — лимита по счёту нет)
     */
    async rotateToNextAccount(): Promise<IRotationResult> {
        const previousAccount = this.getCurrentAccount();

        // Защита от ротации при одном аккаунте
        if (this.accounts.length <= 1) {
            log.warn(`⚠️ Невозможно выполнить ротацию: доступен только 1 аккаунт`);
            return {
                success: false,
                previousAccount,
                newAccount: previousAccount,
                reason: 'Только один аккаунт доступен для ротации',
                rotationTime: new Date()
            };
        }

        previousAccount.isActive = false;
        previousAccount.lastUsed = new Date();

        // Переходим к следующему аккаунту
        this.currentAccountIndex = (this.currentAccountIndex + 1) % this.accounts.length;

        // Если прошли полный цикл, увеличиваем счетчик циклов
        if (this.currentAccountIndex === 0) {
            this.rotationState.cycleCount++;
            log.info(`🔄 Завершен цикл #${this.rotationState.cycleCount}`);
        }

        const newAccount = this.getCurrentAccount();
        newAccount.isActive = true;

        // Обновляем состояние ротации
        this.rotationState.currentAccountIndex = this.currentAccountIndex;
        this.rotationState.lastRotationTime = new Date();
        this.rotationCount++;

        const result: IRotationResult = {
            success: true,
            previousAccount,
            newAccount,
            reason: `Ротация аккаунта (${previousAccount.commentsCount} комментариев на ${previousAccount.name})`,
            rotationTime: new Date()
        };

        log.info(`🔄 Ротация выполнена: ${previousAccount.name} → ${newAccount.name}`);
        log.info(`   📊 Предыдущий аккаунт: ${previousAccount.commentsCount} комментариев`);
        log.info(`   🆕 Новый аккаунт: ${newAccount.name} (@${newAccount.username || 'неизвестно'})`);

        // Сохраняем состояние если включено
        if (this.config.saveProgress) {
            await this.saveRotationState();
        }

        // Задержка между ротациями
        if (this.config.delayBetweenRotations > 0) {
            log.info(`⏳ Задержка между ротациями: ${this.config.delayBetweenRotations}с...`);
            await new Promise(resolve => setTimeout(resolve, this.config.delayBetweenRotations * 1000));
        }

        return result;
    }

    /**
     * Увеличить счетчик комментариев для текущего аккаунта
     */
    incrementCommentCount(): void {
        const currentAccount = this.getCurrentAccount();
        currentAccount.commentsCount++;
        this.rotationState.totalCommentsPosted++;

        log.info(`📈 ${currentAccount.name}: ${currentAccount.commentsCount} комментариев`);
    }

    /**
     * Получить статус ротации
     */
    getRotationState(): IRotationState {
        return { ...this.rotationState };
    }

    /**
     * Получить итоговую статистику
     */
    getRotationSummary(): IAccountRotationSummary {
        const sessionDuration = new Date().getTime() - this.sessionStartTime.getTime();
        const usedAccounts = this.accounts.filter(acc => acc.commentsCount > 0).length;

        return {
            totalAccountsUsed: usedAccounts,
            totalCommentsPosted: this.rotationState.totalCommentsPosted,
            totalRotations: this.rotationCount,
            sessionDuration,
            averageCommentsPerAccount: usedAccounts > 0 ? this.rotationState.totalCommentsPosted / usedAccounts : 0,
            completeCycles: this.rotationState.cycleCount
        };
    }

    /**
     * Сохранить состояние ротации
     */
    async saveRotationState(): Promise<void> {
        if (!this.config.progressFilePath || !this.config.saveProgress) {
            return;
        }

        try {
            const stateData = {
                rotationState: this.rotationState,
                accounts: this.accounts.map(acc => ({
                    ...acc,
                    // Не сохраняем sessionValue в файл по безопасности
                    sessionValue: '[PROTECTED]'
                })),
                currentAccountIndex: this.currentAccountIndex,
                rotationCount: this.rotationCount,
                config: this.config,
                lastSaved: new Date().toISOString()
            };

            const dir = path.dirname(this.config.progressFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(this.config.progressFilePath, JSON.stringify(stateData, null, 2), 'utf-8');
            log.info(`💾 Состояние ротации сохранено: ${this.config.progressFilePath}`);
        } catch (error) {
            log.warn(`⚠️ Не удалось сохранить состояние ротации:`, { error });
        }
    }

    /**
     * Загрузить состояние ротации
     */
    async loadRotationState(): Promise<void> {
        if (!this.config.progressFilePath || !fs.existsSync(this.config.progressFilePath)) {
            log.info('📁 Файл состояния ротации не найден, начинаем с нуля');
            return;
        }

        try {
            const fileContent = fs.readFileSync(this.config.progressFilePath, 'utf-8');
            const stateData = JSON.parse(fileContent);

            // Восстанавливаем только безопасные данные
            if (stateData.rotationState) {
                this.rotationState = {
                    ...stateData.rotationState,
                    sessionStartTime: new Date(stateData.rotationState.sessionStartTime),
                    lastRotationTime: stateData.rotationState.lastRotationTime ?
                        new Date(stateData.rotationState.lastRotationTime) : undefined
                };
            }

            if (stateData.currentAccountIndex !== undefined) {
                this.currentAccountIndex = stateData.currentAccountIndex;
            }

            if (stateData.rotationCount !== undefined) {
                this.rotationCount = stateData.rotationCount;
            }

            // Восстанавливаем счетчики комментариев (но не sessionValue!)
            if (stateData.accounts && Array.isArray(stateData.accounts)) {
                stateData.accounts.forEach((savedAccount: any, index: number) => {
                    if (this.accounts[index] && savedAccount.sessionKey === this.accounts[index].sessionKey) {
                        this.accounts[index].commentsCount = savedAccount.commentsCount || 0;
                        this.accounts[index].lastUsed = savedAccount.lastUsed ? new Date(savedAccount.lastUsed) : undefined;
                        this.accounts[index].isActive = index === this.currentAccountIndex;
                    }
                });
            }

            log.info(`📄 Состояние ротации загружено из ${this.config.progressFilePath}`);
            log.info(`   🔄 Текущий аккаунт: ${this.getCurrentAccount().name}`);
            log.info(`   📊 Всего комментариев: ${this.rotationState.totalCommentsPosted}`);
            log.info(`   🔁 Количество ротаций: ${this.rotationCount}`);

        } catch (error) {
            log.warn(`⚠️ Не удалось загрузить состояние ротации:`, { error });
            log.info('🆕 Начинаем с чистого состояния');
        }
    }

    /**
     * Сбросить счетчики аккаунтов
     */
    resetAccountCounters(): void {
        log.info('🔄 Сброс счетчиков аккаунтов...');

        this.accounts.forEach(account => {
            account.commentsCount = 0;
            account.isActive = false;
            account.lastUsed = undefined;
        });

        // Активируем первый аккаунт
        this.currentAccountIndex = 0;
        this.accounts[0].isActive = true;

        // Сбрасываем состояние ротации
        this.rotationState.totalCommentsPosted = 0;
        this.rotationState.currentAccountIndex = 0;
        this.rotationState.cycleCount = 0;
        this.rotationState.lastRotationTime = undefined;

        this.rotationCount = 0;
        this.sessionStartTime = new Date();
        this.rotationState.sessionStartTime = this.sessionStartTime;

        log.info('✅ Счетчики сброшены, активен первый аккаунт');
    }

    /**
     * Получить все доступные аккаунты
     */
    getAllAccounts(): IAccountInfo[] {
        return [...this.accounts]; // Возвращаем копию массива
    }

    /**
     * Установить активный аккаунт по имени
     */
    setActiveAccount(accountName: string): boolean {
        const accountIndex = this.accounts.findIndex(acc => acc.name === accountName);

        if (accountIndex === -1) {
            log.warn(`⚠️ Аккаунт с именем "${accountName}" не найден`);
            return false;
        }

        // Деактивируем текущий аккаунт
        this.accounts.forEach(acc => acc.isActive = false);

        // Активируем новый аккаунт
        this.currentAccountIndex = accountIndex;
        this.accounts[accountIndex].isActive = true;

        // Обновляем состояние ротации
        this.rotationState.currentAccountIndex = this.currentAccountIndex;

        log.info(`🎯 Активный аккаунт переключен на: ${accountName} (индекс: ${accountIndex})`);
        return true;
    }

    /**
     * Сбросить счётчик комментариев для конкретного аккаунта
     */
    resetAccountComments(accountName: string): void {
        const account = this.accounts.find(acc => acc.name === accountName);
        if (account) {
            const oldCount = account.commentsCount;
            account.commentsCount = 0;
            log.info(`🔄 Счётчик комментариев сброшен: ${accountName} (было: ${oldCount}, стало: 0)`);
        } else {
            log.warn(`⚠️ Аккаунт "${accountName}" не найден для сброса счётчика`);
        }
    }
}
