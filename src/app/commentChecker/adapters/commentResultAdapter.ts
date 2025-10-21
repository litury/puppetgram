import {
    ICommentCheckResponse,
    IBulkCommentCheckResponse,
    IChannelCommentInfo
} from '../interfaces';
import { formatCommentsStatus } from '../parts';

export class CommentResultAdapter {
    /**
     * Форматирование результата проверки одного канала
     */
    formatSingleChannelResult(result: ICommentCheckResponse): string {
        if (!result.success) {
            return `❌ Ошибка проверки канала: ${result.error}`;
        }

        const channel = result.channel;
        let output = `📋 Результат проверки канала\n`;
        output += `════════════════════════════\n\n`;

        // Основная информация
        output += `📺 Канал: ${channel.channelTitle}\n`;
        if (channel.channelUsername) {
            output += `🔗 Username: @${channel.channelUsername}\n`;
            output += `🌐 Ссылка: https://t.me/${channel.channelUsername}\n`;
        }
        output += `🆔 ID: ${channel.channelId}\n\n`;

        // Статус комментариев
        output += `💬 Статус комментариев: ${formatCommentsStatus(channel.commentsPolicy)}\n`;

        // Подробности о комментариях
        if (channel.commentsEnabled) {
            output += `✅ Комментарии активны\n`;

            if (channel.linkedDiscussionGroup) {
                output += `🗨️ Дискуссионная группа: ${channel.linkedDiscussionGroup.title}\n`;
                if (channel.linkedDiscussionGroup.username) {
                    output += `   └─ @${channel.linkedDiscussionGroup.username}\n`;
                    output += `   └─ https://t.me/${channel.linkedDiscussionGroup.username}\n`;
                }
            }
        } else {
            output += `❌ Комментарии недоступны\n`;
            if (channel.restrictionReason) {
                output += `❓ Причина: ${channel.restrictionReason}\n`;
            }
        }

        // Права пользователя
        output += `\n👤 Ваши права:\n`;
        output += `   📝 Можете комментировать: ${channel.canPostComments ? '✅ Да' : '❌ Нет'}\n`;
        output += `   👀 Можете читать: ${channel.canReadComments ? '✅ Да' : '❌ Нет'}\n`;

        // Информация о связанной группе
        if (channel.linkedDiscussionGroup) {
            output += `\n🗨️ Дискуссионная группа:\n`;
            output += `   📢 Название: ${channel.linkedDiscussionGroup.title}\n`;
            if (channel.linkedDiscussionGroup.username) {
                output += `   🔗 Ссылка: https://t.me/${channel.linkedDiscussionGroup.username}\n`;
            }
        }

        // Рекомендации
        if (result.recommendations && result.recommendations.length > 0) {
            output += `\n💡 Рекомендации:\n`;
            result.recommendations.forEach(rec => {
                output += `   ${rec}\n`;
            });
        }

        output += `\n⏰ Проверено: ${this.formatDate(result.checkDate)}\n`;

        return output;
    }

    /**
     * Форматирование результатов массовой проверки
     */
    formatBulkResults(results: IBulkCommentCheckResponse): string {
        let output = `📊 Результаты массовой проверки каналов\n`;
        output += `═══════════════════════════════════════\n\n`;

        // Общая статистика
        output += `📈 Общая статистика:\n`;
        output += `   🎯 Всего проверено: ${results.totalChecked}\n`;
        output += `   ✅ Успешно: ${results.successfulChecks}\n`;
        output += `   ❌ Ошибок: ${results.failedChecks}\n\n`;

        // Статистика комментариев
        output += `💬 Статистика комментариев:\n`;
        output += `   ✅ Комментарии включены: ${results.summary.enabledComments}\n`;
        output += `   ❌ Комментарии отключены: ${results.summary.disabledComments}\n`;
        output += `   ⚠️ Ограниченные: ${results.summary.restrictedComments}\n`;
        output += `   🗨️ С дискуссионными группами: ${results.summary.withDiscussionGroups}\n\n`;

        // Проценты
        if (results.successfulChecks > 0) {
            const enabledPercent = Math.round((results.summary.enabledComments / results.successfulChecks) * 100);
            const withGroupsPercent = Math.round((results.summary.withDiscussionGroups / results.successfulChecks) * 100);

            output += `📊 Процентное соотношение:\n`;
            output += `   💬 Каналы с комментариями: ${enabledPercent}%\n`;
            output += `   🗨️ Каналы с группами обсуждения: ${withGroupsPercent}%\n\n`;
        }

        // Детальные результаты по каналам
        output += `📋 Детальные результаты:\n`;
        output += `─────────────────────────\n`;

        results.results.forEach((result, index) => {
            output += `\n${index + 1}. `;

            if (result.success) {
                const channel = result.channel;
                output += `${channel.channelTitle}`;
                if (channel.channelUsername) {
                    output += ` (@${channel.channelUsername})`;
                    output += `\n   🔗 Канал: https://t.me/${channel.channelUsername}`;
                }
                output += `\n   💬 ${formatCommentsStatus(channel.commentsPolicy)}`;

                if (channel.linkedDiscussionGroup) {
                    output += `\n   🗨️ Группа: ${channel.linkedDiscussionGroup.title}`;
                    if (channel.linkedDiscussionGroup.username) {
                        output += `\n   💬 Чат: https://t.me/${channel.linkedDiscussionGroup.username}`;
                    }
                }

                // Добавляем информацию о требованиях доступа
                if (channel.accessRequirements?.membershipRequired) {
                    if (channel.accessRequirements.joinRequest) {
                        output += `\n   🔒 Требует одобрения администрации`;
                    } else if (channel.accessRequirements.joinToSend) {
                        output += `\n   👥 Только для участников канала`;
                    }
                }
            } else {
                output += `❌ ${result.channel.channelTitle} - ${result.error}`;
            }
        });

        return output;
    }

