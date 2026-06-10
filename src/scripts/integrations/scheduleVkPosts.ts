/**
 * Этап 3 VK-конвейера: планирование постов в отложку ВКонтакте через PostMyPost.
 *
 * Читает результат этапа 1 (exports/vk-content/*.json) — посты с медиа,
 * оригинальный текст as-is — и кладёт их в отложку выбранного VK-аккаунта.
 * Медиа заливается автоматически по localPath существующим загрузчиком.
 *
 * Требует оплаченного тарифа PostMyPost и подключённого VK-аккаунта.
 */

import prompts from "prompts";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
    PostMyPostScheduler,
    createFixedCadenceSchedule,
    ISchedulablePost,
    IScheduledPost
} from "./postMyPostScheduler";

dotenv.config();

/**
 * Загрузка VK-постов из файла этапа 1 (exports/vk-content/*.json).
 * Текст НЕ фильтруем и НЕ режем — берём всё как есть (решение пользователя).
 */
function loadVkPostsFromFile(_filePath: string): ISchedulablePost[] {
    const data = JSON.parse(fs.readFileSync(_filePath, "utf-8"));
    const rawPosts: any[] = Array.isArray(data) ? data : (data.posts || []);

    if (!Array.isArray(rawPosts) || rawPosts.length === 0) {
        throw new Error("В файле нет постов (ожидался массив posts)");
    }

    return rawPosts.map(post => ({
        id: String(post.id),
        content: post.content || "",
        originalDate: new Date(post.originalDate),
        media: (post.media || []).map((m: any) => ({
            localPath: m.localPath,
            downloadUrl: m.downloadUrl,
            mimeType: m.mimeType
        }))
    }));
}

/**
 * Список JSON-файлов с VK-контентом (этап 1)
 */
function getVkContentFiles(): string[] {
    const contentDir = path.join(process.cwd(), "exports", "vk-content");
    if (!fs.existsSync(contentDir)) {
        return [];
    }
    return fs.readdirSync(contentDir)
        .filter(file => file.endsWith(".json"))
        .map(file => path.join(contentDir, file));
}

