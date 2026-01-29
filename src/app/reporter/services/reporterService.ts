/**
 * Reporter Service - отправка отчётов в Telegram
 *
 * Минималистичная система уведомлений:
 * - SESSION END: по завершении сессии (без звука)
 * - CRITICAL: критические проблемы (со звуком)
 */

import { GramClient } from '../../../telegram/adapters/gramClient';
import { TelegramClient } from 'telegram';
import { Api } from 'telegram/tl';
import { createLogger } from '../../../shared/utils/logger';
import { IReportStats, IReporterConfig } from '../interfaces/IReporter';

export class ReporterService {
  private p_config: IReporterConfig;
  private p_log: ReturnType<typeof createLogger>;

  constructor() {
    this.p_log = createLogger('ReporterService');

    this.p_config = {
      reporterSessionKey: process.env.REPORTER_SESSION_KEY || 'SESSION_STRING_1',
      reportRecipient: process.env.REPORT_RECIPIENT || '',
      enabled: !!process.env.REPORT_RECIPIENT,
    };

    if (!this.p_config.enabled) {
      this.p_log.warn('Reporter отключён: REPORT_RECIPIENT не указан в .env');
    }
  }

  /**
   * Отправляет итоговый отчёт сессии (без звука)
   */
  async sendReport(_stats: IReportStats): Promise<boolean> {
    if (!this.p_config.enabled) {
      this.p_log.info('Отчёт не отправлен: reporter отключён');
      return false;
    }

    const startTime = Date.now();
    this.p_log.operationStart('SendReport', {
      recipient: this.p_config.reportRecipient,
      sessionId: _stats.sessionId,
    });

    let client: GramClient | null = null;

    try {
      const sessionString = process.env[this.p_config.reporterSessionKey];
      if (!sessionString) {
        throw new Error(`Session string не найден: ${this.p_config.reporterSessionKey}`);
      }

      const originalSession = process.env.SESSION_STRING;
      process.env.SESSION_STRING = sessionString;

      client = new GramClient();
      await client.connect();

      process.env.SESSION_STRING = originalSession;

      const message = this.formatReport(_stats);

      const recipientId = await this.resolveRecipientId(client.getClient());
      if (!recipientId) {
        throw new Error(`Получатель не найден в диалогах: ${this.p_config.reportRecipient}`);
      }

      // Отчёт всегда без звука
      await client.getClient().sendMessage(recipientId, {
        message,
        parseMode: 'html',
        silent: true,
      });

      this.p_log.operationEnd('SendReport', startTime, {
        success: true,
        recipient: this.p_config.reportRecipient,
      });

      return true;
    } catch (error: any) {
      this.p_log.error('Ошибка отправки отчёта', error, {
        recipient: this.p_config.reportRecipient,
        duration: Date.now() - startTime,
      });
      return false;
    } finally {
      if (client) {
        try {
          await client.disconnect();
        } catch {
          // Игнорируем ошибки отключения
        }
      }
    }
  }

