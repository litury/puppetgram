/**
 * Скрипт для проверки Session String полученного из TData
 * Получает информацию об аккаунте без дополнительной авторизации
 * Следует стандартам компании согласно project-structure.mdc и frontend-coding-standards.mdc
 */

import { SessionGeneratorService } from '../modules/sessionGenerator/services/sessionGeneratorService';
import { SessionResultAdapter } from '../modules/sessionGenerator/adapters/sessionResultAdapter';
import { InteractiveAuthAdapter } from '../modules/sessionGenerator/adapters/interactiveAuthAdapter';
import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

async function main() {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                  🔍 ПРОВЕРКА TDATA SESSION STRING                ║
║                                                                   ║
║  Этот скрипт проверяет Session String полученный из TData         ║
║  и получает информацию об аккаунте                                ║
╚═══════════════════════════════════════════════════════════════════╝
    `);

    try {
        // Проверяем API конфигурацию
        const apiId = Number(process.env.API_ID);
        const apiHash = process.env.API_HASH;

        if (!apiId || !apiHash) {
            console.error("❌ Ошибка: API_ID и API_HASH должны быть указаны в .env файле");
            console.log("\n💡 Инструкции:");
            console.log("1. Получите API_ID и API_HASH на https://my.telegram.org");
            console.log("2. Добавьте их в .env файл:");
            console.log("   API_ID=ваш_api_id");
            console.log("   API_HASH=ваш_api_hash");
            return;
        }

        // Выбираем источник Session String
        const sourceResponse = await prompts({
            type: 'select',
            name: 'source',
            message: 'Выберите источник Session String:',
            choices: [
                { title: '📄 Из созданного TData файла (exports/*.session)', value: 'file' },
                { title: '📝 Ввести вручную', value: 'manual' },
                { title: '🔍 Из переменной окружения SESSION_STRING', value: 'env' }
            ]
        });

        if (!sourceResponse.source) {
            console.log('👋 Операция отменена');
            return;
        }

        let sessionString: string = '';

        switch (sourceResponse.source) {
            case 'file':
                sessionString = await selectFromExportsAsync();
                break;
            case 'manual':
                sessionString = await inputManuallyAsync();
                break;
            case 'env':
                sessionString = process.env.SESSION_STRING || '';
                if (!sessionString) {
                    console.error('❌ SESSION_STRING не найден в переменных окружения');
                    return;
                }
                console.log('✅ Session String загружен из .env файла');
                break;
        }

        if (!sessionString) {
            console.log('❌ Session String не получен');
            return;
        }

        // Создаем сервис для работы с сессиями
        const authAdapter = new InteractiveAuthAdapter();
        const sessionService = new SessionGeneratorService(authAdapter);

        console.log('\n🔄 Получение информации об аккаунте...\n');

        // Получаем информацию об аккаунте (автоматически проверяет валидность)
        try {
            const sessionInfo = await sessionService.getSessionInfo(sessionString);

            // Форматируем и выводим информацию
            console.log(SessionResultAdapter.formatSessionInfo(sessionInfo));

            // Дополнительные действия
            const actionResponse = await prompts({
                type: 'select',
                name: 'action',
                message: '🔧 Выберите дополнительное действие:',
                choices: [
                    { title: '📝 Сохранить информацию в JSON', value: 'save' },
                    { title: '📋 Скопировать в буфер обмена', value: 'copy' },
                    { title: '🔄 Обновить .env файл', value: 'updateEnv' },
                    { title: '✅ Завершить', value: 'exit' }
                ]
            });

            switch (actionResponse.action) {
                case 'save':
                    await saveAccountInfoAsync(sessionInfo, sessionString);
                    break;
                case 'copy':
                    console.log('\n📋 Session String для копирования:');
                    console.log('-'.repeat(60));
                    console.log(sessionString);
                    console.log('-'.repeat(60));
                    break;
                case 'updateEnv':
                    await updateEnvFileAsync(sessionString, sessionInfo);
                    break;
            }

            console.log('\n🎉 Проверка завершена успешно!');

        } catch (error) {
            console.error('❌ Ошибка получения информации об аккаунте:', error);
        }

    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    }
}

/**
 * Выбор Session файла из exports/
 */
async function selectFromExportsAsync(): Promise<string> {
    const exportsDir = path.join(process.cwd(), 'exports');

    if (!fs.existsSync(exportsDir)) {
        console.error('❌ Директория exports/ не найдена');
        return '';
    }

    const files = fs.readdirSync(exportsDir)
        .filter(file => file.endsWith('.session'))
        .sort((a, b) => {
            const statA = fs.statSync(path.join(exportsDir, a));
            const statB = fs.statSync(path.join(exportsDir, b));
            return statB.mtime.getTime() - statA.mtime.getTime(); // Новые файлы сначала
        });

    if (files.length === 0) {
        console.error('❌ Session файлы не найдены в exports/');
        return '';
    }

    const fileResponse = await prompts({
        type: 'select',
        name: 'file',
        message: 'Выберите Session файл:',
        choices: files.map(file => {
            const filePath = path.join(exportsDir, file);
            const stats = fs.statSync(filePath);
            return {
                title: `📄 ${file} (${stats.mtime.toLocaleString()})`,
                value: file
            };
        })
    });

    if (!fileResponse.file) {
        return '';
    }

    const filePath = path.join(exportsDir, fileResponse.file);
    const sessionString = fs.readFileSync(filePath, 'utf-8').trim();

    console.log(`✅ Session String загружен из файла: ${fileResponse.file}`);
    return sessionString;
}

/**
 * Ручной ввод Session String
 */
async function inputManuallyAsync(): Promise<string> {
    const inputResponse = await prompts({
        type: 'text',
        name: 'session',
        message: 'Введите Session String:'
    });

    return inputResponse.session?.trim() || '';
}

/**
 * Сохранение информации об аккаунте
 */
async function saveAccountInfoAsync(_sessionInfo: any, _sessionString: string): Promise<void> {
    try {
        const outputDir = path.join(process.cwd(), 'exports');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const filename = `account_${_sessionInfo.userId || 'unknown'}_${Date.now()}.json`;
        const filePath = path.join(outputDir, filename);

        const accountData = {
            ..._sessionInfo,
            sessionString: _sessionString,
            checkedAt: new Date().toISOString()
        };

        fs.writeFileSync(filePath, JSON.stringify(accountData, null, 2), 'utf-8');
        console.log(`✅ Информация сохранена в файл: ${filePath}`);

    } catch (error) {
        console.error('❌ Ошибка сохранения:', error);
    }
}

/**
 * Обновление .env файла
 */
async function updateEnvFileAsync(_sessionString: string, _sessionInfo: any): Promise<void> {
    try {
        const envPath = path.join(process.cwd(), '.env');
        let envContent = '';

        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf-8');
        }

        // Обновляем или добавляем SESSION_STRING
        const sessionRegex = /^SESSION_STRING=.*$/m;
        const newSessionLine = `SESSION_STRING=${_sessionString}`;

        if (sessionRegex.test(envContent)) {
            envContent = envContent.replace(sessionRegex, newSessionLine);
        } else {
            envContent += `\n# TData Session\n${newSessionLine}\n`;
        }

        // Добавляем комментарий с информацией об аккаунте
        const accountComment = `# Account: ${_sessionInfo.username ? '@' + _sessionInfo.username : _sessionInfo.phoneNumber || _sessionInfo.userId} (ID: ${_sessionInfo.userId})`;
        envContent = envContent.replace(newSessionLine, `${accountComment}\n${newSessionLine}`);

        fs.writeFileSync(envPath, envContent, 'utf-8');
        console.log('✅ .env файл обновлен с новым SESSION_STRING');

    } catch (error) {
        console.error('❌ Ошибка обновления .env файла:', error);
    }
}

if (require.main === module) {
    main().catch(console.error);
}
