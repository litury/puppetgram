/**
 * Интерактивный скрипт для управления двухфакторной аутентификацией (2FA)
 * Использует модуль profileManager с стандартным паролем 640436123
 */

import prompts from 'prompts';
import * as dotenv from 'dotenv';
import { ProfileManagerService } from '../modules/profileManager/services/profileManagerService';
import { ProfileResultAdapter } from '../modules/profileManager/adapters/profileResultAdapter';
import { I2FASetupRequest, I2FAChangeRequest } from '../modules/profileManager/interfaces/IProfileManager';
import { generateDefault2FAPassword, generateDefault2FAHint } from '../modules/profileManager/parts/profileHelpers';

// Загружаем переменные окружения
dotenv.config();

async function main() {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    🔐 УПРАВЛЕНИЕ 2FA                           ║
║                                                                ║
║  Этот скрипт позволяет настроить двухфакторную                 ║
║  аутентификацию для вашего Telegram аккаунта                   ║
║                                                                ║
║  🔑 Стандартный пароль: 640436123                              ║
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

        // Проверяем текущий статус 2FA
        console.log('🔍 Проверка текущего статуса 2FA...\n');

        let currentStatus;
        try {
            currentStatus = await profileService.get2FAStatusAsync(sessionString);

            if (currentStatus.isEnabled) {
                console.log('✅ 2FA уже включена');
                if (currentStatus.hint) {
                    console.log(`💡 Подсказка: ${currentStatus.hint}`);
                }
                console.log('');
            } else {
                console.log('❌ 2FA не настроена');
                console.log('');
            }
        } catch (error) {
            console.warn('⚠️ Не удалось проверить статус 2FA');
            console.warn(`Причина: ${error}`);
            console.log('');
        }

        // Выбор действия
        const actionResponse = await prompts({
            type: 'select',
            name: 'action',
            message: 'Выберите действие:',
            choices: [
                {
                    title: '🔧 Установить 2FA (стандартный пароль)',
                    value: 'setup_default',
                    description: 'Установить 2FA с паролем 640436123'
                },
                {
                    title: '🔧 Установить 2FA (свой пароль)',
                    value: 'setup_custom',
                    description: 'Установить 2FA с собственным паролем'
                },
                {
                    title: '🔄 Изменить пароль 2FA',
                    value: 'change',
                    description: 'Изменить существующий пароль 2FA'
                },
                {
                    title: '📊 Проверить статус 2FA',
                    value: 'status',
                    description: 'Показать текущую информацию о 2FA'
                },
                {
                    title: '❌ Отключить 2FA',
                    value: 'disable',
                    description: 'Полностью отключить двухфакторную аутентификацию'
                },
                {
                    title: '🚪 Выйти',
                    value: 'exit',
                    description: 'Закрыть программу'
                }
            ]
        });

        if (!actionResponse.action || actionResponse.action === 'exit') {
            console.log('👋 До свидания!');
            return;
        }

        switch (actionResponse.action) {
            case 'setup_default':
                await handleSetupDefault(profileService, sessionString);
                break;
            case 'setup_custom':
                await handleSetupCustom(profileService, sessionString);
                break;
            case 'change':
                await handleChange(profileService, sessionString);
                break;
            case 'status':
                await handleStatus(profileService, sessionString);
                break;
            case 'disable':
                await handleDisable(profileService, sessionString);
                break;
        }

    } catch (error) {
        console.error('\n❌ Критическая ошибка:', error);
        console.log('\n💡 Возможные причины:');
        console.log('   • Проблемы с сетевым подключением');
        console.log('   • Недействительная сессия');
        console.log('   • Неправильные API_ID/API_HASH');
    }
}

/**
 * Установка 2FA со стандартным паролем
 */
async function handleSetupDefault(profileService: ProfileManagerService, sessionString: string) {
    console.log('\n🔧 === УСТАНОВКА 2FA СО СТАНДАРТНЫМ ПАРОЛЕМ ===\n');

    const defaultPassword = generateDefault2FAPassword();
    const defaultHint = generateDefault2FAHint();

    console.log('📋 Данные для установки:');
    console.log(`🔑 Пароль: ${defaultPassword}`);
    console.log(`💡 Подсказка: ${defaultHint}`);

    const confirmResponse = await prompts({
        type: 'confirm',
        name: 'confirmed',
        message: '❗ Установить 2FA с этими данными?',
        initial: true
    });

    if (!confirmResponse.confirmed) {
        console.log('❌ Операция отменена');
        return;
    }

    console.log('\n🔄 Установка 2FA...\n');

    const setupRequest: I2FASetupRequest = {
        sessionString,
        password: defaultPassword,
        hint: defaultHint
    };

    const result = await profileService.setup2FAAsync(setupRequest);
    console.log('\n' + ProfileResultAdapter.formatUpdateResult(result));

    if (result.success) {
        console.log('\n🎉 2FA успешно настроена!');
        console.log(`🔑 Запомните пароль: ${defaultPassword}`);
        console.log('💡 Теперь для передачи каналов потребуется этот пароль');
    }
}

/**
 * Установка 2FA с пользовательским паролем
 */
