/**
 * Скрипт для генерации SESSION_STRING и добавления в .env
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import * as dotenv from 'dotenv';
import prompts from 'prompts';
import { SessionGeneratorService, InteractiveAuthAdapter } from '../../app/sessionGenerator';
import { EnvAccountsParser } from '../../shared/utils/envAccountsParser';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

async function main() {
    console.log("\n🚀 === ГЕНЕРАЦИЯ СЕССИИ TELEGRAM ===\n");

    try {
        // Шаг 1: Генерация SESSION_STRING с авторизацией
        console.log("📱 Шаг 1/2: Генерация SESSION_STRING...\n");
        const sessionResult = await generateSessionAsync();

        console.log("\n✅ SESSION_STRING получен!");
        console.log(`👤 Пользователь: ${sessionResult.firstName || 'N/A'}`);

        // Проверка статуса аккаунта
        console.log("\n🔍 Проверка статуса аккаунта...");

        // Проверка на удалённый/замороженный аккаунт
        if (!sessionResult.firstName && !sessionResult.lastName) {
            console.error("\n❌ Аккаунт заморожен или удалён!");
            console.error("Аккаунт не имеет имени, возможно он был деактивирован.");
            console.log("\n💡 Проверьте статус аккаунта в официальном приложении Telegram");
            process.exit(1);
        }

        console.log("✅ Аккаунт активен");

        // Шаг 2: Добавление в .env файл
        console.log("\n💾 Шаг 2/2: Добавление аккаунта в .env файл...");

        // Запрашиваем пароль если есть 2FA
        const passwordResponse = await prompts({
            type: 'password',
            name: 'password',
            message: 'Введите пароль 2FA (или оставьте пустым):',
            initial: '111'  // Дефолтный пароль как в примере
        });

        const password = passwordResponse.password || '111';
        await addToEnvFileAsync(sessionResult.sessionString, password);

        // Вывод результата
        console.log("\n" + "=".repeat(60));
        console.log("✅ СЕССИЯ ДОБАВЛЕНА В .ENV!");
        console.log("=".repeat(60));
        console.log(`\n👤 Пользователь: ${sessionResult.firstName || 'N/A'}`);
        console.log(`🔐 Пароль 2FA: ${password}`);
        console.log(`\n📝 Следующий шаг: npm run profile:update`);
        console.log("   (Для установки имени, username, фото и описания профиля)\n");

    } catch (error) {
        console.error("\n❌ Ошибка:", error);
        process.exit(1);
    }
}

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

async function generateSessionAsync(): Promise<any> {
    const apiId = Number(process.env.API_ID);
    const apiHash = process.env.API_HASH;

    if (!apiId || !apiHash) {
        throw new Error("API_ID и API_HASH должны быть указаны в .env файле");
    }

    const authAdapter = new InteractiveAuthAdapter();
    const sessionGenerator = new SessionGeneratorService(authAdapter);

    const options = {
        apiId,
        apiHash,
        deviceModel: "Desktop",
        systemVersion: "Windows 10",
        appVersion: "1.0.0",
        connectionRetries: 5,
        timeout: 30000
    };

    return await sessionGenerator.generateSession(options);
}

async function addToEnvFileAsync(sessionString: string, password: string): Promise<void> {
    const envPath = path.join(process.cwd(), '.env');

    // Читаем текущий .env файл
    let envContent = '';
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf-8');
    }

    // Парсим .env чтобы найти последний использованный номер
    const parser = new EnvAccountsParser();
    const accounts = parser.getAvailableAccounts("PROFILE");

    let maxNumber = 0;
    for (const account of accounts) {
        const match = account.sessionKey.match(/SESSION_STRING_PROFILE_(\d+)/);
        if (match) {
            const num = parseInt(match[1]);
            if (num > maxNumber) maxNumber = num;
        }
    }

    const nextNumber = maxNumber + 1;

    // Формируем новую запись (без username - он будет установлен через profile:update)
    const newEntry = `
### Профиль ${nextNumber}
SESSION_STRING_PROFILE_${nextNumber}="${sessionString}"
PASSWORD_PROFILE_${nextNumber}="${password}"
`;

    // Добавляем в конец файла
    const updatedContent = envContent.trimEnd() + '\n' + newEntry;
    fs.writeFileSync(envPath, updatedContent, 'utf-8');

    console.log(`✅ Аккаунт добавлен в .env как SESSION_STRING_PROFILE_${nextNumber}`);
}

// Запуск
main().catch((error) => {
    console.error("Критическая ошибка:", error);
    process.exit(1);
});
