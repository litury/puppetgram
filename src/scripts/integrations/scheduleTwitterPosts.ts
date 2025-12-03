/**
 * Скрипт для планирования Twitter постов через PostMyPost API
 * Автоматически получает список проектов и аккаунтов для выбора
 */

import prompts from "prompts";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

interface ITwitterPost {
    id: string;
    content: string;
    originalMessageId: number;
    originalDate: Date;
    media?: Array<{
        localPath?: string;
        downloadUrl?: string;
        mimeType?: string;
    }>;
    characterCount: number;
    isPartOfThread: boolean;
    threadIndex?: number;
    totalThreadParts?: number;
    timeOffset?: number; // Смещение в минутах от базового времени
}

interface IPostMyPostProject {
    id: number;
    name: string;
    timezone_id: number;
}

interface IPostMyPostAccount {
    id: number;
    chanel_id: number;
    external_id: string;
    name: string;
    login?: string;
    connection_status: number;
}

interface ICreatePublicationRequest {
    project_id: number;
    post_at: string;
    account_ids: number[];
    publication_status: number;
    details: Array<{
        account_id: number;
        publication_type: number;
        content: string;
        file_ids?: number[];
    }>;
}

interface IScheduleResult {
    success: boolean;
    scheduledPosts: number;
    failedPosts: number;
    errors: string[];
}

/**
 * Группировка постов по дням для равномерного распределения
 */
interface IDayGroup {
    date: string; // YYYY-MM-DD формат
    posts: ITwitterPost[];
}

/**
 * Расширенный интерфейс поста с информацией о планировании
 */
interface ITwitterPostWithSchedule extends ITwitterPost {
    scheduledTime: Date;
    dayGroup: string;
    positionInDay: number;
    totalInDay: number;
}

class PostMyPostScheduler {
    private readonly p_baseUrl = 'https://api.postmypost.io/v4.1';
    private readonly p_accessToken: string;

    constructor() {
        this.p_accessToken = process.env.POSTMYPOST_ACCESS_TOKEN || '';
        if (!this.p_accessToken) {
            throw new Error('POSTMYPOST_ACCESS_TOKEN не найден в переменных окружения');
        }
    }

    /**
     * Получение списка проектов
     */
    async getProjectsAsync(): Promise<IPostMyPostProject[]> {
        console.log('🔍 Получение списка проектов...');

        try {
            const response = await fetch(`${this.p_baseUrl}/projects`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.p_accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return data.data || [];

        } catch (error: any) {
            console.error('❌ Ошибка получения проектов:', error.message);
            throw error;
        }
    }

    /**
     * Получение аккаунтов проекта
     */
    async getProjectAccountsAsync(_projectId: number): Promise<IPostMyPostAccount[]> {
        console.log(`🔍 Получение аккаунтов проекта ${_projectId}...`);

        try {
            const response = await fetch(`${this.p_baseUrl}/accounts?project_id=${_projectId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.p_accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return data.data || [];

        } catch (error: any) {
            console.error('❌ Ошибка получения аккаунтов:', error.message);
            throw error;
        }
    }

    /**
     * Получение списка каналов
     */
    async getChannelsAsync(): Promise<any[]> {
        console.log('🔍 Получение списка каналов...');

        try {
            const response = await fetch(`${this.p_baseUrl}/channels`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.p_accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return data.data || [];

        } catch (error: any) {
            console.error('❌ Ошибка получения каналов:', error.message);
            throw error;
        }
    }

    /**
     * Планирование поста
     */
    async schedulePostAsync(_postData: ICreatePublicationRequest): Promise<boolean> {
        try {
            const response = await fetch(`${this.p_baseUrl}/publications`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.p_accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(_postData)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Ошибка планирования поста: HTTP ${response.status}: ${errorText}`);
                return false;
            }

            return true;

        } catch (error: any) {
            console.error('❌ Ошибка планирования поста:', error.message);
            return false;
        }
    }

