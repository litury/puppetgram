/**
 * Скрипт для управления проектами PostMyPost
 * Позволяет создать проект и получить его ID для дальнейшего использования
 */

import prompts from "prompts";
import * as dotenv from "dotenv";

dotenv.config();

interface IPostMyPostProject {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
}

interface ICreateProjectRequest {
    name: string;
    description?: string;
}

interface IPostMyPostAccount {
    id: string;
    name: string;
    platform: string;
    username?: string;
    status: string;
}

class PostMyPostProjectManager {
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
     * Создание нового проекта
     */
    async createProjectAsync(_projectData: ICreateProjectRequest): Promise<IPostMyPostProject> {
        console.log(`🆕 Создание проекта: ${_projectData.name}`);

        try {
            const response = await fetch(`${this.p_baseUrl}/projects`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.p_accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(_projectData)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return data.data;

        } catch (error: any) {
            console.error('❌ Ошибка создания проекта:', error.message);
            throw error;
        }
    }

    /**
     * Получение аккаунтов проекта
     */
    async getProjectAccountsAsync(_projectId: string): Promise<IPostMyPostAccount[]> {
        console.log(`🔍 Получение аккаунтов проекта ${_projectId}...`);

        try {
            const response = await fetch(`${this.p_baseUrl}/projects/${_projectId}/accounts`, {
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
     * Отображение информации о проекте
     */
    displayProjectInfo(_project: IPostMyPostProject): void {
        console.log(`📁 Проект: ${_project.name}`);
        console.log(`   ID: ${_project.id}`);
        console.log(`   Создан: ${new Date(_project.created_at).toLocaleString('ru-RU')}`);
        console.log(`   Обновлен: ${new Date(_project.updated_at).toLocaleString('ru-RU')}`);
    }

    /**
     * Отображение информации об аккаунте
     */
    displayAccountInfo(_account: IPostMyPostAccount): void {
        console.log(`📱 Аккаунт: ${_account.name}`);
        console.log(`   ID: ${_account.id}`);
        console.log(`   Платформа: ${_account.platform}`);
        console.log(`   Username: ${_account.username || 'Не указан'}`);
        console.log(`   Статус: ${_account.status}`);
    }
}

async function main() {
    try {
        console.log("\n🚀 Менеджер проектов PostMyPost");
        console.log("═══════════════════════════════════");

        const manager = new PostMyPostProjectManager();

        // Выбор действия
        const actionResponse = await prompts({
            type: "select",
            name: "action",
            message: "Выберите действие:",
            choices: [
                { title: "📋 Показать существующие проекты", value: "list" },
                { title: "🆕 Создать новый проект", value: "create" },
                { title: "👥 Показать аккаунты проекта", value: "accounts" }
            ]
        });

        if (!actionResponse.action) {
            console.log("❌ Операция отменена");
            return;
        }

        switch (actionResponse.action) {
            case "list":
                await handleListProjects(manager);
                break;
            case "create":
                await handleCreateProject(manager);
                break;
            case "accounts":
                await handleShowAccounts(manager);
                break;
        }

    } catch (error: any) {
        console.error("❌ Ошибка:", error.message);
    }
}

async function handleListProjects(_manager: PostMyPostProjectManager): Promise<void> {
    const projects = await _manager.getProjectsAsync();

    if (projects.length === 0) {
        console.log("📭 Проекты не найдены");
        return;
    }

    console.log(`\n📋 Найдено проектов: ${projects.length}`);
    console.log("═══════════════════════════════════");

    projects.forEach((_project, index) => {
        console.log(`\n${index + 1}. ${_project.name}`);
        _manager.displayProjectInfo(_project);
    });
}

async function handleCreateProject(_manager: PostMyPostProjectManager): Promise<void> {
    const projectData = await prompts([
        {
            type: "text",
            name: "name",
            message: "Введите название проекта:",
            validate: (value: string) => value.trim().length > 0 || "Название не может быть пустым"
        },
        {
            type: "text",
            name: "description",
            message: "Введите описание проекта (необязательно):"
        }
    ]);

    if (!projectData.name) {
        console.log("❌ Операция отменена");
        return;
    }

    const newProject = await _manager.createProjectAsync({
        name: projectData.name.trim(),
        description: projectData.description?.trim() || undefined
    });

    console.log("\n✅ Проект успешно создан!");
    console.log("═══════════════════════════════════");
    _manager.displayProjectInfo(newProject);
}

async function handleShowAccounts(_manager: PostMyPostProjectManager): Promise<void> {
    // Сначала получаем список проектов
    const projects = await _manager.getProjectsAsync();

    if (projects.length === 0) {
        console.log("📭 Проекты не найдены");
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
            description: `ID: ${project.id}`
        }))
    });

    if (!projectResponse.projectId) {
        console.log("❌ Операция отменена");
        return;
    }

    // Получаем аккаунты проекта
    const accounts = await _manager.getProjectAccountsAsync(projectResponse.projectId);

    if (accounts.length === 0) {
        console.log("📭 Аккаунты в проекте не найдены");
        return;
    }

    console.log(`\n👥 Найдено аккаунтов: ${accounts.length}`);
    console.log("═══════════════════════════════════");

    accounts.forEach((_account, index) => {
        console.log(`\n${index + 1}. ${_account.name}`);
        _manager.displayAccountInfo(_account);
    });
}

if (require.main === module) {
    main();
} 