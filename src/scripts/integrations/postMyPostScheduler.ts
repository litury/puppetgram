/**
 * Общий планировщик публикаций через PostMyPost API.
 * Платформо-независим: используется и для Twitter, и для ВК.
 * Логика вынесена из scheduleTwitterPosts.ts без изменения поведения.
 */

import * as fsPromises from "fs/promises";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Минимальный пост, пригодный к планированию (нейтральный по платформе)
 */
export interface ISchedulablePost {
    id: string;
    content: string;
    originalDate: Date;
    media?: Array<{
        localPath?: string;
        downloadUrl?: string;
        mimeType?: string;
    }>;
    timeOffset?: number; // Смещение в минутах от базового времени
}

export interface IPostMyPostProject {
    id: number;
    name: string;
    timezone_id: number;
}

export interface IPostMyPostAccount {
    id: number;
    chanel_id: number;
    external_id: string;
    name: string;
    login?: string;
    connection_status: number;
}

export interface ICreatePublicationRequest {
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

export interface IScheduleResult {
    success: boolean;
    scheduledPosts: number;
    failedPosts: number;
    errors: string[];
    /** ID созданных публикаций (для возможного отката) */
    createdIds: number[];
}

/**
 * Группировка постов по дням для равномерного распределения
 */
export interface IDayGroup {
    date: string; // YYYY-MM-DD формат
    posts: ISchedulablePost[];
}

/**
 * Расширенный пост с информацией о планировании
 */
export interface IScheduledPost extends ISchedulablePost {
    scheduledTime: Date;
    dayGroup: string;
    positionInDay: number;
    totalInDay: number;
}

export class PostMyPostScheduler {
    private readonly p_baseUrl = 'https://api.postmypost.io/v4.1';
    private readonly p_accessToken: string;

    constructor() {
        this.p_accessToken = process.env.POSTMYPOST_ACCESS_TOKEN || '';
        if (!this.p_accessToken) {
            throw new Error('POSTMYPOST_ACCESS_TOKEN не найден в переменных окружения');
        }
    }

    /**
     * fetch с повтором при 429/5xx (экспоненциальный бэкофф, уважает Retry-After).
     * Спасает от Rate limit при массовой заливке.
     */
    private async fetchWithRetry(_url: string, _options: any, _maxRetries = 6): Promise<Response> {
        let lastResponse: Response | null = null;
        for (let attempt = 0; attempt <= _maxRetries; attempt++) {
            const response = await fetch(_url, _options);
            if (response.status !== 429 && response.status < 500) {
                return response;
            }
            lastResponse = response;
            if (attempt === _maxRetries) break;

            // Retry-After (сек) или экспоненциальный бэкофф 2,4,8,16... сек (макс 30с)
            const retryAfter = Number(response.headers.get('retry-after'));
            const backoffMs = retryAfter > 0
                ? retryAfter * 1000
                : Math.min(2000 * Math.pow(2, attempt), 30000);
            console.warn(`⏳ HTTP ${response.status} — пауза ${Math.round(backoffMs / 1000)}с (попытка ${attempt + 1}/${_maxRetries})`);
            await new Promise(res => setTimeout(res, backoffMs));
        }
        return lastResponse as Response;
    }

