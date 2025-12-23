/**
 * Интерфейсы для модуля парсинга источников
 */

export interface IParserAccount {
  name: string;
  sessionKey: string;
  sessionValue: string;
  apiId: number;
  apiHash: string;
}

export interface ISourcesParserConfig {
  delayBetweenRequests: number;  // Задержка между запросами (мс)
  maxRetries: number;            // Максимум попыток при ошибке
}

export interface IParseProgress {
  totalSources: number;
  processedCount: number;
  resultsCount: number;
  currentSource: string;
  currentAccount: string;
}

export interface IParseResult {
  source: string;
  recommendations: string[];
  timestamp: Date;
}
