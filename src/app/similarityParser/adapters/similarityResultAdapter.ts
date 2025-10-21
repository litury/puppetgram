/**
 * Адаптер для форматирования результатов парсинга похожих каналов
 * Следует стандартам компании согласно frontend-coding-standards.md
 */

import { ISimilarChannel, ISimilarityParsingResult } from '../interfaces';
import { formatProcessingTime } from '../parts';

/**
 * Адаптер для форматирования результатов поиска похожих каналов
 */
export class SimilarityResultAdapter {

    /**
     * Форматирование результатов для консольного вывода
     * @param _result - результат парсинга
     * @returns отформатированная строка для консоли
     */
    static formatConsoleOutput(_result: ISimilarityParsingResult): string {
        if (_result.channels.length === 0) {
            return `❌ Похожие каналы для ${_result.sourceChannel} не найдены`;
        }

        let output = `\n🎯 Найдено похожих каналов: ${_result.totalCount}\n`;
        output += `📍 Источник: ${_result.sourceChannel}\n`;

        if (_result.searchDepth > 1) {
            output += `🔍 Глубина поиска: ${_result.searchDepth} уровней\n`;
        }

        if (_result.duplicatesRemoved && _result.duplicatesRemoved > 0) {
            output += `🗑️ Удалено дубликатов: ${_result.duplicatesRemoved}\n`;
        }

        output += `⏱️ Время обработки: ${formatProcessingTime(_result.processingTimeMs)}\n`;
        output += '\n📋 Список каналов:\n';
        output += '='.repeat(60) + '\n';

        _result.channels.forEach((channel, index) => {
            output += this.formatChannelForConsole(channel, index + 1);
            output += '-'.repeat(50) + '\n';
        });

        return output;
    }

    /**
     * Форматирование одного канала для консольного вывода
     * @param _channel - канал для форматирования
     * @param _index - порядковый номер
     * @returns отформатированная строка канала
     */
    private static formatChannelForConsole(_channel: ISimilarChannel, _index: number): string {
        let output = `${_index}. 📺 ${_channel.title}\n`;

        if (_channel.username) {
            output += `   🔗 @${_channel.username} | https://t.me/${_channel.username}\n`;
        }

        if (_channel.subscribersCount) {
            output += `   👥 ${_channel.subscribersCount.toLocaleString()} подписчиков`;
        }

        if (_channel.isVerified) {
            output += ` ✅ Верифицирован`;
        }

        if (_channel.searchDepth && _channel.searchDepth > 1) {
            output += ` 📊 Глубина: ${_channel.searchDepth}`;
        }

        output += '\n';

        if (_channel.description) {
            const shortDesc = _channel.description.length > 100
                ? _channel.description.substring(0, 100) + '...'
                : _channel.description;
            output += `   📝 ${shortDesc}\n`;
        }

        return output;
    }

    /**
     * Экспорт списка имен каналов
     * @param _result - результат парсинга
     * @returns строка с именами каналов (по одному на строку)
     */
    static exportChannelNames(_result: ISimilarityParsingResult): string {
        return _result.channels
            .filter(channel => channel.username)
            .map(channel => `@${channel.username}`)
            .join('\n');
    }

    /**
     * Экспорт списка ссылок на каналы
     * @param _result - результат парсинга
     * @returns строка со ссылками (по одной на строку)
     */
    static exportChannelLinks(_result: ISimilarityParsingResult): string {
        return _result.channels
            .filter(channel => channel.username)
            .map(channel => `https://t.me/${channel.username}`)
            .join('\n');
    }

    /**
     * Экспорт подробной информации в формате Markdown
     * @param _result - результат парсинга
     * @returns Markdown строка с подробной информацией
     */
    static exportDetailedMarkdown(_result: ISimilarityParsingResult): string {
        let content = `# Похожие каналы\n\n`;

        content += `**Источник:** ${_result.sourceChannel}\n`;
        content += `**Найдено:** ${_result.totalCount} каналов\n`;

        if (_result.searchDepth > 1) {
            content += `**Глубина поиска:** ${_result.searchDepth} уровней\n`;
        }

        if (_result.duplicatesRemoved && _result.duplicatesRemoved > 0) {
            content += `**Удалено дубликатов:** ${_result.duplicatesRemoved}\n`;
        }

        content += `**Время обработки:** ${formatProcessingTime(_result.processingTimeMs)}\n`;
        content += `**Дата:** ${new Date().toLocaleString()}\n\n`;

        // Список всех каналов
        content += `## 📋 Список каналов (${_result.channels.length})\n\n`;
        _result.channels.forEach((channel, index) => {
            content += this.formatChannelMarkdown(channel, index + 1);
        });

        return content;
    }

