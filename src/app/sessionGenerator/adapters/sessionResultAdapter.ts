/**
 * Адаптер для форматирования результатов генерации сессий
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import { ISessionGenerationResult, ISessionInfo } from '../interfaces';
import { maskPhoneNumber, formatSessionDate } from '../parts';

export class SessionResultAdapter {

    /**
     * Форматирование результата генерации сессии для консольного вывода
     */
    static formatGenerationResult(_result: ISessionGenerationResult): string {
        let output = '\n' + '='.repeat(60) + '\n';
        output += '🎉 СЕССИЯ УСПЕШНО СГЕНЕРИРОВАНА\n';
        output += '='.repeat(60) + '\n\n';

        output += '📱 Информация об аккаунте:\n';
        output += `   Телефон: ${maskPhoneNumber(_result.phoneNumber)}\n`;

        if (_result.firstName || _result.lastName) {
            output += `   Имя: ${_result.firstName || ''} ${_result.lastName || ''}`.trim() + '\n';
        }

        if (_result.username) {
            output += `   Username: @${_result.username}\n`;
        }

        if (_result.userId) {
            output += `   ID пользователя: ${_result.userId}\n`;
        }

        output += '\n🔐 Информация о сессии:\n';
        output += `   Дата создания: ${formatSessionDate(_result.generatedAt)}\n`;
        output += `   Статус: ${_result.isValid ? '✅ Действительна' : '❌ Недействительна'}\n`;

        output += '\n📋 SESSION_STRING:\n';
        output += '-'.repeat(60) + '\n';
        output += _result.sessionString + '\n';
        output += '-'.repeat(60) + '\n';

        output += '\n💡 Инструкции:\n';
        output += '1. Скопируйте SESSION_STRING выше\n';
        output += '2. Добавьте в ваш .env файл:\n';
        output += `   SESSION_STRING="${_result.sessionString}"\n`;
        output += '3. Перезапустите приложение\n';

        output += '\n' + '='.repeat(60) + '\n';

        return output;
    }

    /**
     * Форматирование информации о сессии
     */
    static formatSessionInfo(_info: ISessionInfo): string {
        let output = '\n📋 Информация о сессии:\n';
        output += '-'.repeat(40) + '\n';

        output += `👤 ID пользователя: ${_info.userId}\n`;

        if (_info.firstName || _info.lastName) {
            output += `📝 Имя: ${_info.firstName || ''} ${_info.lastName || ''}`.trim() + '\n';
        }

        if (_info.username) {
            output += `🏷️ Username: @${_info.username}\n`;
        }

        if (_info.phoneNumber) {
            output += `📱 Телефон: ${maskPhoneNumber(_info.phoneNumber)}\n`;
        }

        output += `🤖 Тип аккаунта: ${_info.isBot ? 'Бот' : 'Пользователь'}\n`;

        if (_info.isPremium) {
            output += `⭐ Premium: Да\n`;
        }

        if (_info.isVerified) {
            output += `✅ Верифицирован: Да\n`;
        }

        return output;
    }

    /**
     * Форматирование списка сессий
     */
    static formatSessionsList(_sessions: string[]): string {
        if (_sessions.length === 0) {
            return '\n📂 Сохраненные сессии не найдены\n';
        }

        let output = `\n📂 Найдено сессий: ${_sessions.length}\n`;
        output += '='.repeat(50) + '\n';

        _sessions.forEach((session, index) => {
            output += `${index + 1}. ${session}\n`;
        });

        return output;
    }

    /**
     * Форматирование краткой информации о результате
     */
    static formatShortResult(_result: ISessionGenerationResult): string {
        const userName = _result.firstName || _result.username || 'Неизвестно';
        const phone = maskPhoneNumber(_result.phoneNumber);

        return `✅ Сессия создана для ${userName} (${phone})`;
    }

    /**
     * Форматирование ошибки генерации
     */
    static formatError(_error: Error | string): string {
        const errorMessage = typeof _error === 'string' ? _error : _error.message;

        let output = '\n❌ ОШИБКА ГЕНЕРАЦИИ СЕССИИ\n';
        output += '='.repeat(40) + '\n';
        output += `Причина: ${errorMessage}\n\n`;

        output += '💡 Возможные решения:\n';
        output += '• Проверьте правильность номера телефона\n';
        output += '• Убедитесь, что API_ID и API_HASH корректны\n';
        output += '• Проверьте интернет-соединение\n';
        output += '• Попробуйте через некоторое время\n';

        return output;
    }

    /**
     * Создание .env строки для сессии
     */
    static createEnvString(_sessionString: string): string {
        return `SESSION_STRING="${_sessionString}"`;
    }

    /**
     * Форматирование инструкций по использованию
     */
    static formatUsageInstructions(_sessionString: string): string {
        let output = '\n📖 ИНСТРУКЦИИ ПО ИСПОЛЬЗОВАНИЮ\n';
        output += '='.repeat(50) + '\n\n';

        output += '1️⃣ Откройте ваш .env файл\n\n';

        output += '2️⃣ Добавьте или замените строку SESSION_STRING:\n';
        output += `SESSION_STRING="${_sessionString}"\n\n`;

        output += '3️⃣ Сохраните файл\n\n';

        output += '4️⃣ Перезапустите приложение\n\n';

        output += '⚠️  ВАЖНО:\n';
        output += '• Не делитесь SESSION_STRING с другими\n';
        output += '• Храните .env файл в безопасности\n';
        output += '• Добавьте .env в .gitignore\n';

        return output;
    }
} 