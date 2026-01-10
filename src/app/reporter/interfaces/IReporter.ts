/**
 * Интерфейсы Reporter модуля
 */

export interface IAccountStats {
  name: string;
  commentsCount: number;
  maxComments: number;
  isCurrentOwner: boolean;
}

export interface IReportStats {
  sessionId: string;
  targetChannel: string;
  successfulCount: number;
  failedCount: number;
  newChannelsCount: number;
  startedAt: Date;
  finishedAt: Date;
  durationMinutes: number;
  accountsUsed: IAccountStats[];
  totalAccounts: number;
  successRate: number;
}

export interface IReporterConfig {
  reporterSessionKey: string;
  reportRecipient: string;
  enabled: boolean;
}
