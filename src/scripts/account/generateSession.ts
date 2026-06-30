/**
 * Скрипт для генерации сессий Telegram
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import * as dotenv from 'dotenv';
import prompts from 'prompts';
import {
    SessionGeneratorService,
    InteractiveAuthAdapter,
    SessionStorageAdapter,
    SessionResultAdapter,
    ISessionGenerationOptions
} from '../../app/sessionGenerator';

// Загружаем переменные окружения
dotenv.config();

async function main() {
    console.log("\n🔐 === ГЕНЕРАТОР СЕССИЙ TELEGRAM ===\n");

    try {
        // Проверяем наличие API_ID и API_HASH
        const apiId = Number(process.env.API_ID);
        const apiHash = process.env.API_HASH;

        if (!apiId || !apiHash) {
            console.error("❌ Ошибка: API_ID и API_HASH должны быть указаны в .env файле");
            console.log("\n💡 Инструкции:");
            console.log("1. Получите API_ID и API_HASH на https://my.telegram.org");
            console.log("2. Добавьте их в .env файл:");
            console.log("   API_ID=ваш_api_id");
            console.log("   API_HASH=ваш_api_hash");
            process.exit(1);
        }

        // Создаем адаптеры и сервисы
        const authAdapter = new InteractiveAuthAdapter();
        const storageAdapter = new SessionStorageAdapter();
        const sessionGenerator = new SessionGeneratorService(authAdapter);

        // Показываем меню действий
        const actionResponse = await prompts({
            type: 'select',
            name: 'action',
            message: 'Выберите действие:',
            choices: [
                { title: '🆕 Создать новую сессию', value: 'generate' },
                { title: '📷 Создать сессию по QR (без кода — для аккаунтов с активной сессией)', value: 'generate-qr' },
                { title: '📋 Просмотреть сохраненные сессии', value: 'list' },
                { title: '🔍 Проверить сессию', value: 'validate' },
                { title: '🗑️ Удалить сессию', value: 'delete' }
            ],
            initial: 0
        });

        if (!actionResponse.action) {
            console.log("Операция отменена");
            return;
        }

        switch (actionResponse.action) {
            case 'generate':
                await handleGenerateSession(sessionGenerator, storageAdapter, apiId, apiHash);
                break;
            case 'generate-qr':
                await handleGenerateSessionQr(sessionGenerator, storageAdapter, apiId, apiHash);
                break;
            case 'list':
                await handleListSessions(storageAdapter);
                break;
            case 'validate':
                await handleValidateSession(sessionGenerator, storageAdapter);
                break;
            case 'delete':
                await handleDeleteSession(storageAdapter);
                break;
        }

    } catch (error) {
        console.error(SessionResultAdapter.formatError(error as Error));
    }
}

/**
 * Обработка генерации новой сессии
 */
async function handleGenerateSession(
    sessionGenerator: SessionGeneratorService,
    storageAdapter: SessionStorageAdapter,
    apiId: number,
    apiHash: string
) {
    try {
        console.log("\n🚀 Начинается процесс создания сессии...");
        console.log("📝 Подготовьте ваш телефон для получения кода подтверждения\n");

        const options: ISessionGenerationOptions = {
            apiId,
            apiHash,
            deviceModel: "Desktop",
            systemVersion: "Windows 10",
            appVersion: "1.0.0",
            connectionRetries: 5,
            timeout: 30000
        };

        // Генерируем сессию
        const result = await sessionGenerator.generateSession(options);

        // Отображаем результат
        console.log(SessionResultAdapter.formatGenerationResult(result));

        // Предлагаем сохранить сессию
        const saveResponse = await prompts({
            type: 'confirm',
            name: 'save',
            message: 'Сохранить сессию в файл?',
            initial: true
        });

        if (saveResponse.save) {
            const filename = await storageAdapter.saveSession(result);
            console.log(`\n💾 Сессия сохранена в файл: ${filename}`);

            const storageInfo = storageAdapter.getStorageInfo();
            console.log(`📁 Директория: ${storageInfo.directory}`);
        }

        // Показываем инструкции по использованию
        console.log(SessionResultAdapter.formatUsageInstructions(result.sessionString));

    } catch (error) {
        console.error(SessionResultAdapter.formatError(error as Error));
    }
}

/**
 * Обработка генерации сессии по QR-коду (без SMS/кода).
 * Подходит, когда у аккаунта есть активная сессия (есть чем сканировать QR),
 * а код входа не доходит / SendCode зафлужен.
 */
async function handleGenerateSessionQr(
    sessionGenerator: SessionGeneratorService,
    storageAdapter: SessionStorageAdapter,
    apiId: number,
    apiHash: string
) {
    try {
        console.log("\n📷 === QR-ЛОГИН (без кода) ===");
        console.log("Нужен телефон/устройство, где аккаунт УЖЕ залогинен.");
        console.log("На нём: Telegram → Настройки → Устройства → «Подключить устройство» → отсканируй QR ниже.\n");

        const options: ISessionGenerationOptions = {
            apiId,
            apiHash,
            deviceModel: "Desktop",
            systemVersion: "Windows 10",
            appVersion: "1.0.0",
            connectionRetries: 5,
            timeout: 30000
        };

        const result = await sessionGenerator.generateSessionViaQr(options);

        console.log(SessionResultAdapter.formatGenerationResult(result));

        const saveResponse = await prompts({
            type: 'confirm',
            name: 'save',
            message: 'Сохранить сессию в файл?',
            initial: true
        });

        if (saveResponse.save) {
            const filename = await storageAdapter.saveSession(result);
            console.log(`\n💾 Сессия сохранена в файл: ${filename}`);
            const storageInfo = storageAdapter.getStorageInfo();
            console.log(`📁 Директория: ${storageInfo.directory}`);
        }

        console.log(SessionResultAdapter.formatUsageInstructions(result.sessionString));

    } catch (error) {
        console.error(SessionResultAdapter.formatError(error as Error));
    }
}

