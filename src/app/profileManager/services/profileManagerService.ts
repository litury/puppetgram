/**
 * Основной сервис для управления профилем пользователя
 * Следует стандартам компании согласно project-structure.mdc и frontend-coding-standards.mdc
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram';
import { CustomFile } from 'telegram/client/uploads';
import { computeCheck } from 'telegram/Password';
import * as crypto from 'crypto';
import { Buffer } from 'buffer';
import * as fs from 'fs';
import * as path from 'path';
import {
    IProfileUpdateRequest,
    IProfilePhotoUpdateRequest,
    IProfileUpdateResult,
    IUserProfile,
    IProfileManagerOptions,
    I2FASetupRequest,
    I2FAChangeRequest,
    I2FAStatus,
    IUsernameUpdateRequest
} from '../interfaces';
import {
    validateUsername,
    normalizeUsername,
    validateBio,
    validateName,
    validateImageFile,
    formatTelegramError,
    generateOperationId,
    maskSessionString,
    validate2FAPassword,
    validate2FAHint,
    generateDefault2FAPassword,
    generateDefault2FAHint,
    mask2FAPassword
} from '../parts';

export class ProfileManagerService implements IProfileManager {

    /**
     * Обновление username пользователя
     */
    async updateUsernameAsync(_request: IUsernameUpdateRequest, _options?: IProfileManagerOptions): Promise<IProfileUpdateResult> {
        const operationId = generateOperationId();
        let client: TelegramClient | null = null;

        try {
            console.log(`🔄 [${operationId}] Начинается обновление username...`);
            console.log(`📊 [${operationId}] Сессия: ${maskSessionString(_request.sessionString)}`);
            console.log(`👤 [${operationId}] Новый username: @${_request.newUsername}`);

            // Валидация username
            const validation = validateUsername(_request.newUsername);
            if (!validation.isValid) {
                return {
                    success: false,
                    error: validation.error,
                    details: 'Ошибка валидации username'
                };
            }

            // Нормализация username
            const normalizedUsername = normalizeUsername(_request.newUsername);

            // Создание клиента
            console.log(`📋 [${operationId}] Шаг 1: Создание клиента Telegram...`);
            const apiId = Number(process.env.API_ID);
            const apiHash = process.env.API_HASH;

            if (!apiId || !apiHash) {
                throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
            }

            const session = new StringSession(_request.sessionString);
            client = new TelegramClient(
                session,
                apiId,
                apiHash,
                {
                    connectionRetries: _options?.retryAttempts || 3,
                    timeout: _options?.timeout || 15000,
                }
            );

            await client.connect();

            if (!await client.isUserAuthorized()) {
                throw new Error("Сессия недействительна или истекла");
            }

            // Проверка доступности username
            console.log(`📋 [${operationId}] Шаг 2: Проверка доступности username...`);
            const isAvailable = await this.checkUsernameAvailabilityAsync(normalizedUsername, _request.sessionString);

            if (!isAvailable) {
                return {
                    success: false,
                    error: `Username @${normalizedUsername} уже занят`,
                    details: 'Username недоступен'
                };
            }

            // Обновление username
            console.log(`📋 [${operationId}] Шаг 3: Обновление username...`);
            await client.invoke(new Api.account.UpdateUsername({
                username: normalizedUsername
            }));

            // Получение обновленной информации о профиле
            console.log(`📋 [${operationId}] Шаг 4: Получение обновленной информации о профиле...`);
            const updatedProfile = await this.getProfileInfoAsync(_request.sessionString);

            await client.disconnect();

            console.log(`✅ [${operationId}] Username успешно обновлен!`);

            return {
                success: true,
                profileInfo: updatedProfile,
                details: `Username обновлен на @${normalizedUsername}`
            };

        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn(`⚠️ [${operationId}] Предупреждение при отключении клиента:`, disconnectError);
                }
            }

            const errorMessage = formatTelegramError(error);
            console.error(`❌ [${operationId}] Ошибка при обновлении username:`, errorMessage);

            return {
                success: false,
                error: errorMessage,
                details: 'Ошибка при обновлении username'
            };
        }
    }

    /**
     * Обновление основной информации профиля
     */
    async updateProfileAsync(_request: IProfileUpdateRequest, _options?: IProfileManagerOptions): Promise<IProfileUpdateResult> {
        const operationId = generateOperationId();
        let client: TelegramClient | null = null;

        try {
            console.log(`🔄 [${operationId}] Начинается обновление профиля...`);
            console.log(`📊 [${operationId}] Сессия: ${maskSessionString(_request.sessionString)}`);

            // Валидация данных
            if (_request.firstName) {
                const firstNameValidation = validateName(_request.firstName);
                if (!firstNameValidation.isValid) {
                    return {
                        success: false,
                        error: `Ошибка валидации имени: ${firstNameValidation.error}`,
                        details: 'Ошибка валидации имени'
                    };
                }
            }

            if (_request.lastName) {
                const lastNameValidation = validateName(_request.lastName);
                if (!lastNameValidation.isValid) {
                    return {
                        success: false,
                        error: `Ошибка валидации фамилии: ${lastNameValidation.error}`,
                        details: 'Ошибка валидации фамилии'
                    };
                }
            }

            if (_request.bio) {
                const bioValidation = validateBio(_request.bio);
                if (!bioValidation.isValid) {
                    return {
                        success: false,
                        error: `Ошибка валидации bio: ${bioValidation.error}`,
                        details: 'Ошибка валидации описания профиля'
                    };
                }
            }

            // Создание клиента
            const apiId = Number(process.env.API_ID);
            const apiHash = process.env.API_HASH;

            if (!apiId || !apiHash) {
                throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
            }

            const session = new StringSession(_request.sessionString);
            client = new TelegramClient(
                session,
                apiId,
                apiHash,
                {
                    connectionRetries: _options?.retryAttempts || 3,
                    timeout: _options?.timeout || 15000,
                }
            );

            await client.connect();

            if (!await client.isUserAuthorized()) {
                throw new Error("Сессия недействительна или истекла");
            }

            // Обновление имени и фамилии
            if (_request.firstName !== undefined || _request.lastName !== undefined) {
                console.log(`📋 [${operationId}] Обновление имени...`);
                await client.invoke(new Api.account.UpdateProfile({
                    firstName: _request.firstName || '',
                    lastName: _request.lastName || ''
                }));
            }

            // Обновление bio
            if (_request.bio !== undefined) {
                console.log(`📋 [${operationId}] Обновление описания профиля...`);
                await client.invoke(new Api.account.UpdateProfile({
                    about: _request.bio
                }));
            }

            // Получение обновленной информации о профиле
            const updatedProfile = await this.getProfileInfoAsync(_request.sessionString);

            await client.disconnect();

            console.log(`✅ [${operationId}] Профиль успешно обновлен!`);

            return {
                success: true,
                profileInfo: updatedProfile,
                details: 'Профиль успешно обновлен'
            };

        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn(`⚠️ [${operationId}] Предупреждение при отключении клиента:`, disconnectError);
                }
            }

            const errorMessage = formatTelegramError(error);
            console.error(`❌ [${operationId}] Ошибка при обновлении профиля:`, errorMessage);

            return {
                success: false,
                error: errorMessage,
                details: 'Ошибка при обновлении профиля'
            };
        }
    }

    /**
     * Обновление фото профиля
     */
    async updateProfilePhotoAsync(_request: IProfilePhotoUpdateRequest, _options?: IProfileManagerOptions): Promise<IProfileUpdateResult> {
        const operationId = generateOperationId();
        let client: TelegramClient | null = null;

        try {
            console.log(`🔄 [${operationId}] Начинается обновление фото профиля...`);
            console.log(`📊 [${operationId}] Сессия: ${maskSessionString(_request.sessionString)}`);
            console.log(`📸 [${operationId}] Файл изображения: ${_request.photoPath}`);

            // Валидация файла изображения
            const fileValidation = validateImageFile(_request.photoPath);
            if (!fileValidation.isValid) {
                return {
                    success: false,
                    error: fileValidation.error,
                    details: 'Ошибка валидации файла изображения'
                };
            }

            // Создание клиента
            const apiId = Number(process.env.API_ID);
            const apiHash = process.env.API_HASH;

            if (!apiId || !apiHash) {
                throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
            }

            const session = new StringSession(_request.sessionString);
            client = new TelegramClient(
                session,
                apiId,
                apiHash,
                {
                    connectionRetries: _options?.retryAttempts || 3,
                    timeout: _options?.timeout || 30000, // Увеличенный таймаут для загрузки файла
                }
            );

            await client.connect();

            if (!await client.isUserAuthorized()) {
                throw new Error("Сессия недействительна или истекла");
            }

            // Загрузка и установка фото профиля
            console.log(`📋 [${operationId}] Загрузка изображения...`);

            const fileBuffer = fs.readFileSync(_request.photoPath);
            const fileName = path.basename(_request.photoPath);

            const customFile = new CustomFile(
                fileName,
                fileBuffer.length,
                _request.photoPath,
                fileBuffer
            );

            const uploadedFile = await client.uploadFile({
                file: customFile,
                workers: 1
            });

            console.log(`📋 [${operationId}] Установка фото профиля...`);
            await client.invoke(new Api.photos.UploadProfilePhoto({
                file: uploadedFile
            }));

            // Получение обновленной информации о профиле
            const updatedProfile = await this.getProfileInfoAsync(_request.sessionString);

            await client.disconnect();

            console.log(`✅ [${operationId}] Фото профиля успешно обновлено!`);

            return {
                success: true,
                profileInfo: updatedProfile,
                details: 'Фото профиля успешно обновлено'
            };

        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn(`⚠️ [${operationId}] Предупреждение при отключении клиента:`, disconnectError);
                }
            }

            const errorMessage = formatTelegramError(error);
            console.error(`❌ [${operationId}] Ошибка при обновлении фото профиля:`, errorMessage);

            return {
                success: false,
                error: errorMessage,
                details: 'Ошибка при обновлении фото профиля'
            };
        }
    }

    /**
     * Получение текущей информации о профиле
     */
    async getProfileInfoAsync(_sessionString: string): Promise<IUserProfile> {
        let client: TelegramClient | null = null;

        try {
            const apiId = Number(process.env.API_ID);
            const apiHash = process.env.API_HASH;

            if (!apiId || !apiHash) {
                throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
            }

            const session = new StringSession(_sessionString);
            client = new TelegramClient(
                session,
                apiId,
                apiHash,
                {
                    connectionRetries: 3,
                    timeout: 15000,
                }
            );

            await client.connect();

            if (!await client.isUserAuthorized()) {
                throw new Error("Сессия недействительна или истекла");
            }

            const me = await client.getMe() as Api.User;
            await client.disconnect();

            return {
                userId: me.id?.toJSNumber() || 0,
                username: me.username || undefined,
                firstName: me.firstName || undefined,
                lastName: me.lastName || undefined,
                bio: undefined, // Bio нужно получать отдельным запросом
                phoneNumber: me.phone || undefined,
                profilePhotoUrl: undefined, // URL фото нужно формировать отдельно
                isPremium: me.premium || false,
                isVerified: me.verified || false,
            };

        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn("Предупреждение при отключении клиента:", disconnectError);
                }
            }

            throw new Error(`Ошибка получения информации о профиле: ${formatTelegramError(error)}`);
        }
    }

    /**
     * Проверка доступности username
     */
    async checkUsernameAvailabilityAsync(_username: string, _sessionString: string): Promise<boolean> {
        let client: TelegramClient | null = null;

        try {
            const normalizedUsername = normalizeUsername(_username);

            const apiId = Number(process.env.API_ID);
            const apiHash = process.env.API_HASH;

            if (!apiId || !apiHash) {
                throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
            }

            const session = new StringSession(_sessionString);
            client = new TelegramClient(
                session,
                apiId,
                apiHash,
                {
                    connectionRetries: 3,
                    timeout: 15000,
                }
            );

            await client.connect();

            if (!await client.isUserAuthorized()) {
                throw new Error("Сессия недействительна или истекла");
            }

            // Проверяем доступность через checkUsername
            const result = await client.invoke(new Api.account.CheckUsername({
                username: normalizedUsername
            }));

            await client.disconnect();

            return result; // true если доступен, false если занят

        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn("Предупреждение при отключении клиента:", disconnectError);
                }
            }

            // Если произошла ошибка, считаем что username недоступен
            console.warn(`Ошибка при проверке доступности username: ${formatTelegramError(error)}`);
            return false;
        }
    }

    /**
     * Установка пароля двухфакторной аутентификации
     */
    async setup2FAAsync(_request: I2FASetupRequest, _options?: IProfileManagerOptions): Promise<IProfileUpdateResult> {
        const operationId = generateOperationId();
        let client: TelegramClient | null = null;

        try {
            console.log(`🔄 [${operationId}] Начинается установка пароля 2FA...`);
            console.log(`📊 [${operationId}] Сессия: ${maskSessionString(_request.sessionString)}`);
            console.log(`🔐 [${operationId}] Пароль: ${mask2FAPassword(_request.password)}`);

            // Валидация пароля
            const passwordValidation = validate2FAPassword(_request.password);
            if (!passwordValidation.isValid) {
                return {
                    success: false,
                    error: passwordValidation.error,
                    details: 'Ошибка валидации пароля 2FA'
                };
            }

            // Валидация подсказки
            if (_request.hint) {
                const hintValidation = validate2FAHint(_request.hint);
                if (!hintValidation.isValid) {
                    return {
                        success: false,
                        error: hintValidation.error,
                        details: 'Ошибка валидации подсказки'
                    };
                }
            }

            // Создание клиента
            const apiId = Number(process.env.API_ID);
            const apiHash = process.env.API_HASH;

            if (!apiId || !apiHash) {
                throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
            }

            const session = new StringSession(_request.sessionString);
            client = new TelegramClient(
                session,
                apiId,
                apiHash,
                {
                    connectionRetries: _options?.retryAttempts || 3,
                    timeout: _options?.timeout || 15000,
                }
            );

            await client.connect();

            if (!await client.isUserAuthorized()) {
                throw new Error("Сессия недействительна или истекла");
            }

            // Установка пароля 2FA
            console.log(`📋 [${operationId}] Установка пароля 2FA...`);

            // Получаем текущие настройки пароля
            const passwordInfo = await client.invoke(new Api.account.GetPassword());

            // Создаем новый алгоритм с модифицированной солью и хеш пароля
            const { newAlgo, newPasswordHash } = this.createNewPasswordAlgoAndHash(_request.password, passwordInfo.newAlgo);

            await client.invoke(new Api.account.UpdatePasswordSettings({
                password: new Api.InputCheckPasswordEmpty(),
                newSettings: new Api.account.PasswordInputSettings({
                    newAlgo: newAlgo,
                    newPasswordHash: newPasswordHash,
                    hint: _request.hint || generateDefault2FAHint()
                })
            }));

            await client.disconnect();

            console.log(`✅ [${operationId}] Пароль 2FA успешно установлен!`);

            return {
                success: true,
                details: 'Пароль 2FA установлен успешно'
            };

        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn(`⚠️ [${operationId}] Предупреждение при отключении клиента:`, disconnectError);
                }
            }

            const errorMessage = formatTelegramError(error);
            console.error(`❌ [${operationId}] Ошибка при установке пароля 2FA:`, errorMessage);

            return {
                success: false,
                error: errorMessage,
                details: 'Ошибка при установке пароля 2FA'
            };
        }
    }

    /**
     * Изменение пароля двухфакторной аутентификации
     */
    async change2FAAsync(_request: I2FAChangeRequest, _options?: IProfileManagerOptions): Promise<IProfileUpdateResult> {
        const operationId = generateOperationId();
        let client: TelegramClient | null = null;

        try {
            console.log(`🔄 [${operationId}] Начинается изменение пароля 2FA...`);
            console.log(`📊 [${operationId}] Сессия: ${maskSessionString(_request.sessionString)}`);

            // Валидация нового пароля
            const passwordValidation = validate2FAPassword(_request.newPassword);
            if (!passwordValidation.isValid) {
                return {
                    success: false,
                    error: passwordValidation.error,
                    details: 'Ошибка валидации нового пароля 2FA'
                };
            }

            // Создание клиента
            const apiId = Number(process.env.API_ID);
            const apiHash = process.env.API_HASH;

            if (!apiId || !apiHash) {
                throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
            }

            const session = new StringSession(_request.sessionString);
            client = new TelegramClient(
                session,
                apiId,
                apiHash,
                {
                    connectionRetries: _options?.retryAttempts || 3,
                    timeout: _options?.timeout || 15000,
                }
            );

            await client.connect();

            if (!await client.isUserAuthorized()) {
                throw new Error("Сессия недействительна или истекла");
            }

            // Изменение пароля 2FA
            console.log(`📋 [${operationId}] Изменение пароля 2FA...`);

            // Создаем правильный SRP пароль
            const srpPassword = await this.createSrpPasswordAsync(client, _request.currentPassword);

            // Получаем информацию о текущем алгоритме для создания нового хеша
            const passwordInfo = await client.invoke(new Api.account.GetPassword());
            const { newAlgo, newPasswordHash } = this.createNewPasswordAlgoAndHash(_request.newPassword, passwordInfo.newAlgo);

            await client.invoke(new Api.account.UpdatePasswordSettings({
                password: srpPassword,
                newSettings: new Api.account.PasswordInputSettings({
                    newAlgo: newAlgo,
                    newPasswordHash: newPasswordHash,
                    hint: _request.hint || generateDefault2FAHint()
                })
            }));

            await client.disconnect();

            console.log(`✅ [${operationId}] Пароль 2FA успешно изменен!`);

            return {
                success: true,
                details: 'Пароль 2FA изменен успешно'
            };

        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn(`⚠️ [${operationId}] Предупреждение при отключении клиента:`, disconnectError);
                }
            }

            const errorMessage = formatTelegramError(error);
            console.error(`❌ [${operationId}] Ошибка при изменении пароля 2FA:`, errorMessage);

            return {
                success: false,
                error: errorMessage,
                details: 'Ошибка при изменении пароля 2FA'
            };
        }
    }

    /**
     * Получение статуса двухфакторной аутентификации
     */
    async get2FAStatusAsync(_sessionString: string): Promise<I2FAStatus> {
        let client: TelegramClient | null = null;

        try {
            const apiId = Number(process.env.API_ID);
            const apiHash = process.env.API_HASH;

            if (!apiId || !apiHash) {
                throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
            }

            const session = new StringSession(_sessionString);
            client = new TelegramClient(
                session,
                apiId,
                apiHash,
                {
                    connectionRetries: 3,
                    timeout: 15000,
                }
            );

            await client.connect();

            if (!await client.isUserAuthorized()) {
                throw new Error("Сессия недействительна или истекла");
            }

            const passwordInfo = await client.invoke(new Api.account.GetPassword());
            await client.disconnect();

            return {
                isEnabled: passwordInfo.hasPassword || false,
                hint: passwordInfo.hint || undefined,
                recoveryEmail: passwordInfo.emailUnconfirmedPattern || undefined
            };

        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn("Предупреждение при отключении клиента:", disconnectError);
                }
            }

            throw new Error(`Ошибка получения статуса 2FA: ${formatTelegramError(error)}`);
        }
    }

    /**
     * Отключение двухфакторной аутентификации
     */
    async disable2FAAsync(_sessionString: string, _currentPassword: string): Promise<IProfileUpdateResult> {
        const operationId = generateOperationId();
        let client: TelegramClient | null = null;

        try {
            console.log(`🔄 [${operationId}] Начинается отключение 2FA...`);
            console.log(`📊 [${operationId}] Сессия: ${maskSessionString(_sessionString)}`);

            const apiId = Number(process.env.API_ID);
            const apiHash = process.env.API_HASH;

            if (!apiId || !apiHash) {
                throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
            }

            const session = new StringSession(_sessionString);
            client = new TelegramClient(
                session,
                apiId,
                apiHash,
                {
                    connectionRetries: 3,
                    timeout: 15000,
                }
            );

            await client.connect();

            if (!await client.isUserAuthorized()) {
                throw new Error("Сессия недействительна или истекла");
            }

            // Отключение 2FA
            console.log(`📋 [${operationId}] Отключение 2FA...`);

            // Создаем правильный SRP пароль
            const srpPassword = await this.createSrpPasswordAsync(client, _currentPassword);

            await client.invoke(new Api.account.UpdatePasswordSettings({
                password: srpPassword,
                newSettings: new Api.account.PasswordInputSettings({})
            }));

            await client.disconnect();

            console.log(`✅ [${operationId}] 2FA успешно отключена!`);

            return {
                success: true,
                details: '2FA отключена успешно'
            };

        } catch (error) {
            if (client) {
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    console.warn(`⚠️ [${operationId}] Предупреждение при отключении клиента:`, disconnectError);
                }
            }

            const errorMessage = formatTelegramError(error);
            console.error(`❌ [${operationId}] Ошибка при отключении 2FA:`, errorMessage);

            return {
                success: false,
                error: errorMessage,
                details: 'Ошибка при отключении 2FA'
            };
        }
    }

    /**
     * Создает правильный SRP пароль для 2FA аутентификации
     * @param _client - Telegram клиент
     * @param _password - пароль пользователя
     * @returns Promise с InputCheckPasswordSRP
     */
    private async createSrpPasswordAsync(_client: TelegramClient, _password: string): Promise<Api.InputCheckPasswordSRP> {
        try {
            // Получаем данные пароля
            const passwordData = await _client.invoke(new Api.account.GetPassword());

            // Проверяем, что 2FA настроена
            if (!passwordData.currentAlgo || !passwordData.srp_B || !passwordData.srpId) {
                throw new Error("2FA не настроена для этого аккаунта");
            }

            // Используем встроенную функцию GramJS для создания правильного SRP
            const srpPassword = await computeCheck(passwordData, _password);
            return srpPassword;

        } catch (error) {
            throw new Error(`Ошибка создания SRP пароля: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
        }
    }

    /**
 * Создает новый алгоритм с модифицированной солью и хеш пароля для установки 2FA
 * @param _password - новый пароль
 * @param _algo - базовый алгоритм KDF от сервера
 * @returns объект с новым алгоритмом и хешем пароля
 */
    private createNewPasswordAlgoAndHash(_password: string, _algo: any): { newAlgo: any, newPasswordHash: Buffer } {
        try {
            // Согласно документации Telegram API
            const baseAlgo = _algo as Api.PasswordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow;

            // ВАЖНО: Добавляем 32 случайных байта к salt1 согласно документации
            // "just append 32 sufficiently random bytes to the salt1, first"
            const randomBytes = crypto.randomBytes(32);
            const newSalt1 = Buffer.concat([baseAlgo.salt1, randomBytes]);

            // Создаем новый алгоритм с модифицированной солью
            const newAlgo = new Api.PasswordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow({
                salt1: newSalt1,
                salt2: baseAlgo.salt2,
                g: baseAlgo.g,
                p: baseAlgo.p
            });

            // Реализуем функции из документации
            const H = (data: Buffer): Buffer => crypto.createHash('sha256').update(data).digest();
            const SH = (data: Buffer, salt: Buffer): Buffer => H(Buffer.concat([salt, data, salt]));

            // PH1(password, salt1, salt2) := SH(SH(password, salt1), salt2)
            const passwordBuffer = Buffer.from(_password, 'utf8');
            const ph1 = SH(SH(passwordBuffer, newSalt1), baseAlgo.salt2);

            // PH2(password, salt1, salt2) := SH(pbkdf2(sha512, PH1(password, salt1, salt2), salt1, 100000), salt2)
            const pbkdf2Result = crypto.pbkdf2Sync(ph1, newSalt1, 100000, 64, 'sha512');
            const ph2 = SH(pbkdf2Result, baseAlgo.salt2);

            // x := PH2(password, salt1, salt2)
            const x = ph2;

            // Преобразуем в BigInt для математических операций
            const xBigInt = BigInt('0x' + x.toString('hex'));
            const gBigInt = BigInt(baseAlgo.g);
            const pBigInt = BigInt('0x' + baseAlgo.p.toString('hex'));

            // v := pow(g, x) mod p
            const v = this.modPow(gBigInt, xBigInt, pBigInt);

            // Конвертируем обратно в Buffer (2048 bits = 256 bytes)
            const vHex = v.toString(16).padStart(512, '0'); // 2048 bits = 512 hex chars
            const newPasswordHash = Buffer.from(vHex, 'hex');

            return { newAlgo, newPasswordHash };

        } catch (error) {
            throw new Error(`Ошибка создания алгоритма и хеша пароля: ${error}`);
        }
    }

    /**
     * Вычисляет (base^exponent) mod modulus для больших чисел
     */
    private modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
        if (modulus === 1n) return 0n;
        let result = 1n;
        base = base % modulus;
        while (exponent > 0n) {
            if (exponent % 2n === 1n) {
                result = (result * base) % modulus;
            }
            exponent = exponent >> 1n;
            base = (base * base) % modulus;
        }
        return result;
    }
} 