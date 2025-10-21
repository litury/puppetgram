/**
 * Адаптер для интерактивной авторизации через консоль
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import prompts from 'prompts';
import { IInteractiveAuthHandler } from '../interfaces';
import { validatePhoneNumber } from '../parts';

export class InteractiveAuthAdapter implements IInteractiveAuthHandler {

    /**
     * Запрос номера телефона
     */
    async requestPhoneNumber(): Promise<string> {
        const response = await prompts({
            type: 'text',
            name: 'phoneNumber',
            message: '📱 Введите номер телефона (в международном формате, например +79123456789):',
            validate: (value: string) => {
                if (!value || value.trim().length === 0) {
                    return 'Номер телефона обязателен';
                }

                if (!validatePhoneNumber(value)) {
                    return 'Неверный формат номера телефона. Используйте международный формат (+79123456789)';
                }

                return true;
            }
        });

        if (!response.phoneNumber) {
            throw new Error('Операция отменена пользователем');
        }

        return response.phoneNumber.trim();
    }

    /**
     * Запрос кода подтверждения
     */
    async requestPhoneCode(): Promise<string> {
        const response = await prompts({
            type: 'text',
            name: 'phoneCode',
            message: '🔐 Введите код подтверждения из SMS или Telegram:',
            validate: (value: string) => {
                if (!value || value.trim().length === 0) {
                    return 'Код подтверждения обязателен';
                }

                const cleanCode = value.replace(/[^\d]/g, '');
                if (cleanCode.length < 4 || cleanCode.length > 6) {
                    return 'Код должен содержать от 4 до 6 цифр';
                }

                return true;
            }
        });

        if (!response.phoneCode) {
            throw new Error('Операция отменена пользователем');
        }

        return response.phoneCode.trim();
    }

    /**
     * Запрос пароля двухфакторной аутентификации
     */
    async requestPassword(): Promise<string> {
        const response = await prompts({
            type: 'password',
            name: 'password',
            message: '🔒 Введите пароль двухфакторной аутентификации:',
            validate: (value: string) => {
                if (!value || value.trim().length === 0) {
                    return 'Пароль обязателен';
                }
                return true;
            }
        });

        if (!response.password) {
            throw new Error('Операция отменена пользователем');
        }

        return response.password;
    }

    /**
     * Подтверждение действия
     */
    async confirmAction(_message: string): Promise<boolean> {
        const response = await prompts({
            type: 'confirm',
            name: 'confirm',
            message: _message,
            initial: false
        });

        return response.confirm || false;
    }

    /**
     * Отображение обычного сообщения
     */
    displayMessage(_message: string): void {
        console.log(_message);
    }

    /**
     * Отображение ошибки
     */
    displayError(_error: string): void {
        console.error(`❌ ${_error}`);
    }

    /**
     * Отображение успешного сообщения
     */
    displaySuccess(_message: string): void {
        console.log(`✅ ${_message}`);
    }
} 