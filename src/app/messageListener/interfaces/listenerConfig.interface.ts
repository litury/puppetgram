/**
 * Конфигурация слушателя сообщений
 */
export interface IListenerConfig {
  /** Слушать только личные сообщения */
  privateOnly?: boolean;
  /** Слушать только группы */
  groupsOnly?: boolean;
  /** Слушать только каналы */
  channelsOnly?: boolean;
  /** Фильтр по паттерну текста (regex) */
  textPattern?: RegExp;
  /** Обрабатывать только входящие сообщения */
  incomingOnly?: boolean;
}

/**
 * Данные сконвертированной сессии
 */
export interface IConvertedSessionData {
  phone: string;
  username: string | null;
  firstName: string;
  userId: number | null;
  sessionString: string;
  app_id: number;
  app_hash: string;
  convertedAt: string;
  sessionFilePath: string;
  jsonFilePath: string;
}
