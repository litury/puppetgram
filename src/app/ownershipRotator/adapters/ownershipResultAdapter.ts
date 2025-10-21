/**
 * Адаптер для форматирования результатов передачи владения каналами
 * Обеспечивает красивый вывод результатов и ошибок
 */

import { IOwnershipTransferResult } from '../interfaces/IChannelOwnershipRotator';

export class OwnershipResultAdapter {
    /**
     * Форматирует успешный результат передачи владения
     * @param _result - результат передачи
     * @returns отформатированная строка
     */
    static formatSuccessResult(_result: IOwnershipTransferResult): string {
        const lines = [
            '✅ Владение каналом успешно передано!',
            '',
            `📺 Канал: ${_result.channelTitle}`,
            `🆔 ID канала: ${_result.channelId}`,
            '',
            '👤 Участники передачи:',
            `   От: ${_result.fromUser.firstName || 'Неизвестно'} (@${_result.fromUser.username || _result.fromUser.id})`,
            `   К: ${_result.toUser.firstName || 'Неизвестно'} (@${_result.toUser.username || _result.toUser.id})`,
            '',
            `⏰ Время передачи: ${_result.transferredAt.toLocaleString('ru-RU')}`,
            '',
            '🎉 Передача владения завершена успешно!'
        ];

        return lines.join('\n');
    }

    /**
     * Форматирует ошибку передачи владения
     * @param _errorMessage - сообщение об ошибке
     * @param _context - контекст ошибки
     * @returns отформатированная строка
     */
    static formatErrorResult(_errorMessage: string, _context?: {
        channelIdentifier?: string;
        targetUserIdentifier?: string;
        sessionString?: string;
    }): string {
        const lines = [
            '❌ Ошибка при передаче владения каналом',
            '',
            `🚫 Ошибка: ${_errorMessage}`
        ];

        if (_context) {
            lines.push('');
            lines.push('📋 Контекст:');

            if (_context.channelIdentifier) {
                lines.push(`   📺 Канал: ${_context.channelIdentifier}`);
            }

            if (_context.targetUserIdentifier) {
                lines.push(`   👤 Получатель: ${_context.targetUserIdentifier}`);
            }

            if (_context.sessionString) {
                lines.push(`   🔐 Сессия: ${_context.sessionString}`);
            }
        }

        lines.push('');
        lines.push('💡 Рекомендации:');
        lines.push('   • Проверьте правильность введенных данных');
        lines.push('   • Убедитесь, что у вас есть права владельца канала');
        lines.push('   • Проверьте корректность пароля 2FA');

        return lines.join('\n');
    }

    /**
     * Форматирует краткий результат для логов
     * @param _result - результат передачи
     * @returns краткая строка
     */
    static formatBriefResult(_result: IOwnershipTransferResult): string {
        const status = _result.success ? '✅ УСПЕХ' : '❌ ОШИБКА';
        const channel = _result.channelTitle || _result.channelId || 'Неизвестный канал';
        const fromUser = _result.fromUser.username || _result.fromUser.id.toString();
        const toUser = _result.toUser.username || _result.toUser.id.toString();

        if (_result.success) {
            return `${status} | Канал "${channel}" передан от @${fromUser} к @${toUser}`;
        } else {
            return `${status} | Канал "${channel}" | Ошибка: ${_result.error}`;
        }
    }

    /**
     * Форматирует начало процесса передачи
     * @param _channelIdentifier - идентификатор канала
     * @param _targetUserIdentifier - идентификатор получателя
     * @param _sessionMask - замаскированная сессия
     * @returns отформатированная строка
     */
    static formatTransferStart(
        _channelIdentifier: string,
        _targetUserIdentifier: string,
        _sessionMask: string
    ): string {
        const lines = [
            '🔄 Начинаю передачу владения каналом...',
            '',
            `📺 Канал: ${_channelIdentifier}`,
            `👤 Получатель: ${_targetUserIdentifier}`,
            `🔐 Сессия: ${_sessionMask}`,
            '',
            '⏳ Выполняется проверка данных...'
        ];

        return lines.join('\n');
    }

    /**
     * Форматирует прогресс валидации
     * @param _step - текущий шаг
     * @param _description - описание шага
     * @returns отформатированная строка
     */
    static formatValidationStep(_step: number, _description: string): string {
        return `📋 Шаг ${_step}: ${_description}`;
    }

    /**
     * Форматирует список ошибок валидации
     * @param _errors - массив ошибок
     * @returns отформатированная строка
     */
    static formatValidationErrors(_errors: string[]): string {
        const lines = [
            '❌ Обнаружены ошибки при валидации:',
            ''
        ];

        _errors.forEach((error, index) => {
            lines.push(`   ${index + 1}. ${error}`);
        });

        lines.push(
            '',
            '💡 Исправьте указанные ошибки и попробуйте снова'
        );

        return lines.join('\n');
    }

    /**
     * Форматирует информацию о канале
     * @param _channelTitle - название канала
     * @param _channelId - ID канала
     * @param _isCreator - является ли пользователь создателем
     * @param _participantsCount - количество участников
     * @returns отформатированная строка
     */
    static formatChannelInfo(
        _channelTitle: string,
        _channelId: string,
        _isCreator: boolean,
        _participantsCount: number
    ): string {
        const creatorStatus = _isCreator ? '✅ Владелец' : '❌ Не владелец';

        return [
            `📺 ${_channelTitle}`,
            `🆔 ID: ${_channelId}`,
            `👑 Статус: ${creatorStatus}`,
            `👥 Участников: ${_participantsCount.toLocaleString('ru-RU')}`
        ].join('\n');
    }

    /**
     * Форматирует информацию о пользователе
     * @param _firstName - имя
     * @param _username - username
     * @param _userId - ID пользователя
     * @param _isVerified - верифицированный аккаунт
     * @returns отформатированная строка
     */
    static formatUserInfo(
        _firstName: string | undefined,
        _username: string | undefined,
        _userId: number,
        _isVerified: boolean
    ): string {
        const name = _firstName || 'Неизвестно';
        const username = _username ? `@${_username}` : 'Нет username';
        const verified = _isVerified ? '✅' : '';

        return `👤 ${name} (${username}) ${verified} | ID: ${_userId}`;
    }

    /**
     * Создает JSON отчет о результате
     * @param _result - результат передачи
     * @returns JSON строка
     */
    static createJsonReport(_result: IOwnershipTransferResult): string {
        return JSON.stringify(_result, null, 2);
    }
}

/**
 * Создает результат с ошибкой
 * @param _errorMessage - сообщение об ошибке
 * @param _context - контекст ошибки
 * @returns результат с ошибкой
 */
export function formatErrorResult(_errorMessage: string, _context?: {
    channelIdentifier?: string;
    targetUserIdentifier?: string;
    sessionString?: string;
}): IOwnershipTransferResult {
    return {
        success: false,
        channelTitle: _context?.channelIdentifier || 'Неизвестно',
        channelId: '',
        fromUser: {
            id: 0,
            username: undefined,
            firstName: undefined,
            isBot: false
        },
        toUser: {
            id: 0,
            username: undefined,
            firstName: undefined,
            isBot: false
        },
        transferredAt: new Date(),
        error: _errorMessage,
        errorDetails: _context ? JSON.stringify(_context) : undefined
    };
} 