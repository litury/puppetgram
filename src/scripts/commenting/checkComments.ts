import { GramClient } from "../../telegram/adapters/gramClient";
import { CommentCheckerService, CommentResultAdapter, parseChannelsFromFile } from "../../app/commentChecker";
import { ExportService } from "../../shared/exportService";
import prompts from "prompts";
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const gramClient = new GramClient();

    try {
        await gramClient.connect();
        console.log("\n🔍 Проверка комментариев в Telegram каналах");
        console.log("═══════════════════════════════════════════");
        console.log("\n🚨 КРИТИЧЕСКИ ВАЖНО: Строгие лимиты для избежания FloodWait:");
        console.log("• ОБЯЗАТЕЛЬНАЯ задержка: МИНИМУМ 10 секунд между каналами");
        console.log("• МАКСИМУМ каналов за сессию: 50 (не больше!)");
        console.log("• ТОЛЬКО 1 поток - никогда не используйте параллельность");
        console.log("• При FloodWait - НЕМЕДЛЕННО остановите все операции");
        console.log("• FloodWait длится 6-24+ часов - ожидание ОБЯЗАТЕЛЬНО");
        console.log("═══════════════════════════════════════════");

        const commentService = new CommentCheckerService(gramClient.getClient());
        const adapter = new CommentResultAdapter();

        // Выбор режима работы
        const modeResponse = await prompts({
            type: "select",
            name: "mode",
            message: "Выберите режим проверки:",
            choices: [
                { title: "🔍 Проверить один канал", value: "single" },
                { title: "📊 Массовая проверка каналов", value: "bulk" },
                { title: "📁 Проверить каналы из файла", value: "file" },
                { title: "🔄 Восстановить прогресс", value: "resume" }
            ],
            initial: 0
        });

        if (!modeResponse.mode) {
            throw new Error("Операция отменена пользователем");
        }

        switch (modeResponse.mode) {
            case "single":
                await handleSingleChannelCheck(commentService, adapter);
                break;
            case "bulk":
                await handleBulkChannelCheck(commentService, adapter, gramClient);
                break;
            case "file":
                await handleFileChannelCheck(commentService, adapter, gramClient);
                break;
            case "resume":
                await handleResumeProgress(commentService, adapter);
                break;
        }

    } catch (error) {
        console.error("\n❌ Произошла ошибка:", error);
    } finally {
        await gramClient.disconnect();
        console.log("\n✅ Работа программы завершена");
    }
}

/**
 * Проверка одного канала
 */
async function handleSingleChannelCheck(
    service: CommentCheckerService,
    adapter: CommentResultAdapter
) {
    console.log("\n🔍 Проверка одного канала");
    console.log("─────────────────────────");

    const channelResponse = await prompts({
        type: "text",
        name: "channelName",
        message: "Введите имя канала (например, @channel_name):",
        validate: (value) => value.length > 0 ? true : "Имя канала не может быть пустым"
    });

    if (!channelResponse.channelName) {
        throw new Error("Операция отменена пользователем");
    }

    const optionsResponse = await prompts([
        {
            type: "confirm",
            name: "checkActivity",
            message: "Проверить активность комментариев?",
            initial: true
        },
        {
            type: "confirm",
            name: "includeStats",
            message: "Включить статистику?",
            initial: true
        }
    ]);

    console.log(`\n🔍 Проверяю канал ${channelResponse.channelName}...`);

    try {
        const result = await service.checkChannelComments({
            channelName: channelResponse.channelName,
            checkRecentActivity: optionsResponse.checkActivity,
            includeStatistics: optionsResponse.includeStats,
            activityDays: 7
        });

        console.log("\n" + adapter.formatSingleChannelResult(result));

        // Предложение сохранить результат
        const saveResponse = await prompts({
            type: "confirm",
            name: "save",
            message: "Сохранить результат в файл?",
            initial: false
        });

        if (saveResponse.save) {
            await saveResultToFile(result, adapter, channelResponse.channelName);
        }

    } catch (error) {
        console.error("❌ Ошибка при проверке канала:", error);
    }
}

