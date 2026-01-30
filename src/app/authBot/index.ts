/**
 * Auth Bot Module - публичный API
 *
 * Модуль для авторизации пользователей дашборда через Telegram Deep Link
 *
 * @example
 * import { AuthBotService } from '../../app/authBot';
 *
 * const bot = new AuthBotService();
 * await bot.start();
 */

export { AuthBotService } from './services/authBotService';
export {
  IAuthBotConfig,
  ITelegramUser,
  ITelegramMessage,
  ITelegramUpdate,
  IAuthConfirmPayload,
  IAuthConfirmResponse,
} from './interfaces/IAuthBot';