    /**
     * Форматирование канала для Markdown
     */
    private static formatChannelMarkdown(channel: ISimilarChannel, index: number): string {
        let content = `### ${index}. ${channel.title} ${channel.isVerified ? '✅' : ''}\n\n`;

        if (channel.username) {
            content += `- **Username:** @${channel.username}\n`;
            content += `- **Ссылка:** https://t.me/${channel.username}\n`;
        }

        content += `- **ID:** ${channel.id}\n`;

        if (channel.subscribersCount) {
            content += `- **Подписчиков:** ${channel.subscribersCount.toLocaleString()}\n`;
        }

        if (channel.searchDepth && channel.searchDepth > 1) {
            content += `- **Найден на глубине:** ${channel.searchDepth}\n`;
        }

        if (channel.description) {
            content += `- **Описание:** ${channel.description}\n`;
        }

        content += '\n';
        return content;
    }

    /**
     * Экспорт в CSV формат
     * @param _result - результат парсинга
     * @returns CSV строка
     */
    static exportCSV(_result: ISimilarityParsingResult): string {
        const headers = [
            'ID',
            'Название',
            'Username',
            'Ссылка',
            'Подписчиков',
            'Верифицирован',
            'Глубина поиска',
            'Описание'
        ];

        let csv = headers.join(',') + '\n';

        _result.channels.forEach(channel => {
            const row = [
                channel.id,
                `"${channel.title.replace(/"/g, '""')}"`,
                channel.username || '',
                channel.username ? `https://t.me/${channel.username}` : '',
                channel.subscribersCount || 0,
                channel.isVerified ? 'Да' : 'Нет',
                channel.searchDepth || 1,
                `"${(channel.description || '').replace(/"/g, '""')}"`
            ];

            csv += row.join(',') + '\n';
        });

        return csv;
    }

    /**
     * Генерация статистики поиска
     * @param _result - результат парсинга
     * @returns отформатированная статистика
     */
    static generateSearchStats(_result: ISimilarityParsingResult): string {
        if (_result.channels.length === 0) {
            return '📊 Статистика: каналы не найдены';
        }

        const stats = {
            totalChannels: _result.totalCount,
            withUsername: _result.channels.filter(c => c.username).length,
            verified: _result.channels.filter(c => c.isVerified).length,
            withDescription: _result.channels.filter(c => c.description && c.description.length > 0).length,
            avgSubscribers: this.calculateAverageSubscribers(_result.channels),
            maxDepth: Math.max(..._result.channels.map(c => c.searchDepth || 1))
        };

        return `
📊 Статистика поиска:
- Всего каналов: ${stats.totalChannels}
- С username: ${stats.withUsername} (${Math.round(stats.withUsername / stats.totalChannels * 100)}%)
- Верифицированных: ${stats.verified} (${Math.round(stats.verified / stats.totalChannels * 100)}%)
- С описанием: ${stats.withDescription} (${Math.round(stats.withDescription / stats.totalChannels * 100)}%)
- Средний размер аудитории: ${stats.avgSubscribers.toLocaleString()}
- Максимальная глубина: ${stats.maxDepth}
    `.trim();
    }

    /**
     * Расчет среднего количества подписчиков
     * @param _channels - массив каналов
     * @returns среднее количество подписчиков
     */
    private static calculateAverageSubscribers(_channels: ISimilarChannel[]): number {
        const channelsWithSubscribers = _channels.filter(c => c.subscribersCount && c.subscribersCount > 0);

        if (channelsWithSubscribers.length === 0) {
            return 0;
        }

        const totalSubscribers = channelsWithSubscribers.reduce((sum, c) => sum + (c.subscribersCount || 0), 0);
        return Math.round(totalSubscribers / channelsWithSubscribers.length);
    }

    /**
     * Форматирование ошибки для пользователя
     * @param _error - объект ошибки
     * @param _sourceChannel - исходный канал
     * @returns отформатированное сообщение об ошибке
     */
    static formatError(_error: Error, _sourceChannel?: string): string {
        let message = '❌ Ошибка при поиске похожих каналов';

        if (_sourceChannel) {
            message += ` для ${_sourceChannel}`;
        }

        message += `:\n${_error.message}`;

        // Добавляем возможные причины и решения
        if (_error.message.includes('не найден') || _error.message.includes('недоступен')) {
            message += '\n\n💡 Возможные причины:';
            message += '\n- Канал не существует или был удален';
            message += '\n- Канал приватный и недоступен для поиска';
            message += '\n- Неправильно указано имя канала';
            message += '\n- Канал заблокирован в вашем регионе';
        } else if (_error.message.includes('API')) {
            message += '\n\n💡 Возможные причины:';
            message += '\n- Превышен лимит запросов к API';
            message += '\n- Проблемы с подключением к Telegram';
            message += '\n- Временные проблемы с сервером Telegram';
        }

        return message;
    }
} 