    /**
     * Получение списка проектов
     */
    async getProjectsAsync(): Promise<IPostMyPostProject[]> {
        console.log('🔍 Получение списка проектов...');

        try {
            const response = await this.fetchWithRetry(`${this.p_baseUrl}/projects`, {
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
            const response = await this.fetchWithRetry(`${this.p_baseUrl}/accounts?project_id=${_projectId}`, {
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
            const response = await this.fetchWithRetry(`${this.p_baseUrl}/channels`, {
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
     * Планирование поста. Возвращает { ok, id } — id созданной публикации (если отдан API).
     */
    async schedulePostAsync(_postData: ICreatePublicationRequest): Promise<{ ok: boolean; id: number | null }> {
        try {
            const response = await this.fetchWithRetry(`${this.p_baseUrl}/publications`, {
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
                return { ok: false, id: null };
            }

            const data = await response.json().catch(() => ({}));
            const id = data?.id ?? data?.data?.id ?? null;
            return { ok: true, id };

        } catch (error: any) {
            console.error('❌ Ошибка планирования поста:', error.message);
            return { ok: false, id: null };
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

        const response = await this.fetchWithRetry(`${this.p_baseUrl}/upload/init`, {
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
        const response = await this.fetchWithRetry(`${this.p_baseUrl}/upload/complete?id=${_uploadId}`, {
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
        const response = await this.fetchWithRetry(`${this.p_baseUrl}/upload/status?id=${_uploadId}`, {
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
        // Статус приходит строкой ("file uploaded successfully"), не числом —
        // ориентируемся на наличие file_id, а не на конкретный status.
        const fileId = data.file_id ?? data.data?.file_id ?? data.data?.upload?.file_id;
        if (fileId) {
            return fileId;
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

        // Файлу нужно время на обработку — ждём до ~20с (15 попыток × 1.5с)
        for (let attempt = 0; attempt < 15; attempt++) {
            const fileId = await this.getUploadStatusAsync(uploadId);
            if (fileId) return fileId;
            await new Promise(res => setTimeout(res, 1500));
        }

        throw new Error(`file_id not ready for upload ${uploadId}`);
    }

    /**
     * Планирование нескольких постов
     */
    async schedulePostsAsync(
        _posts: ISchedulablePost[] | IScheduledPost[],
        _accountId: number,
        _projectId: number,
        _onCreated?: (_id: number) => void
    ): Promise<IScheduleResult> {
        console.log(`📅 Планирование ${_posts.length} постов...`);

        const result: IScheduleResult = {
            success: true,
            scheduledPosts: 0,
            failedPosts: 0,
            errors: [],
            createdIds: []
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

                const { ok: success, id: createdId } = await this.schedulePostAsync(postData);

                if (success) {
                    result.scheduledPosts++;
                    if (createdId) {
                        result.createdIds.push(createdId);
                        if (_onCreated) _onCreated(createdId);
                    }
                    const dayInfo = (post as IScheduledPost).dayGroup
                        ? ` [${(post as IScheduledPost).positionInDay}/${(post as IScheduledPost).totalInDay} в день ${(post as IScheduledPost).dayGroup}]`
                        : '';
                    console.log(`✅ Запланирован пост ${post.id} на ${scheduledTime.toLocaleString('ru-RU')}${dayInfo}`);
                } else {
                    result.failedPosts++;
                    result.errors.push(`Не удалось запланировать пост ${post.id}`);
                }

                // Пауза между постами — запас по rate-limit (60 req/мин)
                await new Promise(resolve => setTimeout(resolve, 1500));

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
            const response = await this.fetchWithRetry(`${this.p_baseUrl}/publications?project_id=${_projectId}`, {
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
 * Группировка постов по дням на основе originalDate
 */
export function groupPostsByDays(_posts: ISchedulablePost[]): IDayGroup[] {
    const dayGroups = new Map<string, ISchedulablePost[]>();

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
export function createDayBasedSchedule(_posts: ISchedulablePost[], _startTime: Date, _workingHours: { start: number; end: number }): IScheduledPost[] {
    const dayGroups = groupPostsByDays(_posts);
    const scheduledPosts: IScheduledPost[] = [];

    console.log(`\n📊 Анализ постов по дням:`);
    console.log("═".repeat(50));

    dayGroups.forEach((group) => {
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

/**
 * Расписание с ФИКСИРОВАННОЙ частотой: ровно _perDay постов в день,
 * равномерно по рабочим часам. Порядок постов — хронологический (по originalDate).
 * Не зависит от исходных дат — даёт ровный темп без дампов.
 */
export function createFixedCadenceSchedule(
    _posts: ISchedulablePost[],
    _startTime: Date,
    _workingHours: { start: number; end: number },
    _perDay: number
): IScheduledPost[] {
    const perDay = Math.max(1, Math.floor(_perDay));
    const sorted = [..._posts].sort(
        (a, b) => new Date(a.originalDate).getTime() - new Date(b.originalDate).getTime()
    );

    const startDay = new Date(_startTime);
    startDay.setHours(0, 0, 0, 0);

    const workingMinutes = (_workingHours.end - _workingHours.start) * 60;
    const scheduledPosts: IScheduledPost[] = [];

    sorted.forEach((post, index) => {
        const dayIndex = Math.floor(index / perDay);
        const positionInDay = index % perDay;

        const scheduleTime = new Date(startDay);
        scheduleTime.setDate(scheduleTime.getDate() + dayIndex);

        let totalMinutes: number;
        if (perDay === 1) {
            totalMinutes = Math.floor((_workingHours.start + _workingHours.end) / 2) * 60;
        } else {
            // Равномерно: первый — в начале рабочего дня, последний — ближе к концу
            const interval = workingMinutes / perDay;
            totalMinutes = _workingHours.start * 60 + Math.round(positionInDay * interval);
        }
        scheduleTime.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);

        const dayGroup = scheduleTime.toISOString().split('T')[0];
        scheduledPosts.push({
            ...post,
            scheduledTime: scheduleTime,
            dayGroup,
            positionInDay: positionInDay + 1,
            totalInDay: perDay
        });
    });

    return scheduledPosts;
}
