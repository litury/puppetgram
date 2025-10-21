/**
 * Вспомогательные функции для работы с TData форматом Telegram Desktop
 * Основано на коде из MadelineProto и улучшено для TypeScript
 * Следует стандартам компании согласно project-structure.mdc и frontend-coding-standards.mdc
 */

import * as crypto from "crypto";
import * as fs from "fs";
import { BinaryReader } from "telegram/extensions";
import { IGE } from "telegram/crypto/IGE";

/**
 * Создает MD5 хеш с переставленными байтами как в TDesktop
 * @param _data - данные для хеширования
 * @returns MD5 хеш с переставленными байтами
 */
export function tdesktopMd5(_data: string): string {
    let result = '';
    const hash = crypto.createHash('md5').update(_data).digest("hex");

    // Переставляем байты (как в TDesktop)
    for (let i = 0; i < hash.length; i += 2) {
        result += hash[i + 1] + hash[i];
    }

    return result.toUpperCase();
}

/**
 * Читает буфер данных из TDesktop файла
 * @param _file - BinaryReader файла
 * @returns Buffer с данными
 */
export function tdesktopReadBuffer(_file: BinaryReader): Buffer {
    const length = _file.read(4).reverse().readInt32LE();
    return length > 0 ? _file.read(length, false) : Buffer.alloc(0);
}

/**
 * Создает SHA1 хеш
 * @param _buf - буфер данных
 * @returns SHA1 хеш
 */
export function sha1(_buf: Buffer): Buffer {
    return crypto.createHash('sha1').update(_buf).digest();
}

/**
 * Вычисляет ключи AES для старого MTProto v1 алгоритма (как в TDesktop)
 * @param _authKey - ключ аутентификации
 * @param _msgKey - ключ сообщения
 * @param _client - флаг клиента
 * @returns Массив [aes_key, aes_iv]
 */
export function calcKey(_authKey: Buffer, _msgKey: Buffer, _client: boolean): [Buffer, Buffer] {
    const x = _client ? 0 : 8;

    const sha1_a = sha1(Buffer.concat([_msgKey, _authKey.slice(x, x + 32)]));
    const sha1_b = sha1(Buffer.concat([_authKey.slice(32 + x, 32 + x + 16), _msgKey, _authKey.slice(48 + x, 48 + x + 16)]));
    const sha1_c = sha1(Buffer.concat([_authKey.slice(64 + x, 64 + x + 32), _msgKey]));
    const sha1_d = sha1(Buffer.concat([_msgKey, _authKey.slice(96 + x, 96 + x + 32)]));

    const aes_key = Buffer.concat([sha1_a.slice(0, 8), sha1_b.slice(8, 8 + 12), sha1_c.slice(4, 4 + 12)]);
    const aes_iv = Buffer.concat([sha1_a.slice(8, 8 + 12), sha1_b.slice(0, 8), sha1_c.slice(16, 16 + 4), sha1_d.slice(0, 8)]);

    return [aes_key, aes_iv];
}

/**
 * Расшифровывает данные TDesktop
 * @param _data - зашифрованные данные
 * @param _authKey - ключ аутентификации
 * @returns Расшифрованные данные
 */
export function tdesktopDecrypt(_data: BinaryReader, _authKey: Buffer): BinaryReader {
    const messageKey = _data.read(16);
    const encryptedData = _data.read();

    const [aesKey, aesIv] = calcKey(_authKey, messageKey, false);
    const ige = new IGE(aesKey, aesIv);
    const decryptedData = ige.decryptIge(encryptedData) as Buffer;

    // Проверяем целостность данных
    if (messageKey.toString("hex") !== sha1(decryptedData).slice(0, 16).toString("hex")) {
        throw new Error('Ошибка проверки целостности данных (msg_key mismatch)');
    }

    return new BinaryReader(decryptedData);
}

/**
 * Открывает зашифрованный TDesktop файл
 * @param _fileName - имя файла
 * @param _tdesktopKey - ключ расшифровки
 * @returns BinaryReader с расшифрованными данными
 */
export function tdesktopOpenEncrypted(_fileName: string, _tdesktopKey: Buffer): BinaryReader {
    const file = tdesktopOpen(_fileName);
    const data = tdesktopReadBuffer(file);
    const result = tdesktopDecrypt(new BinaryReader(data), _tdesktopKey);

    const length = result.readInt(false);
    if (length > result.getBuffer().length || length < 4) {
        throw new Error(`Неверная длина данных: ${length}, ожидалось <= ${result.getBuffer().length}`);
    }

    return result;
}

/**
 * Открывает TDesktop файл и проверяет его валидность
 * @param _name - имя файла (без суффикса)
 * @returns BinaryReader с данными файла
 */