/**
 * Массовая проверка каналов
 */
async function handleBulkChannelCheck(
    service: CommentCheckerService,
    adapter: CommentResultAdapter,
    gramClient: any
) {
    console.log("\n📊 Массовая проверка каналов");
    console.log("───────────────────────────");

    const channelsResponse = await prompts({
        type: "text",
        name: "channels",
        message: "Введите имена каналов через запятую:",
        validate: (value) => value.length > 0 ? true : "Список каналов не может быть пустым"
    });

    if (!channelsResponse.channels) {
        throw new Error("Операция отменена пользователем");
    }

    const allChannels = channelsResponse.channels
        .split(",")
        .map((ch: string) => ch.trim())
        .filter((ch: string) => ch.length > 0);

    // Ограничиваем количество каналов для безопасности
    if (allChannels.length > 50) {
        console.log(`\n⚠️ ПРЕДУПРЕЖДЕНИЕ: Вы ввели ${allChannels.length} каналов.`);
        console.log(`🛡️ Для безопасности рекомендуется обрабатывать максимум 50 каналов за раз.`);

        const limitResponse = await prompts({
            type: "confirm",
            name: "proceed",
            message: `Обработать только первые 50 каналов?`,
            initial: true
        });

        if (!limitResponse.proceed) {
            throw new Error("Операция отменена пользователем");
        }
    }

    const channels = allChannels.slice(0, 50); // Ограничиваем до 50 каналов

    // УЛЬТРА-МЕДЛЕННЫЙ РЕЖИМ - 30 СЕКУНД!
    console.log(`\n🐌 РЕЖИМ: Ультра-медленная задержка`);
    console.log(`⏱️ Задержка: 30 секунд между каналами`);
    console.log(`📊 Скорость: ~120 каналов в час`);
    console.log(`🛡️ Безопасность: ЭКСТРЕМАЛЬНАЯ`);

    // УЛЬТРА-МЕДЛЕННЫЕ настройки - ВСЕГДА 30 СЕКУНД!
    const limiterOptions = {
        initialDelay: 30000,      // 30 секунд
        minDelay: 30000,         // ВСЕГДА 30 секунд
        maxDelay: 30000,         // ВСЕГДА 30 секунд  
        aggressiveMode: false,
        responseTimeThreshold: 10000  // Не используется
    };
    const description = "🐌 УЛЬТРА-МЕДЛЕННАЯ ЗАДЕРЖКА: 30 секунд между КАЖДЫМ каналом";

    console.log(`\n📊 Начинаю проверку ${channels.length} каналов...`);
    console.log(`⚡ ${description}`);
    console.log(`💾 Автосохранение включено - прогресс будет сохраняться после каждого канала`);

    // Создаем файлы для прогресса
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const progressFile = `./exports/progress_check_comments_${timestamp}.json`;

    // Создаем сервис с адаптивными настройками
    const adaptiveService = new CommentCheckerService(gramClient.getClient(), limiterOptions);

    try {
        const results = await adaptiveService.checkMultipleChannels({
            channels,
            parallelLimit: 1, // Всегда 1
            delayBetweenRequests: 0, // Не используется, заменено адаптивным лимитером
            autoSaveResults: true,
            progressFilePath: progressFile
        });

        console.log("\n" + adapter.formatBulkResults(results));

        // Автосохранение в TXT + предложение других форматов
        await autoSaveAndOfferExport(results, adapter);

    } catch (error) {
        console.error("❌ Ошибка при массовой проверке:", error);
    }
}

/**
 * Проверка каналов из файла
 */
