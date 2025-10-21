/**
 * Сервис для конвертации TData в Session String
 * Исправляет ограничения оригинального кода и добавляет поддержку множественных аккаунтов
 * Следует стандартам компании согласно project-structure.mdc и frontend-coding-standards.mdc
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { BinaryReader } from "telegram/extensions";
import { AuthKey } from "telegram/crypto/AuthKey";
import { StringSession } from "telegram/sessions";

import {
    ITdataSessionConverter,
    ITdataConversionRequest,
    ITdataConversionResult,
    ITdataConversionOptions,
    ITdataValidationResult,
    ITdataFileInfo,
    IMultiAccountInfo,
    IAccountInfo,
    IAccountSummary
} from '../interfaces/ITdataSessionConverter';

import {
    tdesktopMd5,
    tdesktopReadBuffer,
    tdesktopDecrypt,
    tdesktopOpen,
    tdesktopOpenEncrypted,
    getServerAddress,
    generateSessionId,
    maskPath,
    formatTdataError,
    getTdesktopFileInfo
} from '../parts/tdataHelpers';

/**
 * Основной сервис конвертации TData
 */
export class TdataSessionConverterService implements ITdataSessionConverter {
    private logger = {
        info: (message: string) => console.log(message),
        warn: (message: string) => console.warn(message),
        error: (message: string) => console.error(message)
    };

    /**
     * Конвертирует TData в Session String с поддержкой множественных аккаунтов
     */
    async convertTdataToSessionAsync(_request: ITdataConversionRequest, _options?: ITdataConversionOptions): Promise<ITdataConversionResult> {
        const sessionId = generateSessionId();
        console.log(`🔄 [${sessionId}] Начинается конвертация TData...`);
        console.log(`📁 [${sessionId}] Путь: ${maskPath(_request.tdataPath)}`);

        try {
            // Валидация входных данных
            const validation = await this.validateTdataAsync(_request.tdataPath);
            if (!validation.isValid) {
                throw new Error(`Невалидная TData: ${validation.errors.join(', ')}`);
            }

            // Получение информации о множественных аккаунтах
            const multiAccountInfo = await this.getMultiAccountInfoAsync(_request.tdataPath);
            console.log(`📊 [${sessionId}] Найдено аккаунтов: ${multiAccountInfo.accountCount}`);

            const accountIndex = _request.accountIndex || 0;
            if (accountIndex >= multiAccountInfo.accountCount) {
                throw new Error(`Индекс аккаунта ${accountIndex} превышает количество доступных аккаунтов (${multiAccountInfo.accountCount})`);
            }

            // Извлечение метаданных аккаунта
            const accountMetadata = await this.extractAccountMetadataAsync(_request.tdataPath);
            const selectedAccount = accountMetadata[accountIndex] || null;

            console.log(`👤 [${sessionId}] Конвертируется аккаунт ${accountIndex}: ${selectedAccount?.phoneNumber || 'Неизвестный'}`);

            // Выполнение конвертации
            const sessionString = await this.performConversionAsync(_request, accountIndex, sessionId);

            // Создание результата
            const result: ITdataConversionResult = {
                success: true,
                sessionString,
                accountInfo: selectedAccount,
                sessionFilePath: await this.saveSessionFileAsync(sessionString, _request, selectedAccount, _options),
                jsonFilePath: _request.outputFormat === 'json' || _request.outputFormat === 'both'
                    ? await this.saveJsonFileAsync(
                        selectedAccount,
                        _request,
                        _options
                    ) : undefined,
                details: {
                    tdataPath: _request.tdataPath,
                    accountIndex,
                    accountsCount: multiAccountInfo.accountCount,
                    convertedAt: new Date()
                }
            };

            console.log(`✅ [${sessionId}] Конвертация завершена успешно`);
            return result;

        } catch (error) {
            console.error(`❌ [${sessionId}] Ошибка конвертации:`, error);
            return {
                success: false,
                error: formatTdataError(error),
                details: {
                    tdataPath: _request.tdataPath,
                    accountsCount: 0,
                    accountIndex: _request.accountIndex || 0,
                    convertedAt: new Date()
                }
            };
        }
    }

