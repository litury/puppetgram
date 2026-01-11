/**
 * Интерфейсы Reporter модуля
 */

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
