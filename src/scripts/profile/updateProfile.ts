/**
 * Скрипт для обновления данных профиля Telegram
 * Устанавливает имя, username, фото и bio для существующих аккаунтов
 * Использует ЕДИНОЕ подключение для всех операций
 */

import * as dotenv from 'dotenv';
import prompts from 'prompts';
import { EnvAccountsParser } from '../../shared/utils/envAccountsParser';
import * as fs from 'fs';
import * as path from 'path';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { CustomFile } from 'telegram/client/uploads';
import { SpamChecker } from '../../shared/services/spamChecker';

dotenv.config();

// Конфигурация
const CONFIG = {
    displayName: "Джун на фронте | IT Dev Log",
    bio: "Пишу код за деньги @divatoz",
    usernamePrefix: "pravku",  // pravku1, pravku2, pravku3...
    photoPath: "./profile-photos/default.jpg",
};

async function main() {
    console.log("\n🔧 === ОБНОВЛЕНИЕ ПРОФИЛЯ TELEGRAM ===\n");

    let client: TelegramClient | null = null;

    try {
        // Шаг 1: Выбор аккаунта из .env
        const parser = new EnvAccountsParser();
        const accounts = parser.getAvailableAccounts("PROFILE");

        if (accounts.length === 0) {
            console.error("❌ Нет доступных профильных аккаунтов в .env");
            console.log("\n💡 Сначала создайте аккаунт с помощью: npm run profile:setup\n");
            process.exit(1);
        }

        const accountChoices = accounts.map((acc, idx) => ({
            title: `${acc.name} (${acc.username || 'без username'})`,
            value: idx
        }));

        const accountResponse = await prompts({
            type: 'select',
            name: 'accountIndex',
            message: 'Выберите аккаунт для обновления:',
            choices: accountChoices
        });

        if (accountResponse.accountIndex === undefined) {
            console.log("Операция отменена");
            return;
        }

        const selectedAccount = accounts[accountResponse.accountIndex];
        const sessionString = selectedAccount.sessionValue;

        if (!sessionString) {
            console.error(`❌ Не найден SESSION_STRING для аккаунта ${selectedAccount.name}`);
            process.exit(1);
        }

        console.log(`\n📝 Обновление профиля для: ${selectedAccount.name}\n`);

        // Шаг 2: Создаём ЕДИНОЕ подключение
        console.log("🔌 Подключение к Telegram...");

        const apiId = Number(process.env.API_ID);
        const apiHash = process.env.API_HASH;

        if (!apiId || !apiHash) {
            throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
        }

        const session = new StringSession(sessionString);
        client = new TelegramClient(session, apiId, apiHash, {
            connectionRetries: 5,
        });

        await client.connect();
        console.log("✅ Подключение установлено\n");

        // Шаг 3: Проверка статуса аккаунта
        console.log("🔍 Проверка статуса аккаунта...");

        // 3.1. Проверка заморозки
        console.log("  → Проверка на заморозку...");
        const me = await client.getMe() as Api.User;

        if (!me.firstName && !me.lastName) {
            console.error("\n❌ Аккаунт заморожен или удалён!");
            console.error("Аккаунт не имеет имени, возможно он был деактивирован.");
            console.log("\n💡 Проверьте статус аккаунта в официальном приложении Telegram");
            process.exit(1);
        }

        console.log("  ✅ Аккаунт активен");

        // 3.2. Проверка спама (двойная проверка для надёжности)
        console.log("  → Проверка спама через @SpamBot...");
        const spamChecker = new SpamChecker();
        const isSpammed = await spamChecker.isAccountSpammedReliable(
            client,
            selectedAccount.name
        );

        if (isSpammed) {
            console.error("\n❌ Аккаунт в спаме!");
            console.error(`Аккаунт ${selectedAccount.name} ограничен Telegram за спам.`);
            console.log("\n💡 Проверьте статус аккаунта через @SpamBot в официальном приложении");
            process.exit(1);
        }

        console.log("  ✅ Аккаунт чистый\n");

        console.log("✅ Все проверки пройдены, начинаю обновление профиля...\n");

        // Шаг 4: Установка имени И bio через ЕДИНОЕ подключение
        console.log("📝 Шаг 1/3: Установка имени и описания профиля...");
        await client.invoke(
            new Api.account.UpdateProfile({
                firstName: CONFIG.displayName,
                lastName: "",
                about: CONFIG.bio
            })
        );
        console.log(`✅ Имя установлено: "${CONFIG.displayName}"`);
        console.log(`✅ Описание установлено: "${CONFIG.bio}"`);

        // Шаг 5: Установка username через ЕДИНОЕ подключение
        console.log("\n🏷️ Шаг 2/3: Установка username...");
        const username = await findAndSetUsername(client);

        // Шаг 6: Загрузка фото через ЕДИНОЕ подключение
        console.log("\n📸 Шаг 3/3: Загрузка фото профиля...");
        await setProfilePhoto(client);

        // Шаг 7: Отключаемся
        console.log("\n🔌 Отключение от Telegram...");
        await client.disconnect();
        client = null;
        console.log("✅ Отключение завершено");

        // Шаг 8: Обновление username в .env (ПОСЛЕ отключения)
        await updateUsernameInEnv(selectedAccount.sessionKey, username);

        // Вывод итоговых результатов
        console.log("\n" + "=".repeat(60));
        console.log("✅ ПРОФИЛЬ УСПЕШНО ОБНОВЛЁН!");
        console.log("=".repeat(60));
        console.log(`\n👤 Имя: ${CONFIG.displayName}`);
        console.log(`🏷️ Username: @${username}`);
        console.log(`📋 Bio: ${CONFIG.bio}`);
        console.log(`📸 Фото: ${CONFIG.photoPath || 'не установлено'}`);
        console.log(`\n✅ Аккаунт готов к использованию в npm run comment:profile\n`);

    } catch (error: any) {
        const errorMsg = error?.message || error?.toString() || "";

        // FLOOD_WAIT - аккаунт исчерпал лимит
        if (errorMsg.includes("FLOOD_WAIT")) {
            console.error("\n❌ Аккаунт исчерпал лимит API запросов!");
            console.error("Необходимо подождать перед следующей операцией.");
            console.log("\n💡 Попробуйте позже или используйте другой аккаунт");
            process.exit(1);
        }

        // Другие ошибки аутентификации
        if (errorMsg.includes("AUTH_KEY") || errorMsg.includes("USER_DEACTIVATED")) {
            console.error("\n❌ Аккаунт заморожен, удалён или сессия невалидна!");
            console.error(`Ошибка: ${errorMsg}`);
            console.log("\n💡 Создайте новую сессию через: npm run profile:setup");
            process.exit(1);
        }

        // Неизвестная ошибка
        console.error("\n❌ Ошибка:", error);
        process.exit(1);
    } finally {
        // Гарантируем отключение даже при ошибке
        if (client) {
            try {
                await client.disconnect();
            } catch (e) {
                // Игнорируем ошибки отключения
            }
        }
    }
}

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