    /**
     * Улучшенная версия оригинального алгоритма с поддержкой множественных аккаунтов
     */
    private async performConversionAsync(_request: ITdataConversionRequest, _accountIndex: number, _sessionId: string): Promise<string> {
        const dataName = _request.dataName || 'data';
        const partOneMd5 = tdesktopMd5(dataName + (_accountIndex > 0 ? `#${_accountIndex + 1}` : '')).slice(0, 16);
        const tdesktopUserBasePath = path.join(_request.tdataPath, partOneMd5);
        const pathKey = `key_${dataName}` + (_accountIndex > 0 ? `${_accountIndex}` : 's');

        console.log(`📋 [${_sessionId}] Шаг 1: Определение путей для аккаунта ${_accountIndex}`);
        console.log(`📋 [${_sessionId}] Папка аккаунта: ${partOneMd5}`);
        console.log(`📋 [${_sessionId}] Файл ключей: ${pathKey}`);

        // Чтение и расшифровка ключей
        console.log(`📋 [${_sessionId}] Шаг 2: Чтение файла ключей...`);
        const data = tdesktopOpen(path.join(_request.tdataPath, pathKey));
        const { key, accountsCount } = await this.extractKeysAsync(data, _request.password || '', _sessionId);

        if (_accountIndex >= accountsCount) {
            throw new Error(`Аккаунт с индексом ${_accountIndex} не найден (всего аккаунтов: ${accountsCount})`);
        }

        // Чтение данных конкретного аккаунта
        console.log(`📋 [${_sessionId}] Шаг 3: Чтение данных аккаунта...`);
        const main = tdesktopOpenEncrypted(tdesktopUserBasePath, key);
        const { userId, mainDc, authKeyBuffer } = await this.extractAccountDataAsync(main, _accountIndex, _sessionId);

        console.log(`📋 [${_sessionId}] Шаг 4: Создание Session String...`);
        console.log(`👤 [${_sessionId}] User ID: ${userId}`);
        console.log(`🌐 [${_sessionId}] Main DC: ${mainDc}`);

        // Создание StringSession
        const session = new StringSession("");
        const serverAddress = getServerAddress(mainDc);
        session.setDC(mainDc, serverAddress, 443);

        const authKey = new AuthKey();
        await authKey.setKey(authKeyBuffer);
        session.setAuthKey(authKey);

        return session.save();
    }

    /**
     * Извлекает ключи и информацию об аккаунтах из файла ключей
     */
    private async extractKeysAsync(_data: BinaryReader, _password: string, _sessionId: string): Promise<{ key: Buffer, accountsCount: number }> {
        console.log(`📋 [${_sessionId}] Извлечение ключей из файла...`);

        const salt = tdesktopReadBuffer(_data);
        if (salt.length !== 32) {
            throw new Error(`Неверная длина salt: ${salt.length}, ожидалось: 32`);
        }

        const encryptedKey = tdesktopReadBuffer(_data);
        const encryptedInfo = tdesktopReadBuffer(_data);

        console.log(`📋 [${_sessionId}] Расшифровка ключа с паролем...`);
        const hash = crypto.createHash('sha512').update(salt).update(_password).update(salt).digest();
        const passKey = crypto.pbkdf2Sync(hash, salt, 1, 256, "sha512");

        const key = tdesktopReadBuffer(tdesktopDecrypt(new BinaryReader(encryptedKey), passKey));
        const info = tdesktopReadBuffer(tdesktopDecrypt(new BinaryReader(encryptedInfo), key));

        const accountsCount = info.readUInt32BE();
        console.log(`📊 [${_sessionId}] Количество аккаунтов: ${accountsCount}`);

        return { key, accountsCount };
    }

