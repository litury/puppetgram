/**
 * Вспомогательные функции для модуля генерации сессий
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { ISessionGenerationResult, IAuthCredentials } from '../interfaces';

/**
 * Валидация номера телефона
 */
export function validatePhoneNumber(_phoneNumber: string): boolean {
    // Убираем все символы кроме цифр и +
    const cleanPhone = _phoneNumber.replace(/[^\d+]/g, '');

    // Проверяем формат международного номера
    const phoneRegex = /^\+\d{10,15}$/;
    return phoneRegex.test(cleanPhone);
}

/**
 * Форматирование номера телефона
 */
export function formatPhoneNumber(_phoneNumber: string): string {
    let cleanPhone = _phoneNumber.replace(/[^\d+]/g, '');

    // Добавляем + если его нет
    if (!cleanPhone.startsWith('+')) {
        cleanPhone = '+' + cleanPhone;
    }

    return cleanPhone;
}

/**
 * Генерация имени файла для сессии
 */
export function generateSessionFilename(_phoneNumber: string, _timestamp?: Date): string {
    const cleanPhone = _phoneNumber.replace(/[^\d]/g, '');
    const timestamp = _timestamp || new Date();
    const dateStr = timestamp.toISOString().split('T')[0].replace(/-/g, '');

    return `session_${cleanPhone}_${dateStr}.json`;
}

/**
 * Проверка существования директории и создание при необходимости
 */
export function ensureDirectoryExists(_dirPath: string): void {
    if (!fs.existsSync(_dirPath)) {
        fs.mkdirSync(_dirPath, { recursive: true });
    }
}

/**
 * Сохранение сессии в файл
 */
export function saveSessionToFile(
    _sessionResult: ISessionGenerationResult,
    _filePath: string
): void {
    try {
        const dirPath = path.dirname(_filePath);
        ensureDirectoryExists(dirPath);

        const sessionData = {
            ..._sessionResult,
            generatedAt: _sessionResult.generatedAt.toISOString()
        };

        fs.writeFileSync(_filePath, JSON.stringify(sessionData, null, 2), 'utf-8');
    } catch (error) {
        throw new Error(`Ошибка сохранения сессии в файл ${_filePath}: ${error}`);
    }
}

/**
 * Загрузка сессии из файла
 */
export function loadSessionFromFile(_filePath: string): ISessionGenerationResult {
    try {
        if (!fs.existsSync(_filePath)) {
            throw new Error(`Файл сессии не найден: ${_filePath}`);
        }

        const fileContent = fs.readFileSync(_filePath, 'utf-8');
        const sessionData = JSON.parse(fileContent);

        return {
            ...sessionData,
            generatedAt: new Date(sessionData.generatedAt)
        };
    } catch (error) {
        throw new Error(`Ошибка загрузки сессии из файла ${_filePath}: ${error}`);
    }
}

/**
 * Получение списка файлов сессий
 */
export function getSessionFiles(_directoryPath: string): string[] {
    try {
        if (!fs.existsSync(_directoryPath)) {
            return [];
        }

        return fs.readdirSync(_directoryPath)
            .filter(file => file.startsWith('session_') && file.endsWith('.json'))
            .map(file => path.join(_directoryPath, file))
            .filter(filePath => fs.statSync(filePath).isFile());
    } catch (error) {
        console.warn(`Предупреждение: не удалось получить список сессий из ${_directoryPath}:`, error);
        return [];
    }
}

/**
 * Удаление файла сессии
 */
export function deleteSessionFile(_filePath: string): boolean {
    try {
        if (fs.existsSync(_filePath)) {
            fs.unlinkSync(_filePath);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Ошибка удаления файла сессии ${_filePath}:`, error);
        return false;
    }
}

/**
 * Валидация учетных данных
 */
export function validateCredentials(_credentials: IAuthCredentials): string[] {
    const errors: string[] = [];

    if (!_credentials.phoneNumber) {
        errors.push('Номер телефона обязателен');
    } else if (!validatePhoneNumber(_credentials.phoneNumber)) {
        errors.push('Неверный формат номера телефона');
    }

    return errors;
}

/**
 * Создание безопасного отображения номера телефона
 */
export function maskPhoneNumber(_phoneNumber: string): string {
    if (_phoneNumber.length < 4) return _phoneNumber;

    const start = _phoneNumber.substring(0, 3);
    const end = _phoneNumber.substring(_phoneNumber.length - 2);
    const middle = '*'.repeat(_phoneNumber.length - 5);

    return start + middle + end;
}

/**
 * Форматирование времени генерации сессии
 */
export function formatSessionDate(_date: Date): string {
    return _date.toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

/**
 * Генерация уникального идентификатора сессии
 */
export function generateSessionId(_phoneNumber: string): string {
    const cleanPhone = _phoneNumber.replace(/[^\d]/g, '');
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);

    return `sess_${cleanPhone}_${timestamp}_${random}`;
} 