async function handleFileChannelCheck(
    service: CommentCheckerService,
    adapter: CommentResultAdapter,
    gramClient: any
) {
    console.log("\n📁 Проверка каналов из файла");
    console.log("────────────────────────────");

    // Сканируем папку input-channels для доступных файлов
    const inputDir = './input-channels';
    const availableFiles: string[] = [];

    if (fs.existsSync(inputDir)) {
        const files = fs.readdirSync(inputDir)
            .filter(file => file.endsWith('.txt') && !file.startsWith('.'))
            .map(file => path.join(inputDir, file));

        availableFiles.push(...files);
    }

    // Добавляем файлы из корневой папки
    const rootFiles = [
        './channels-example.txt',
        './channels.txt',
        './input.txt'
    ].filter(file => fs.existsSync(file));

    availableFiles.push(...rootFiles);

    let selectedFile: string;

    if (availableFiles.length > 0) {
        console.log(`\n📋 Найдено ${availableFiles.length} файлов с каналами:`);

        const choices = [
            ...availableFiles.map(file => ({
                title: `📄 ${path.basename(file)} (${getFileInfo(file)})`,
                value: file
            })),
            {
                title: "📂 Указать другой файл...",
                value: "custom"
            }
        ];

        const fileChoice = await prompts({
            type: "select",
            name: "selectedFile",
            message: "Выберите файл:",
            choices
        });

        if (!fileChoice.selectedFile) {
            throw new Error("Операция отменена пользователем");
        }

        if (fileChoice.selectedFile === "custom") {
            const customFileResponse = await prompts({
                type: "text",
                name: "filename",
                message: "Введите путь к файлу:",
                validate: (value) => {
                    if (!value) return "Путь к файлу не может быть пустым";
                    if (!fs.existsSync(value)) return "Файл не найден";
                    return true;
                }
            });

            if (!customFileResponse.filename) {
                throw new Error("Операция отменена пользователем");
            }

            selectedFile = customFileResponse.filename;
        } else {
            selectedFile = fileChoice.selectedFile;
        }
    } else {
        // Если файлов не найдено, просим указать путь
        const fileResponse = await prompts({
            type: "text",
            name: "filename",
            message: "Файлы не найдены. Введите путь к файлу с каналами:",
            validate: (value) => {
                if (!value) return "Путь к файлу не может быть пустым";
                if (!fs.existsSync(value)) return "Файл не найден";
                return true;
            }
        });

        if (!fileResponse.filename) {
            throw new Error("Операция отменена пользователем");
        }

        selectedFile = fileResponse.filename;
    }

    try {
        const fileContent = fs.readFileSync(selectedFile, 'utf-8');
        const channels = parseChannelsFromFile(fileContent);

        if (channels.length === 0) {
            throw new Error("В файле не найдено валидных имён каналов");
        }

        console.log(`\n📋 Найдено ${channels.length} каналов в файле ${path.basename(selectedFile)}`);
        console.log(`📄 Примеры: ${channels.slice(0, 3).join(', ')}${channels.length > 3 ? '...' : ''}`);

        const settingsResponse = await prompts([
            {
                type: "confirm",
                name: "autoSave",
                message: "Включить автосохранение прогресса и удаление обработанных каналов?",
                initial: true
            }
        ]);

        // УЛЬТРА-МЕДЛЕННЫЙ РЕЖИМ - 30 СЕКУНД!
        console.log(`\n🐌 РЕЖИМ: Ультра-медленная задержка`);
        console.log(`⏱️ Задержка: 30 секунд между каналами`);
        console.log(`📊 Скорость: ~120 каналов в час`);
        console.log(`🛡️ Безопасность: ЭКСТРЕМАЛЬНАЯ`);

        // УЛЬТРА-МЕДЛЕННЫЕ настройки - ВСЕГДА 30 СЕКУНД!
        const limiterOptions = {
            initialDelay: 30000,      // 30 секунд
            minDelay: 30000,         // ВСЕГДА 30 секунд
            maxDelay: 30000,         // ВСЕГДА 30 секунд  
            aggressiveMode: false,
            responseTimeThreshold: 10000  // Не используется
        };
        const description = "🐌 УЛЬТРА-МЕДЛЕННАЯ ЗАДЕРЖКА: 30 секунд между КАЖДЫМ каналом";

        console.log(`\n📊 Начинаю проверку каналов из файла...`);
        console.log(`⚡ ${description}`);
        if (settingsResponse.autoSave) {
            console.log(`💾 Автосохранение включено - прогресс будет сохраняться после каждого канала`);
            console.log(`🗑️ Обработанные каналы будут удаляться из исходного файла`);
        }

        // Создаем файлы для прогресса
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const progressFile = settingsResponse.autoSave ? `./exports/progress_file_check_${timestamp}.json` : undefined;

        // Создаем адаптивный сервис
        const adaptiveService = new CommentCheckerService(gramClient.getClient(), limiterOptions);

        const results = await adaptiveService.checkMultipleChannels({
            channels,
            parallelLimit: 1, // Всегда 1
            delayBetweenRequests: 0, // Не используется
            autoSaveResults: settingsResponse.autoSave,
            progressFilePath: progressFile,
            sourceFilePath: settingsResponse.autoSave ? selectedFile : undefined
        });

        console.log("\n" + adapter.formatBulkResults(results));

        // Автосохранение в TXT + предложение других форматов
        await autoSaveAndOfferExport(results, adapter);

    } catch (error) {
        console.error("❌ Ошибка при чтении файла:", error);
    }
}

