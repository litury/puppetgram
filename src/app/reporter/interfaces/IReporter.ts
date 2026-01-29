/**
 * Интерфейсы Reporter модуля
 */

/**
 * Уровни алертов для уменьшения alert fatigue
 * - CRITICAL: требует немедленного действия (со звуком)
 * - WARNING: требует внимания (со звуком)
 * - INFO: информационное сообщение (без звука)
 * - HEARTBEAT: периодический статус (без звука)
 */
export enum AlertLevel {
  CRITICAL = 'critical',
  WARNING = 'warning',
  INFO = 'info',
  HEARTBEAT = 'heartbeat',
}

/**
 * Конфигурация алертов
 */
export interface IAlertConfig {
  heartbeatIntervalMinutes: number; // Интервал heartbeat (по умолчанию 60)
  successThreshold: number;         // % успеха ниже которого WARNING (по умолчанию 50)
  silentInfo: boolean;              // Тихие INFO сообщения (по умолчанию true)
}

export interface IAccountStats {
  name: string;
  commentsCount: number;
  maxComments: number;
  isCurrentOwner: boolean;
}

export interface IFloodWaitInfo {
  name: string;
  unlockAt: string; // Время разблокировки "15:30"
  waitTime: string; // Сколько ждать "17ч 35м"
}

export interface IReportStats {
  sessionId: string;
  targetChannel: string;
  successfulCount: number;
  failedCount: number;
  processedCount: number; // Общее количество обработанных каналов
  newChannelsCount: number;
  startedAt: Date;
  finishedAt: Date;
  durationMinutes: number;
  accountsUsed: IAccountStats[];
  totalAccounts: number;
  successRate: number;
  // Информация о FLOOD_WAIT (опционально)
  floodWaitAccounts?: IFloodWaitInfo[];
  spammedAccounts?: string[];
}

export interface IReporterConfig {
  reporterSessionKey: string;
  reportRecipient: string;
  enabled: boolean;
}
