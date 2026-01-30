/**
 * Auth Bot Service - обрабатывает Deep Link авторизацию для дашборда
 *
 * Использует прямые вызовы Telegram Bot API (без внешних библиотек)
 *
 * Flow:
 * 1. Пользователь нажимает "Войти через Telegram" на дашборде
 * 2. Генерируется токен и deep link: t.me/bot?start=TOKEN
 * 3. Пользователь переходит в бота и нажимает Start
 * 4. Бот получает /start TOKEN, показывает кнопку подтверждения
 * 5. После подтверждения бот вызывает ws-server POST /auth/confirm
 * 6. ws-server уведомляет дашборд через WebSocket
 */

import { createLogger } from '../../../shared/utils/logger';
import {
  IAuthBotConfig,
  ITelegramUpdate,
  ITelegramUser,
  IAuthConfirmPayload,
  IAuthConfirmResponse,
} from '../interfaces/IAuthBot';

export class AuthBotService {
  private p_config: IAuthBotConfig;
  private p_log: ReturnType<typeof createLogger>;
  private p_isRunning: boolean = false;
  private p_offset: number = 0;

  // UX improvements
  private p_lastClick = new Map<number, number>(); // Rate limiting
  private p_subscriptionAttempts = new Map<string, number>(); // Attempt counter

  constructor() {
    this.p_log = createLogger('AuthBotService');

    const botToken = process.env.AUTH_BOT_TOKEN;
    if (!botToken) {
      throw new Error('AUTH_BOT_TOKEN не указан в .env');
    }

    this.p_config = {
      botToken,
      wsServerUrl: process.env.WS_SERVER_URL || 'http://localhost:4000',
      authBotSecret: process.env.AUTH_BOT_SECRET || 'auth-bot-secret',
    };
  }

  /**
   * Запускает бота (long polling)
   */
  async start(): Promise<void> {
    if (this.p_isRunning) {
      this.p_log.warn('Бот уже запущен');
      return;
    }

    this.p_isRunning = true;
    this.p_log.info('Auth Bot запускается...');

    // Получаем информацию о боте
    const me = await this.p_callApi('getMe');
    this.p_log.info(`Auth Bot запущен: @${me.username}`);
    this.p_log.info(`Deep link format: https://t.me/${me.username}?start=TOKEN`);

    // Запускаем polling
    this.p_pollUpdates();
  }

  /**
   * Останавливает бота
   */
  stop(): void {
    this.p_isRunning = false;
    this.p_log.info('Auth Bot остановлен');
  }

  /**
   * Long polling для получения обновлений
   */
  private async p_pollUpdates(): Promise<void> {
    while (this.p_isRunning) {
      try {
        const updates = await this.p_callApi<ITelegramUpdate[]>('getUpdates', {
          offset: this.p_offset,
          timeout: 30,
          allowed_updates: ['message', 'callback_query'],
        });

        for (const update of updates) {
          this.p_offset = update.update_id + 1;
          await this.p_handleUpdate(update);
        }
      } catch (error: any) {
        this.p_log.error('Ошибка polling', error);
        // Ждём перед повторной попыткой
        await this.p_sleep(5000);
      }
    }
  }

  /**
   * Обрабатывает входящее обновление
   */
  private async p_handleUpdate(_update: ITelegramUpdate): Promise<void> {
    try {
      if (_update.message?.text) {
        await this.p_handleMessage(_update.message.from!, _update.message.chat.id, _update.message.text);
      } else if (_update.callback_query) {
        await this.p_handleCallback(
          _update.callback_query.id,
          _update.callback_query.from,
          _update.callback_query.data,
          _update.callback_query.message?.chat.id,
          _update.callback_query.message?.message_id // Добавляем message_id
        );
      }
    } catch (error: any) {
      this.p_log.error('Ошибка обработки update', error);
    }
  }

