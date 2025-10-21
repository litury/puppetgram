/**
 * Интерактивный скрипт для установки/изменения username пользователя
 * Использует модуль profileManager для управления профилем
 */

import prompts from 'prompts';
import * as dotenv from 'dotenv';
import { ProfileManagerService } from '../modules/profileManager/services/profileManagerService';
import { ProfileResultAdapter } from '../modules/profileManager/adapters/profileResultAdapter';
import { IUsernameUpdateRequest } from '../modules/profileManager/interfaces/IProfileManager';

// Загружаем переменные окружения
dotenv.config();

async function main() {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                     👤 УСТАНОВКА USERNAME                      ║
║                                                                ║
║  Этот скрипт позволяет установить или изменить username        ║
║  для вашего Telegram аккаунта                                  ║
╚════════════════════════════════════════════════════════════════╝
    `);

    // Проверяем обязательные переменные
    const apiId = Number(process.env.API_ID);
    const apiHash = process.env.API_HASH;
    const sessionString = process.env.SESSION_STRING;

    if (!apiId || !apiHash || !sessionString) {
        console.error('❌ Ошибка: API_ID, API_HASH и SESSION_STRING должны быть указаны в .env файле');
        return;
    }

    try {
        const profileService = new ProfileManagerService();

        // Отображаем текущую информацию о профиле
        console.log('🔍 Получение текущей информации о профиле...\n');

        try {
            const currentProfile = await profileService.getProfileInfoAsync(sessionString);
            console.log(ProfileResultAdapter.formatProfileInfo(currentProfile));
            console.log('');
        } catch (error) {
            console.warn('⚠️ Не удалось получить текущую информацию о профиле');
            console.warn(`Причина: ${error}`);
            console.log('');
        }

        // Интерактивный ввод данных
        const response = await prompts([
            {
                type: 'text',
                name: 'newUsername',
                message: 'Введите новый username (без @):',
                validate: value => {
                    if (!value || value.length === 0) {
                        return 'Username не может быть пустым';
                    }

                    // Базовая проверка длины
                    const cleanUsername = value.replace(/^@/, '');
                    if (cleanUsername.length < 5) {
                        return 'Username должен содержать минимум 5 символов';
                    }

                    if (cleanUsername.length > 32) {
                        return 'Username должен содержать максимум 32 символа';
                    }

                    return true;
                }
            },
            {
                type: 'confirm',
                name: 'checkAvailability',
                message: 'Проверить доступность username перед установкой?',
                initial: true
            }
        ]);

        if (!response.newUsername) {
            console.log('❌ Операция отменена');
            return;
        }

        // Проверка доступности username если запрошено
        if (response.checkAvailability) {
            console.log('\n🔍 Проверка доступности username...');

            try {
                const isAvailable = await profileService.checkUsernameAvailabilityAsync(response.newUsername, sessionString);

                if (!isAvailable) {
                    console.log(`❌ Username @${response.newUsername} уже занят`);

                    const retryResponse = await prompts({
                        type: 'confirm',
                        name: 'retry',
                        message: 'Попробовать другой username?',
                        initial: true
                    });

                    if (retryResponse.retry) {
                        console.log('🔄 Перезапустите скрипт для выбора нового username');
                    }
                    return;
                } else {
                    console.log(`✅ Username @${response.newUsername} доступен!`);
                }
            } catch (error) {
                console.warn('⚠️ Не удалось проверить доступность username');
                console.warn(`Причина: ${error}`);

                const continueResponse = await prompts({
                    type: 'confirm',
                    name: 'continue',
                    message: 'Продолжить установку без проверки?',
                    initial: false
                });

                if (!continueResponse.continue) {
                    console.log('❌ Операция отменена');
                    return;
                }
            }
        }

        // Подтверждение операции
        console.log('');
        console.log(ProfileResultAdapter.formatConfirmationRequest('Установка Username', {
            '🔗 Новый username': `@${response.newUsername}`,
            '📱 Аккаунт': 'Текущий (из SESSION_STRING)'
        }));

        const confirmResponse = await prompts({
            type: 'confirm',
            name: 'confirmed',
            message: '❗ Вы уверены, что хотите установить этот username?',
            initial: false
        });

        if (!confirmResponse.confirmed) {
            console.log('❌ Операция отменена');
            return;
        }

        // Выполнение операции
        console.log('\n🔄 Установка username...\n');

        const updateRequest: IUsernameUpdateRequest = {
            sessionString,
            newUsername: response.newUsername
        };

        const result = await profileService.updateUsernameAsync(updateRequest);

        // Отображение результата
        console.log('\n' + ProfileResultAdapter.formatUpdateResult(result));

        if (result.success) {
            console.log('\n🎉 Username успешно установлен!');
            console.log('💡 Теперь другие пользователи могут найти вас по этому username');
        } else {
            console.log('\n💡 Рекомендации по устранению ошибки:');
            console.log('   • Попробуйте другой username');
            console.log('   • Проверьте подключение к интернету');
            console.log('   • Убедитесь, что сессия не истекла');
        }

    } catch (error) {
        console.error('\n❌ Критическая ошибка:', error);
        console.log('\n💡 Возможные причины:');
        console.log('   • Проблемы с сетевым подключением');
        console.log('   • Недействительная сессия');
        console.log('   • Неправильные API_ID/API_HASH');
    }
}

// Обработка прерывания процесса
process.on('SIGINT', () => {
    console.log('\n👋 Операция прервана пользователем');
    process.exit(0);
});

// Запуск скрипта
main().catch(console.error); 