/**
 * Поиск следующего свободного username и установка
 * Использует существующее подключение client
 */
async function findAndSetUsername(client: TelegramClient): Promise<string> {
    // Парсим .env чтобы найти последний использованный username
    const parser = new EnvAccountsParser();
    const accounts = parser.getAvailableAccounts("PROFILE");

    let maxNumber = 0;
    for (const account of accounts) {
        if (account.username) {
            const match = account.username.match(/pravku(\d+)/i);
            if (match) {
                const num = parseInt(match[1]);
                if (num > maxNumber) maxNumber = num;
            }
        }
    }

    // Пробуем установить username (без предварительной проверки доступности)
    let nextNumber = maxNumber + 1;

    while (nextNumber < maxNumber + 100) { // Защита от бесконечного цикла
        const usernameToTry = `${CONFIG.usernamePrefix}${nextNumber}`;
        console.log(`🔄 Пробую установить @${usernameToTry}...`);

        try {
            // Сразу пытаемся установить username через существующее подключение
            await client.invoke(
                new Api.account.UpdateUsername({
                    username: usernameToTry
                })
            );

            console.log(`✅ Username установлен: @${usernameToTry}`);
            return usernameToTry;
        } catch (error: any) {
            const errorMsg = error?.message || "";

            // Если username занят - пробуем следующий
            if (errorMsg.includes("USERNAME_OCCUPIED") || errorMsg.includes("USERNAME_NOT_MODIFIED")) {
                console.log(`❌ @${usernameToTry} занят, пробую следующий...`);
                nextNumber++;
                continue;
            }

            // Другая ошибка - пробрасываем
            throw error;
        }
    }

    throw new Error("Не удалось найти свободный username после 100 попыток");
}

/**
 * Загрузка фото профиля
 * Использует существующее подключение client
 */
async function setProfilePhoto(client: TelegramClient): Promise<void> {
    // Проверяем наличие файла
    if (!fs.existsSync(CONFIG.photoPath)) {
        console.log(`⚠️ Фото не найдено по пути: ${CONFIG.photoPath}`);
        console.log(`⚠️ Пропускаю установку фото профиля`);
        return;
    }

    try {
        // Читаем файл как Buffer
        const fileBuffer = fs.readFileSync(CONFIG.photoPath);
        const fileName = path.basename(CONFIG.photoPath);

        // Создаём CustomFile объект (как в profileManagerService.ts:350-355)
        const customFile = new CustomFile(
            fileName,           // name: имя файла
            fileBuffer.length,  // size: размер в байтах
            CONFIG.photoPath,   // path: путь к файлу
            fileBuffer          // buffer: содержимое файла
        );

        // Загружаем файл через существующее подключение
        const uploadedFile = await client.uploadFile({
            file: customFile,
            workers: 1
        });

        // Устанавливаем фото профиля
        await client.invoke(
            new Api.photos.UploadProfilePhoto({
                file: uploadedFile
            })
        );

        console.log(`✅ Фото профиля загружено: ${CONFIG.photoPath}`);
    } catch (error: any) {
        console.error(`❌ Ошибка загрузки фото: ${error?.message || error}`);
        console.log(`⚠️ Продолжаю без установки фото`);
    }
}

/**
 * Обновление username в .env файле
 */
async function updateUsernameInEnv(sessionKey: string, username: string): Promise<void> {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');

    const usernameKey = sessionKey.replace('SESSION_STRING', 'USERNAME');

    // Проверяем, есть ли уже USERNAME_PROFILE_X в .env
    const usernameRegex = new RegExp(`${usernameKey}="[^"]*"`, 'g');

    if (usernameRegex.test(envContent)) {
        // Обновляем существующий username
        envContent = envContent.replace(usernameRegex, `${usernameKey}="@${username}"`);
    } else {
        // Добавляем новую строку USERNAME_PROFILE_X после SESSION_STRING_PROFILE_X
        const sessionKeyRegex = new RegExp(`(${sessionKey}="[^"]+")`, 'g');
        envContent = envContent.replace(
            sessionKeyRegex,
            `$1\n${usernameKey}="@${username}"`
        );
    }

    fs.writeFileSync(envPath, envContent, 'utf-8');
    console.log(`✅ Username обновлён в .env: @${username}`);
}

// Запуск
main().catch((error) => {
    console.error("Критическая ошибка:", error);
    process.exit(1);
});
