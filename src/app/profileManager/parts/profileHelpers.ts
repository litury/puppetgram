/**
 * Вспомогательные функции для модуля управления профилем
 * Следует стандартам компании согласно frontend-coding-standards.mdc
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Валидация username
 */
export function validateUsername(_username: string): { isValid: boolean; error?: string } {
    // Убираем @ если есть
    const cleanUsername = _username.replace(/^@/, '');

    // Проверка длины (5-32 символа)
    if (cleanUsername.length < 5) {
        return { isValid: false, error: 'Username должен содержать минимум 5 символов' };
    }

    if (cleanUsername.length > 32) {
        return { isValid: false, error: 'Username должен содержать максимум 32 символа' };
    }

    // Проверка символов (только латинские буквы, цифры и подчеркивания)
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(cleanUsername)) {
        return { isValid: false, error: 'Username может содержать только латинские буквы, цифры и подчеркивания' };
    }

    // Проверка что не начинается и не заканчивается на подчеркивание
    if (cleanUsername.startsWith('_') || cleanUsername.endsWith('_')) {
        return { isValid: false, error: 'Username не может начинаться или заканчиваться подчеркиванием' };
    }

    // Проверка на подряд идущие подчеркивания
    if (cleanUsername.includes('__')) {
        return { isValid: false, error: 'Username не может содержать два подчеркивания подряд' };
    }

    return { isValid: true };
}

/**
 * Нормализация username (убирает @, приводит к нижнему регистру)
 */
export function normalizeUsername(_username: string): string {
    return _username.replace(/^@/, '').toLowerCase();
}

/**
 * Валидация имени пользователя
 */
export function validateFirstName(_firstName: string): { isValid: boolean; error?: string } {
    // Проверка длины (1-64 символа)
    if (_firstName.length < 1) {
        return { isValid: false, error: 'Имя не может быть пустым' };
    }

    if (_firstName.length > 64) {
        return { isValid: false, error: 'Имя должно содержать максимум 64 символа' };
    }

    // Проверка на недопустимые символы (запрещены управляющие символы)
    const controlCharsRegex = /[\x00-\x1F\x7F]/;
    if (controlCharsRegex.test(_firstName)) {
        return { isValid: false, error: 'Имя содержит недопустимые символы' };
    }

    // Проверка что имя не состоит только из пробелов
    if (_firstName.trim().length === 0) {
        return { isValid: false, error: 'Имя не может состоять только из пробелов' };
    }

    return { isValid: true };
}

/**
 * Валидация фамилии пользователя
 */
export function validateLastName(_lastName: string): { isValid: boolean; error?: string } {
    // Фамилия может быть пустой
    if (_lastName.length === 0) {
        return { isValid: true };
    }

    // Проверка длины (максимум 64 символа)
    if (_lastName.length > 64) {
        return { isValid: false, error: 'Фамилия должна содержать максимум 64 символа' };
    }

    // Проверка на недопустимые символы
    const controlCharsRegex = /[\x00-\x1F\x7F]/;
    if (controlCharsRegex.test(_lastName)) {
        return { isValid: false, error: 'Фамилия содержит недопустимые символы' };
    }

    // Проверка что фамилия не состоит только из пробелов
    if (_lastName.trim().length === 0) {
        return { isValid: false, error: 'Фамилия не может состоять только из пробелов' };
    }

    return { isValid: true };
}

/**
 * Валидация биографии профиля
 */
export function validateBio(_bio: string): { isValid: boolean; error?: string } {
    // Биография может быть пустой
    if (_bio.length === 0) {
        return { isValid: true };
    }

    // Проверка длины (максимум 70 символов)
    if (_bio.length > 70) {
        return { isValid: false, error: 'Биография должна содержать максимум 70 символов' };
    }

    // Проверка на недопустимые символы
    const controlCharsRegex = /[\x00-\x1F\x7F]/;
    if (controlCharsRegex.test(_bio)) {
        return { isValid: false, error: 'Биография содержит недопустимые символы' };
    }

    return { isValid: true };
}

/**
 * Валидация имени/фамилии
 */
export function validateName(_name: string): { isValid: boolean; error?: string } {
    // Максимальная длина имени в Telegram - 64 символа
    if (_name.length > 64) {
        return { isValid: false, error: 'Имя не может превышать 64 символа' };
    }

    // Имя не может быть пустым
    if (_name.trim().length === 0) {
        return { isValid: false, error: 'Имя не может быть пустым' };
    }

    return { isValid: true };
}

// === РАБОТА С ФОТОГРАФИЯМИ ===

/**
 * Поддерживаемые форматы изображений
 */
export const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Максимальный размер файла изображения (10 MB)
 */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/**
 * Валидация файла изображения
 */
export function validateImageFile(_filePath: string): { isValid: boolean; error?: string } {
    try {
        // Проверка существования файла
        if (!fs.existsSync(_filePath)) {
            return { isValid: false, error: 'Файл не найден' };
        }

        // Проверка расширения файла
        const fileExtension = path.extname(_filePath).toLowerCase();
        if (!SUPPORTED_IMAGE_FORMATS.includes(fileExtension)) {
            return {
                isValid: false,
                error: `Неподдерживаемый формат файла. Разрешены: ${SUPPORTED_IMAGE_FORMATS.join(', ')}`
            };
        }

        // Проверка размера файла
        const fileStats = fs.statSync(_filePath);
        if (fileStats.size > MAX_IMAGE_SIZE) {
            return {
                isValid: false,
                error: `Размер файла превышает ${MAX_IMAGE_SIZE / (1024 * 1024)} MB`
            };
        }

        // Проверка что файл не пустой
        if (fileStats.size === 0) {
            return { isValid: false, error: 'Файл пустой' };
        }

        return { isValid: true };

    } catch (error) {
        return { isValid: false, error: `Ошибка при проверке файла: ${error}` };
    }
}