    /**
     * Инициализация загрузки файла в PostMyPost
     */
    private async initUploadAsync(_projectId: number, _filePath: string): Promise<{ uploadId: number; uploadUrl: string; size: number; fields?: Array<{ key: string; value: string }> }> {
        const stats = await fsPromises.stat(_filePath);
        const body = {
            project_id: _projectId,
            name: path.basename(_filePath),
            size: stats.size
        };

        const response = await fetch(`${this.p_baseUrl}/upload/init`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.p_accessToken}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`initUpload failed: HTTP ${response.status} ${errorText}`);
        }

        const data = await response.json();
        // Пытаемся извлечь поля из разных форматов ответа
        const uploadId = data.id ?? data.upload_id ?? data.data?.id ?? data.data?.upload_id ?? data.data?.upload?.id;
        const uploadUrl = data.action ?? data.url ?? data.upload_url ?? data.data?.action ?? data.data?.url ?? data.data?.upload_url ?? data.data?.upload?.url;
        const fields: Array<{ key: string; value: string }> | undefined = data.fields ?? data.data?.fields;

        if (!uploadId || !uploadUrl) {
            throw new Error(`initUpload missing id/url in response: ${JSON.stringify(data)}`);
        }

        return { uploadId, uploadUrl, size: stats.size, fields };
    }

    /**
     * Загрузка файла на выданный URL
     */
    private async uploadFileToUrlAsync(_uploadUrl: string, _filePath: string, _mimeType?: string, _fields?: Array<{ key: string; value: string }>): Promise<void> {
        const buffer = await fsPromises.readFile(_filePath);

        // Если есть поля — используем form-data POST (S3 presigned post)
        if (_fields && _fields.length > 0) {
            const formData = new FormData();
            for (const field of _fields) {
                formData.append(field.key, field.value);
            }
            const blob = new Blob([buffer], { type: _mimeType || "application/octet-stream" });
            formData.append("file", blob, path.basename(_filePath));

            const response = await fetch(_uploadUrl, {
                method: "POST",
                body: formData
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`upload file failed (form-data): HTTP ${response.status} ${text}`);
            }
            return;
        }

        // Иначе — простой PUT
        const response = await fetch(_uploadUrl, {
            method: "PUT",
            headers: {
                "Content-Type": _mimeType || "application/octet-stream",
                "Content-Length": buffer.length.toString()
            },
            body: buffer
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`upload file failed: HTTP ${response.status} ${text}`);
        }
    }

    /**
     * Завершение загрузки файла
     */
    private async completeUploadAsync(_uploadId: number): Promise<void> {
        const response = await fetch(`${this.p_baseUrl}/upload/complete?id=${_uploadId}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.p_accessToken}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`completeUpload failed: HTTP ${response.status} ${text}`);
        }
    }

    /**
     * Проверка статуса загрузки и получение file_id
     */
    private async getUploadStatusAsync(_uploadId: number): Promise<number | null> {
        const response = await fetch(`${this.p_baseUrl}/upload/status?id=${_uploadId}`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${this.p_accessToken}`,
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`statusUpload failed: HTTP ${response.status} ${text}`);
        }

        const data = await response.json();
        if (data.status === 1 && data.file_id) {
            return data.file_id;
        }
        return null;
    }

    /**
     * Полный цикл загрузки одного файла и возврат file_id
     */
    private async uploadMediaFileAsync(_projectId: number, _filePath: string, _mimeType?: string): Promise<number> {
        const { uploadId, uploadUrl, fields } = await this.initUploadAsync(_projectId, _filePath);
        await this.uploadFileToUrlAsync(uploadUrl, _filePath, _mimeType, fields);
        await this.completeUploadAsync(uploadId);

        // Пару попыток дождаться file_id
        for (let attempt = 0; attempt < 3; attempt++) {
            const fileId = await this.getUploadStatusAsync(uploadId);
            if (fileId) return fileId;
            await new Promise(res => setTimeout(res, 500));
        }

        throw new Error(`file_id not ready for upload ${uploadId}`);
    }

    /**
     * Планирование нескольких постов
     */
    async schedulePostsAsync(_posts: ITwitterPost[] | ITwitterPostWithSchedule[], _accountId: number, _projectId: number): Promise<IScheduleResult> {
        console.log(`📅 Планирование ${_posts.length} постов...`);

        const result: IScheduleResult = {
            success: true,
            scheduledPosts: 0,
            failedPosts: 0,
            errors: []
        };

        for (const post of _posts) {
            try {
                let fileIds: number[] = [];
                if (post.media && post.media.length > 0) {
                    for (const media of post.media) {
                        const filePath = media.localPath || media.downloadUrl || '';
                        if (!filePath) {
                            console.warn(`⚠️  Пропускаем медиа без пути для поста ${post.id}`);
                            continue;
                        }
                        try {
                            const fileId = await this.uploadMediaFileAsync(_projectId, filePath, media.mimeType);
                            fileIds.push(fileId);
                            // небольшая пауза между загрузками
                            await new Promise(res => setTimeout(res, 200));
                        } catch (uploadError: any) {
                            console.warn(`⚠️  Не удалось загрузить медиа для поста ${post.id}: ${uploadError.message || uploadError}`);
                        }
                    }
                }

                // Используем либо заранее вычисленное время, либо вычисляем
                const scheduledTime = (post as any).scheduledTime ||
                    new Date(new Date(post.originalDate).getTime() + (post.timeOffset || 0) * 60000);

                const postData: ICreatePublicationRequest = {
                    project_id: _projectId,
                    post_at: scheduledTime.toISOString(),
                    account_ids: [_accountId],
                    publication_status: 5, // PENDING_PUBLICATION
                    details: [{
                        account_id: _accountId,
                        publication_type: 1, // POST
                        content: post.content,
                        file_ids: fileIds.length ? fileIds : undefined
                    }]
                };

                const success = await this.schedulePostAsync(postData);

                if (success) {
                    result.scheduledPosts++;
                    const dayInfo = (post as ITwitterPostWithSchedule).dayGroup
                        ? ` [${(post as ITwitterPostWithSchedule).positionInDay}/${(post as ITwitterPostWithSchedule).totalInDay} в день ${(post as ITwitterPostWithSchedule).dayGroup}]`
                        : '';
                    console.log(`✅ Запланирован пост ${post.id} на ${scheduledTime.toLocaleString('ru-RU')}${dayInfo}`);
                } else {
                    result.failedPosts++;
                    result.errors.push(`Не удалось запланировать пост ${post.id}`);
                }

                // Небольшая задержка между запросами
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error: any) {
                result.failedPosts++;
                result.errors.push(`Ошибка планирования поста ${post.id}: ${error.message}`);
                console.error(`❌ Ошибка планирования поста ${post.id}:`, error.message);
            }
        }

        result.success = result.failedPosts === 0;
        return result;
    }

    /**
     * Получение запланированных постов
     */
    async getScheduledPostsAsync(_projectId: number): Promise<any[]> {
        console.log('📋 Получение запланированных постов...');

        try {
            const response = await fetch(`${this.p_baseUrl}/publications?project_id=${_projectId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.p_accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return data.data || [];

        } catch (error: any) {
            console.error('❌ Ошибка получения запланированных постов:', error.message);
            return [];
        }
    }
}

/**
 * Загрузка постов из JSON файла
 */
function loadPostsFromFile(_filePath: string): ITwitterPost[] {
    try {
        const fileContent = fs.readFileSync(_filePath, 'utf-8');
        const data = JSON.parse(fileContent);

        // Поддерживаем разные форматы JSON
        let posts: ITwitterPost[] = [];
        if (data.posts && Array.isArray(data.posts)) {
            posts = data.posts;
        } else if (Array.isArray(data)) {
            posts = data;
        } else {
            throw new Error('Неподдерживаемый формат JSON файла');
        }

        // Фильтруем и очищаем посты
        return posts.filter(post => {
            // Убираем посты со слишком коротким содержимым
            if (post.content.length < 50) {
                console.warn(`⚠️  Пропускаем короткий пост ${post.id}: ${post.content.substring(0, 30)}...`);
                return false;
            }

            // Убираем посты, которые состоят только из хэштегов
            const contentWithoutHashtags = post.content.replace(/#\w+/g, '').trim();
            if (contentWithoutHashtags.length < 30) {
                console.warn(`⚠️  Пропускаем пост только с хэштегами ${post.id}`);
                return false;
            }

            return true;
        }).map(post => {
            // Очищаем контент от артефактов
            let cleanContent = post.content
                .replace(/\((\d+) символов.*?\)/g, '') // Убираем счетчики символов
                .replace(/остаётся место для хэште\.\.\./g, '') // Убираем фрагменты
                .replace(/\n\s*\n/g, '\n\n') // Нормализуем переносы строк
                .trim();

            return {
                ...post,
                content: cleanContent,
                // Исправляем дату - преобразуем строку в объект Date
                originalDate: new Date(post.originalDate)
            };
        });
    } catch (error: any) {
        throw new Error(`Ошибка загрузки файла ${_filePath}: ${error.message}`);
    }
}

/**
 * Получение списка JSON файлов с постами
 */
function getTwitterContentFiles(): string[] {
    const contentDir = path.join(process.cwd(), 'exports', 'twitter-content');

    if (!fs.existsSync(contentDir)) {
        return [];
    }

    return fs.readdirSync(contentDir)
        .filter(file => file.endsWith('.json'))
        .map(file => path.join(contentDir, file));
}

/**
 * Группировка постов по дням на основе originalDate
 */
function groupPostsByDays(_posts: ITwitterPost[]): IDayGroup[] {
    const dayGroups = new Map<string, ITwitterPost[]>();

    for (const post of _posts) {
        const dateKey = post.originalDate.toISOString().split('T')[0]; // YYYY-MM-DD

        if (!dayGroups.has(dateKey)) {
            dayGroups.set(dateKey, []);
        }

        dayGroups.get(dateKey)!.push(post);
    }

    // Сортируем группы по дате
    const sortedGroups: IDayGroup[] = Array.from(dayGroups.entries())
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .map(([date, posts]) => ({
            date,
            posts: posts.sort((a, b) => a.originalDate.getTime() - b.originalDate.getTime())
        }));

    return sortedGroups;
}

/**
 * Создание расписания с равномерным распределением постов по дням
 */
function createDayBasedSchedule(_posts: ITwitterPost[], _startTime: Date, _workingHours: { start: number; end: number }): ITwitterPostWithSchedule[] {
    const dayGroups = groupPostsByDays(_posts);
    const scheduledPosts: ITwitterPostWithSchedule[] = [];

    console.log(`\n📊 Анализ постов по дням:`);
    console.log("═".repeat(50));

    dayGroups.forEach((group, dayIndex) => {
        console.log(`📅 ${group.date}: ${group.posts.length} постов`);
    });

    let currentDate = new Date(_startTime);

    for (const group of dayGroups) {
        const postsInDay = group.posts.length;

        if (postsInDay === 1) {
            // Если пост один в день - публикуем в середине рабочего дня
            const scheduleTime = new Date(currentDate);
            const middleHour = Math.floor((_workingHours.start + _workingHours.end) / 2);
            scheduleTime.setHours(middleHour, 0, 0, 0);

            scheduledPosts.push({
                ...group.posts[0],
                scheduledTime: scheduleTime,
                dayGroup: group.date,
                positionInDay: 1,
                totalInDay: 1
            });
        } else {
            // Если постов несколько - распределяем равномерно в течение рабочего дня
            const workingMinutes = (_workingHours.end - _workingHours.start) * 60;
            const intervalMinutes = workingMinutes / postsInDay;

            group.posts.forEach((post, index) => {
                const scheduleTime = new Date(currentDate);
                const minutesFromStart = index * intervalMinutes;
                const totalMinutes = _workingHours.start * 60 + minutesFromStart;

                scheduleTime.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);

                scheduledPosts.push({
                    ...post,
                    scheduledTime: scheduleTime,
                    dayGroup: group.date,
                    positionInDay: index + 1,
                    totalInDay: postsInDay
                });
            });
        }

        // Переходим к следующему дню
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return scheduledPosts;
}

async function main() {
    try {
        console.log("\n🐦 Планирование Twitter постов через PostMyPost");
        console.log("═══════════════════════════════════════════════");

        const scheduler = new PostMyPostScheduler();

        // Получаем список проектов
        const projects = await scheduler.getProjectsAsync();

        if (projects.length === 0) {
            console.log("📭 Проекты не найдены. Создайте проект через:");
            console.log("npm run postmypost-manager");
            return;
        }

        // Выбираем проект
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

        // Получаем аккаунты проекта
        const accounts = await scheduler.getProjectAccountsAsync(projectResponse.projectId);

        // Получаем информацию о каналах для фильтрации Twitter аккаунтов
        const channels = await scheduler.getChannelsAsync();
        const twitterChannel = channels.find((ch: any) => ch.code === 'twitter' || ch.code === 'x');

        const twitterAccounts = accounts.filter(acc => acc.chanel_id === twitterChannel?.id);

        if (twitterAccounts.length === 0) {
            console.log("📭 Twitter аккаунты не найдены в проекте.");
            console.log("Добавьте Twitter аккаунт в веб-интерфейсе PostMyPost.");
            return;
        }

        // Выбираем Twitter аккаунт
        const accountResponse = await prompts({
            type: "select",
            name: "accountId",
            message: "Выберите Twitter аккаунт:",
            choices: twitterAccounts.map(account => ({
                title: account.name,
                value: account.id,
                description: `Login: ${account.login || 'неизвестно'} | Статус: ${account.connection_status === 1 ? 'подключен' : 'требует авторизации'}`
            }))
        });

        if (!accountResponse.accountId) {
            console.log("❌ Операция отменена");
            return;
        }

        // Получаем список JSON файлов
        const jsonFiles = getTwitterContentFiles();

        if (jsonFiles.length === 0) {
            console.log("📭 JSON файлы с постами не найдены в exports/twitter-content/");
            return;
        }

        // Выбираем файл с постами
        const fileResponse = await prompts({
            type: "select",
            name: "filePath",
            message: "Выберите файл с постами:",
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

        // Загружаем посты
        const posts = loadPostsFromFile(fileResponse.filePath);
        console.log(`📝 Загружено ${posts.length} постов`);

        // Настройка рабочих часов для публикации
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
                {
                    type: "number",
                    name: "start",
                    message: "Начальный час (0-23):",
                    initial: 9,
                    min: 0,
                    max: 23
                },
                {
                    type: "number",
                    name: "end",
                    message: "Конечный час (0-23):",
                    initial: 18,
                    min: 0,
                    max: 23
                }
            ]);
            workingHours = { start: customHours.start, end: customHours.end };
        }

        // Настройка времени начала публикации
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
                    {
                        type: "date",
                        name: "date",
                        message: "Выберите дату и время начала:",
                        initial: new Date(),
                        mask: "YYYY-MM-DD HH:mm"
                    }
                ]);
                startTime = new Date(customTime.date);
                break;
        }

        // Создаем расписание с распределением по дням
        const postsWithSchedule = createDayBasedSchedule(posts, startTime, workingHours);

        // Показываем план публикации
        console.log(`\n📅 План публикации (рабочие часы: ${workingHours.start}:00 - ${workingHours.end}:00):`);
        console.log("═".repeat(80));

        // Группируем для показа
        const dayGroups = new Map<string, ITwitterPostWithSchedule[]>();
        postsWithSchedule.forEach(post => {
            if (!dayGroups.has(post.dayGroup)) {
                dayGroups.set(post.dayGroup, []);
            }
            dayGroups.get(post.dayGroup)!.push(post);
        });

        // Показываем первые несколько дней
        let shownPosts = 0;
        const maxShowDays = 3;
        let dayCount = 0;

        for (const [dayGroup, dayPosts] of dayGroups) {
            if (dayCount >= maxShowDays) break;

            console.log(`\n📅 ${dayGroup} (${dayPosts.length} постов):`);
            dayPosts.forEach((post, index) => {
                if (shownPosts >= 10) return;
                const time = post.scheduledTime.toLocaleString('ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                const content = post.content.split('\n')[0].substring(0, 50);
                console.log(`  ${time} - ${content}...`);
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

        // Подтверждение планирования
        const confirmResponse = await prompts({
            type: "confirm",
            name: "confirm",
            message: `Запланировать ${posts.length} постов на ${dayGroups.size} дней в аккаунте ${twitterAccounts.find(a => a.id === accountResponse.accountId)?.name}?`,
            initial: false
        });

        if (!confirmResponse.confirm) {
            console.log("❌ Операция отменена");
            return;
        }

        // Планируем посты
        const result = await scheduler.schedulePostsAsync(postsWithSchedule, accountResponse.accountId, projectResponse.projectId);

        // Показываем результаты
        console.log("\n📊 Результаты планирования:");
        console.log("═══════════════════════════════════");
        console.log(`✅ Успешно запланировано: ${result.scheduledPosts}`);
        console.log(`❌ Ошибки: ${result.failedPosts}`);

        if (result.errors.length > 0) {
            console.log("\n🚨 Ошибки:");
            result.errors.forEach(error => console.log(`   • ${error}`));
        }

        // Предложение посмотреть запланированные посты
        if (result.scheduledPosts > 0) {
            const viewResponse = await prompts({
                type: "confirm",
                name: "viewScheduled",
                message: "Показать запланированные посты?",
                initial: false
            });

            if (viewResponse.viewScheduled) {
                const scheduledPosts = await scheduler.getScheduledPostsAsync(projectResponse.projectId);

                if (scheduledPosts.length > 0) {
                    console.log(`\n📅 Запланированные посты (${scheduledPosts.length}):`);
                    scheduledPosts.forEach((post, index) => {
                        const scheduledTime = new Date(post.post_at);
                        const content = post.details?.[0]?.content || 'Нет содержимого';
                        console.log(`${index + 1}. ${scheduledTime.toLocaleString('ru-RU')} - ${content.substring(0, 50)}...`);
                    });
                }
            }
        }

    } catch (error: any) {
        console.error("❌ Ошибка:", error.message);
    }
}

if (require.main === module) {
    main();
} 
