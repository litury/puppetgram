/**
 * Генератор сессий для USA аккаунтов через прокси
 *
 * Особенности:
 * - Авторизация через SOCKS5 прокси (hardsession)
 * - USA device fingerprint (iPhone 15 Pro, iOS 17.4, en-US)
 * - Проверка здоровья прокси перед авторизацией
 * - Автоматическое сохранение SESSION_STRING_USA_N в .env
 *
 * Запуск: npm run session:generate-usa
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import prompts from "prompts";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Logger } from "telegram/extensions";
import { Api } from "telegram";

import { parseProxyUrl, loadAllProxies, ProxyConfig } from "../../shared/utils/proxyParser";
import { checkProxyHealth } from "../../shared/utils/proxyChecker";

// =============================================
// USA DEVICE CONFIGURATION
// =============================================

const USA_DEVICE_CONFIG = {
    deviceModel: "iPhone 15 Pro",
    systemVersion: "iOS 17.4",
    appVersion: "10.5.2",
    langCode: "en",
    systemLangCode: "en-US",
};

// =============================================
// MAIN
// =============================================

async function main() {
    console.log("\n🇺🇸 === ГЕНЕРАТОР USA СЕССИЙ ===\n");

    // Проверяем API credentials
    const apiId = Number(process.env.API_ID);
    const apiHash = process.env.API_HASH;

    if (!apiId || !apiHash) {
        console.error("❌ API_ID и API_HASH должны быть указаны в .env");
        process.exit(1);
    }

    // Загружаем доступные прокси
    const proxies = loadAllProxies("PROXY_USA_");

    if (proxies.length === 0) {
        console.error("❌ Не найдено прокси PROXY_USA_* в .env");
        console.log("\nДобавьте прокси в формате:");
        console.log('PROXY_USA_1=socks5://host:port:user:pass');
        process.exit(1);
    }

    console.log(`📡 Найдено ${proxies.length} USA прокси\n`);

    // Проверяем здоровье прокси и показываем выбор
    console.log("🔍 Проверка прокси...\n");

    const proxyChoices: Array<{ title: string; value: { key: string; config: ProxyConfig } | null; disabled?: boolean }> = [];

    for (const proxy of proxies) {
        const number = proxy.key.replace("PROXY_USA_", "");
        process.stdout.write(`  USA_${number}... `);

        const health = await checkProxyHealth(proxy.config, 10000);

        if (health.alive && health.countryCode === "US") {
            console.log(`✅ ${health.ip} (${health.isp?.substring(0, 20)})`);
            proxyChoices.push({
                title: `USA_${number} - ${health.ip} (${health.isp?.substring(0, 25)})`,
                value: { key: proxy.key, config: proxy.config },
            });
        } else if (health.alive) {
            console.log(`⚠️ ${health.countryCode} (не USA)`);
            proxyChoices.push({
                title: `USA_${number} - ${health.ip} (${health.countryCode} - не USA)`,
                value: null,
                disabled: true,
            });
        } else {
            console.log("❌ DEAD");
            proxyChoices.push({
                title: `USA_${number} - DEAD`,
                value: null,
                disabled: true,
            });
        }
    }

    // Фильтруем только рабочие
    const workingChoices = proxyChoices.filter(c => c.value !== null);

    if (workingChoices.length === 0) {
        console.error("\n❌ Нет рабочих USA прокси!");
        process.exit(1);
    }

    console.log("");

    // Выбор прокси
    const proxyResponse = await prompts({
        type: "select",
        name: "proxy",
        message: "Выберите прокси для авторизации:",
        choices: workingChoices as any,
    });

    if (!proxyResponse.proxy) {
        console.log("Отменено");
        return;
    }

    const selectedProxy = proxyResponse.proxy as { key: string; config: ProxyConfig };
    const accountNumber = selectedProxy.key.replace("PROXY_USA_", "");

    // Проверяем, не занят ли этот номер
    const existingSession = process.env[`SESSION_STRING_USA_${accountNumber}`];
    if (existingSession && existingSession !== "твоя_сессия_usa_1") {
        const overwriteResponse = await prompts({
            type: "confirm",
            name: "overwrite",
            message: `⚠️ SESSION_STRING_USA_${accountNumber} уже существует. Перезаписать?`,
            initial: false,
        });

        if (!overwriteResponse.overwrite) {
            console.log("Отменено");
            return;
        }
    }

    // Ввод номера телефона
    const phoneResponse = await prompts({
        type: "text",
        name: "phone",
        message: "Введите номер телефона (с кодом страны, например +1234567890):",
        validate: (value) => {
            if (!value.startsWith("+")) return "Номер должен начинаться с +";
            if (value.length < 10) return "Слишком короткий номер";
            return true;
        },
    });

    if (!phoneResponse.phone) {
        console.log("Отменено");
        return;
    }

    // Создаём клиент с прокси
    console.log(`\n📱 Подключение через ${selectedProxy.config.ip}...`);

    const session = new StringSession("");
    const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: false,
        baseLogger: new Logger("none" as any),
        requestRetries: 3,
        autoReconnect: false,
        proxy: {
            socksType: selectedProxy.config.socksType,
            ip: selectedProxy.config.ip,
            port: selectedProxy.config.port,
            username: selectedProxy.config.username,
            password: selectedProxy.config.password,
        },
        ...USA_DEVICE_CONFIG,
    });

    try {
        await client.connect();

        // Авторизация
        await client.start({
            phoneNumber: async () => phoneResponse.phone,
            password: async () => {
                const response = await prompts({
                    type: "password",
                    name: "password",
                    message: "🔒 Введите пароль 2FA:",
                });
                return response.password || "";
            },
            phoneCode: async () => {
                const response = await prompts({
                    type: "text",
                    name: "code",
                    message: "📨 Введите код из Telegram/SMS:",
                });
                return response.code || "";
            },
            onError: (err) => {
                console.error(`❌ Ошибка: ${err.message}`);
                throw err;
            },
        });

        // Получаем информацию о пользователе
        const me = (await client.getMe()) as Api.User;
        const sessionString = (client.session as StringSession).save();

        console.log(`\n✅ Авторизация успешна!`);
        console.log(`👤 ${me.firstName || ""} ${me.lastName || ""}`);
        if (me.username) console.log(`🏷️ @${me.username}`);

        // Сохраняем в .env
        const envPath = ".env";
        let envContent = fs.readFileSync(envPath, "utf-8");

        const sessionKey = `SESSION_STRING_USA_${accountNumber}`;
        const sessionLine = `${sessionKey}="${sessionString}"`;

        // Проверяем, есть ли уже такая переменная
        const regex = new RegExp(`^${sessionKey}=.*$`, "m");

        if (regex.test(envContent)) {
            // Заменяем существующую
            envContent = envContent.replace(regex, sessionLine);
        } else {
            // Добавляем новую после секции USA АККАУНТЫ
            const usaSection = "# SESSION_STRING_USA_N должен соответствовать PROXY_USA_N";
            if (envContent.includes(usaSection)) {
                envContent = envContent.replace(
                    usaSection,
                    `${usaSection}\n\n### USA аккаунт ${accountNumber}\n${sessionLine}`
                );
            } else {
                // Просто добавляем в конец
                envContent += `\n\n### USA аккаунт ${accountNumber}\n${sessionLine}\n`;
            }
        }

        fs.writeFileSync(envPath, envContent, "utf-8");

        console.log(`\n💾 Сессия сохранена как ${sessionKey}`);
        console.log(`\n🎉 Теперь можно запускать: npm run comment:usa`);

        await client.disconnect();
    } catch (error: any) {
        console.error(`\n❌ Ошибка авторизации: ${error.message}`);

        try {
            await client.disconnect();
        } catch {
            // ignore
        }

        process.exit(1);
    }
}

main().catch((error) => {
    console.error("Фатальная ошибка:", error);
    process.exit(1);
});
