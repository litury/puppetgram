import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql, ne, and, isNotNull, isNull, desc, min, max, eq, gt } from 'drizzle-orm';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import {
  comments,
  users,
  authTokens,
  userSessions,
  accountBans,
  accountFloodWait,
  targetChannels,
} from '../../src/shared/database/schema';
import { parseAccountUsernames } from './lib/parseAccounts';

// ============================================
// DATABASE
// ============================================

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

// Auto-migrate auth tables
async function migrateAuthTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      photo_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      last_login_at TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

    CREATE TABLE IF NOT EXISTS auth_tokens (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      telegram_id BIGINT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      confirmed_at TIMESTAMP,
      expires_at TIMESTAMP NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_status ON auth_tokens(status);

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
  `);
  console.log('Auth tables migrated');
}

migrateAuthTables().catch(console.error);

// ============================================
// WEBSOCKET CLIENTS
// ============================================

// Map ws.id -> ws object (Elysia provides unique id for each connection)
const clients = new Map<string, any>();

// Map token -> Set of ws.id waiting for auth confirmation
const authWaiters = new Map<string, Set<string>>();

const EMIT_SECRET = process.env.EMIT_SECRET || 'dev-secret';
const BOT_USERNAME = process.env.BOT_USERNAME || 'puppetgram_auth_bot';
const AUTH_BOT_SECRET = process.env.AUTH_BOT_SECRET || 'auth-bot-secret';
const AUTH_BOT_TOKEN = process.env.AUTH_BOT_TOKEN;

// ============================================
// TELEGRAM BOT API HELPERS (for webhook)
// ============================================

// РФ-IP блокирует прямой исходящий к api.telegram.org → все вызовы Bot API идут
// через SOCKS5-прокси (AUTH_BOT_PROXY=socks5://user:pass@host:port). Bun поддерживает
// опцию proxy в fetch нативно. Если env пуст — обычный fetch (для локалки).
const AUTH_BOT_PROXY = process.env.AUTH_BOT_PROXY;

function tgFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const opts: any = { ...init };
  if (AUTH_BOT_PROXY) opts.proxy = AUTH_BOT_PROXY;
  return fetch(url, opts);
}

async function telegramApi<T = any>(method: string, params: Record<string, any> = {}): Promise<T> {
  if (!AUTH_BOT_TOKEN) throw new Error('AUTH_BOT_TOKEN not set');

  const res = await tgFetch(`https://api.telegram.org/bot${AUTH_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json() as { ok: boolean; result: T; description?: string };
  if (!data.ok) throw new Error(`Telegram API: ${data.description}`);
  return data.result;
}

// Rate limiting & subscription attempts for webhook
const webhookLastClick = new Map<number, number>();
const webhookSubscriptionAttempts = new Map<string, number>();

// Check channel subscription
async function checkSubscription(userId: number, channel: string): Promise<boolean> {
  try {
    const data = await telegramApi<{ status: string }>('getChatMember', {
      chat_id: channel,
      user_id: userId,
    });
    return ['creator', 'administrator', 'member'].includes(data.status);
  } catch {
    return false;
  }
}

// Get user photo URL
async function getUserPhotoUrl(userId: number): Promise<string | null> {
  try {
    const photos = await telegramApi<{ total_count: number; photos: Array<Array<{ file_id: string }>> }>(
      'getUserProfilePhotos',
      { user_id: userId, limit: 1 }
    );
    if (photos.total_count > 0 && photos.photos[0]?.[0]) {
      const file = await telegramApi<{ file_path: string }>('getFile', { file_id: photos.photos[0][0].file_id });
      return `https://api.telegram.org/file/bot${AUTH_BOT_TOKEN}/${file.file_path}`;
    }
  } catch { /* ignore */ }
  return null;
}

// Message templates
const MSG = {
  welcome: `*Puppetgram Auth*\n\nЭтот бот используется для авторизации в дашборде.\n\nЧтобы войти, нажмите «Войти через Telegram» на [сайте](https://puppetgram.ru/).`,

  confirm: (name: string) => `*Авторизация в Puppetgram*\n\nВы входите как «${name}».\n\nНажмите «Авторизоваться» для подтверждения.\n\n_Если вы не запрашивали вход — нажмите «Отмена»._`,

  success: `*Авторизация успешна*\n\nМожете закрыть это окно и вернуться в [дашборд](https://puppetgram.ru/).`,

  cancel: `🚫 *Авторизация отменена*\n\nВы можете закрыть это окно.`,

  subscription: (attempt: number) => {
    if (attempt === 1) return `📢  *Требуется подписка*\n\nДля авторизации подпишитесь на канал автора.\n\n_Там выходят обновления и гайды по автоматизации._\n\nПосле подписки нажмите «Я подписался» 👇`;
    if (attempt === 2) return `🔄  *Ещё не подписаны*\n\nОткройте канал по кнопке ниже\nи нажмите «Подписаться».\n\n_Затем вернитесь и подтвердите._`;
    return `💡  *Подсказка*\n\nКак подписаться на канал:\n\n1️⃣  Нажмите «Подписаться» ниже\n\n2️⃣  В канале тапните на название\n\n3️⃣  Нажмите «Join» или «Вступить»\n\n4️⃣  Вернитесь сюда и нажмите\n      «Я подписался»`;
  },

  error: (err: string) => `❌ *Ошибка авторизации*\n\n${err}\n\nПопробуйте снова.`,

  serverError: `❌ *Сервер недоступен*\n\nПопробуйте позже.`,
};

