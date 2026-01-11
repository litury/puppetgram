/**
 * Скрипт для обновления профиля USA аккаунтов через прокси
 *
 * Особенности:
 * - Работает через SOCKS5 прокси (PROXY_USA_N)
 * - USA device fingerprint
 * - Устанавливает имя, bio, username, фото
 * - Username начинается с @pravku27
 *
 * Запуск: npm run profile:update-usa
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import prompts from "prompts";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { Logger } from "telegram/extensions";
import { CustomFile } from "telegram/client/uploads";

import { parseProxyUrl, ProxyConfig } from "../../shared/utils/proxyParser";
import { checkProxyHealth } from "../../shared/utils/proxyChecker";
import { SpamChecker } from "../../shared/services/spamChecker";

// =============================================
// КОНФИГУРАЦИЯ
// =============================================

const CONFIG = {
    displayName: "Джун на фронте | IT Dev Log",
    bio: "Пишу код за деньги @divatoz",
    usernamePrefix: "pravku",
    startingNumber: 27, // Начинаем с @pravku27
    photoPath: "./profile-photos/default.jpg",
};

const USA_DEVICE_CONFIG = {
    deviceModel: "iPhone 15 Pro",
    systemVersion: "iOS 17.4",
    appVersion: "10.5.2",
    langCode: "en",
    systemLangCode: "en-US",
};

// =============================================
// ТИПЫ
// =============================================

interface USAAccount {
    number: string;
    sessionKey: string;
    sessionValue: string;
    proxyKey: string;
    proxyConfig: ProxyConfig;
    username?: string;
}

// =============================================
// MAIN
// =============================================

async function main() {
    console.log("\n🇺🇸 === ОБНОВЛЕНИЕ ПРОФИЛЯ USA ===\n");

    let client: TelegramClient | null = null;

    try {
        // Проверяем API credentials
        const apiId = Number(process.env.API_ID);
        const apiHash = process.env.API_HASH;

        if (!apiId || !apiHash) {
            console.error("❌ API_ID и API_HASH должны быть указаны в .env");
            process.exit(1);
        }

        // Загружаем USA аккаунты
        const accounts = loadUSAAccounts();

        if (accounts.length === 0) {
            console.error("❌ Не найдено USA аккаунтов в .env");
            console.log("\nСначала создайте сессию: npm run session:generate-usa\n");
            process.exit(1);
        }

        console.log(`📋 Найдено ${accounts.length} USA аккаунтов\n`);

        // Проверяем прокси
        console.log("🔍 Проверка прокси...\n");

        const accountChoices: Array<{ title: string; value: USAAccount | null; disabled?: boolean }> = [];

        for (const account of accounts) {
            process.stdout.write(`  USA_${account.number}... `);

            const health = await checkProxyHealth(account.proxyConfig, 10000);

            if (health.alive && health.countryCode === "US") {
                console.log(`✅ ${health.ip}`);
                accountChoices.push({
                    title: `USA_${account.number} - ${health.ip} ${account.username ? `(@${account.username})` : "(без username)"}`,
                    value: account,
                });
            } else if (health.alive) {
                console.log(`⚠️ ${health.countryCode} (не USA)`);
                accountChoices.push({
                    title: `USA_${account.number} - не USA прокси`,
                    value: null,
                    disabled: true,
                });
            } else {
                console.log("❌ DEAD");
                accountChoices.push({
                    title: `USA_${account.number} - прокси не работает`,
                    value: null,
                    disabled: true,
                });
            }
        }

        // Фильтруем только рабочие
        const workingChoices = accountChoices.filter((c) => c.value !== null);

        if (workingChoices.length === 0) {
            console.error("\n❌ Нет аккаунтов с рабочими USA прокси!");
            process.exit(1);
        }

        console.log("");

        // Выбор аккаунта
        const accountResponse = await prompts({
            type: "select",
            name: "account",
            message: "Выберите аккаунт для обновления:",
            choices: workingChoices as any,
        });

        if (!accountResponse.account) {
            console.log("Отменено");
            return;
        }

        const selectedAccount = accountResponse.account as USAAccount;

        // Подключаемся через прокси
        console.log(`\n📱 Подключение USA_${selectedAccount.number} через прокси...`);

        const session = new StringSession(selectedAccount.sessionValue);
        client = new TelegramClient(session, apiId, apiHash, {
            connectionRetries: 5,
            useWSS: false,
            baseLogger: new Logger("none" as any),
            requestRetries: 3,
            autoReconnect: false,
            proxy: {
                socksType: selectedAccount.proxyConfig.socksType,
                ip: selectedAccount.proxyConfig.ip,
                port: selectedAccount.proxyConfig.port,
                username: selectedAccount.proxyConfig.username,
                password: selectedAccount.proxyConfig.password,
            },
            ...USA_DEVICE_CONFIG,
        });

        await client.connect();
        console.log("✅ Подключение установлено\n");

        // Проверка статуса аккаунта
        console.log("🔍 Проверка статуса аккаунта...");

        const me = (await client.getMe()) as Api.User;

        if (!me.firstName && !me.lastName) {
            console.error("\n❌ Аккаунт заморожен или удалён!");
            process.exit(1);
        }
        console.log("  ✅ Аккаунт активен");

        // Проверка спама
        console.log("  → Проверка спама через @SpamBot...");
        const spamChecker = new SpamChecker();
        const isSpammed = await spamChecker.isAccountSpammedReliable(client, `USA_${selectedAccount.number}`);

        if (isSpammed) {
            console.error("\n❌ Аккаунт в спаме!");
            process.exit(1);
        }
        console.log("  ✅ Аккаунт чистый\n");

        // Обновление профиля
        console.log("📝 Шаг 1/3: Установка имени и описания профиля...");
        await client.invoke(
            new Api.account.UpdateProfile({
                firstName: CONFIG.displayName,
                lastName: "",
                about: CONFIG.bio,
            })
        );
        console.log(`✅ Имя: "${CONFIG.displayName}"`);
        console.log(`✅ Bio: "${CONFIG.bio}"`);

        // Установка username
        console.log("\n🏷️ Шаг 2/3: Установка username...");
        const username = await findAndSetUsername(client, selectedAccount.number);

        // Загрузка фото
        console.log("\n📸 Шаг 3/3: Загрузка фото профиля...");
        await setProfilePhoto(client);

        // Отключаемся
        console.log("\n🔌 Отключение от Telegram...");
        await client.disconnect();
        client = null;

        // Сохраняем username в .env
        await updateUsernameInEnv(selectedAccount.number, username);

        // Итоги
        console.log("\n" + "=".repeat(60));
        console.log("✅ ПРОФИЛЬ USA УСПЕШНО ОБНОВЛЁН!");
        console.log("=".repeat(60));
        console.log(`\n👤 Имя: ${CONFIG.displayName}`);
        console.log(`🏷️ Username: @${username}`);
        console.log(`📋 Bio: ${CONFIG.bio}`);
        console.log(`📸 Фото: ${CONFIG.photoPath}`);
        console.log(`\n✅ Аккаунт готов к использованию: npm run comment:usa\n`);
    } catch (error: any) {
        const errorMsg = error?.message || error?.toString() || "";

        if (errorMsg.includes("FLOOD_WAIT")) {
            console.error("\n❌ FLOOD_WAIT - подождите перед следующей попыткой");
            process.exit(1);
        }

        if (errorMsg.includes("AUTH_KEY") || errorMsg.includes("USER_DEACTIVATED")) {
            console.error("\n❌ Аккаунт заморожен или сессия невалидна!");
            process.exit(1);
        }

        console.error("\n❌ Ошибка:", error);
        process.exit(1);
    } finally {
        if (client) {
            try {
                await client.disconnect();
            } catch {
                // ignore
            }
        }
    }
}

// =============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================

/**
 * Загрузка USA аккаунтов из .env
 */