async function main() {
    try {
        console.log("\n🅥 Планирование постов в ВКонтакте через PostMyPost");
        console.log("═══════════════════════════════════════════════");

        const scheduler = new PostMyPostScheduler();

        // Проекты
        const projects = await scheduler.getProjectsAsync();
        if (projects.length === 0) {
            console.log("📭 Проекты не найдены. Создайте проект в PostMyPost.");
            return;
        }

        const projectResponse = await prompts({
            type: "select",
            name: "projectId",
            message: "Выберите проект:",
            choices: projects.map(project => ({
                title: project.name,
                value: project.id,
                description: `ID: ${project.id} | Timezone ID: ${project.timezone_id}`
            }))
        });

        if (!projectResponse.projectId) {
            console.log("❌ Операция отменена");
            return;
        }

        // Аккаунты + фильтр канала ВКонтакте
        const accounts = await scheduler.getProjectAccountsAsync(projectResponse.projectId);
        const channels = await scheduler.getChannelsAsync();
        const vkChannel = channels.find((ch: any) => ch.code === 'vkontakte' || ch.code === 'vk');

        const vkAccounts = accounts.filter(acc => acc.chanel_id === vkChannel?.id);

        if (vkAccounts.length === 0) {
            console.log("📭 VK-аккаунты не найдены в проекте.");
            console.log("Подключите аккаунт ВКонтакте в веб-интерфейсе PostMyPost.");
            return;
        }

        const accountResponse = await prompts({
            type: "select",
            name: "accountId",
            message: "Выберите VK-аккаунт:",
            choices: vkAccounts.map(account => ({
                title: account.name,
                value: account.id,
                description: `Login: ${account.login || 'неизвестно'} | Статус: ${account.connection_status === 1 ? 'подключен' : 'требует авторизации'}`
            }))
        });

        if (!accountResponse.accountId) {
            console.log("❌ Операция отменена");
            return;
        }

        // Файл с VK-постами (этап 1)
        const jsonFiles = getVkContentFiles();
        if (jsonFiles.length === 0) {
            console.log("📭 Файлы не найдены в exports/vk-content/. Сначала: npm run export:vk");
            return;
        }

        const fileResponse = await prompts({
            type: "select",
            name: "filePath",
            message: "Выберите файл с VK-постами:",
            choices: jsonFiles.map(filePath => ({
                title: path.basename(filePath),
                value: filePath,
                description: `Размер: ${(fs.statSync(filePath).size / 1024).toFixed(1)} KB`
            }))
        });

        if (!fileResponse.filePath) {
            console.log("❌ Операция отменена");
            return;
        }

        const posts = loadVkPostsFromFile(fileResponse.filePath);
        console.log(`📝 Загружено ${posts.length} постов (с медиа)`);

        // Сколько постов в день
        const perDayResponse = await prompts({
            type: "number",
            name: "perDay",
            message: "Сколько постов публиковать в день?",
            initial: 2,
            min: 1,
            max: 20
        });
        const perDay = perDayResponse.perDay || 2;

        // Рабочие часы
        const workingHoursResponse = await prompts([
            {
                type: "select",
                name: "workingHours",
                message: "Выберите рабочие часы для публикации:",
                choices: [
                    { title: "9:00 - 18:00 (рабочий день)", value: { start: 9, end: 18 } },
                    { title: "8:00 - 20:00 (расширенный день)", value: { start: 8, end: 20 } },
                    { title: "10:00 - 22:00 (активные часы)", value: { start: 10, end: 22 } },
                    { title: "6:00 - 23:00 (весь день)", value: { start: 6, end: 23 } },
                    { title: "Пользовательские часы", value: "custom" }
                ],
                initial: 0
            }
        ]);

        let workingHours = workingHoursResponse.workingHours;

        if (workingHoursResponse.workingHours === "custom") {
            const customHours = await prompts([
                { type: "number", name: "start", message: "Начальный час (0-23):", initial: 9, min: 0, max: 23 },
                { type: "number", name: "end", message: "Конечный час (0-23):", initial: 18, min: 0, max: 23 }
            ]);
            workingHours = { start: customHours.start, end: customHours.end };
        }

        // Время старта
        const startTimeResponse = await prompts([
            {
                type: "select",
                name: "startTime",
                message: "Когда начать публикацию?",
                choices: [
                    { title: "Сейчас", value: "now" },
                    { title: "Завтра в 9:00", value: "tomorrow_9" },
                    { title: "Через час", value: "hour_later" },
                    { title: "Пользовательское время", value: "custom" }
                ]
            }
        ]);

        let startTime = new Date();

        switch (startTimeResponse.startTime) {
            case "now":
                startTime = new Date();
                break;
            case "tomorrow_9":
                startTime = new Date();
                startTime.setDate(startTime.getDate() + 1);
                startTime.setHours(9, 0, 0, 0);
                break;
            case "hour_later":
                startTime = new Date(Date.now() + 60 * 60 * 1000);
                break;
            case "custom":
                const customTime = await prompts([
                    { type: "date", name: "date", message: "Выберите дату и время начала:", initial: new Date(), mask: "YYYY-MM-DD HH:mm" }
                ]);
                startTime = new Date(customTime.date);
                break;
        }

        // Расписание (фиксированная частота: perDay постов в день)
        const postsWithSchedule = createFixedCadenceSchedule(posts, startTime, workingHours, perDay);

        console.log(`\n📅 План публикации (${perDay} постов/день, рабочие часы: ${workingHours.start}:00 - ${workingHours.end}:00):`);
        console.log("═".repeat(80));

        const dayGroups = new Map<string, IScheduledPost[]>();
        postsWithSchedule.forEach(post => {
            if (!dayGroups.has(post.dayGroup)) {
                dayGroups.set(post.dayGroup, []);
            }
            dayGroups.get(post.dayGroup)!.push(post);
        });

        let shownPosts = 0;
        const maxShowDays = 3;
        let dayCount = 0;

        for (const [dayGroup, dayPosts] of dayGroups) {
            if (dayCount >= maxShowDays) break;
            console.log(`\n📅 ${dayGroup} (${dayPosts.length} постов):`);
            dayPosts.forEach((post) => {
                if (shownPosts >= 10) return;
                const time = post.scheduledTime.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                const firstLine = (post.content.split('\n')[0] || '(без текста)').substring(0, 50);
                const mediaCount = post.media?.length || 0;
                console.log(`  ${time} - [${mediaCount} медиа] ${firstLine}...`);
                shownPosts++;
            });
            dayCount++;
        }

        if (dayGroups.size > maxShowDays) {
            console.log(`\n... и еще ${dayGroups.size - maxShowDays} дней`);
        }

        const lastPost = postsWithSchedule[postsWithSchedule.length - 1];
        console.log(`\nПоследний пост: ${lastPost.scheduledTime.toLocaleString('ru-RU')}`);
        console.log(`Всего дней: ${dayGroups.size}`);
        console.log(`Общая продолжительность: ${Math.ceil((lastPost.scheduledTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24))} дней`);

        // Подтверждение
        const confirmResponse = await prompts({
            type: "confirm",
            name: "confirm",
            message: `Запланировать ${posts.length} постов на ${dayGroups.size} дней в VK-аккаунте ${vkAccounts.find(a => a.id === accountResponse.accountId)?.name}?`,
            initial: false
        });

        if (!confirmResponse.confirm) {
            console.log("❌ Операция отменена");
            return;
        }

        const result = await scheduler.schedulePostsAsync(postsWithSchedule, accountResponse.accountId, projectResponse.projectId);

        // Сохраняем ID созданных публикаций — для возможного отката (delete_publication)
        if (result.createdIds.length > 0) {
            const idsPath = fileResponse.filePath.replace(/\.json$/, `_scheduled-ids_${Date.now()}.json`);
            fs.writeFileSync(idsPath, JSON.stringify({
                projectId: projectResponse.projectId,
                accountId: accountResponse.accountId,
                createdAt: new Date().toISOString(),
                ids: result.createdIds
            }, null, 2), "utf-8");
            console.log(`🧾 ID публикаций сохранены: ${path.relative(process.cwd(), idsPath)}`);
        }

        console.log("\n📊 Результаты планирования:");
        console.log("═══════════════════════════════════");
        console.log(`✅ Успешно запланировано: ${result.scheduledPosts}`);
        console.log(`❌ Ошибки: ${result.failedPosts}`);

        if (result.errors.length > 0) {
            console.log("\n🚨 Ошибки:");
            result.errors.slice(0, 20).forEach(error => console.log(`   • ${error}`));
            if (result.errors.length > 20) {
                console.log(`   ... и ещё ${result.errors.length - 20} ошибок`);
            }
        }

    } catch (error: any) {
        console.error("❌ Ошибка:", error.message);
    }
}

if (require.main === module) {
    main();
}