/**
 * Восстановление прогресса из сохраненного файла
 */
async function handleResumeProgress(
    service: CommentCheckerService,
    adapter: CommentResultAdapter
) {
    console.log("\n🔄 Восстановление прогресса");
    console.log("─────────────────────────");

    // Ищем файлы прогресса
    const exportsDir = './exports';
    const progressFiles: string[] = [];

    if (fs.existsSync(exportsDir)) {
        const files = fs.readdirSync(exportsDir)
            .filter(file => file.startsWith('progress_') && file.endsWith('.json'))
            .map(file => path.join(exportsDir, file));

        progressFiles.push(...files);
    }

    if (progressFiles.length === 0) {
        console.log("❌ Файлы прогресса не найдены");
        return;
    }

    // Сортируем по дате (новые первые)
    progressFiles.sort((a, b) => {
        const statsA = fs.statSync(a);
        const statsB = fs.statSync(b);
        return statsB.mtime.getTime() - statsA.mtime.getTime();
    });

    const choices = progressFiles.map(file => {
        try {
            const content = JSON.parse(fs.readFileSync(file, 'utf8'));
            const fileName = path.basename(file);
            const lastUpdate = new Date(content.lastUpdate).toLocaleString();
            const progress = `${content.processedChannels}/${content.totalChannels}`;

            return {
                title: `📄 ${fileName} (${progress} каналов, ${lastUpdate})`,
                value: file
            };
        } catch (error) {
            return {
                title: `📄 ${path.basename(file)} (ошибка чтения)`,
                value: file
            };
        }
    });

    const fileChoice = await prompts({
        type: "select",
        name: "selectedFile",
        message: "Выберите файл прогресса:",
        choices
    });

    if (!fileChoice.selectedFile) {
        throw new Error("Операция отменена пользователем");
    }

    try {
        const progressData = JSON.parse(fs.readFileSync(fileChoice.selectedFile, 'utf8'));

        console.log(`\n📊 Восстанавливаю прогресс:`);
        console.log(`• Обработано каналов: ${progressData.processedChannels}/${progressData.totalChannels}`);
        console.log(`• Последний канал: ${progressData.lastProcessedChannel}`);
        console.log(`• Последнее обновление: ${new Date(progressData.lastUpdate).toLocaleString()}`);

        // Показываем результаты
        console.log("\n" + adapter.formatBulkResults({
            results: progressData.results,
            totalChecked: progressData.processedChannels,
            successfulChecks: progressData.results.filter((r: any) => r.success).length,
            failedChecks: progressData.results.filter((r: any) => !r.success).length,
            summary: {
                enabledComments: progressData.results.filter((r: any) => r.success && r.channel.commentsPolicy === 'enabled').length,
                disabledComments: progressData.results.filter((r: any) => r.success && r.channel.commentsPolicy === 'disabled').length,
                restrictedComments: progressData.results.filter((r: any) => r.success && r.channel.commentsPolicy === 'restricted').length,
                membersOnlyComments: progressData.results.filter((r: any) => r.success && r.channel.commentsPolicy === 'members_only').length,
                approvalRequiredComments: progressData.results.filter((r: any) => r.success && r.channel.commentsPolicy === 'approval_required').length,
                withDiscussionGroups: progressData.results.filter((r: any) => r.success && r.channel.linkedDiscussionGroup).length
            }
        }));

        // Предлагаем экспорт
        await autoSaveAndOfferExport(progressData, adapter);

    } catch (error) {
        console.error("❌ Ошибка при восстановлении прогресса:", error);
    }
}