function loadUSAAccounts(): USAAccount[] {
    const accounts: USAAccount[] = [];

    for (let i = 1; i <= 20; i++) {
        const sessionKey = `SESSION_STRING_USA_${i}`;
        const proxyKey = `PROXY_USA_${i}`;
        const usernameKey = `USERNAME_USA_${i}`;

        const sessionValue = process.env[sessionKey];
        const proxyUrl = process.env[proxyKey];
        const username = process.env[usernameKey]?.replace("@", "");

        if (sessionValue && proxyUrl) {
            const proxyConfig = parseProxyUrl(proxyUrl);

            if (proxyConfig) {
                accounts.push({
                    number: String(i),
                    sessionKey,
                    sessionValue,
                    proxyKey,
                    proxyConfig,
                    username,
                });
            }
        }
    }

    return accounts;
}

/**
 * Поиск и установка свободного username
 */
async function findAndSetUsername(client: TelegramClient, accountNumber: string): Promise<string> {
    // Загружаем существующие USERNAME_USA_* чтобы найти максимальный номер
    let maxNumber = CONFIG.startingNumber - 1;

    for (let i = 1; i <= 20; i++) {
        const username = process.env[`USERNAME_USA_${i}`]?.replace("@", "");
        if (username) {
            const match = username.match(/pravku(\d+)/i);
            if (match) {
                const num = parseInt(match[1]);
                if (num > maxNumber) maxNumber = num;
            }
        }
    }

    // Также проверяем PROFILE аккаунты
    for (let i = 1; i <= 50; i++) {
        const username = process.env[`USERNAME_PROFILE_${i}`]?.replace("@", "");
        if (username) {
            const match = username.match(/pravku(\d+)/i);
            if (match) {
                const num = parseInt(match[1]);
                if (num > maxNumber) maxNumber = num;
            }
        }
    }

    let nextNumber = maxNumber + 1;

    while (nextNumber < maxNumber + 100) {
        const usernameToTry = `${CONFIG.usernamePrefix}${nextNumber}`;
        console.log(`🔄 Пробую @${usernameToTry}...`);

        try {
            await client.invoke(
                new Api.account.UpdateUsername({
                    username: usernameToTry,
                })
            );

            console.log(`✅ Username установлен: @${usernameToTry}`);
            return usernameToTry;
        } catch (error: any) {
            const errorMsg = error?.message || "";

            if (errorMsg.includes("USERNAME_OCCUPIED") || errorMsg.includes("USERNAME_NOT_MODIFIED")) {
                console.log(`❌ @${usernameToTry} занят`);
                nextNumber++;
                continue;
            }

            throw error;
        }
    }

    throw new Error("Не удалось найти свободный username после 100 попыток");
}

