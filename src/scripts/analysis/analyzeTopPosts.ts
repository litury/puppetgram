/**
 * Скрипт для анализа лучших постов в Telegram каналах
 * Использует модуль topPosts для поиска и анализа топ контента
 */

import prompts from 'prompts';
import { GramClient } from '../../telegram/adapters/gramClient';
import { TopPostAnalyzerService, TopPostResultAdapter } from '../../app/topPosts';
import { IPostAnalysisCriteria, ITopPostAnalysisOptions } from '../../app/topPosts/interfaces';
import { ExportService } from '../../shared/services/exportService';
import { loadChannelsFromFile } from '../utils/helpers';

async function main() {
    console.log('🔍 Добро пожаловать в анализатор лучших постов Telegram каналов!');

    try {
        // Инициализация клиента
        const gramClient = new GramClient();
        await gramClient.connect();

        const analyzer = new TopPostAnalyzerService(gramClient.getClient());
        const exportService = new ExportService();

        // Главное меню
        while (true) {
            console.log('\n' + '='.repeat(60));
            console.log('📊 АНАЛИЗ ЛУЧШИХ ПОСТОВ');
            console.log('='.repeat(60));

            const mainChoice = await prompts({
                type: 'select',
                name: 'action',
                message: 'Выберите действие:',
                choices: [
                    { title: '🔍 Анализировать топ посты', value: 'analyze' },
                    { title: '📁 Загрузить каналы из файла', value: 'loadFile' },
                    { title: '❌ Выход', value: 'exit' }
                ]
            });

            if (!mainChoice.action || mainChoice.action === 'exit') {
                break;
            }

            switch (mainChoice.action) {
                case 'analyze':
                    await handleTopPostAnalysis(analyzer, exportService);
                    break;
                case 'loadFile':
                    await handleFileAnalysis(analyzer, exportService);
                    break;
            }
        }

    } catch (error: any) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        console.log('\n👋 До свидания!');
        process.exit(0);
    }
}

/**
 * Обработка анализа топ постов
 */
async function handleTopPostAnalysis(
    analyzer: TopPostAnalyzerService,
    exportService: ExportService
) {
    // 1. Ввод каналов
    const channelsInput = await prompts({
        type: 'text',
        name: 'channels',
        message: 'Введите каналы для анализа (через запятую):',
        validate: value => value.length > 0 ? true : 'Необходимо указать хотя бы один канал'
    });

    if (!channelsInput.channels) return;

    const channels = channelsInput.channels
        .split(',')
        .map((ch: string) => ch.trim())
        .filter((ch: string) => ch.length > 0);

    // 2. Настройка критериев анализа
    const criteria = await setupAnalysisCriteria();

    // 3. Дополнительные опции
    const options = await setupAnalysisOptions();

    // 4. Запуск анализа
    const analysisOptions: ITopPostAnalysisOptions = {
        channels,
        criteria,
        limit: options.limit,
        messageLimit: options.messageLimit,
        exportResults: options.exportResults
    };

    console.log('\n🚀 Запускаю анализ...');
    const startTime = Date.now();

    try {
        const result = await analyzer.analyzeTopPostsAsync(analysisOptions);
        const endTime = Date.now();

        console.log(`\n✅ Анализ завершен за ${((endTime - startTime) / 1000).toFixed(1)} секунд`);

        // Показываем результаты
        console.log(TopPostResultAdapter.formatForConsole(result));
        console.log(TopPostResultAdapter.generateSummary(result));

        // Экспорт результатов
        if (options.exportResults) {
            await handleResultsExport(result, exportService);
        }

    } catch (error: any) {
        console.error('❌ Ошибка при анализе:', error.message);
    }
}

/**
 * Обработка анализа из файла
 */
async function handleFileAnalysis(
    analyzer: TopPostAnalyzerService,
    exportService: ExportService
) {
    const fileChoice = await prompts({
        type: 'text',
        name: 'filePath',
        message: 'Введите путь к файлу с каналами:',
        initial: 'input-channels/it-channels.txt'
    });

    if (!fileChoice.filePath) return;

    try {
        const channels = await loadChannelsFromFile(fileChoice.filePath);
        console.log(`📁 Загружено ${channels.length} каналов из файла`);

        if (channels.length === 0) {
            console.log('⚠️ Файл пустой или не содержит валидных каналов');
            return;
        }

        // Настройка критериев и опций
        const criteria = await setupAnalysisCriteria();
        const options = await setupAnalysisOptions();

        const analysisOptions: ITopPostAnalysisOptions = {
            channels,
            criteria,
            limit: options.limit,
            messageLimit: options.messageLimit,
            exportResults: true // Для файлового анализа всегда экспортируем
        };

        console.log('\n🚀 Запускаю анализ...');
        const result = await analyzer.analyzeTopPostsAsync(analysisOptions);

        // Показываем результаты
        console.log(TopPostResultAdapter.formatForConsole(result));
        console.log(TopPostResultAdapter.generateSummary(result));

        // Экспорт результатов
        await handleResultsExport(result, exportService);

    } catch (error: any) {
        console.error('❌ Ошибка при загрузке файла:', error.message);
    }
}