async function handleSetupCustom(profileService: ProfileManagerService, sessionString: string) {
    console.log('\n🔧 === УСТАНОВКА 2FA С ПОЛЬЗОВАТЕЛЬСКИМ ПАРОЛЕМ ===\n');

    const response = await prompts([
        {
            type: 'password',
            name: 'password',
            message: 'Введите пароль для 2FA (минимум 6 символов):',
            validate: value => value.length >= 6 ? true : 'Пароль должен содержать минимум 6 символов'
        },
        {
            type: 'text',
            name: 'hint',
            message: 'Введите подсказку для пароля (опционально):',
            initial: ''
        }
    ]);

    if (!response.password) {
        console.log('❌ Операция отменена');
        return;
    }

    console.log('\n📋 Данные для установки:');
    console.log(`🔑 Пароль: ${'*'.repeat(response.password.length)}`);
    console.log(`💡 Подсказка: ${response.hint || 'не указана'}`);

    const confirmResponse = await prompts({
        type: 'confirm',
        name: 'confirmed',
        message: '❗ Установить 2FA с этими данными?',
        initial: false
    });

    if (!confirmResponse.confirmed) {
        console.log('❌ Операция отменена');
        return;
    }

    console.log('\n🔄 Установка 2FA...\n');

    const setupRequest: I2FASetupRequest = {
        sessionString,
        password: response.password,
        hint: response.hint || undefined
    };

    const result = await profileService.setup2FAAsync(setupRequest);
    console.log('\n' + ProfileResultAdapter.formatUpdateResult(result));

    if (result.success) {
        console.log('\n🎉 2FA успешно настроена!');
        console.log('💡 Запомните ваш пароль - он понадобится для операций с каналами');
    }
}

/**
 * Изменение пароля 2FA
 */
async function handleChange(profileService: ProfileManagerService, sessionString: string) {
    console.log('\n🔄 === ИЗМЕНЕНИЕ ПАРОЛЯ 2FA ===\n');

    const response = await prompts([
        {
            type: 'password',
            name: 'currentPassword',
            message: 'Введите текущий пароль 2FA:'
        },
        {
            type: 'password',
            name: 'newPassword',
            message: 'Введите новый пароль 2FA (минимум 6 символов):',
            validate: value => value.length >= 6 ? true : 'Пароль должен содержать минимум 6 символов'
        },
        {
            type: 'text',
            name: 'hint',
            message: 'Введите новую подсказку (опционально):',
            initial: ''
        }
    ]);

    if (!response.currentPassword || !response.newPassword) {
        console.log('❌ Операция отменена');
        return;
    }

    const confirmResponse = await prompts({
        type: 'confirm',
        name: 'confirmed',
        message: '❗ Изменить пароль 2FA?',
        initial: false
    });

    if (!confirmResponse.confirmed) {
        console.log('❌ Операция отменена');
        return;
    }

    console.log('\n🔄 Изменение пароля 2FA...\n');

    const changeRequest: I2FAChangeRequest = {
        sessionString,
        currentPassword: response.currentPassword,
        newPassword: response.newPassword,
        hint: response.hint || undefined
    };

    const result = await profileService.change2FAAsync(changeRequest);
    console.log('\n' + ProfileResultAdapter.formatUpdateResult(result));
}

/**
 * Проверка статуса 2FA
 */
async function handleStatus(profileService: ProfileManagerService, sessionString: string) {
    console.log('\n📊 === СТАТУС 2FA ===\n');

    try {
        const status = await profileService.get2FAStatusAsync(sessionString);

        console.log('📋 Информация о 2FA:');
        console.log('----------------------------------------');
        console.log(`🔐 Статус: ${status.isEnabled ? '✅ Включена' : '❌ Отключена'}`);

        if (status.hint) {
            console.log(`💡 Подсказка: ${status.hint}`);
        }

        if (status.recoveryEmail) {
            console.log(`📧 Email восстановления: ${status.recoveryEmail}`);
        }

    } catch (error) {
        console.error('❌ Ошибка получения статуса 2FA:', error);
    }
}

/**
 * Отключение 2FA
 */
async function handleDisable(profileService: ProfileManagerService, sessionString: string) {
    console.log('\n❌ === ОТКЛЮЧЕНИЕ 2FA ===\n');
    console.log('⚠️ ВНИМАНИЕ: Отключение 2FA снизит безопасность вашего аккаунта!');

    const passwordResponse = await prompts({
        type: 'password',
        name: 'currentPassword',
        message: 'Введите текущий пароль 2FA:'
    });

    if (!passwordResponse.currentPassword) {
        console.log('❌ Операция отменена');
        return;
    }

    const confirmResponse = await prompts({
        type: 'confirm',
        name: 'confirmed',
        message: '❗ Вы действительно хотите отключить 2FA?',
        initial: false
    });

    if (!confirmResponse.confirmed) {
        console.log('❌ Операция отменена');
        return;
    }

    console.log('\n🔄 Отключение 2FA...\n');

    const result = await profileService.disable2FAAsync(sessionString, passwordResponse.currentPassword);
    console.log('\n' + ProfileResultAdapter.formatUpdateResult(result));
}

// Обработка прерывания процесса
process.on('SIGINT', () => {
    console.log('\n👋 Операция прервана пользователем');
    process.exit(0);
});

// Запуск скрипта
main().catch(console.error); 