    /**
     * Извлекает данные конкретного аккаунта
     */
    private async extractAccountDataAsync(_main: BinaryReader, _accountIndex: number, _sessionId: string): Promise<{ userId: number, mainDc: number, authKeyBuffer: Buffer }> {
        console.log(`📋 [${_sessionId}] Извлечение данных аккаунта ${_accountIndex}...`);

        const magic = _main.read(4).reverse().readUInt32LE();
        if (magic !== 75) {
            throw new Error(`Неподдерживаемая версия magic: ${magic}, ожидалось: 75`);
        }

        const final = new BinaryReader(tdesktopReadBuffer(_main));

        // Пропускаем данные до нужного аккаунта
        final.read(12); // Пропускаем заголовок

        const userId = final.read(4).reverse().readUInt32LE();
        const mainDc = final.read(4).reverse().readUInt32LE();
        const length = final.read(4).reverse().readUInt32LE();

        console.log(`👤 [${_sessionId}] Найден User ID: ${userId}`);
        console.log(`🌐 [${_sessionId}] Main DC: ${mainDc}`);
        console.log(`🔑 [${_sessionId}] Количество ключей: ${length}`);

        // Поиск auth_key для основного датацентра
        let authKeyBuffer: Buffer | null = null;

        for (let i = 0; i < length; i++) {
            const dc = final.read(4).reverse().readUInt32LE();
            const authKey = final.read(256);

            console.log(`🔑 [${_sessionId}] Ключ ${i}: DC ${dc}`);

            if (dc === mainDc) {
                authKeyBuffer = authKey;
                console.log(`✅ [${_sessionId}] Найден auth_key для Main DC ${mainDc}`);
                break;
            }
        }

        if (!authKeyBuffer) {
            throw new Error(`Auth key для Main DC ${mainDc} не найден`);
        }

        return { userId, mainDc, authKeyBuffer };
    }

    /**
     * Сохраняет Session String в файл
     */
    private async saveSessionFileAsync(_sessionString: string, _request: ITdataConversionRequest, _account: IAccountInfo | null, _options?: ITdataConversionOptions): Promise<string | undefined> {
        if (_request.outputFormat === 'json') {
            return undefined;
        }

        try {
            const outputDir = _options?.outputDirectory || 'exports';
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            const filename = _account ? `${_account.phoneNumber}.session` : `session_${Date.now()}.session`;
            const filePath = path.join(outputDir, filename);

            await fs.promises.writeFile(filePath, _sessionString, 'utf-8');
            this.logger.info(`💾 Session файл сохранен: ${filePath}`);

            return filePath;
        } catch (error) {
            this.logger.error(`❌ Ошибка сохранения Session файла: ${error}`);
            return undefined;
        }
    }

    /**
     * Сохраняет метаданные аккаунта в JSON файл
     */
    private async saveJsonFileAsync(_account: IAccountInfo | null, _request: ITdataConversionRequest, _options?: ITdataConversionOptions): Promise<string | undefined> {
        if (_request.outputFormat === 'session') {
            return undefined;
        }

        try {
            const outputDir = _options?.outputDirectory || 'exports';
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            const filename = _account ? `${_account.phoneNumber}.json` : `account_${Date.now()}.json`;
            const filePath = path.join(outputDir, filename);

            const jsonData = {
                phoneNumber: _account?.phoneNumber,
                userId: _account?.userId,
                username: _account?.username,
                dcId: _account?.dcId,
                convertedAt: new Date().toISOString(),
                ...(_account?.additionalMetadata || {})
            };

            await fs.promises.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf-8');
            this.logger.info(`💾 JSON файл сохранен: ${filePath}`);

            return filePath;
        } catch (error) {
            this.logger.error(`❌ Ошибка сохранения JSON файла: ${error}`);
            return undefined;
        }
    }