/**
 * Получение информации о файле
 */
function getFileInfo(filePath: string): string {
    try {
        const stats = fs.statSync(filePath);
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').length;
        const size = stats.size < 1024 ? `${stats.size}B` : `${Math.round(stats.size / 1024)}KB`;
        return `${lines} строк, ${size}`;
    } catch (error) {
        return 'информация недоступна';
    }
}

/**
 * Автосохранение в TXT и предложение других форматов
 */
async function autoSaveAndOfferExport(
    results: any,
    adapter: CommentResultAdapter
) {
    // Автоматически сохраняем в TXT
    const txtFile = await saveResultsToTxt(results);
    console.log(`\n✅ Результаты автоматически сохранены: ${txtFile}`);

    // 🆕 Автоматически экспортируем ссылки на каналы с комментариями
    await exportChannelLinksForBot(results);

    // Предлагаем дополнительные форматы
    const additionalExport = await prompts({
        type: "confirm",
        name: "export",
        message: "Экспортировать также в другие форматы (JSON/CSV)?",
        initial: false
    });

    if (additionalExport.export) {
        await handleBulkResultsExport(results, adapter, false);
    }
}

/**
 * Сохранение в TXT формат
 */
async function saveResultsToTxt(results: any): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `comment_check_${timestamp}.txt`;
    const filePath = path.join('./exports', fileName);

    // Создаем папку если её нет
    const exportsDir = './exports';
    if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
    }

    let content = `ОТЧЁТ О ПРОВЕРКЕ КОММЕНТАРИЕВ В TELEGRAM КАНАЛАХ\n`;
    content += `Дата проверки: ${new Date().toLocaleString('ru-RU')}\n`;
    content += `${'='.repeat(60)}\n\n`;

    // Общая статистика
    content += `ОБЩАЯ СТАТИСТИКА:\n`;
    content += `- Всего проверено: ${results.totalChecked}\n`;
    content += `- Успешно: ${results.successfulChecks}\n`;
    content += `- Ошибок: ${results.failedChecks}\n`;
    content += `- Комментарии доступны всем: ${results.summary.enabledComments || 0}\n`;
    content += `- Только участникам: ${results.summary.membersOnlyComments || 0}\n`;
    content += `- Требует одобрения: ${results.summary.approvalRequiredComments || 0}\n`;
    content += `- Ограничены: ${results.summary.restrictedComments || 0}\n`;
    content += `- Отключены: ${results.summary.disabledComments || 0}\n`;
    content += `- С дискуссионными группами: ${results.summary.withDiscussionGroups || 0}\n\n`;

    // Разбивка по категориям
    const categories = {
        'КОММЕНТАРИИ ДОСТУПНЫ ВСЕМ': results.results.filter((r: any) => r.channel.commentsPolicy === 'enabled'),
        'ТОЛЬКО ДЛЯ УЧАСТНИКОВ': results.results.filter((r: any) => r.channel.commentsPolicy === 'members_only'),
        'ТРЕБУЕТ ОДОБРЕНИЯ': results.results.filter((r: any) => r.channel.commentsPolicy === 'approval_required'),
        'ОГРАНИЧЕНЫ': results.results.filter((r: any) => r.channel.commentsPolicy === 'restricted'),
        'ОТКЛЮЧЕНЫ': results.results.filter((r: any) => r.channel.commentsPolicy === 'disabled'),
        'ОШИБКИ': results.results.filter((r: any) => !r.success)
    };

    for (const [categoryName, channels] of Object.entries(categories)) {
        if ((channels as any[]).length === 0) continue;

        content += `${categoryName} (${(channels as any[]).length}):\n`;
        content += `${'-'.repeat(40)}\n`;

        (channels as any[]).forEach((result, index) => {
            const channel = result.channel;
            content += `${index + 1}. ${channel.channelTitle}\n`;

            if (channel.channelUsername) {
                content += `   Username: @${channel.channelUsername}\n`;
                content += `   Ссылка на канал: https://t.me/${channel.channelUsername}\n`;
            }

            if (channel.participantsCount) {
                content += `   Подписчиков: ${channel.participantsCount.toLocaleString('ru-RU')}\n`;
            }

            if (channel.linkedDiscussionGroup) {
                content += `   Дискуссионная группа: ${channel.linkedDiscussionGroup.title}\n`;
                if (channel.linkedDiscussionGroup.username) {
                    content += `   Ссылка на чат: https://t.me/${channel.linkedDiscussionGroup.username}\n`;
                }
            }

            if (channel.accessRequirements?.membershipRequired) {
                if (channel.accessRequirements.joinRequest) {
                    content += `   Требования: Одобрение администрации\n`;
                } else if (channel.accessRequirements.joinToSend) {
                    content += `   Требования: Вступление в канал\n`;
                }
            }

            if (result.error) {
                content += `   Ошибка: ${result.error}\n`;
            }

            content += `\n`;
        });

        content += `\n`;
    }

    await fs.promises.writeFile(filePath, content, 'utf-8');
    return filePath;
}

