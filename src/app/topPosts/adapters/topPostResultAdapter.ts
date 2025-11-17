/**
 * Адаптер для форматирования результатов анализа топ постов
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import {
  ITopPostAnalysisResponse,
  IChannelTopPostsResult,
  IPostAnalysisResult,
} from "../interfaces";

export class TopPostResultAdapter {
  /**
   * Форматирует результаты для консольного вывода
   */
  static formatForConsole(result: ITopPostAnalysisResponse): string {
    let output = "\n" + "=".repeat(80) + "\n";
    output += `📊 АНАЛИЗ ЛУЧШИХ ПОСТОВ\n`;
    output += `🗓 Дата анализа: ${result.analysisDate.toLocaleString("ru-RU")}\n`;
    output += `📱 Каналов обработано: ${result.totalChannels}\n`;
    output += `📝 Всего сообщений: ${result.totalMessagesAnalyzed}\n`;
    output += `🎯 Критерий сортировки: ${this.getCriteriaDisplayName(result.criteria.sortBy)}\n`;
    output += "=".repeat(80) + "\n\n";

    // Общий топ постов
    if (result.overallTopPosts.length > 0) {
      output += `🏆 ТОП ${result.overallTopPosts.length} ЛУЧШИХ ПОСТОВ:\n\n`;

      result.overallTopPosts.forEach((post, index) => {
        output += this.formatPostResult(post, index + 1);
        output += "-".repeat(60) + "\n";
      });
      output += "\n";
    }

    // Результаты по каналам
    output += "📱 РЕЗУЛЬТАТЫ ПО КАНАЛАМ:\n\n";

    result.channels.forEach((channel) => {
      output += this.formatChannelResult(channel);
      output += "\n";
    });

    return output;
  }

  /**
   * Форматирует результат отдельного поста
   */
  private static formatPostResult(
    post: IPostAnalysisResult,
    rank?: number,
  ): string {
    const msg = post.message;
    const metrics = post.metrics;

    let output = "";
    if (rank) {
      output += `${rank}. `;
    }
    output += `📊 Оценка: ${post.score.toFixed(2)}\n`;
    output += `📅 Дата: ${msg.date.toLocaleDateString("ru-RU")} ${msg.date.toLocaleTimeString("ru-RU")}\n`;
    output += `👁 Просмотры: ${metrics.views.toLocaleString()}\n`;
    output += `📤 Пересылки: ${metrics.forwards.toLocaleString()}\n`;
    output += `❤️ Реакции: ${metrics.reactions.toLocaleString()}\n`;
    output += `💬 Ответы: ${metrics.replies.toLocaleString()}\n`;
    output += `🎯 Вовлеченность: ${metrics.engagement}%\n`;
    output += `📝 Длина текста: ${metrics.textLength} символов\n`;
    output += `🖼 Медиа: ${metrics.hasMedia ? "Да" : "Нет"}\n`;

    if (msg.postAuthor) {
      output += `✍️ Автор: ${msg.postAuthor}\n`;
    }

    // Показываем первые 150 символов сообщения
    const messageText = msg.message || "";
    const previewText =
      messageText.length > 150
        ? messageText.substring(0, 150) + "..."
        : messageText;

    if (previewText.trim()) {
      output += `📄 Текст: ${previewText}\n`;
    }

    output += `🔗 ID сообщения: ${msg.id}\n`;

    return output;
  }

  /**
   * Форматирует результат канала
   */
  private static formatChannelResult(channel: IChannelTopPostsResult): string {
    let output = `📱 ${channel.channelTitle} (@${channel.channelName})\n`;
    output += `📊 Проанализировано сообщений: ${channel.totalMessagesAnalyzed}\n`;
    output += `🏆 Найдено топ постов: ${channel.topPosts.length}\n`;

    const avg = channel.averageMetrics;
    output += `📈 Средние метрики:\n`;
    output += `   👁 Просмотры: ${avg.avgViews.toLocaleString()}\n`;
    output += `   📤 Пересылки: ${avg.avgForwards.toLocaleString()}\n`;
    output += `   ❤️ Реакции: ${avg.avgReactions.toLocaleString()}\n`;
    output += `   🎯 Вовлеченность: ${avg.avgEngagement}%\n`;

    if (channel.topPosts.length > 0) {
      output += `\n🥇 Лучший пост канала:\n`;
      output += this.formatPostResult(channel.topPosts[0]);
    }

    return output;
  }

  /**
   * Форматирует результаты для экспорта в CSV
   */
  static formatForCSV(result: ITopPostAnalysisResponse): string {
    const headers = [
      "Ранг",
      "Канал",
      "ID_Сообщения",
      "Дата",
      "Оценка",
      "Просмотры",
      "Пересылки",
      "Реакции",
      "Ответы",
      "Вовлеченность_%",
      "Длина_Текста",
      "Есть_Медиа",
      "Автор",
      "Текст_Превью",
    ];

    let csv = headers.join(",") + "\n";

    result.overallTopPosts.forEach((post, index) => {
      const msg = post.message;
      const metrics = post.metrics;

      // Очищаем текст для CSV (убираем запятые и переносы строк)
      const cleanText = (msg.message || "")
        .replace(/,/g, ";")
        .replace(/\n/g, " ")
        .replace(/\r/g, " ")
        .substring(0, 100);

      const row = [
        index + 1,
        this.getChannelNameFromMessage(msg) || "unknown",
        msg.id,
        msg.date.toISOString(),
        post.score.toFixed(2),
        metrics.views,
        metrics.forwards,
        metrics.reactions,
        metrics.replies,
        metrics.engagement,
        metrics.textLength,
        metrics.hasMedia ? "Да" : "Нет",
        msg.postAuthor || "",
        `"${cleanText}"`,
      ];

      csv += row.join(",") + "\n";
    });

    return csv;
  }

  /**
   * Форматирует результаты для экспорта в JSON
   */
  static formatForJSON(result: ITopPostAnalysisResponse): string {
    // Создаем упрощенную версию для экспорта
    const exportData = {
      analysisDate: result.analysisDate,
      criteria: result.criteria,
      totalChannels: result.totalChannels,
      totalMessagesAnalyzed: result.totalMessagesAnalyzed,
      topPosts: result.overallTopPosts.map((post) => ({
        rank: post.rank,
        score: post.score,
        messageId: post.message.id,
        date: post.message.date,
        channel: this.getChannelNameFromMessage(post.message),
        metrics: post.metrics,
        author: post.message.postAuthor,
        textPreview: (post.message.message || "").substring(0, 200),
      })),
      channelSummary: result.channels.map((channel) => ({
        name: channel.channelName,
        title: channel.channelTitle,
        totalAnalyzed: channel.totalMessagesAnalyzed,
        topPostsCount: channel.topPosts.length,
        averageMetrics: channel.averageMetrics,
      })),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Получает отображаемое имя критерия
   */
  private static getCriteriaDisplayName(sortBy: string): string {
    const names: Record<string, string> = {
      views: "Просмотры",
      forwards: "Пересылки",
      engagement: "Вовлеченность",
      reactions: "Реакции",
      replies: "Ответы",
      combined: "Комбинированная оценка",
    };

    return names[sortBy] || sortBy;
  }

  /**
   * Извлекает имя канала из сообщения (если доступно)
   */
  private static getChannelNameFromMessage(message: any): string | null {
    // Это упрощенная версия - в реальности нужно будет хранить информацию о канале
    // при анализе или передавать её отдельно
    return null;
  }

  /**
   * Генерирует краткую статистику
   */
  static generateSummary(result: ITopPostAnalysisResponse): string {
    const totalViews = result.overallTopPosts.reduce(
      (sum, post) => sum + post.metrics.views,
      0,
    );
    const totalForwards = result.overallTopPosts.reduce(
      (sum, post) => sum + post.metrics.forwards,
      0,
    );
    const totalReactions = result.overallTopPosts.reduce(
      (sum, post) => sum + post.metrics.reactions,
      0,
    );

    const avgEngagement =
      result.overallTopPosts.length > 0
        ? result.overallTopPosts.reduce(
            (sum, post) => sum + post.metrics.engagement,
            0,
          ) / result.overallTopPosts.length
        : 0;

    return `
📊 КРАТКАЯ СТАТИСТИКА:
• Проанализировано каналов: ${result.totalChannels}
• Обработано сообщений: ${result.totalMessagesAnalyzed}
• Найдено топ постов: ${result.overallTopPosts.length}
• Общие просмотры топ постов: ${totalViews.toLocaleString()}
• Общие пересылки: ${totalForwards.toLocaleString()}
• Общие реакции: ${totalReactions.toLocaleString()}
• Средняя вовлеченность: ${avgEngagement.toFixed(2)}%
        `.trim();
  }
}