    /**
     * Проверяет валидность TData папки
     */
    async validateTdataAsync(_tdataPath: string): Promise<ITdataValidationResult> {
        const result: ITdataValidationResult = {
            isValid: false,
            keyFiles: [],
            accountFolders: [],
            errors: [],
            warnings: []
        };

        try {
            if (!fs.existsSync(_tdataPath)) {
                result.errors.push(`Папка TData не существует: ${_tdataPath}`);
                return result;
            }

            const stats = fs.statSync(_tdataPath);
            if (!stats.isDirectory()) {
                result.errors.push(`Путь не является папкой: ${_tdataPath}`);
                return result;
            }

            // Поиск файлов ключей
            const keyFilePatterns = ['key_data', 'key_datas', 'key_data0', 'key_data1'];
            for (const pattern of keyFilePatterns) {
                const keyPath = path.join(_tdataPath, pattern);
                if (fs.existsSync(keyPath)) {
                    result.keyFiles.push(pattern);
                }
            }

            if (result.keyFiles.length === 0) {
                result.errors.push('Не найдены файлы ключей (key_data*)');
            }

            // Поиск папок аккаунтов (MD5 хеши)
            const files = fs.readdirSync(_tdataPath);
            for (const file of files) {
                const filePath = path.join(_tdataPath, file);
                const fileStats = fs.statSync(filePath);

                if (fileStats.isDirectory() && /^[A-F0-9]{16}$/.test(file)) {
                    result.accountFolders.push(file);
                }
            }

            if (result.accountFolders.length === 0) {
                result.warnings.push('Не найдены папки аккаунтов (MD5 хеши)');
            }

            // Проверка TDesktop файлов
            for (const keyFile of result.keyFiles) {
                const keyPath = path.join(_tdataPath, keyFile);
                const fileInfo = getTdesktopFileInfo(keyPath);

                if (!fileInfo) {
                    result.errors.push(`Невалидный TDesktop файл: ${keyFile}`);
                } else {
                    console.log(`✅ Валидный TDesktop файл: ${keyFile} (версия: ${fileInfo.version})`);
                }
            }

            result.isValid = result.errors.length === 0;

        } catch (error) {
            result.errors.push(`Ошибка валидации: ${formatTdataError(error)}`);
        }

        return result;
    }

    /**
     * Получает информацию о TData файлах
     */
    async getTdataInfoAsync(_tdataPath: string): Promise<ITdataFileInfo[]> {
        const fileInfos: ITdataFileInfo[] = [];

        try {
            if (!fs.existsSync(_tdataPath)) {
                return fileInfos;
            }

            const files = fs.readdirSync(_tdataPath);

            for (const file of files) {
                const filePath = path.join(_tdataPath, file);
                const stats = fs.statSync(filePath);

                if (stats.isFile()) {
                    const fileInfo = getTdesktopFileInfo(filePath);

                    if (fileInfo) {
                        fileInfos.push({
                            filePath,
                            version: fileInfo.version,
                            magic: fileInfo.magic,
                            md5Hash: '', // Будет заполнено позже при необходимости
                            fileSize: fileInfo.fileSize,
                            lastModified: stats.mtime
                        });
                    }
                }
            }

        } catch (error) {
            console.error('Ошибка получения информации о TData файлах:', formatTdataError(error));
        }

        return fileInfos;
    }

    /**
     * Валидирует конкретный key_datas файл
     * @param _keyDatasPath Путь к файлу key_datas
     * @returns Результат валидации с версией файла
     */
    private async validateKeyDatasFile(_keyDatasPath: string): Promise<{ isValid: boolean; version?: number; error?: string }> {
        try {
            if (!fs.existsSync(_keyDatasPath)) {
                return { isValid: false, error: `Файл key_datas не найден: ${_keyDatasPath}` };
            }

            const fileInfo = getTdesktopFileInfo(_keyDatasPath);
            if (!fileInfo) {
                return { isValid: false, error: `Невалидный TDesktop файл: ${_keyDatasPath}` };
            }

            return { isValid: true, version: fileInfo.version };

        } catch (error) {
            return { isValid: false, error: `Ошибка валидации key_datas: ${formatTdataError(error)}` };
        }
    }