/**
 * Обработка просмотра сохраненных сессий
 */
async function handleListSessions(storageAdapter: SessionStorageAdapter) {
    try {
        const sessions = await storageAdapter.listSessions();
        console.log(SessionResultAdapter.formatSessionsList(sessions));

        if (sessions.length > 0) {
            const storageInfo = storageAdapter.getStorageInfo();
            console.log(`\n📁 Директория: ${storageInfo.directory}`);
            console.log(`📊 Всего сессий: ${storageInfo.totalSessions}`);
        }
    } catch (error) {
        console.error(`❌ Ошибка получения списка сессий: ${error}`);
    }
}

/**
 * Обработка валидации сессии
 */
async function handleValidateSession(
    sessionGenerator: SessionGeneratorService,
    storageAdapter: SessionStorageAdapter
) {
    try {
        const validationResponse = await prompts({
            type: 'select',
            name: 'source',
            message: 'Откуда взять сессию для проверки?',
            choices: [
                { title: '📝 Ввести SESSION_STRING вручную', value: 'manual' },
                { title: '📂 Выбрать из сохраненных файлов', value: 'file' }
            ]
        });

        let sessionString = '';

        if (validationResponse.source === 'manual') {
            const inputResponse = await prompts({
                type: 'text',
                name: 'sessionString',
                message: 'Введите SESSION_STRING:',
                validate: (value: string) => value.trim().length > 0 ? true : 'SESSION_STRING не может быть пустым'
            });

            if (!inputResponse.sessionString) {
                console.log("Операция отменена");
                return;
            }

            sessionString = inputResponse.sessionString.trim();
        } else {
            const sessions = await storageAdapter.listSessions();

            if (sessions.length === 0) {
                console.log("❌ Сохраненные сессии не найдены");
                return;
            }

            const fileResponse = await prompts({
                type: 'select',
                name: 'filename',
                message: 'Выберите файл сессии:',
                choices: sessions.map((session: any) => ({ title: session, value: session }))
            });

            if (!fileResponse.filename) {
                console.log("Операция отменена");
                return;
            }

            const sessionData = await storageAdapter.loadSession(fileResponse.filename);
            sessionString = sessionData.sessionString;
        }

        console.log("\n🔍 Проверка сессии...");

        const isValid = await sessionGenerator.validateExistingSession(sessionString);

        if (isValid) {
            console.log("✅ Сессия действительна");

            try {
                const sessionInfo = await sessionGenerator.getSessionInfo(sessionString);
                console.log(SessionResultAdapter.formatSessionInfo(sessionInfo));
            } catch (error) {
                console.log("⚠️  Не удалось получить подробную информацию о сессии");
            }
        } else {
            console.log("❌ Сессия недействительна или истекла");
        }

    } catch (error) {
        console.error(`❌ Ошибка валидации сессии: ${error}`);
    }
}

/**
 * Обработка удаления сессии
 */
async function handleDeleteSession(storageAdapter: SessionStorageAdapter) {
    try {
        const sessions = await storageAdapter.listSessions();

        if (sessions.length === 0) {
            console.log("❌ Сохраненные сессии не найдены");
            return;
        }

        const choices = [
            ...sessions.map((session: any) => ({ title: session, value: session })),
            { title: '🗑️ Удалить все сессии', value: 'all' }
        ];

        const deleteResponse = await prompts({
            type: 'select',
            name: 'target',
            message: 'Что удалить?',
            choices
        });

        if (!deleteResponse.target) {
            console.log("Операция отменена");
            return;
        }

        if (deleteResponse.target === 'all') {
            const confirmResponse = await prompts({
                type: 'confirm',
                name: 'confirm',
                message: '⚠️  Вы уверены, что хотите удалить ВСЕ сессии?',
                initial: false
            });

            if (confirmResponse.confirm) {
                const deletedCount = await storageAdapter.clearAllSessions();
                console.log(`✅ Удалено сессий: ${deletedCount}`);
            } else {
                console.log("Операция отменена");
            }
        } else {
            const confirmResponse = await prompts({
                type: 'confirm',
                name: 'confirm',
                message: `Удалить сессию ${deleteResponse.target}?`,
                initial: false
            });

            if (confirmResponse.confirm) {
                const success = await storageAdapter.deleteSession(deleteResponse.target);
                if (success) {
                    console.log(`✅ Сессия ${deleteResponse.target} удалена`);
                } else {
                    console.log(`❌ Не удалось удалить сессию ${deleteResponse.target}`);
                }
            } else {
                console.log("Операция отменена");
            }
        }

    } catch (error) {
        console.error(`❌ Ошибка удаления сессии: ${error}`);
    }
}

// Запуск скрипта
main().catch((error) => {
    console.error("Критическая ошибка:", error);
    process.exit(1);
}); 