  /**
   * Обрабатывает текстовое сообщение
   */
  private async p_handleMessage(_user: ITelegramUser, _chatId: number, _text: string): Promise<void> {
    // Проверяем команду /start
    if (_text.startsWith('/start')) {
      const parts = _text.split(' ');
      const token = parts.length > 1 ? parts[1] : null;

      if (!token) {
        // Просто приветствие
        await this.p_sendMessage(_chatId, this.p_getWelcomeMessage());
        return;
      }

      // Показываем кнопку подтверждения
      const name = _user.first_name || _user.username || 'Пользователь';
      await this.p_sendMessage(_chatId, this.p_getConfirmMessage(name), {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Авторизоваться', callback_data: `confirm:${token}` },
              { text: '❌ Отмена', callback_data: 'cancel' },
            ],
          ],
        },
      });
    }
  }

  /**
   * Обрабатывает нажатие inline кнопки
   */
  private async p_handleCallback(
    _callbackId: string,
    _user: ITelegramUser,
    _data: string | undefined,
    _chatId: number | undefined,
    _messageId: number | undefined
  ): Promise<void> {
    if (!_data || !_chatId) return;

    // Rate limiting — игнорируем быстрые клики
    const now = Date.now();
    const lastClick = this.p_lastClick.get(_user.id) || 0;
    if (now - lastClick < 1500) {
      await this.p_answerCallback(_callbackId, '');
      return;
    }
    this.p_lastClick.set(_user.id, now);

    if (_data === 'cancel') {
      await this.p_answerCallback(_callbackId, 'Отменено');
      await this.p_editMessage(_chatId, _messageId, this.p_getCancelMessage());
      return;
    }

    if (_data.startsWith('confirm:')) {
      const token = _data.replace('confirm:', '');

      // Toast: проверяем подписку
      await this.p_answerCallback(_callbackId, '⏳ Проверяю подписку...');

      // Проверяем подписку ПЕРЕД авторизацией
      const isSubscribed = await this.p_checkChannelSubscription(_user.id, '@divatoz');

      if (!isSubscribed) {
        // Увеличиваем счётчик попыток
        const key = `${_user.id}:${token}`;
        const attempt = (this.p_subscriptionAttempts.get(key) || 0) + 1;
        this.p_subscriptionAttempts.set(key, attempt);

        // Редактируем существующее сообщение (не отправляем новое!)
        await this.p_editMessage(
          _chatId,
          _messageId,
          this.p_getSubscriptionMessage(attempt),
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📢 Подписаться', url: 'https://t.me/divatoz' }],
                [{ text: '✅ Я подписался', callback_data: `confirm:${token}` }],
              ],
            },
          }
        );
        return;
      }

      // Подписан — продолжаем авторизацию
      const photoUrl = await this.p_getUserPhotoUrl(_user.id);

      const payload: IAuthConfirmPayload = {
        token,
        telegramId: _user.id,
        username: _user.username || null,
        firstName: _user.first_name || null,
        lastName: _user.last_name || null,
        photoUrl,
      };

      try {
        const response = await fetch(`${this.p_config.wsServerUrl}/auth/confirm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Bot-Secret': this.p_config.authBotSecret,
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json() as IAuthConfirmResponse;

        if (result.success) {
          await this.p_answerCallback(_callbackId, '✅ Успешно!');
          await this.p_editMessage(_chatId, _messageId, this.p_getSuccessMessage());
        } else {
          await this.p_answerCallback(_callbackId, `❌ ${result.error || 'Ошибка'}`);
          await this.p_editMessage(_chatId, _messageId, this.p_getErrorMessage(result.error || 'Неизвестная ошибка'));
        }
      } catch (error: any) {
        this.p_log.error('Ошибка подтверждения авторизации', error);
        await this.p_answerCallback(_callbackId, '❌ Сервер недоступен');
        await this.p_editMessage(_chatId, _messageId, this.p_getServerErrorMessage());
      }
    }
  }

  /**
   * Получает URL фото профиля пользователя
   */
  private async p_getUserPhotoUrl(_userId: number): Promise<string | null> {
    try {
      const photos = await this.p_callApi<{ total_count: number; photos: Array<Array<{ file_id: string }>> }>('getUserProfilePhotos', {
        user_id: _userId,
        limit: 1,
      });

      if (photos.total_count > 0 && photos.photos[0]?.[0]) {
        const fileId = photos.photos[0][0].file_id;
        const file = await this.p_callApi<{ file_path: string }>('getFile', { file_id: fileId });
        return `https://api.telegram.org/file/bot${this.p_config.botToken}/${file.file_path}`;
      }
    } catch (error) {
      // Игнорируем ошибки получения фото
    }
    return null;
  }

  /**
   * Вызывает метод Telegram Bot API
   */
  private async p_callApi<T = any>(_method: string, _params: Record<string, any> = {}): Promise<T> {
    const url = `https://api.telegram.org/bot${this.p_config.botToken}/${_method}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_params),
    });

    const data = await response.json() as { ok: boolean; result: T; description?: string };

    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description}`);
    }

    return data.result;
  }

  /**
   * Отправляет сообщение
   */
  private async p_sendMessage(_chatId: number, _text: string, _extra: Record<string, any> = {}): Promise<void> {
    await this.p_callApi('sendMessage', {
      chat_id: _chatId,
      text: _text,
      parse_mode: 'Markdown',
      ..._extra,
    });
  }

  /**
   * Редактирует сообщение
   */
  private async p_editMessage(
    _chatId: number,
    _messageId: number | undefined,
    _text: string,
    _extra: Record<string, any> = {}
  ): Promise<void> {
    if (!_messageId) {
      // Fallback: отправляем новое сообщение
      await this.p_sendMessage(_chatId, _text, _extra);
      return;
    }

    try {
      await this.p_callApi('editMessageText', {
        chat_id: _chatId,
        message_id: _messageId,
        text: _text,
        parse_mode: 'Markdown',
        ..._extra,
      });
    } catch (error: any) {
      // Если сообщение не изменилось или устарело — игнорируем
      if (!error.message?.includes('message is not modified')) {
        this.p_log.warn('Не удалось отредактировать сообщение:', error.message);
      }
    }
  }

  /**
   * Отвечает на callback query
   */
  private async p_answerCallback(_callbackId: string, _text: string): Promise<void> {
    await this.p_callApi('answerCallbackQuery', {
      callback_query_id: _callbackId,
      text: _text,
    });
  }

  /**
   * Задержка
   */
  private p_sleep(_ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, _ms));
  }

  /**
   * Проверяет подписку пользователя на канал
   */
  private async p_checkChannelSubscription(_userId: number, _channel: string): Promise<boolean> {
    try {
      const data = await this.p_callApi<{ status: string }>('getChatMember', {
        chat_id: _channel,
        user_id: _userId,
      });
      return ['creator', 'administrator', 'member'].includes(data.status);
    } catch {
      return false; // Fail gracefully
    }
  }

  // ============================================
  // MESSAGES
  // ============================================

  private p_getWelcomeMessage(): string {
    return `*Puppetgram Auth*

Этот бот используется для авторизации в дашборде.

Чтобы войти, нажмите «Войти через Telegram» на [сайте](https://puppetgram.ru/).`;
  }

  private p_getConfirmMessage(_name: string): string {
    return `*Авторизация в Puppetgram*

Вы входите как «${_name}».

Нажмите «Авторизоваться» для подтверждения.

_Если вы не запрашивали вход — нажмите «Отмена»._`;
  }

  private p_getSuccessMessage(): string {
    return `*Авторизация успешна*

Можете закрыть это окно и вернуться в [дашборд](https://puppetgram.ru/).`;
  }

  private p_getSubscriptionMessage(_attempt: number): string {
    if (_attempt === 1) {
      return `📢  *Требуется подписка*

Для авторизации подпишитесь на канал автора.

_Там выходят обновления и гайды по автоматизации._

После подписки нажмите «Я подписался» 👇`;
    }

    if (_attempt === 2) {
      return `🔄  *Ещё не подписаны*

Откройте канал по кнопке ниже
и нажмите «Подписаться».

_Затем вернитесь и подтвердите._`;
    }

    // 3+ попытка — подсказка
    return `💡  *Подсказка*

Как подписаться на канал:

1️⃣  Нажмите «Подписаться» ниже

2️⃣  В канале тапните на название

3️⃣  Нажмите «Join» или «Вступить»

4️⃣  Вернитесь сюда и нажмите
      «Я подписался»`;
  }

  private p_getCancelMessage(): string {
    return `🚫 *Авторизация отменена*

Вы можете закрыть это окно.`;
  }

  private p_getErrorMessage(_error: string): string {
    return `❌ *Ошибка авторизации*

${_error}

Попробуйте снова.`;
  }

  private p_getServerErrorMessage(): string {
    return `❌ *Сервер недоступен*

Попробуйте позже.`;
  }
}
