/**
 * Адаптер для форматирования результатов операций с профилем
 * Следует стандартам компании согласно frontend-coding-standards.mdc
 */

import { IUserProfile, IProfileUpdateResult } from '../interfaces';

export class ProfileResultAdapter {
    /**
     * Форматирование информации о профиле для вывода
     */
    static formatProfileInfo(_profile: IUserProfile): string {
        const lines = [
            '📋 Информация о профиле:',
            '----------------------------------------'
        ];

        lines.push(`👤 ID пользователя: ${_profile.userId}`);

        if (_profile.firstName || _profile.lastName) {
            const fullName = [_profile.firstName, _profile.lastName].filter(Boolean).join(' ');
            lines.push(`📝 Имя: ${fullName}`);
        }

        if (_profile.username) {
            lines.push(`🔗 Username: @${_profile.username}`);
        } else {
            lines.push(`🔗 Username: не установлен`);
        }

        if (_profile.bio) {
            lines.push(`📄 Описание: ${_profile.bio}`);
        }

        if (_profile.phoneNumber) {
            const maskedPhone = ProfileResultAdapter.maskPhoneNumber(_profile.phoneNumber);
            lines.push(`📱 Телефон: ${maskedPhone}`);
        }

        // Статусы
        const statuses = [];
        if (_profile.isPremium) statuses.push('Premium');
        if (_profile.isVerified) statuses.push('Верифицирован');

        if (statuses.length > 0) {
            lines.push(`⭐ Статус: ${statuses.join(', ')}`);
        } else {
            lines.push(`🤖 Тип аккаунта: Обычный пользователь`);
        }

        return lines.join('\n');
    }

    /**
     * Форматирование результата операции обновления
     */
    static formatUpdateResult(_result: IProfileUpdateResult): string {
        if (_result.success) {
            const lines = [
                '✅ Операция выполнена успешно!',
                ''
            ];

            if (_result.details) {
                lines.push(`📋 Подробности: ${_result.details}`);
            }

            if (_result.profileInfo) {
                lines.push('');
                lines.push(ProfileResultAdapter.formatProfileInfo(_result.profileInfo));
            }

            return lines.join('\n');
        } else {
            const lines = [
                '❌ Операция завершилась с ошибкой',
                ''
            ];

            if (_result.error) {
                lines.push(`🚫 Ошибка: ${_result.error}`);
            }

            if (_result.details) {
                lines.push(`📋 Подробности: ${_result.details}`);
            }

            return lines.join('\n');
        }
    }

    /**
     * Форматирование списка доступных операций
     */
    static formatAvailableOperations(): string {
        return `
📋 Доступные операции с профилем:

1️⃣ Установить/изменить username
2️⃣ Обновить имя и фамилию  
3️⃣ Изменить описание профиля (bio)
4️⃣ Загрузить новое фото профиля
5️⃣ Просмотреть текущую информацию о профиле
6️⃣ Проверить доступность username

💡 Все операции требуют действующую сессию Telegram
        `.trim();
    }

    /**
     * Маскирование номера телефона для безопасности
     */
    private static maskPhoneNumber(_phone: string): string {
        if (_phone.length <= 6) {
            return '*'.repeat(_phone.length);
        }

        const start = _phone.substring(0, 3);
        const end = _phone.substring(_phone.length - 2);
        const middle = '*'.repeat(_phone.length - 5);

        return start + middle + end;
    }

    /**
     * Форматирование ошибок для пользователя
     */
    static formatError(_error: string, _context?: string): string {
        const lines = ['❌ Произошла ошибка'];

        if (_context) {
            lines.push(`📋 Контекст: ${_context}`);
        }

        lines.push(`🚫 Ошибка: ${_error}`);

        lines.push('');
        lines.push('💡 Рекомендации:');
        lines.push('   • Проверьте правильность введенных данных');
        lines.push('   • Убедитесь, что сессия не истекла');
        lines.push('   • Проверьте подключение к интернету');

        return lines.join('\n');
    }

    /**
     * Форматирование запроса подтверждения операции
     */
    static formatConfirmationRequest(_operation: string, _details: Record<string, string>): string {
        const lines = [
            `📋 Данные для операции: ${_operation}`,
            ''
        ];

        Object.entries(_details).forEach(([key, value]) => {
            lines.push(`   ${key}: ${value}`);
        });

        return lines.join('\n');
    }
} 