/**
 * Обработка экспорта результатов массовой проверки
 */
async function handleBulkResultsExport(
    results: any,
    adapter: CommentResultAdapter,
    autoExport: boolean = false
) {
    if (autoExport) {
        // Автоматический экспорт в JSON по умолчанию
        await saveResultsToJson(results);
        return;
    }

    const exportResponse = await prompts({
        type: "confirm",
        name: "export",
        message: "Экспортировать результаты?",
        initial: true
    });

    if (!exportResponse.export) return;

    const formatResponse = await prompts({
        type: "select",
        name: "format",
        message: "Выберите формат экспорта:",
        choices: [
            { title: "📄 JSON (структурированные данные)", value: "json" },
            { title: "📝 Markdown (читаемый отчёт)", value: "markdown" },
            { title: "📊 CSV (для Excel)", value: "csv" }
        ],
        initial: 0
    });

    if (!formatResponse.format) return;

    try {
        let filePath: string;

        switch (formatResponse.format) {
            case "json":
                filePath = await saveResultsToJson(results);
                break;
            case "markdown":
                filePath = await saveResultsToMarkdown(results, adapter);
                break;
            case "csv":
                filePath = await saveResultsToCsv(results);
                break;
            default:
                throw new Error("Неподдерживаемый формат");
        }

        console.log(`\n✅ Результаты сохранены: ${filePath}`);

    } catch (error) {
        console.error("❌ Ошибка при экспорте:", error);
    }
}

/**
 * Экспорт в JSON с полной информацией
 */
async function saveResultsToJson(results: any): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `comment_check_${timestamp}.json`;
    const filePath = path.join('./exports', fileName);

    // Создаем папку если её нет
    const exportsDir = './exports';
    if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
    }

    const exportData = {
        metadata: {
            exportDate: new Date().toISOString(),
            totalChecked: results.totalChecked,
            successfulChecks: results.successfulChecks,
            failedChecks: results.failedChecks,
            summary: results.summary
        },
        channels: results.results.map((result: any, index: number) => ({
            id: index + 1,
            channel: {
                ...result.channel,
                checkDate: result.checkDate,
                success: result.success,
                error: result.error,
                recommendations: result.recommendations
            }
        }))
    };

    await fs.promises.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
    return filePath;
}