/**
 * Установка фото профиля
 */
async function setProfilePhoto(client: TelegramClient): Promise<void> {
    if (!fs.existsSync(CONFIG.photoPath)) {
        console.log(`⚠️ Фото не найдено: ${CONFIG.photoPath}`);
        return;
    }

    try {
        const fileBuffer = fs.readFileSync(CONFIG.photoPath);
        const fileName = path.basename(CONFIG.photoPath);

        const customFile = new CustomFile(fileName, fileBuffer.length, CONFIG.photoPath, fileBuffer);

        const uploadedFile = await client.uploadFile({
            file: customFile,
            workers: 1,
        });

        await client.invoke(
            new Api.photos.UploadProfilePhoto({
                file: uploadedFile,
            })
        );

        console.log(`✅ Фото загружено: ${CONFIG.photoPath}`);
    } catch (error: any) {
        console.error(`❌ Ошибка загрузки фото: ${error?.message || error}`);
    }
}

/**
 * Сохранение username в .env
 */
async function updateUsernameInEnv(accountNumber: string, username: string): Promise<void> {
    const envPath = path.join(process.cwd(), ".env");
    let envContent = fs.readFileSync(envPath, "utf-8");

    const usernameKey = `USERNAME_USA_${accountNumber}`;
    const sessionKey = `SESSION_STRING_USA_${accountNumber}`;

    // Проверяем, есть ли уже USERNAME_USA_X
    const usernameRegex = new RegExp(`${usernameKey}="[^"]*"`, "g");

    if (usernameRegex.test(envContent)) {
        // Обновляем существующий
        envContent = envContent.replace(usernameRegex, `${usernameKey}="@${username}"`);
    } else {
        // Добавляем после SESSION_STRING_USA_X
        const sessionKeyRegex = new RegExp(`(${sessionKey}="[^"]+")`, "g");
        envContent = envContent.replace(sessionKeyRegex, `$1\n${usernameKey}="@${username}"`);
    }

    fs.writeFileSync(envPath, envContent, "utf-8");
    console.log(`✅ Username сохранён в .env: ${usernameKey}="@${username}"`);
}

// Запуск
main().catch((error) => {
    console.error("Фатальная ошибка:", error);
    process.exit(1);
});
