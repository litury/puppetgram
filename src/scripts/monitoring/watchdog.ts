/**
 * Watchdog - проверяет зависшие сессии и отправляет алерты
 */

import { SessionsRepository } from '../../shared/database/repositories/sessionsRepository';
import { ReporterService } from '../../app/reporter/services/reporterService';
import { createLogger } from '../../shared/utils/logger';

const log = createLogger('Watchdog');

async function checkStalledSessions() {
  log.info('Запуск watchdog проверки');

  const sessionsRepo = new SessionsRepository();
  const reporter = new ReporterService();

  try {
    // Ищем сессии которые не обновлялись 30+ минут
    const stalledSessions = await sessionsRepo.findStalled(30);

    if (stalledSessions.length === 0) {
      log.info('Зависших сессий не найдено');
      return;
    }

    log.warn(`Найдено ${stalledSessions.length} зависших сессий`, {
      sessions: stalledSessions.map(s => s.id),
    });

    // Формируем сообщение для алерта
    const sessionsList = stalledSessions
      .map(s => {
        const duration = Math.round((Date.now() - s.startedAt.getTime()) / 1000 / 60);
        return `Session: <code>${s.id.substring(0, 8)}...</code>
Started: ${s.startedAt.toLocaleString('ru-RU')}
Channel: @${s.targetChannel}
Duration: ${duration} минут`;
      })
      .join('\n\n');

    const message = `Найдено ${stalledSessions.length} зависших сессий:

${sessionsList}`;

    // Отправляем алерт
    await reporter.sendAlert({ message });

    log.info('Алерт о зависших сессиях отправлен');
  } catch (error: any) {
    log.error('Ошибка в watchdog', error);

    // Пытаемся отправить алерт об ошибке самого watchdog
    try {
      await reporter.sendAlert({
        message: 'Ошибка в watchdog скрипте',
        error: error.message,
      });
    } catch {
      // Если не удалось отправить алерт - логируем и продолжаем
      log.error('Не удалось отправить алерт об ошибке watchdog');
    }
  }

  process.exit(0);
}

checkStalledSessions();