/**
 * Экспорт в улучшенный Markdown
 */
async function saveResultsToMarkdown(results: any, adapter: CommentResultAdapter): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `comment_check_${timestamp}.md`;
    const filePath = path.join('./exports', fileName);

    // Создаем папку если её нет
    const exportsDir = './exports';
    if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
    }

    let content = `# Отчёт о проверке комментариев в каналах\n\n`;
    content += `**Дата проверки:** ${new Date().toLocaleString('ru-RU')}\n\n`;

    // Общая статистика
    content += `## 📊 Общая статистика\n\n`;
    content += `- **Всего проверено:** ${results.totalChecked}\n`;
    content += `- **Успешно:** ${results.successfulChecks}\n`;
    content += `- **Ошибок:** ${results.failedChecks}\n`;
    content += `- **Комментарии доступны всем:** ${results.summary.enabledComments || 0}\n`;
    content += `- **Только участникам:** ${results.summary.membersOnlyComments || 0}\n`;
    content += `- **Требует одобрения:** ${results.summary.approvalRequiredComments || 0}\n`;
    content += `- **Ограничены:** ${results.summary.restrictedComments || 0}\n`;
    content += `- **Отключены:** ${results.summary.disabledComments || 0}\n`;
    content += `- **С дискуссионными группами:** ${results.summary.withDiscussionGroups || 0}\n\n`;

    // Разбивка по категориям
    const categories = {
        'Доступны всем': results.results.filter((r: any) => r.channel.commentsPolicy === 'enabled'),
        'Только участникам': results.results.filter((r: any) => r.channel.commentsPolicy === 'members_only'),
        'Требует одобрения': results.results.filter((r: any) => r.channel.commentsPolicy === 'approval_required'),
        'Ограничены': results.results.filter((r: any) => r.channel.commentsPolicy === 'restricted'),
        'Отключены': results.results.filter((r: any) => r.channel.commentsPolicy === 'disabled'),
        'Ошибки': results.results.filter((r: any) => !r.success)
    };

    for (const [categoryName, channels] of Object.entries(categories)) {
        if ((channels as any[]).length === 0) continue;

        content += `## ${categoryName} (${(channels as any[]).length})\n\n`;

        (channels as any[]).forEach((result, index) => {
            const channel = result.channel;
            content += `### ${index + 1}. ${channel.channelTitle}\n\n`;

            if (channel.channelUsername) {
                content += `- **Username:** @${channel.channelUsername}\n`;
                content += `- **Ссылка:** https://t.me/${channel.channelUsername}\n`;
            }

            if (channel.participantsCount) {
                content += `- **Подписчиков:** ${channel.participantsCount.toLocaleString('ru-RU')}\n`;
            }

            if (channel.linkedDiscussionGroup) {
                content += `- **Дискуссионная группа:** ${channel.linkedDiscussionGroup.title}\n`;
                if (channel.linkedDiscussionGroup.username) {
                    content += `- **Ссылка на чат:** https://t.me/${channel.linkedDiscussionGroup.username}\n`;
                }
            }

            if (channel.accessRequirements?.membershipRequired) {
                content += `- **Требования:** `;
                if (channel.accessRequirements.joinRequest) {
                    content += `Одобрение администрации`;
                } else if (channel.accessRequirements.joinToSend) {
                    content += `Вступление в канал`;
                }
                content += `\n`;
            }

            if (result.error) {
                content += `- **Ошибка:** ${result.error}\n`;
            }

            content += `\n`;
        });
    }

    await fs.promises.writeFile(filePath, content, 'utf-8');
    return filePath;
}

/**
 * Экспорт в CSV для Excel
 */