/**
 * Получение MIME типа файла по расширению
 */
export function getMimeType(_filePath: string): string {
    const extension = path.extname(_filePath).toLowerCase();

    switch (extension) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.png':
            return 'image/png';
        case '.webp':
            return 'image/webp';
        default:
            return 'application/octet-stream';
    }
}

/**
 * Генерация уникального имени файла
 */
export function generateUniqueFileName(_originalPath: string): string {
    const extension = path.extname(_originalPath);
    const timestamp = Date.now();
    const randomHash = crypto.randomBytes(8).toString('hex');

    return `photo_${timestamp}_${randomHash}${extension}`;
}

/**
 * Копирование файла в директорию uploaded
 */
export async function copyToUploadedDir(_sourcePath: string): Promise<{ success: boolean; newPath?: string; error?: string }> {
    try {
        const fileName = generateUniqueFileName(_sourcePath);
        const uploadedDir = path.join(__dirname, '../photos/uploaded');
        const newPath = path.join(uploadedDir, fileName);

        // Создаем директорию если не существует
        if (!fs.existsSync(uploadedDir)) {
            fs.mkdirSync(uploadedDir, { recursive: true });
        }

        // Копируем файл
        fs.copyFileSync(_sourcePath, newPath);

        return { success: true, newPath };

    } catch (error) {
        return { success: false, error: `Ошибка копирования файла: ${error}` };
    }
}

/**
 * Очистка старых временных файлов (старше 1 часа)
 */
export function cleanupTempFiles(): void {
    try {
        const tempDir = path.join(__dirname, '../photos/temp');
        if (!fs.existsSync(tempDir)) return;

        const files = fs.readdirSync(tempDir);
        const oneHourAgo = Date.now() - (60 * 60 * 1000);

        files.forEach(file => {
            const filePath = path.join(tempDir, file);
            const stats = fs.statSync(filePath);

            if (stats.mtime.getTime() < oneHourAgo) {
                fs.unlinkSync(filePath);
                console.log(`🧹 Удален временный файл: ${file}`);
            }
        });

    } catch (error) {
        console.warn(`⚠️ Ошибка при очистке временных файлов: ${error}`);
    }
}

/**
 * Форматирование ошибок Telegram API
 */
export function formatTelegramError(_error: any): string {
    if (typeof _error === 'string') {
        return _error;
    }

    if (_error?.message) {
        return _error.message;
    }

    return 'Неизвестная ошибка Telegram API';
}

/**
 * Создание уникального ID для операции
 */
export function generateOperationId(): string {
    return Math.random().toString(36).substring(2, 10);
}

/**
 * Маскирование чувствительной информации в логах
 */
export function maskSessionString(_sessionString: string): string {
    if (_sessionString.length <= 20) {
        return '*'.repeat(_sessionString.length);
    }

    return _sessionString.substring(0, 10) + '*'.repeat(_sessionString.length - 20) + _sessionString.substring(_sessionString.length - 10);
}

/**
 * Валидация пароля для двухфакторной аутентификации
 */
export function validate2FAPassword(_password: string): { isValid: boolean; error?: string } {
    // Минимальная длина пароля
    if (_password.length < 6) {
        return { isValid: false, error: 'Пароль 2FA должен содержать минимум 6 символов' };
    }

    // Максимальная длина пароля (обычно в Telegram до 256 символов)
    if (_password.length > 256) {
        return { isValid: false, error: 'Пароль 2FA не может превышать 256 символов' };
    }

    // Проверка на простые пароли
    const weakPasswords = ['123456', 'password', 'qwerty', '111111', '000000'];
    if (weakPasswords.includes(_password.toLowerCase())) {
        return { isValid: false, error: 'Пароль слишком простой. Используйте более сложный пароль' };
    }

    return { isValid: true };
}

/**
 * Валидация подсказки для пароля 2FA
 */
export function validate2FAHint(_hint: string): { isValid: boolean; error?: string } {
    // Подсказка не может быть слишком длинной
    if (_hint.length > 255) {
        return { isValid: false, error: 'Подсказка не может превышать 255 символов' };
    }

    // Подсказка не должна содержать сам пароль (базовая проверка)
    if (_hint.length > 0 && _hint.length < 3) {
        return { isValid: false, error: 'Подсказка должна содержать минимум 3 символа или быть пустой' };
    }

    return { isValid: true };
}

/**
 * Генерация стандартного пароля 2FA
 */
export function generateDefault2FAPassword(): string {
    return '640436123';
}

/**
 * Генерация стандартной подсказки для пароля 2FA
 */
export function generateDefault2FAHint(): string {
    return 'Стандартный пароль проекта';
}

/**
 * Маскирование пароля 2FA для логов
 */
export function mask2FAPassword(_password: string): string {
    if (_password.length <= 2) {
        return '*'.repeat(_password.length);
    }

    return _password.substring(0, 1) + '*'.repeat(_password.length - 2) + _password.substring(_password.length - 1);
} 