  /**
   * Компактный формат отчёта
   */
  private formatReport(_stats: IReportStats): string {
    const lines: string[] = [];
    const channelName = _stats.targetChannel.replace('@', '');

    // Форматирование времени
    const hours = Math.floor(_stats.durationMinutes / 60);
    const mins = _stats.durationMinutes % 60;
    const durationStr = hours > 0 ? `${hours}ч ${mins}м` : `${mins}м`;

    // Дата/время окончания
    const endTime = _stats.finishedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const endDate = _stats.finishedAt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

    // Заголовок
    lines.push(`✅ @${channelName}`);
    lines.push('');

    // Краткая статистика в одну строку
    lines.push(`${_stats.successfulCount} комм · ${_stats.successRate}% · ${durationStr}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━');

    // Аккаунты (компактно)
    if (_stats.accountsUsed.length > 0) {
      lines.push('<pre>');
      for (const acc of _stats.accountsUsed) {
        const mark = acc.commentsCount >= acc.maxComments ? ' ✓' : '';
        const name = acc.name.substring(0, 8).padEnd(8);
        lines.push(`${name} ${acc.commentsCount}/${acc.maxComments}${mark}`);
      }
      lines.push('</pre>');
    }

    // FLOOD_WAIT (если есть)
    if (_stats.floodWaitAccounts && _stats.floodWaitAccounts.length > 0) {
      lines.push('━━━━━━━━━━━━━━━━━━━━━');
      for (const acc of _stats.floodWaitAccounts) {
        lines.push(`⏳ ${acc.name} → ${acc.unlockAt}`);
      }
    }

    // Спам (если есть)
    if (_stats.spammedAccounts && _stats.spammedAccounts.length > 0) {
      if (!_stats.floodWaitAccounts || _stats.floodWaitAccounts.length === 0) {
        lines.push('━━━━━━━━━━━━━━━━━━━━━');
      }
      for (const acc of _stats.spammedAccounts) {
        lines.push(`⛔ ${acc} SPAM`);
      }
    }

    // Футер
    lines.push('');
    lines.push(`<code>${endDate} ${endTime}</code>`);

    return lines.join('\n');
  }

  private async resolveRecipientId(_client: TelegramClient): Promise<number | null> {
    const recipient = this.p_config.reportRecipient;

    // Если уже числовой ID — используем
    if (/^\d+$/.test(recipient)) {
      return parseInt(recipient, 10);
    }

    // Ищем в диалогах
    const username = recipient.replace('@', '').toLowerCase();
    const dialogs = await _client.getDialogs({ limit: 500 });

    for (const dialog of dialogs) {
      const entity = dialog.entity;
      if (entity?.className === 'User') {
        const user = entity as Api.User;
        if (user.username?.toLowerCase() === username) {
          this.p_log.info(`Найден ID для ${recipient}: ${user.id}`);
          return user.id.toJSNumber();
        }
      }
    }

    this.p_log.error(`Получатель ${recipient} не найден в диалогах`);
    return null;
  }

  async checkAvailability(): Promise<boolean> {
    if (!this.p_config.enabled) {
      return false;
    }

    try {
      const sessionString = process.env[this.p_config.reporterSessionKey];
      if (!sessionString) {
        return false;
      }

      const originalSession = process.env.SESSION_STRING;
      process.env.SESSION_STRING = sessionString;

      const client = new GramClient();
      await client.connect();
      await client.disconnect();

      process.env.SESSION_STRING = originalSession;

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Отправляет критический алерт (СО ЗВУКОМ)
   * Используется только для критических проблем:
   * - Все аккаунты заблокированы
   * - Скрипт упал с ошибкой
   */
  async sendAlert(_params: {
    message: string;
    sessionId?: string;
    error?: string;
  }): Promise<boolean> {
    if (!this.p_config.enabled) {
      return false;
    }

    let alertMessage = `🚨 <b>CRITICAL</b>\n\n${_params.message}`;

    if (_params.sessionId) {
      alertMessage += `\n\nSession: <code>${_params.sessionId.substring(0, 8)}...</code>`;
    }

    if (_params.error) {
      alertMessage += `\n\n<pre>${_params.error.substring(0, 500)}</pre>`;
    }

    return this.sendMessage(alertMessage, false);
  }

  /**
   * Вспомогательный метод для отправки сообщений
   */
  private async sendMessage(_message: string, _silent: boolean = true): Promise<boolean> {
    if (!this.p_config.enabled) {
      return false;
    }

    let client: GramClient | null = null;

    try {
      const sessionString = process.env[this.p_config.reporterSessionKey];
      if (!sessionString) {
        throw new Error(`Session string не найден: ${this.p_config.reporterSessionKey}`);
      }

      const originalSession = process.env.SESSION_STRING;
      process.env.SESSION_STRING = sessionString;

      client = new GramClient();
      await client.connect();

      process.env.SESSION_STRING = originalSession;

      const recipientId = await this.resolveRecipientId(client.getClient());
      if (!recipientId) {
        throw new Error(`Получатель не найден: ${this.p_config.reportRecipient}`);
      }

      await client.getClient().sendMessage(recipientId, {
        message: _message,
        parseMode: 'html',
        silent: _silent,
      });

      return true;
    } catch (error: any) {
      this.p_log.error('Ошибка отправки сообщения', error);
      return false;
    } finally {
      if (client) {
        try {
          await client.disconnect();
        } catch {
          // Игнорируем ошибки отключения
        }
      }
    }
  }
}