export function tdesktopOpen(_name: string): BinaryReader {
    const filesToTry = ['', '0', '1', 's']; // Сначала пробуем без суффикса
    const errors: string[] = [];

    for (const suffix of filesToTry) {
        const filePath = _name + suffix;

        if (!fs.existsSync(filePath)) {
            continue;
        }

        try {
            const fileData = fs.readFileSync(filePath);
            const fileReader = new BinaryReader(fileData);

            // Проверяем magic number
            const magic = fileReader.read(4).toString("utf-8");
            if (magic !== "TDF$") {
                errors.push(`Неверный magic number в файле ${filePath}: ${magic}`);
                continue;
            }

            // Читаем версию
            const versionBytes = fileReader.read(4);
            const version = versionBytes.readInt32LE(0);
            console.log(`📋 TDesktop версия: ${version} (файл: ${filePath})`);

            // Проверяем MD5
            let data = fileReader.read();
            const md5 = data.slice(-16).toString("hex");
            data = data.slice(0, -16);

            const length = Buffer.alloc(4);
            length.writeInt32LE(data.length, 0);
            const toCompare = Buffer.concat([data, length, versionBytes, Buffer.from("TDF$", "utf-8")]);
            const calculatedHash = crypto.createHash('md5').update(toCompare).digest("hex");

            if (calculatedHash !== md5) {
                errors.push(`Неверный MD5 хеш в файле ${filePath}: ${calculatedHash} !== ${md5}`);
                continue;
            }

            return new BinaryReader(data);

        } catch (error) {
            errors.push(`Ошибка чтения файла ${filePath}: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
            continue;
        }
    }

    throw new Error(`Не удалось открыть файл ${_name}. Попытки: ${filesToTry.map(s => _name + s).join(', ')}. Ошибки: ${errors.join('; ')}`);
}

/**
 * Получает адрес сервера по ID датацентра
 * @param _dcId - ID датацентра
 * @returns IP адрес сервера
 */
export function getServerAddress(_dcId: number): string {
    const dcMapping: { [key: number]: string } = {
        1: "149.154.175.55",
        2: "149.154.167.50",
        3: "149.154.175.100",
        4: "149.154.167.91",
        5: "91.108.56.170"
    };

    const address = dcMapping[_dcId];
    if (!address) {
        throw new Error(`Неизвестный датацентр: ${_dcId}`);
    }

    return address;
}

/**
 * Проверяет, является ли файл TDesktop файлом
 * @param _filePath - путь к файлу
 * @returns true если файл является TDesktop файлом
 */
export function isTdesktopFile(_filePath: string): boolean {
    try {
        if (!fs.existsSync(_filePath)) {
            return false;
        }

        const fileData = fs.readFileSync(_filePath);
        if (fileData.length < 4) {
            return false;
        }

        const magic = fileData.slice(0, 4).toString("utf-8");
        return magic === "TDF$";

    } catch (error) {
        return false;
    }
}

/**
 * Получает информацию о TDesktop файле
 * @param _filePath - путь к файлу
 * @returns Информация о файле или null если файл невалиден
 */
export function getTdesktopFileInfo(_filePath: string): { version: number; magic: string; fileSize: number } | null {
    try {
        if (!fs.existsSync(_filePath)) {
            return null;
        }

        const stats = fs.statSync(_filePath);
        const fileData = fs.readFileSync(_filePath);

        if (fileData.length < 8) {
            return null;
        }

        const magic = fileData.slice(0, 4).toString("utf-8");
        if (magic !== "TDF$") {
            return null;
        }

        const version = fileData.slice(4, 8).readInt32LE(0);

        return {
            version,
            magic,
            fileSize: stats.size
        };

    } catch (error) {
        return null;
    }
}

/**
 * Создает уникальный ID для сессии логирования
 * @returns Уникальный 8-символьный ID
 */
export function generateSessionId(): string {
    return Math.random().toString(36).substring(2, 10);
}

/**
 * Безопасно маскирует путь для логирования
 * @param _path - исходный путь
 * @returns Замаскированный путь
 */
export function maskPath(_path: string): string {
    // Маскируем чувствительные части пути
    return _path
        .replace(/\/Users\/[^\/]+/g, '/Users/***')
        .replace(/\\Users\\[^\\]+/g, '\\Users\\***')
        .replace(/\/home\/[^\/]+/g, '/home/***')
        .replace(/\\AppData\\Roaming/g, '\\AppData\\***');
}

/**
 * Форматирует ошибки TData для пользователя
 * @param _error - объект ошибки
 * @returns Читаемое сообщение об ошибке
 */
export function formatTdataError(_error: unknown): string {
    if (_error instanceof Error) {
        const message = _error.message;

        // Специфические ошибки TData
        if (message.includes('msg_key mismatch')) {
            return 'Неверный пароль или поврежденные данные TData';
        }

        if (message.includes('Wrong MD5')) {
            return 'Поврежденный файл TData (неверная контрольная сумма)';
        }

        if (message.includes('TDF$')) {
            return 'Файл не является корректным TData файлом';
        }

        if (message.includes('Length of salt is wrong')) {
            return 'Неверный формат ключевого файла TData';
        }

        return message;
    }

    return 'Неизвестная ошибка при обработке TData';
} 