    /**
     * Получает информацию о множественных аккаунтах из TData
     * @param _tdataPath Путь к TData папке
     * @returns Информация о всех аккаунтах
     */
    public async getMultiAccountInfoAsync(_tdataPath: string): Promise<IMultiAccountInfo> {
        try {
            // Сначала пытаемся прочитать key_datas файл
            const keyDatasPath = path.join(_tdataPath, 'key_datas');
            const validationResult = await this.validateKeyDatasFile(keyDatasPath);

            if (!validationResult.isValid) {
                throw new Error(`Невалидный key_datas файл: ${validationResult.error}`);
            }

            // Ищем папки аккаунтов (папки с MD5 именами длиной 16 символов)
            const files = await fs.promises.readdir(_tdataPath);
            const accountFolders = files.filter(file => {
                try {
                    const fullPath = path.join(_tdataPath, file);
                    const stats = fs.statSync(fullPath);
                    return stats.isDirectory() &&
                        /^[A-F0-9]{16}$/i.test(file) && // MD5 хеш (16 hex символов)
                        file !== 'user_data' &&
                        file !== 'temp' &&
                        file !== 'emoji';
                } catch {
                    return false;
                }
            });

            // Ищем файлы данных аккаунтов (MD5 имя + 's')
            const accountDataFiles = files.filter(file =>
                /^[A-F0-9]{16}s$/i.test(file) && // MD5 хеш + 's'
                file !== 'settingss' // Исключаем системный файл
            );

            // Получаем метаданные аккаунтов
            const accountsMetadata = await this.extractAccountMetadataAsync(_tdataPath);

            this.logger.info(`📊 Найдено: ${accountFolders.length} папок аккаунтов, ${accountDataFiles.length} файлов данных, ${accountsMetadata.length} JSON метаданных`);

            return {
                accountCount: Math.max(accountFolders.length, accountDataFiles.length, accountsMetadata.length),
                accountFolders,
                accountDataFiles,
                accountsMetadata,
                hasMultipleAccounts: accountFolders.length > 1 || accountDataFiles.length > 1,
                keyDatasVersion: validationResult.version || 0
            };

        } catch (error) {
            throw new Error(`Ошибка получения информации о множественных аккаунтах: ${error instanceof Error ? error.message : error}`);
        }
    }

    /**
     * Извлекает метаданные аккаунтов из JSON файлов
     * @param _tdataPath Путь к TData папке
     * @returns Массив метаданных аккаунтов
     */
    public async extractAccountMetadataAsync(_tdataPath: string): Promise<IAccountInfo[]> {
        const metadataList: IAccountInfo[] = [];

        try {
            const files = await fs.promises.readdir(_tdataPath);

            // Ищем JSON файлы, которые выглядят как метаданные аккаунтов (номер телефона + .json)
            const accountJsonFiles = files.filter(file =>
                file.endsWith('.json') &&
                /^\d+\.json$/.test(file) && // Только файлы вида "номер.json"
                !file.includes('shortcuts') && // Исключаем shortcuts файлы
                !file.includes('config') // Исключаем config файлы
            );

            for (const jsonFile of accountJsonFiles) {
                try {
                    const jsonPath = path.join(_tdataPath, jsonFile);
                    const content = await fs.promises.readFile(jsonPath, 'utf-8');
                    const metadata = JSON.parse(content);

                    // Извлекаем основную информацию об аккаунте
                    const accountInfo: IAccountInfo = {
                        phoneNumber: metadata.phone || jsonFile.replace('.json', ''),
                        userId: metadata.id || 0,
                        username: metadata.username || undefined,
                        dcId: metadata.dc_id || 2, // Default DC
                        authKey: '', // Будет заполнен при конвертации
                        sessionData: '', // Будет заполнен при конвертации
                        additionalMetadata: {
                            appId: metadata.app_id,
                            appHash: metadata.app_hash,
                            appVersion: metadata.app_version,
                            sdk: metadata.sdk,
                            device: metadata.device,
                            langPack: metadata.lang_pack,
                            systemLangPack: metadata.system_lang_pack,
                            twoFA: metadata.twoFA,
                            role: metadata.role
                        }
                    };

                    metadataList.push(accountInfo);
                    this.logger.info(`📋 Извлечены метаданные аккаунта: ${accountInfo.phoneNumber}`);
                } catch (error) {
                    // Пропускаем проблемные JSON файлы без логирования ошибки
                    // (shortcuts файлы с комментариями и другие служебные файлы)
                    continue;
                }
            }

        } catch (error) {
            this.logger.warn(`⚠️ Ошибка чтения директории ${_tdataPath}: ${error}`);
        }

        return metadataList;
    }
} 