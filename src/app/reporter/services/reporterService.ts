/**
 * Reporter Service - отправка отчётов в Telegram
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

      await client.getClient().sendMessage(recipientId, {
        message,
        parseMode: 'html',
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

  private formatReport(_stats: IReportStats): string {
    const lines: string[] = [];
    const channelName = _stats.targetChannel.replace('@', '');

    // Форматирование времени в ч м
    const hours = Math.floor(_stats.durationMinutes / 60);
    const mins = _stats.durationMinutes % 60;
    const durationStr = hours > 0 ? `${hours}ч ${mins}м` : `${mins}м`;

    // Скорость комментирования в час
    const commentsPerHour = _stats.durationMinutes > 0
      ? Math.round((_stats.successfulCount / _stats.durationMinutes) * 60)
      : 0;

    // Дата/время окончания
    const endTime = _stats.finishedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const endDate = _stats.finishedAt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

    // Заголовок (1 эмодзи)
    lines.push(`📊 <b>Комментирование @${channelName}</b>`);
    lines.push('');

    // Основная статистика в моноширинном формате
    lines.push('<pre>');
    lines.push(`Каналов    ${_stats.processedCount}`);
    lines.push(`Успешно    ${_stats.successfulCount}`);
    lines.push(`Ошибок     ${_stats.failedCount}`);
    lines.push(`Новых      ${_stats.newChannelsCount}`);
    lines.push(`Аккаунтов  ${_stats.accountsUsed.length}/${_stats.totalAccounts}`);
    lines.push(`Время      ${durationStr}`);
    lines.push(`Скорость   ${commentsPerHour}/ч`);
    lines.push(`Успех      ${_stats.successRate}%`);
    lines.push('</pre>');

    // Аккаунты (вертикальный список в pre-блоке)
    if (_stats.accountsUsed.length > 0) {
      lines.push('');
      lines.push('<b>Аккаунты:</b>');
      lines.push('<pre>');
      for (const acc of _stats.accountsUsed) {
        const mark = acc.isCurrentOwner ? ' *' : (acc.commentsCount >= acc.maxComments ? ' +' : '');
        const name = acc.name.padEnd(8);
        lines.push(`${name} ${acc.commentsCount}/${acc.maxComments}${mark}`);
      }
      lines.push('</pre>');
    }

    // FLOOD_WAIT (вертикальный список с временем ожидания)
    if (_stats.floodWaitAccounts && _stats.floodWaitAccounts.length > 0) {
      lines.push('');
      lines.push(`⏳ <b>FLOOD (${_stats.floodWaitAccounts.length}):</b>`);
      lines.push('<pre>');
      for (const acc of _stats.floodWaitAccounts) {
        const name = acc.name.padEnd(8);
        lines.push(`${name} ${acc.unlockAt} (${acc.waitTime})`);
      }
      lines.push('</pre>');
    }

    // Спам (3 эмодзи)
    if (_stats.spammedAccounts && _stats.spammedAccounts.length > 0) {
      lines.push('');
      lines.push(`⛔ <b>Спам (${_stats.spammedAccounts.length}):</b> ${_stats.spammedAccounts.join(', ')}`);
    }

    // Футер с датой/временем
    lines.push('');
    lines.push(`<code>${endDate} ${endTime} · ${_stats.sessionId.substring(0, 8)}</code>`);

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
}