/**
 * Настройка критериев анализа
 */
async function setupAnalysisCriteria(): Promise<IPostAnalysisCriteria> {
    console.log('\n📊 Настройка критериев анализа:');

    const sortChoice = await prompts({
        type: 'select',
        name: 'sortBy',
        message: 'По какому критерию сортировать посты?',
        choices: [
            { title: '👁 По просмотрам', value: 'views' },
            { title: '📤 По пересылкам', value: 'forwards' },
            { title: '🎯 По вовлеченности', value: 'engagement' },
            { title: '❤️ По реакциям', value: 'reactions' },
            { title: '💬 По ответам', value: 'replies' },
            { title: '🎯 Комбинированная оценка', value: 'combined' }
        ]
    });

    const filters = await prompts([
        {
            type: 'number',
            name: 'minViews',
            message: 'Минимальное количество просмотров (0 - без ограничений):',
            initial: 0
        },
        {
            type: 'number',
            name: 'minForwards',
            message: 'Минимальное количество пересылок (0 - без ограничений):',
            initial: 0
        },
        {
            type: 'number',
            name: 'minReactions',
            message: 'Минимальное количество реакций (0 - без ограничений):',
            initial: 0
        },
        {
            type: 'select',
            name: 'mediaFilter',
            message: 'Фильтр по медиа:',
            choices: [
                { title: 'Все посты', value: 'all' },
                { title: 'Только с медиа', value: 'withMedia' },
                { title: 'Только без медиа', value: 'withoutMedia' }
            ]
        },
        {
            type: 'number',
            name: 'daysBack',
            message: 'Анализировать посты за последние N дней (0 - все):',
            initial: 0
        }
    ]);

    const criteria: IPostAnalysisCriteria = {
        sortBy: sortChoice.sortBy,
        minViews: filters.minViews > 0 ? filters.minViews : undefined,
        minForwards: filters.minForwards > 0 ? filters.minForwards : undefined,
        minReactions: filters.minReactions > 0 ? filters.minReactions : undefined,
        includeWithMedia: filters.mediaFilter === 'withMedia' ? true : undefined,
        excludeWithMedia: filters.mediaFilter === 'withoutMedia' ? true : undefined
    };

    // Добавляем фильтр по дате если указан
    if (filters.daysBack > 0) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - filters.daysBack);
        criteria.dateFrom = startDate;
        criteria.dateTo = endDate;
    }

    return criteria;
}

/**
 * Настройка дополнительных опций
 */
async function setupAnalysisOptions() {
    const options = await prompts([
        {
            type: 'number',
            name: 'messageLimit',
            message: 'Сколько последних сообщений анализировать из каждого канала?',
            initial: 100,
            min: 10,
            max: 1000
        },
        {
            type: 'number',
            name: 'limit',
            message: 'Сколько топ постов показать в результате?',
            initial: 20,
            min: 5,
            max: 100
        },
        {
            type: 'confirm',
            name: 'exportResults',
            message: 'Экспортировать результаты в файлы?',
            initial: true
        }
    ]);

    return options;
}

/**
 * Обработка экспорта результатов
 */
async function handleResultsExport(result: any, exportService: ExportService) {
    const exportChoice = await prompts({
        type: 'multiselect',
        name: 'formats',
        message: 'В каких форматах экспортировать результаты?',
        choices: [
            { title: 'JSON', value: 'json', selected: true },
            { title: 'CSV', value: 'csv', selected: true },
            { title: 'TXT (консольный вывод)', value: 'txt' }
        ]
    });

    if (!exportChoice.formats || exportChoice.formats.length === 0) {
        return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const baseFileName = `top_posts_analysis_${timestamp}`;

    try {
        for (const format of exportChoice.formats) {
            let content: string;
            let fileName: string;

            switch (format) {
                case 'json':
                    content = TopPostResultAdapter.formatForJSON(result);
                    fileName = `${baseFileName}.json`;
                    break;
                case 'csv':
                    content = TopPostResultAdapter.formatForCSV(result);
                    fileName = `${baseFileName}.csv`;
                    break;
                case 'txt':
                    content = TopPostResultAdapter.formatForConsole(result);
                    fileName = `${baseFileName}.txt`;
                    break;
                default:
                    continue;
            }

            await exportService.saveToFile(content, fileName, 'exports');
            console.log(`✅ Результаты экспортированы в: exports/${fileName}`);
        }
    } catch (error: any) {
        console.error('❌ Ошибка при экспорте:', error.message);
    }
}

// Запуск программы
if (require.main === module) {
    main().catch(console.error);
} 