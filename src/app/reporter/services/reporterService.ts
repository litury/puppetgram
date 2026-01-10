/**
 * Reporter Service - отправка отчётов в Telegram
 */

import { GramClient } from '../../../telegram/adapters/gramClient';
import { createLogger } from '../../../shared/utils/logger';
import { IReportStats, IReporterConfig, IAccountStats } from '../interfaces/IReporter';

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

      await client.getClient().sendMessage(this.p_config.reportRecipient, {
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

    lines.push(`<b>📊 Отчёт: комментирование от @${_stats.targetChannel}</b>`);
    lines.push('');
    lines.push(`✅ Успешных: <b>${_stats.successfulCount}</b>`);
    lines.push(`❌ Ошибок: <b>${_stats.failedCount}</b>`);
    lines.push(`📁 Новых каналов: <b>${_stats.newChannelsCount}</b>`);
    lines.push(`👥 Аккаунтов: <b>${_stats.accountsUsed.length}/${_stats.totalAccounts}</b>`);
    lines.push(`⏱️ Время: <b>${_stats.durationMinutes} мин</b>`);
    lines.push(`📈 Успех: <b>${_stats.successRate}%</b>`);

    if (_stats.accountsUsed.length > 0) {
      lines.push('');
      lines.push('🔄 <b>Статус аккаунтов:</b>');

      for (const account of _stats.accountsUsed) {
        const status = this.formatAccountStatus(account);
        lines.push(`• ${account.name}: ${account.commentsCount}/${account.maxComments} ${status}`);
      }
    }

    lines.push('');
    lines.push(`<i>Сессия: ${_stats.sessionId.substring(0, 8)}...</i>`);

    return lines.join('\n');
  }

  private formatAccountStatus(_account: IAccountStats): string {
    if (_account.isCurrentOwner) {
      return '(текущий владелец)';
    }
    if (_account.commentsCount >= _account.maxComments) {
      return '✓';
    }
    return '';
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