// ============================================
// HELPERS
// ============================================

// Только реально опубликованные комменты — где есть и post_id, и comment_id.
// Исключает "Уже есть" детекции и "фантомные" записи без идентификаторов поста.
const successFilter = and(
  isNotNull(comments.postId),
  isNotNull(comments.commentId)
);

function generateDateRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(23, 59, 59, 999);
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/**
 * TZ-безопасный диапазон дат по строкам 'YYYY-MM-DD' (включительно).
 * Якорится на 12:00 UTC + setUTCDate, чтобы избежать сдвигов из-за локального TZ/DST.
 * Нужен потому, что данные бакетятся по Europe/Moscow, а JS-Date+setHours+toISOString
 * мешает локальный TZ с UTC и теряет сегодняшний день.
 */
function dateStringRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${startStr}T12:00:00Z`);
  const end = new Date(`${endStr}T12:00:00Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function generateHourRange(start: Date, end: Date): string[] {
  const hours: string[] = [];
  const current = new Date(start);
  current.setMinutes(0, 0, 0);
  while (current <= end) {
    hours.push(current.toISOString());
    current.setHours(current.getHours() + 1);
  }
  return hours;
}

// ============================================
// AUTH HELPERS (защита /api/*)
// ============================================

const ADMIN_TELEGRAM_IDS: number[] = (process.env.ADMIN_TELEGRAM_ID || '703552444')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));

type SessionUser = {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
};

/**
 * Достаёт пользователя по сессии (cookie `session` или заголовок `x-session-id`).
 * Та же логика, что в `/auth/session`. Возвращает null если сессии нет/истекла.
 */
async function getSessionUser(
  headers: Record<string, string | undefined>,
  cookie: any
): Promise<SessionUser | null> {
  const sessionId = cookie?.session?.value || headers['x-session-id'];
  if (!sessionId) return null;
  try {
    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, sessionId));
    if (!session || new Date() > session.expiresAt) return null;
    const [user] = await db.select().from(users).where(eq(users.id, session.userId));
    if (!user) return null;
    return {
      id: user.id,
      telegramId: Number(user.telegramId),
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      photoUrl: user.photoUrl,
    };
  } catch (e) {
    console.error('getSessionUser error:', e);
    return null;
  }
}

function isAdminUser(user: SessionUser | null): boolean {
  return !!user && ADMIN_TELEGRAM_IDS.includes(user.telegramId);
}

// Константно-временное сравнение паролей (через sha256-дайджесты — без утечки длины)
function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Rate-limit попыток пароля по IP
const passwordAttempts = new Map<string, { count: number; resetAt: number }>();

// ============================================
// ELYSIA APP
// ============================================

