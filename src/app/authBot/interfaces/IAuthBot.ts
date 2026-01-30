/**
 * Интерфейсы для Auth Bot модуля
 */

export interface IAuthBotConfig {
  botToken: string;
  wsServerUrl: string;
  authBotSecret: string;
}

export interface ITelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ITelegramMessage {
  message_id: number;
  from?: ITelegramUser;
  chat: {
    id: number;
    type: string;
  };
  text?: string;
  entities?: Array<{
    type: string;
    offset: number;
    length: number;
  }>;
}

export interface ITelegramCallbackQuery {
  id: string;
  from: ITelegramUser;
  message?: ITelegramMessage;
  data?: string;
}

export interface ITelegramUpdate {
  update_id: number;
  message?: ITelegramMessage;
  callback_query?: ITelegramCallbackQuery;
}

export interface IAuthConfirmPayload {
  token: string;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
}

export interface IAuthConfirmResponse {
  success?: boolean;
  error?: string;
  sessionId?: string;
}