    /**
     * Создание краткого отчёта для экспорта
     */
    createExportSummary(results: IBulkCommentCheckResponse): string {
        let csv = 'Канал,Username,Ссылка канала,Комментарии,Тип,Дискуссионная группа,Ссылка чата,Может комментировать\n';

        results.results.forEach(result => {
            if (result.success) {
                const ch = result.channel;
                csv += `"${ch.channelTitle}",`;
                csv += `"${ch.channelUsername || ''}",`;
                csv += `"${ch.channelUsername ? `https://t.me/${ch.channelUsername}` : ''}",`;
                csv += `"${formatCommentsStatus(ch.commentsPolicy)}",`;
                csv += `"${ch.commentsPolicy}",`;
                csv += `"${ch.linkedDiscussionGroup?.title || ''}",`;
                csv += `"${ch.linkedDiscussionGroup?.username ? `https://t.me/${ch.linkedDiscussionGroup.username}` : ''}",`;
                csv += `"${ch.canPostComments ? 'Да' : 'Нет'}"\n`;
            } else {
                csv += `"${result.channel.channelTitle}","","","Ошибка","unknown","","","Нет"\n`;
            }
        });

        return csv;
    }

    /**
     * Создание детального отчёта в Markdown
     */
    createDetailedMarkdownReport(results: IBulkCommentCheckResponse): string {
        let md = `# Отчёт о проверке комментариев в каналах\n\n`;
        md += `**Дата проверки:** ${this.formatDate(new Date())}\n\n`;

        // Общая статистика
        md += `## 📊 Общая статистика\n\n`;
        md += `| Метрика | Значение |\n`;
        md += `|---------|----------|\n`;
        md += `| Всего проверено | ${results.totalChecked} |\n`;
        md += `| Успешно | ${results.successfulChecks} |\n`;
        md += `| Ошибок | ${results.failedChecks} |\n`;
        md += `| Комментарии включены | ${results.summary.enabledComments} |\n`;
        md += `| Комментарии отключены | ${results.summary.disabledComments} |\n`;
        md += `| С дискуссионными группами | ${results.summary.withDiscussionGroups} |\n\n`;

        // Таблица каналов
        md += `## 📋 Детальная информация по каналам\n\n`;
        md += `| № | Канал | Username | Комментарии | Дискуссионная группа | Права |\n`;
        md += `|---|-------|----------|-------------|---------------------|-------|\n`;

        results.results.forEach((result, index) => {
            if (result.success) {
                const ch = result.channel;
                md += `| ${index + 1} | ${ch.channelTitle} | `;
                md += `${ch.channelUsername ? `@${ch.channelUsername}` : ''} | `;
                md += `${formatCommentsStatus(ch.commentsPolicy)} | `;
                md += `${ch.linkedDiscussionGroup?.title || ''} | `;
                md += `${ch.canPostComments ? '✅' : '❌'} |\n`;
            } else {
                md += `| ${index + 1} | ${result.channel.channelTitle} | | ❌ Ошибка | | |\n`;
            }
        });

        // Рекомендации
        md += `\n## 💡 Общие рекомендации\n\n`;

        const disabledCount = results.summary.disabledComments;
        const totalSuccessful = results.successfulChecks;

        if (disabledCount > 0) {
            md += `- **${disabledCount} каналов** имеют отключенные комментарии. Рассмотрите создание дискуссионных групп.\n`;
        }

        if (results.summary.withDiscussionGroups > 0) {
            md += `- **${results.summary.withDiscussionGroups} каналов** уже используют дискуссионные группы - это повышает вовлеченность.\n`;
        }

        if (totalSuccessful > 0) {
            const enabledPercent = Math.round((results.summary.enabledComments / totalSuccessful) * 100);
            md += `- **${enabledPercent}%** каналов поддерживают комментарии.\n`;
        }

        return md;
    }

    /**
     * Форматирование даты
     */
    private formatDate(date: Date): string {
        return date.toLocaleString('ru-RU', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
} 