async function saveResultsToCsv(results: any): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `comment_check_${timestamp}.csv`;
    const filePath = path.join('./exports', fileName);

    // Создаем папку если её нет
    const exportsDir = './exports';
    if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
    }

    const headers = [
        'Номер',
        'Название канала',
        'Username',
        'Ссылка на канал',
        'Статус комментариев',
        'Требования доступа',
        'Дискуссионная группа',
        'Ссылка на чат',
        'Подписчиков',
        'Успешно',
        'Ошибка'
    ];

    let csvContent = headers.join(',') + '\n';

    results.results.forEach((result: any, index: number) => {
        const channel = result.channel;
        const row = [
            index + 1,
            `"${channel.channelTitle.replace(/"/g, '""')}"`,
            channel.channelUsername ? `@${channel.channelUsername}` : '',
            channel.channelUrl || '',
            `"${formatCommentsStatusForCsv(channel.commentsPolicy)}"`,
            formatAccessRequirements(channel.accessRequirements),
            channel.linkedDiscussionGroup ? `"${channel.linkedDiscussionGroup.title.replace(/"/g, '""')}"` : '',
            channel.linkedDiscussionGroup?.url || '',
            channel.participantsCount || '',
            result.success ? 'Да' : 'Нет',
            result.error ? `"${result.error.replace(/"/g, '""')}"` : ''
        ];

        csvContent += row.join(',') + '\n';
    });

    await fs.promises.writeFile(filePath, csvContent, 'utf-8');
    return filePath;
}

function formatCommentsStatusForCsv(policy: string): string {
    const mapping = {
        enabled: 'Доступны всем',
        disabled: 'Отключены',
        restricted: 'Ограничены',
        members_only: 'Только участникам',
        approval_required: 'Требует одобрения',
        unknown: 'Неизвестно'
    };
    return mapping[policy as keyof typeof mapping] || 'Неизвестно';
}

function formatAccessRequirements(requirements?: any): string {
    if (!requirements?.membershipRequired) return '';

    if (requirements.joinRequest) return 'Одобрение администрации';
    if (requirements.joinToSend) return 'Вступление в канал';
    return '';
}

/**
 * Сохранение результата проверки одного канала
 */
async function saveResultToFile(
    result: any,
    adapter: CommentResultAdapter,
    channelName: string
) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `comment_check_${channelName.replace('@', '')}_${timestamp}.txt`;
        const exportDir = './exports';

        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        const content = adapter.formatSingleChannelResult(result);
        fs.writeFileSync(path.join(exportDir, filename), content, 'utf-8');

        console.log(`\n💾 Результат сохранён: ${exportDir}/${filename}`);
    } catch (error) {
        console.error("❌ Ошибка при сохранении файла:", error);
    }
}

/**
 * Экспорт ссылок на каналы с комментариями для дальнейшего использования в боте
 */
async function exportChannelLinksForBot(results: any): Promise<void> {
    const exportService = new ExportService();

    // Экспортируем каналы с доступными комментариями 
    await exportChannelLinksForCommenting(results, 'enabled');

    // Также можем экспортировать каналы где нужно быть участником
    const membersOnlyCount = results.results.filter((r: any) =>
        r.success && r.channel.commentsPolicy === 'members_only'
    ).length;

    if (membersOnlyCount > 0) {
        await exportChannelLinksForCommenting(results, 'members_only');
    }
}

/**
 * Экспорт ссылок на каналы с определенным типом комментариев
 */
async function exportChannelLinksForCommenting(results: any, commentType: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `channels_${commentType}_comments_${timestamp}.txt`;

    const filteredChannels = results.results.filter((r: any) =>
        r.success && r.channel.commentsPolicy === commentType
    );

    if (filteredChannels.length === 0) {
        console.log(`Каналы с типом комментариев '${commentType}' не найдены`);
        return;
    }

    const content = filteredChannels
        .map((result: any) => {
            const channel = result.channel;
            if (channel.channelUsername) {
                return `@${channel.channelUsername}`;
            }
            return channel.channelUrl || channel.channelTitle;
        })
        .filter((link: string) => link)
        .join('\n');

    const exportService = new ExportService();
    await exportService.saveToFile(content, filename);

    console.log(`💾 Экспортировано ${filteredChannels.length} каналов с типом '${commentType}': ./exports/${filename}`);
}

// Запуск программы
main().catch(console.error); 