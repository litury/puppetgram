/**
 * Скрипт для конвертации TData в Session String
 * Поддерживает множественные аккаунты и интерактивный режим
 * Следует стандартам компании согласно project-structure.mdc и frontend-coding-standards.mdc
 */

import { TdataSessionConverterService } from '../../app/tdataConverter/services/tdataSessionConverterService';
import { ITdataConversionRequest } from '../../app/tdataConverter/interfaces/ITdataSessionConverter';
import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

// Константы
const INPUT_TDATA_DIR = 'input-tdata';

async function main() {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                  🔄 КОНВЕРТАЦИЯ TDATA В SESSION                ║
║                                                                ║
║  Этот скрипт конвертирует TData файлы Telegram Desktop         ║
║  в Session String для использования с GramJS                   ║
╚════════════════════════════════════════════════════════════════╝
    `);

    const tdataConverter = new TdataSessionConverterService();

    try {
        // Выбор действия
        const { action } = await prompts({
            type: 'select',
            name: 'action',
            message: 'Выберите действие:',
            choices: [
                { title: '🔄 Конвертировать TData в Session', value: 'convert' },
                { title: '📋 Показать информацию о TData', value: 'info' },
                { title: '✅ Валидировать TData', value: 'validate' },
                { title: '🚪 Выход', value: 'exit' }
            ]
        });

        if (!action || action === 'exit') {
            console.log('👋 До свидания!');
            return;
        }

        // Поиск доступных TData папок
        const tdataFolders = await scanTdataFolders(tdataConverter);

        if (tdataFolders.length === 0) {
            console.log(`
❌ TData папки не найдены!

📁 Разместите ваши TData папки в директории: input-tdata/

Пример:
  input-tdata/
  ├── my-tdata/
  │   ├── key_datas
  │   ├── D877F783D5D3EF8C/
  │   └── ...
  └── another-tdata/

Запустите скрипт снова после размещения TData папок.
            `);
            return;
        }

        // Выбор TData папки
        const { selectedTdata } = await prompts({
            type: 'select',
            name: 'selectedTdata',
            message: `Выберите TData папку (найдено: ${tdataFolders.length}):`,
            choices: tdataFolders.map(folder => ({
                title: `📁 ${folder.name} (${folder.accountCount} аккаунт${getAccountsSuffix(folder.accountCount)})`,
                description: folder.path,
                value: folder.path
            }))
        });

        if (!selectedTdata) {
            console.log('❌ Операция отменена');
            return;
        }

        // Выполняем выбранное действие
        switch (action) {
            case 'convert':
                await performConversion(selectedTdata, tdataConverter);
                break;
            case 'info':
                await showTdataInfo(tdataConverter, selectedTdata);
                break;
            case 'validate':
                await validateTdata(tdataConverter, selectedTdata);
                break;
        }

    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    }
}

/**
 * Сканирует TData папки и возвращает информацию о них
 */
async function scanTdataFolders(tdataConverter: TdataSessionConverterService): Promise<Array<{ name: string; accountCount: number; path: string }>> {
    const inputDir = path.join(process.cwd(), INPUT_TDATA_DIR);
    const tdataFolders: Array<{ name: string; accountCount: number; path: string }> = [];

    try {
        if (!fs.existsSync(inputDir)) {
            fs.mkdirSync(inputDir, { recursive: true });
            console.log(`📁 Создана директория: ${inputDir}`);
            return tdataFolders;
        }

        const items = await fs.promises.readdir(inputDir);

        for (const item of items) {
            const itemPath = path.join(inputDir, item);
            const stats = await fs.promises.stat(itemPath);

            if (stats.isDirectory()) {
                try {
                    // Проверяем наличие key_datas файла
                    const keyDatasPath = path.join(itemPath, 'key_datas');
                    await fs.promises.access(keyDatasPath);

                    // Получаем информацию об аккаунтах
                    const multiAccountInfo = await tdataConverter.getMultiAccountInfoAsync(itemPath);

                    tdataFolders.push({
                        name: item,
                        accountCount: multiAccountInfo.accountCount,
                        path: itemPath
                    });
                } catch {
                    // Пропускаем папки без key_datas или с ошибками
                    continue;
                }
            }
        }
    } catch (error) {
        console.error('❌ Ошибка сканирования TData папок:', error);
    }

    return tdataFolders;
}

/**
 * Выполняет конвертацию TData в Session
 */
async function performConversion(_tdataPath: string, tdataConverter: TdataSessionConverterService) {
    console.log(`\n📁 Выбрана TData: ${path.basename(_tdataPath)}`);
    console.log('\n🔄 === КОНВЕРТАЦИЯ TDATA В SESSION ===\n');

    try {
        // Получаем информацию об аккаунтах
        const multiAccountInfo = await tdataConverter.getMultiAccountInfoAsync(_tdataPath);
        console.log(`📊 Найдено аккаунтов: ${multiAccountInfo.accountCount}`);

        // Если нет аккаунтов
        if (multiAccountInfo.accountCount === 0) {
            console.log('⚠️ В выбранной TData папке не найдено аккаунтов для конвертации');
            console.log('📋 Структура должна содержать:');
            console.log('   - key_datas файл');
            console.log('   - Папки аккаунтов (MD5 имена длиной 16 символов)');
            console.log('   - Файлы данных аккаунтов (MD5 + "s")');
            console.log('   - JSON файлы с метаданными (номер_телефона.json)');
            return;
        }

        // Показываем найденные компоненты
        if (multiAccountInfo.accountsMetadata.length > 0) {
            console.log('\n📋 Найденные аккаунты:');
            multiAccountInfo.accountsMetadata.forEach((account, index) => {
                console.log(`   ${index + 1}. 📱 ${account.phoneNumber} (ID: ${account.userId})`);
                if (account.username) {
                    console.log(`      👤 @${account.username}`);
                }
            });
        }

        let selectedAccountIndex = 0;

        // Если несколько аккаунтов, предлагаем выбор
        if (multiAccountInfo.hasMultipleAccounts && multiAccountInfo.accountsMetadata.length > 1) {
            const accountChoices = multiAccountInfo.accountsMetadata.map((account, index) => ({
                title: `📱 ${account.phoneNumber}${account.username ? ` (@${account.username})` : ''}`,
                value: index
            }));

            accountChoices.push({
                title: '🔄 Конвертировать все аккаунты',
                value: -1
            });

            const accountSelection = await prompts({
                type: 'select',
                name: 'accountIndex',
                message: 'Выберите аккаунт для конвертации:',
                choices: accountChoices
            });

            if (accountSelection.accountIndex === undefined) {
                console.log('❌ Конвертация отменена');
                return;
            }

            selectedAccountIndex = accountSelection.accountIndex;
        }

        // Запрашиваем пароль TData
        const passwordPrompt = await prompts({
            type: 'password',
            name: 'password',
            message: 'Введите пароль TData (оставьте пустым если нет):'
        });

        if (passwordPrompt.password === undefined) {
            console.log('❌ Конвертация отменена');
            return;
        }

        // Выбираем формат вывода
        const formatPrompt = await prompts({
            type: 'select',
            name: 'format',
            message: 'Выберите формат вывода:',
            choices: [
                { title: '📄 Session String (.session файл)', value: 'session' },
                { title: '📋 JSON метаданные (.json файл)', value: 'json' },
                { title: '📦 Оба формата', value: 'both' }
            ]
        });

        if (!formatPrompt.format) {
            console.log('❌ Конвертация отменена');
            return;
        }

        // Выполняем конвертацию
        if (selectedAccountIndex === -1) {
            // Конвертируем все аккаунты
            console.log('\n🔄 Конвертация всех аккаунтов...\n');

            for (let i = 0; i < multiAccountInfo.accountsMetadata.length; i++) {
                const account = multiAccountInfo.accountsMetadata[i];
                console.log(`\n📱 Конвертация аккаунта ${i + 1}/${multiAccountInfo.accountsMetadata.length}: ${account.phoneNumber}`);

                await convertSingleAccount(_tdataPath, i, passwordPrompt.password, formatPrompt.format, tdataConverter);
            }
        } else {
            // Конвертируем выбранный аккаунт
            const account = multiAccountInfo.accountsMetadata[selectedAccountIndex];
            console.log(`\n📱 Конвертация аккаунта: ${account.phoneNumber}`);

            await convertSingleAccount(_tdataPath, selectedAccountIndex, passwordPrompt.password, formatPrompt.format, tdataConverter);
        }

    } catch (error) {
        console.error('❌ Ошибка конвертации:', error);
    }
}

/**
 * Конвертирует один аккаунт
 */
async function convertSingleAccount(_tdataPath: string, _accountIndex: number, _password: string, _format: string, tdataConverter: TdataSessionConverterService) {
    try {
        const conversionRequest: ITdataConversionRequest = {
            tdataPath: _tdataPath,
            outputFormat: _format as 'session' | 'json' | 'both',
            password: _password || undefined,
            accountIndex: _accountIndex
        };

        const result = await tdataConverter.convertTdataToSessionAsync(conversionRequest);

        if (result.success) {
            console.log('✅ Конвертация успешно завершена!');
            console.log('\n📂 Созданные файлы:');

            if (result.sessionFilePath) {
                console.log(`   📄 Session: ${result.sessionFilePath}`);
            }

            if (result.jsonFilePath) {
                console.log(`   📋 JSON: ${result.jsonFilePath}`);
            }

            if (result.accountInfo) {
                console.log('\n📊 Информация об аккаунте:');
                console.log(`   📱 Телефон: ${result.accountInfo.phoneNumber}`);
                console.log(`   🆔 ID: ${result.accountInfo.userId}`);
                if (result.accountInfo.username) {
                    console.log(`   👤 Username: @${result.accountInfo.username}`);
                }
                console.log(`   🌐 DC: ${result.accountInfo.dcId}`);
            }
        } else {
            console.error('❌ Конвертация не удалась:', result.error);
            if (result.details) {
                console.error('📋 Детали:', result.details);
            }
        }

    } catch (error) {
        console.error('❌ Ошибка конвертации аккаунта:', error);
    }
}

/**
 * Показывает информацию о TData
 */
async function showTdataInfo(tdataConverter: TdataSessionConverterService, _tdataPath: string) {
    console.log(`\n📁 Выбрана TData: ${path.basename(_tdataPath)}`);
    console.log('\n📋 === ИНФОРМАЦИЯ О TDATA ===\n');

    try {
        // Валидация
        const validation = await tdataConverter.validateTdataAsync(_tdataPath);
        console.log(`✅ Валидность: ${validation.isValid ? 'Валидна' : 'Невалидна'}`);

        if (!validation.isValid) {
            console.log('❌ Ошибки:');
            validation.errors.forEach(error => console.log(`   • ${error}`));
            return;
        }

        // Информация об аккаунтах
        const multiAccountInfo = await tdataConverter.getMultiAccountInfoAsync(_tdataPath);
        console.log(`👥 Количество аккаунтов: ${multiAccountInfo.accountCount}`);
        console.log(`🔢 Версия key_datas: ${multiAccountInfo.keyDatasVersion}`);

        // Найденные компоненты
        console.log(`\n📂 Папки аккаунтов: ${multiAccountInfo.accountFolders.length}`);
        multiAccountInfo.accountFolders.forEach(folder => console.log(`   📁 ${folder}`));

        console.log(`\n📄 Файлы данных аккаунтов: ${multiAccountInfo.accountDataFiles.length}`);
        multiAccountInfo.accountDataFiles.forEach(file => console.log(`   📄 ${file}`));

        // Метаданные аккаунтов
        if (multiAccountInfo.accountsMetadata.length > 0) {
            console.log('\n👤 Найденные аккаунты:');
            multiAccountInfo.accountsMetadata.forEach((account, index) => {
                console.log(`   ${index + 1}. 📱 ${account.phoneNumber} (ID: ${account.userId})`);
                if (account.username) {
                    console.log(`      👤 @${account.username}`);
                }
                console.log(`      🌐 DC: ${account.dcId}`);
                if (account.additionalMetadata?.appVersion) {
                    console.log(`      📱 Версия: ${account.additionalMetadata.appVersion}`);
                }
            });
        }

        if (validation.warnings.length > 0) {
            console.log('\n⚠️ Предупреждения:');
            validation.warnings.forEach(warning => console.log(`   • ${warning}`));
        }

    } catch (error) {
        console.error('❌ Ошибка получения информации:', error);
    }
}

/**
 * Валидирует TData
 */
async function validateTdata(tdataConverter: TdataSessionConverterService, _tdataPath: string) {
    console.log(`\n📁 Выбрана TData: ${path.basename(_tdataPath)}`);
    console.log('\n✅ === ВАЛИДАЦИЯ TDATA ===\n');

    try {
        const validation = await tdataConverter.validateTdataAsync(_tdataPath);

        console.log(`📋 Результат: ${validation.isValid ? '✅ ВАЛИДНА' : '❌ НЕВАЛИДНА'}`);

        if (validation.isValid) {
            console.log('🎉 TData прошла все проверки и готова для конвертации!');
        }

        if (validation.errors.length > 0) {
            console.log('\n❌ Ошибки:');
            validation.errors.forEach(error => console.log(`   • ${error}`));
        }

        if (validation.warnings.length > 0) {
            console.log('\n⚠️ Предупреждения:');
            validation.warnings.forEach(warning => console.log(`   • ${warning}`));
        }

        console.log(`\n📄 Найденные файлы ключей: ${validation.keyFiles.length}`);
        validation.keyFiles.forEach(file => console.log(`   ✅ ${file}`));

        console.log(`\n📂 Найденные папки аккаунтов: ${validation.accountFolders.length}`);
        validation.accountFolders.forEach(folder => console.log(`   ✅ ${folder}`));

        // Дополнительная информация об аккаунтах
        try {
            const multiAccountInfo = await tdataConverter.getMultiAccountInfoAsync(_tdataPath);
            console.log(`\n👥 Обнаружено аккаунтов: ${multiAccountInfo.accountCount}`);

            if (multiAccountInfo.accountsMetadata.length > 0) {
                console.log('\n📱 Аккаунты с метаданными:');
                multiAccountInfo.accountsMetadata.forEach((account, index) => {
                    console.log(`   ${index + 1}. ${account.phoneNumber} (ID: ${account.userId})`);
                });
            }
        } catch (error) {
            console.warn('⚠️ Не удалось получить дополнительную информацию об аккаунтах:', error);
        }

    } catch (error) {
        console.error('❌ Ошибка валидации:', error);
    }
}

/**
 * Получает правильное окончание для слова "аккаунт"
 */
function getAccountsSuffix(_count: number): string {
    if (_count % 10 === 1 && _count % 100 !== 11) {
        return '';
    } else if ([2, 3, 4].includes(_count % 10) && ![12, 13, 14].includes(_count % 100)) {
        return 'а';
    } else {
        return 'ов';
    }
}

/**
 * Получает описание формата вывода
 */
function getFormatDescription(_format: string): string {
    switch (_format) {
        case 'session': return 'Только Session файл';
        case 'json': return 'Только JSON файл';
        case 'both': return 'Session + JSON файлы';
        default: return 'Неизвестный формат';
    }
}

/**
 * Расширяет переменные окружения в пути
 */
function expandPath(_inputPath: string): string {
    let expanded = _inputPath;

    if (process.platform === 'win32') {
        expanded = expanded.replace(/%([^%]+)%/g, (_, varName) =>
            process.env[varName] || `%${varName}%`
        );
    } else {
        if (expanded.startsWith('~')) {
            expanded = path.join(process.env.HOME || '', expanded.slice(1));
        }
    }

    return path.resolve(expanded);
}

if (require.main === module) {
    main().catch(console.error);
} 