const app = new Elysia()
  .use(cors({
    origin: true, // Allow all origins in dev
    credentials: true,
  }))

  // ==========================================
  // WEBSOCKET
  // ==========================================
  .ws('/ws', {
    open(ws) {
      clients.set(ws.id, ws);
      console.log(`Client connected. Total: ${clients.size}`);
    },
    message(ws, message: any) {
      // Handle auth subscription
      if (message?.type === 'auth:subscribe' && message?.token) {
        if (!authWaiters.has(message.token)) {
          authWaiters.set(message.token, new Set());
        }
        authWaiters.get(message.token)!.add(ws.id);
        console.log(`Client subscribed to auth token: ${message.token.slice(0, 8)}...`);
      }
    },
    close(ws) {
      clients.delete(ws.id);
      // Remove from auth waiters
      for (const [token, waiters] of authWaiters.entries()) {
        waiters.delete(ws.id);
        if (waiters.size === 0) {
          authWaiters.delete(token);
        }
      }
      console.log(`Client disconnected. Total: ${clients.size}`);
    },
  })

  // Emit endpoint for broadcasting
  .post('/emit', ({ body, headers }) => {
    if (headers['x-api-key'] !== EMIT_SECRET) {
      return { error: 'Unauthorized' };
    }
    const message = JSON.stringify(body);
    clients.forEach(ws => ws.send(message));
    console.log(`Broadcasted to ${clients.size} clients:`, (body as any).type);
    return { ok: true, clients: clients.size };
  }, {
    body: t.Object({
      type: t.String(),
      data: t.Any(),
    }),
  })

  // ==========================================
  // AUTH ENDPOINTS
  // ==========================================

  // Create auth token and return deep link
  .post('/auth/login', async () => {
    try {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

      await db.insert(authTokens).values({
        token,
        status: 'pending',
        expiresAt,
      });

      const deepLink = `https://t.me/${BOT_USERNAME}?start=${token}`;

      return {
        token,
        deepLink,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error) {
      console.error('Login error:', error);
      return { error: 'Failed to create auth token' };
    }
  })

  // Bot confirms auth (called by auth-bot)
  .post('/auth/confirm', async ({ body, headers }) => {
    // Verify bot secret
    if (headers['x-bot-secret'] !== AUTH_BOT_SECRET) {
      return { error: 'Unauthorized' };
    }

    const { token, telegramId, username, firstName, lastName, photoUrl } = body as any;

    try {
      // Check token exists and is pending
      const [authToken] = await db
        .select()
        .from(authTokens)
        .where(and(eq(authTokens.token, token), eq(authTokens.status, 'pending')));

      if (!authToken) {
        return { error: 'Invalid or expired token' };
      }

      if (new Date() > authToken.expiresAt) {
        await db.update(authTokens).set({ status: 'expired' }).where(eq(authTokens.token, token));
        return { error: 'Token expired' };
      }

      // Upsert user
      let [user] = await db.select().from(users).where(eq(users.telegramId, telegramId));

      if (!user) {
        const [newUser] = await db.insert(users).values({
          telegramId,
          username,
          firstName,
          lastName,
          photoUrl,
        }).returning();
        user = newUser;
      } else {
        await db.update(users).set({
          username,
          firstName,
          lastName,
          photoUrl,
          lastLoginAt: new Date(),
        }).where(eq(users.id, user.id));
      }

      // Create session
      const sessionId = randomBytes(32).toString('base64url');
      const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await db.insert(userSessions).values({
        id: sessionId,
        userId: user.id,
        expiresAt: sessionExpiresAt,
      });

      // Update auth token
      await db.update(authTokens).set({
        status: 'confirmed',
        telegramId,
        confirmedAt: new Date(),
      }).where(eq(authTokens.token, token));

      // Notify waiting WebSocket clients
      const waiters = authWaiters.get(token);
      if (waiters) {
        const message = JSON.stringify({
          type: 'auth:confirmed',
          data: {
            sessionId,
            user: {
              id: user.id,
              telegramId: user.telegramId,
              username: user.username,
              firstName: user.firstName,
              lastName: user.lastName,
              photoUrl: user.photoUrl,
            },
          },
        });
        waiters.forEach(clientId => {
          const ws = clients.get(clientId);
          if (ws) ws.send(message);
        });
        authWaiters.delete(token);
        console.log(`Auth confirmed for token ${token.slice(0, 8)}..., notified ${waiters.size} clients`);
      }

      return { success: true, sessionId };
    } catch (error) {
      console.error('Confirm error:', error);
      return { error: 'Failed to confirm auth' };
    }
  })

  // Check session
  .get('/auth/session', async ({ headers, cookie }) => {
    const sessionId = cookie?.session?.value || headers['x-session-id'];
    if (!sessionId) {
      return { authenticated: false };
    }

    try {
      const [session] = await db
        .select()
        .from(userSessions)
        .where(eq(userSessions.id, sessionId));

      if (!session || new Date() > session.expiresAt) {
        return { authenticated: false };
      }

      const [user] = await db.select().from(users).where(eq(users.id, session.userId));
      if (!user) {
        return { authenticated: false };
      }

      return {
        authenticated: true,
        user: {
          id: user.id,
          telegramId: user.telegramId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          photoUrl: user.photoUrl,
        },
      };
    } catch (error) {
      console.error('Session check error:', error);
      return { authenticated: false };
    }
  })

  // Logout
  .post('/auth/logout', async ({ headers, cookie }) => {
    const sessionId = cookie?.session?.value || headers['x-session-id'];
    if (!sessionId) {
      return { success: true };
    }

    try {
      await db.delete(userSessions).where(eq(userSessions.id, sessionId));
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { error: 'Failed to logout' };
    }
  })

  // ==========================================
  // PASSWORD LOGIN (временный, пока Telegram-бот заблокирован РФ-IP/прокси)
  // ==========================================

  .post('/auth/password', async ({ body, headers, set }) => {
    const expected = process.env.DASHBOARD_PASSWORD;
    if (!expected) { set.status = 503; return { error: 'Password login not configured' }; }

    // Rate-limit по IP: 5 попыток в минуту
    const ip = (headers['x-forwarded-for']?.split(',')[0] || headers['x-real-ip'] || 'unknown').trim();
    const now = Date.now();
    const rl = passwordAttempts.get(ip);
    if (rl && now < rl.resetAt) {
      if (rl.count >= 5) { set.status = 429; return { error: 'Too many attempts, try later' }; }
      rl.count++;
    } else {
      passwordAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    }

    const password = (body as any)?.password;
    if (typeof password !== 'string' || !constantTimeEqual(password, expected)) {
      set.status = 401;
      return { error: 'Invalid password' };
    }

    try {
      // Сессия привязывается к админ-юзеру (первый из ADMIN_TELEGRAM_IDS) → isAdmin проходит
      const adminTgId = ADMIN_TELEGRAM_IDS[0];
      let [adminUser] = await db.select().from(users).where(eq(users.telegramId, adminTgId));
      if (!adminUser) {
        [adminUser] = await db.insert(users).values({
          telegramId: adminTgId,
          username: 'admin',
          firstName: 'Admin',
        }).returning();
      }

      const sessionId = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await db.insert(userSessions).values({ id: sessionId, userId: adminUser.id, expiresAt });

      return {
        sessionId,
        user: {
          id: adminUser.id,
          telegramId: Number(adminUser.telegramId),
          username: adminUser.username,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName,
          photoUrl: adminUser.photoUrl,
        },
      };
    } catch (error) {
      console.error('Password login error:', error);
      set.status = 500;
      return { error: 'Login failed' };
    }
  })

  // ==========================================
  // TELEGRAM WEBHOOK
  // ==========================================

  .post('/telegram/webhook', ({ body }) => {
    if (!AUTH_BOT_TOKEN) {
      console.error('AUTH_BOT_TOKEN not configured');
      return { ok: true }; // Always return 200 to Telegram
    }

    const update = body as any;

    // Отвечаем Telegram 200 сразу; обработку (цепочка вызовов Bot API через SOCKS5-прокси,
    // бывает медленной) выполняем в фоне — иначе Telegram таймаутит вебхук.
    void (async () => {
    try {
      // Handle /start command
      if (update.message?.text?.startsWith('/start')) {
        const chatId = update.message.chat.id;
        const user = update.message.from;
        const parts = update.message.text.split(' ');
        const token = parts[1] || null;

        if (!token) {
          await telegramApi('sendMessage', {
            chat_id: chatId,
            text: MSG.welcome,
            parse_mode: 'Markdown',
          });
          return { ok: true };
        }

        // Show confirmation button
        const name = user.first_name || user.username || 'Пользователь';
        await telegramApi('sendMessage', {
          chat_id: chatId,
          text: MSG.confirm(name),
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Авторизоваться', callback_data: `confirm:${token}` },
                { text: '❌ Отмена', callback_data: 'cancel' },
              ],
            ],
          },
        });
        return { ok: true };
      }

      // Handle callback query
      if (update.callback_query) {
        const callbackId = update.callback_query.id;
        const user = update.callback_query.from;
        const data = update.callback_query.data;
        const chatId = update.callback_query.message?.chat.id;
        const messageId = update.callback_query.message?.message_id;

        if (!data || !chatId) {
          await telegramApi('answerCallbackQuery', { callback_query_id: callbackId });
          return { ok: true };
        }

        // Rate limiting
        const now = Date.now();
        const lastClick = webhookLastClick.get(user.id) || 0;
        if (now - lastClick < 1500) {
          await telegramApi('answerCallbackQuery', { callback_query_id: callbackId });
          return { ok: true };
        }
        webhookLastClick.set(user.id, now);

        // Cancel
        if (data === 'cancel') {
          await telegramApi('answerCallbackQuery', { callback_query_id: callbackId, text: 'Отменено' });
          await telegramApi('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: MSG.cancel,
            parse_mode: 'Markdown',
          });
          return { ok: true };
        }

        // Confirm auth
        if (data.startsWith('confirm:')) {
          const token = data.replace('confirm:', '');

          // Toast: checking subscription
          await telegramApi('answerCallbackQuery', { callback_query_id: callbackId, text: '⏳ Проверяю подписку...' });

          // Check subscription
          const isSubscribed = await checkSubscription(user.id, '@divatoz');

          if (!isSubscribed) {
            const key = `${user.id}:${token}`;
            const attempt = (webhookSubscriptionAttempts.get(key) || 0) + 1;
            webhookSubscriptionAttempts.set(key, attempt);

            await telegramApi('editMessageText', {
              chat_id: chatId,
              message_id: messageId,
              text: MSG.subscription(attempt),
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📢 Подписаться', url: 'https://t.me/divatoz' }],
                  [{ text: '✅ Я подписался', callback_data: `confirm:${token}` }],
                ],
              },
            });
            return { ok: true };
          }

          // Get user photo
          const photoUrl = await getUserPhotoUrl(user.id);

          // Call internal auth confirm
          const confirmPayload = {
            token,
            telegramId: user.id,
            username: user.username || null,
            firstName: user.first_name || null,
            lastName: user.last_name || null,
            photoUrl,
          };

          // Check token exists and is pending
          const [authToken] = await db
            .select()
            .from(authTokens)
            .where(and(eq(authTokens.token, token), eq(authTokens.status, 'pending')));

          if (!authToken) {
            await telegramApi('editMessageText', {
              chat_id: chatId,
              message_id: messageId,
              text: MSG.error('Токен недействителен или истёк'),
              parse_mode: 'Markdown',
            });
            return { ok: true };
          }

          if (new Date() > authToken.expiresAt) {
            await db.update(authTokens).set({ status: 'expired' }).where(eq(authTokens.token, token));
            await telegramApi('editMessageText', {
              chat_id: chatId,
              message_id: messageId,
              text: MSG.error('Токен истёк. Попробуйте войти снова.'),
              parse_mode: 'Markdown',
            });
            return { ok: true };
          }

          // Upsert user
          let [dbUser] = await db.select().from(users).where(eq(users.telegramId, confirmPayload.telegramId));

          if (!dbUser) {
            const [newUser] = await db.insert(users).values({
              telegramId: confirmPayload.telegramId,
              username: confirmPayload.username,
              firstName: confirmPayload.firstName,
              lastName: confirmPayload.lastName,
              photoUrl: confirmPayload.photoUrl,
            }).returning();
            dbUser = newUser;
          } else {
            await db.update(users).set({
              username: confirmPayload.username,
              firstName: confirmPayload.firstName,
              lastName: confirmPayload.lastName,
              photoUrl: confirmPayload.photoUrl,
              lastLoginAt: new Date(),
            }).where(eq(users.id, dbUser.id));
          }

          // Create session
          const sessionId = randomBytes(32).toString('base64url');
          const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

          await db.insert(userSessions).values({
            id: sessionId,
            userId: dbUser.id,
            expiresAt: sessionExpiresAt,
          });

          // Update auth token
          await db.update(authTokens).set({
            status: 'confirmed',
            telegramId: confirmPayload.telegramId,
            confirmedAt: new Date(),
          }).where(eq(authTokens.token, token));

          // Notify waiting WebSocket clients
          const waiters = authWaiters.get(token);
          if (waiters) {
            const wsMessage = JSON.stringify({
              type: 'auth:confirmed',
              data: {
                sessionId,
                user: {
                  id: dbUser.id,
                  telegramId: dbUser.telegramId,
                  username: dbUser.username,
                  firstName: dbUser.firstName,
                  lastName: dbUser.lastName,
                  photoUrl: dbUser.photoUrl,
                },
              },
            });
            waiters.forEach(clientId => {
              const ws = clients.get(clientId);
              if (ws) ws.send(wsMessage);
            });
            authWaiters.delete(token);
            console.log(`[Webhook] Auth confirmed for token ${token.slice(0, 8)}..., notified ${waiters.size} clients`);
          }

          // Success message
          await telegramApi('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: MSG.success,
            parse_mode: 'Markdown',
          });
        }
      }
    } catch (error) {
      console.error('[Webhook] Error:', error);
    }
    })();

    return { ok: true }; // Always return 200
  })

  // ==========================================
  // DASHBOARD API
  // ==========================================

  // Stats
  .get('/api/stats', async ({ headers, cookie, set }) => {
    const user = await getSessionUser(headers, cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    try {
      const totalResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(comments)
        .where(successFilter);

      const todayResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(comments)
        .where(and(
          successFilter,
          sql`DATE(created_at AT TIME ZONE 'Europe/Moscow') = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date`
        ));

      return {
        totalComments: Number(totalResult[0]?.count) || 0,
        todayComments: Number(todayResult[0]?.count) || 0,
      };
    } catch (error) {
      console.error('Stats error:', error);
      return { error: 'Failed to fetch stats' };
    }
  })

  // Daily chart data
  .get('/api/daily', async ({ headers, cookie, set }) => {
    const user = await getSessionUser(headers, cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    try {
      // Группировка по московской дате. rawData (ASC) уже содержит все даты-ключи.
      const rawData = await db
        .select({
          date: sql<string>`DATE(created_at AT TIME ZONE 'Europe/Moscow')`.as('date'),
          count: sql<number>`COUNT(*)`.as('count'),
        })
        .from(comments)
        .where(successFilter)
        .groupBy(sql`DATE(created_at AT TIME ZONE 'Europe/Moscow')`)
        .orderBy(sql`date ASC`);

      if (rawData.length === 0) {
        return { data: [], groupBy: 'day' };
      }

      const dataMap = new Map<string, number>();
      rawData.forEach(item => dataMap.set(String(item.date), Number(item.count)));

      // Ось дат строим из московских дат-строк (первая/последняя из rawData) —
      // tz-безопасно, чтобы не потерять сегодняшний день.
      const firstStr = String(rawData[0].date);
      const lastStr = String(rawData[rawData.length - 1].date);
      const allDates = dateStringRange(firstStr, lastStr);

      const filledData = allDates.map(date => ({
        time: date,
        count: dataMap.get(date) || 0,
      }));

      return { data: filledData, groupBy: 'day' };
    } catch (error) {
      console.error('Daily error:', error);
      return { error: 'Failed to fetch daily stats' };
    }
  })

  // Timeline (hourly)
  .get('/api/timeline', async ({ headers, cookie, set }) => {
    const user = await getSessionUser(headers, cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    try {
      const dateRange = await db
        .select({
          firstDate: min(comments.createdAt),
          lastDate: max(comments.createdAt),
        })
        .from(comments)
        .where(successFilter);

      const firstDate = dateRange[0]?.firstDate;
      const lastDate = dateRange[0]?.lastDate;

      if (!firstDate || !lastDate) {
        return { data: [] };
      }

      const rawData = await db
        .select({
          hour: sql<string>`date_trunc('hour', created_at AT TIME ZONE 'Europe/Moscow')`.as('hour'),
          count: sql<number>`COUNT(*)`.as('count'),
        })
        .from(comments)
        .where(successFilter)
        .groupBy(sql`date_trunc('hour', created_at AT TIME ZONE 'Europe/Moscow')`)
        .orderBy(sql`hour ASC`);

      const dataMap = new Map<string, number>();
      rawData.forEach(item => {
        const key = new Date(item.hour).toISOString();
        dataMap.set(key, Number(item.count));
      });

      const allHours = generateHourRange(new Date(firstDate), new Date(lastDate));
      const filledData = allHours.map(hour => ({
        time: hour,
        count: dataMap.get(hour) || 0,
      }));

      return { data: filledData };
    } catch (error) {
      console.error('Timeline error:', error);
      return { error: 'Failed to fetch timeline' };
    }
  })

  // Recent posts
  .get('/api/recent-posts', async ({ query, headers, cookie, set }) => {
    const user = await getSessionUser(headers, cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    try {
      const limit = parseInt(query.limit || '10', 10);
      const offset = parseInt(query.offset || '0', 10);

      const data = await db
        .select({
          channel: comments.channelUsername,
          postId: comments.postId,
          commentText: comments.commentText,
          createdAt: comments.createdAt,
        })
        .from(comments)
        .where(and(isNotNull(comments.postId), ne(comments.commentText, 'Уже есть')))
        .orderBy(desc(comments.createdAt))
        .limit(limit)
        .offset(offset);

      const posts = data.map(post => ({
        channel: post.channel?.replace('@', '') || '',
        postId: post.postId,
        commentText: post.commentText,
        createdAt: post.createdAt ? new Date(post.createdAt).toISOString() : null,
      }));

      return { posts };
    } catch (error) {
      console.error('Recent posts error:', error);
      return { posts: [] };
    }
  })

  // Comments list (все авторизованные): лента опубликованных коммантов + поиск
  .get('/api/comments', async ({ query, headers, cookie, set }) => {
    const user = await getSessionUser(headers, cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    try {
      const limit = Math.min(parseInt(query.limit || '20', 10), 100);
      const offset = parseInt(query.offset || '0', 10);
      const search = query.search?.trim() || null;

      const conditions = [successFilter];
      if (search) {
        const like = `%${search}%`;
        conditions.push(sql`(${comments.channelUsername} ILIKE ${like} OR ${comments.commentText} ILIKE ${like})`);
      }
      const where = and(...conditions);

      const data = await db
        .select({
          id: comments.id,
          channel: comments.channelUsername,
          account: comments.accountName,
          text: comments.commentText,
          postId: comments.postId,
          createdAt: comments.createdAt,
        })
        .from(comments)
        .where(where)
        .orderBy(desc(comments.createdAt))
        .limit(limit)
        .offset(offset);

      const formattedComments = data.map(comment => ({
        id: comment.id,
        channel: `@${comment.channel}`,
        account: comment.account,
        text: comment.text || '',
        postId: comment.postId,
        createdAt: comment.createdAt ? new Date(comment.createdAt).toISOString() : null,
      }));

      return { comments: formattedComments, hasMore: data.length === limit };
    } catch (error) {
      console.error('Comments error:', error);
      return { error: 'Failed to fetch comments' };
    }
  })

  // Accounts (admin): статус working / flood_wait / banned + метаданные.
  // Ростер = union(env USERNAME_* ∪ авторы за 7 дней ∪ активные баны ∪ активные flood_wait).
  .get('/api/accounts', async ({ headers, cookie, set }) => {
    const user = await getSessionUser(headers, cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isAdminUser(user)) { set.status = 403; return { error: 'Forbidden' }; }
    try {
      const now = new Date();
      const envNames = parseAccountUsernames();

      const recent = await db
        .selectDistinct({ name: comments.accountName })
        .from(comments)
        .where(gt(comments.createdAt, sql`now() - interval '7 days'`));

      const activeBans = await db
        .select({
          name: accountBans.accountName,
          bannedAt: accountBans.bannedAt,
          banReason: accountBans.banReason,
        })
        .from(accountBans)
        .where(isNull(accountBans.unbannedAt));

      const activeFloods = await db
        .select({ name: accountFloodWait.accountName, unlockAt: accountFloodWait.unlockAt })
        .from(accountFloodWait)
        .where(gt(accountFloodWait.unlockAt, now));

      const todayRows = await db
        .select({ name: comments.accountName, count: sql<number>`COUNT(*)` })
        .from(comments)
        .where(and(
          successFilter,
          sql`DATE(created_at AT TIME ZONE 'Europe/Moscow') = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date`
        ))
        .groupBy(comments.accountName);

      // Последний коммент на аккаунт (для индикатора «сейчас пишет»)
      const lastRows = await db
        .select({ name: comments.accountName, last: max(comments.createdAt) })
        .from(comments)
        .where(successFilter)
        .groupBy(comments.accountName);

      const banMap = new Map(activeBans.map(b => [b.name, b]));
      const floodMap = new Map(activeFloods.map(f => [f.name, f]));
      const todayMap = new Map(todayRows.map(t => [t.name, Number(t.count)]));
      const lastMap = new Map(lastRows.map(r => [r.name, r.last ? new Date(r.last) : null]));

      // «Активный» = аккаунт с самым свежим коммантом, если он в пределах 15 минут.
      // Бот пишет одним аккаунтом за раз, БД не хранит in-memory владельца → эвристика
      // (15 мин ловит активный аккаунт сквозь естественные паузы flood_wait между бёрстами).
      let activeName: string | null = null;
      let activeTs = 0;
      for (const [name, last] of lastMap) {
        if (last && last.getTime() > activeTs) { activeTs = last.getTime(); activeName = name; }
      }
      if (activeName && Date.now() - activeTs > 15 * 60 * 1000) activeName = null;

      const names = new Set<string>([
        ...envNames,
        ...recent.map(r => r.name),
        ...activeBans.map(b => b.name),
        ...activeFloods.map(f => f.name),
      ]);

      const accounts = [...names].map(name => {
        const ban = banMap.get(name);
        const flood = floodMap.get(name);
        let status: 'working' | 'flood_wait' | 'banned' = 'working';
        if (ban) status = 'banned';
        else if (flood) status = 'flood_wait';
        const lastComment = lastMap.get(name) ?? null;
        return {
          name,
          status,
          activeNow: name === activeName,
          bannedAt: ban?.bannedAt ? new Date(ban.bannedAt).toISOString() : null,
          banReason: ban?.banReason ?? null,
          unlockAt: flood?.unlockAt ? new Date(flood.unlockAt).toISOString() : null,
          lastCommentAt: lastComment ? lastComment.toISOString() : null,
          commentsToday: todayMap.get(name) ?? 0,
        };
      });

      // Сортировка: активный первым, далее banned → flood_wait → working, затем по имени
      const order: Record<string, number> = { banned: 0, flood_wait: 1, working: 2 };
      accounts.sort((a, b) =>
        Number(b.activeNow) - Number(a.activeNow) ||
        order[a.status] - order[b.status] ||
        a.name.localeCompare(b.name)
      );

      const summary = {
        total: accounts.length,
        working: accounts.filter(a => a.status === 'working').length,
        floodWait: accounts.filter(a => a.status === 'flood_wait').length,
        banned: accounts.filter(a => a.status === 'banned').length,
      };

      return { accounts, summary };
    } catch (error) {
      console.error('Accounts error:', error);
      set.status = 500;
      return { error: 'Failed to fetch accounts' };
    }
  })

  // Channels (admin): сводка по статусам + пагинированный список с фильтрами
  .get('/api/channels', async ({ query, headers, cookie, set }) => {
    const user = await getSessionUser(headers, cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isAdminUser(user)) { set.status = 403; return { error: 'Forbidden' }; }
    try {
      const limit = Math.min(parseInt(query.limit || '50', 10), 200);
      const offset = parseInt(query.offset || '0', 10);
      const status = query.status?.trim() || null;
      const search = query.search?.trim() || null;

      // Сводка по статусам (всегда по всей таблице, без фильтров)
      const statusRows = await db
        .select({ status: targetChannels.status, count: sql<number>`COUNT(*)` })
        .from(targetChannels)
        .groupBy(targetChannels.status);

      const summary: Record<string, number> = { total: 0, new: 0, done: 0, error: 0, skipped: 0 };
      for (const r of statusRows) {
        const c = Number(r.count);
        summary[r.status] = (summary[r.status] ?? 0) + c;
        summary.total += c;
      }

      // Условия фильтрации для списка
      const conditions = [];
      if (status) conditions.push(eq(targetChannels.status, status));
      if (search) {
        const like = `%${search}%`;
        conditions.push(sql`(${targetChannels.username} ILIKE ${like} OR ${targetChannels.title} ILIKE ${like})`);
      }
      const where = conditions.length ? and(...conditions) : undefined;

      const totalRow = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(targetChannels)
        .where(where);
      const filteredTotal = Number(totalRow[0]?.count) || 0;

      const rows = await db
        .select({
          username: targetChannels.username,
          title: targetChannels.title,
          status: targetChannels.status,
          participants: targetChannels.participants,
          avgViews: targetChannels.avgViews,
          errorMessage: targetChannels.errorMessage,
          processedAt: targetChannels.processedAt,
          createdAt: targetChannels.createdAt,
        })
        .from(targetChannels)
        .where(where)
        .orderBy(sql`COALESCE(processed_at, created_at) DESC NULLS LAST`)
        .limit(limit)
        .offset(offset);

      const channels = rows.map(r => ({
        username: r.username,
        title: r.title,
        status: r.status,
        participants: r.participants,
        avgViews: r.avgViews,
        errorMessage: r.errorMessage,
        processedAt: r.processedAt ? new Date(r.processedAt).toISOString() : null,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      }));

      return { channels, summary, filteredTotal, limit, offset };
    } catch (error) {
      console.error('Channels error:', error);
      set.status = 500;
      return { error: 'Failed to fetch channels' };
    }
  })

  // Settings (admin): read-only обзор системы + доступный конфиг (без секретов).
  // Конфиг бота (TARGET_CHANNEL и т.п.) живёт на боте/в Dokploy, не на ws-server → может быть null.
  .get('/api/settings', async ({ headers, cookie, set }) => {
    const user = await getSessionUser(headers, cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isAdminUser(user)) { set.status = 403; return { error: 'Forbidden' }; }
    try {
      const [commentsRow] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(comments)
        .where(successFilter);

      const [channelsRow] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(targetChannels);

      const [bansRow] = await db
        .select({ active: sql<number>`COUNT(*)` })
        .from(accountBans)
        .where(isNull(accountBans.unbannedAt));

      return {
        config: {
          targetChannel: process.env.TARGET_CHANNEL ?? null,
          botUsername: process.env.BOT_USERNAME ?? BOT_USERNAME,
          deepseekModel: process.env.DEEPSEEK_MODEL ?? null,
          deepseekEnabled: process.env.DEEPSEEK_ENABLED ?? null,
          maxCommentsPerAccount: process.env.MAX_COMMENTS_PER_ACCOUNT ?? null,
          adminCount: ADMIN_TELEGRAM_IDS.length,
        },
        system: {
          commentsTotal: Number(commentsRow?.total ?? 0),
          channelsTotal: Number(channelsRow?.total ?? 0),
          activeBans: Number(bansRow?.active ?? 0),
        },
        note: 'Конфигурация бота управляется через переменные окружения в Dokploy.',
      };
    } catch (error) {
      console.error('Settings error:', error);
      set.status = 500;
      return { error: 'Failed to fetch settings' };
    }
  })

  // Coverage (все авторизованные): потенциальный охват спарсенной базы + распределение по размеру
  .get('/api/coverage', async ({ headers, cookie, set }) => {
    const user = await getSessionUser(headers, cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    try {
      const totals = await db
        .select({
          channels: sql<number>`COUNT(*) FILTER (WHERE participants IS NOT NULL)`,
          reach: sql<string>`COALESCE(SUM(participants),0)`,
          doneReach: sql<string>`COALESCE(SUM(participants) FILTER (WHERE status='done'),0)`,
          doneChannels: sql<number>`COUNT(*) FILTER (WHERE status='done' AND participants IS NOT NULL)`,
        })
        .from(targetChannels);

      const bucketRows = await db
        .select({
          bucket: sql<string>`
            CASE
              WHEN participants < 1000 THEN '<1K'
              WHEN participants < 10000 THEN '1K-10K'
              WHEN participants < 100000 THEN '10K-100K'
              WHEN participants < 1000000 THEN '100K-1M'
              ELSE '>1M'
            END`.as('bucket'),
          ord: sql<number>`
            CASE
              WHEN participants < 1000 THEN 1
              WHEN participants < 10000 THEN 2
              WHEN participants < 100000 THEN 3
              WHEN participants < 1000000 THEN 4
              ELSE 5
            END`.as('ord'),
          channels: sql<number>`COUNT(*)`,
          reach: sql<string>`COALESCE(SUM(participants),0)`,
        })
        .from(targetChannels)
        .where(isNotNull(targetChannels.participants))
        .groupBy(sql`1, 2`)
        .orderBy(sql`2`);

      const t = totals[0];
      return {
        totalReach: Number(t?.reach ?? 0),
        channelsWithData: Number(t?.channels ?? 0),
        doneReach: Number(t?.doneReach ?? 0),
        doneChannels: Number(t?.doneChannels ?? 0),
        buckets: bucketRows.map(b => ({
          label: b.bucket,
          channels: Number(b.channels),
          reach: Number(b.reach),
        })),
      };
    } catch (error) {
      console.error('Coverage error:', error);
      set.status = 500;
      return { error: 'Failed to fetch coverage' };
    }
  })

  // Public stats (БЕЗ auth) — для лендинга. Только агрегаты, ничего чувствительного.
  .get('/api/public-stats', async ({ set }) => {
    try {
      const [c] = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(comments)
        .where(successFilter);
      const [ch] = await db
        .select({
          n: sql<number>`COUNT(*) FILTER (WHERE participants IS NOT NULL)`,
          reach: sql<string>`COALESCE(SUM(participants),0)`,
        })
        .from(targetChannels);
      set.headers['Cache-Control'] = 'public, max-age=300';
      return {
        totalComments: Number(c?.n ?? 0),
        channelsCount: Number(ch?.n ?? 0),
        totalReach: Number(ch?.reach ?? 0),
      };
    } catch (e) {
      console.error('public-stats error:', e);
      return { totalComments: 0, channelsCount: 0, totalReach: 0 };
    }
  })

  // User photo proxy (Telegram Bot API file URLs expire after ~1h)
  .get('/api/photo/:telegramId', async ({ params }) => {
    if (!AUTH_BOT_TOKEN) {
      return new Response(null, { status: 404 });
    }

    const telegramId = parseInt(params.telegramId);
    if (isNaN(telegramId)) {
      return new Response(null, { status: 400 });
    }

    try {
      const photos = await telegramApi<{ total_count: number; photos: Array<Array<{ file_id: string }>> }>(
        'getUserProfilePhotos',
        { user_id: telegramId, limit: 1 }
      );

      if (photos.total_count === 0 || !photos.photos[0]?.[0]) {
        return new Response(null, { status: 404 });
      }

      const file = await telegramApi<{ file_path: string }>('getFile', {
        file_id: photos.photos[0][0].file_id,
      });

      const imageRes = await tgFetch(
        `https://api.telegram.org/file/bot${AUTH_BOT_TOKEN}/${file.file_path}`
      );

      if (!imageRes.ok) {
        return new Response(null, { status: 404 });
      }

      const imageBuffer = await imageRes.arrayBuffer();
      const contentType = imageRes.headers.get('content-type') || 'image/jpeg';

      return new Response(imageBuffer, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  })

  // Health check
  .get('/health', () => ({
    status: 'ok',
    clients: clients.size,
    authWaiters: authWaiters.size,
  }))

  .listen(4000);

console.log('WS Server running on :4000');
console.log('- WebSocket: ws://localhost:4000/ws');
console.log('- API: http://localhost:4000/api/*');
console.log('- Auth: http://localhost:4000/auth/*');
console.log('- Webhook: POST /telegram/webhook');
if (AUTH_BOT_TOKEN) {
  console.log(`\nTelegram Bot ready. Set webhook with:`);
  console.log(`  npm run webhook:setup https://YOUR_DOMAIN/telegram/webhook`);
}
