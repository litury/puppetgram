import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql, ne, and, isNotNull, desc, min, max, eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import {
  comments,
  users,
  authTokens,
  userSessions,
} from '../../src/shared/database/schema';

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

async function telegramApi<T = any>(method: string, params: Record<string, any> = {}): Promise<T> {
  if (!AUTH_BOT_TOKEN) throw new Error('AUTH_BOT_TOKEN not set');

  const res = await fetch(`https://api.telegram.org/bot${AUTH_BOT_TOKEN}/${method}`, {
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

const successFilter = and(
  ne(comments.commentText, 'Уже есть'),
  isNotNull(comments.commentText)
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
  // TELEGRAM WEBHOOK
  // ==========================================

  .post('/telegram/webhook', async ({ body }) => {
    if (!AUTH_BOT_TOKEN) {
      console.error('AUTH_BOT_TOKEN not configured');
      return { ok: true }; // Always return 200 to Telegram
    }

    const update = body as any;

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

    return { ok: true }; // Always return 200
  })

  // ==========================================
  // DASHBOARD API
  // ==========================================

  // Stats
  .get('/api/stats', async () => {
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
  .get('/api/daily', async () => {
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
        return { data: [], groupBy: 'day' };
      }

      const rawData = await db
        .select({
          date: sql<string>`DATE(created_at AT TIME ZONE 'Europe/Moscow')`.as('date'),
          count: sql<number>`COUNT(*)`.as('count'),
        })
        .from(comments)
        .where(successFilter)
        .groupBy(sql`DATE(created_at AT TIME ZONE 'Europe/Moscow')`)
        .orderBy(sql`date ASC`);

      const dataMap = new Map<string, number>();
      rawData.forEach(item => dataMap.set(item.date, Number(item.count)));

      const allDates = generateDateRange(new Date(firstDate), new Date(lastDate));
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
  .get('/api/timeline', async () => {
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
  .get('/api/recent-posts', async ({ query }) => {
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

  // Comments list
  .get('/api/comments', async ({ query }) => {
    try {
      const limit = parseInt(query.limit || '20', 10);
      const offset = parseInt(query.offset || '0', 10);

      const data = await db
        .select({
          id: comments.id,
          channel: comments.channelUsername,
          text: comments.commentText,
          postId: comments.postId,
          createdAt: comments.createdAt,
        })
        .from(comments)
        .where(successFilter)
        .orderBy(desc(comments.createdAt))
        .limit(limit)
        .offset(offset);

      const formattedComments = data.map(comment => ({
        id: comment.id,
        channel: `@${comment.channel}`,
        text: comment.text || '',
        postId: comment.postId,
        createdAt: comment.createdAt ? new Date(comment.createdAt).toISOString() : null,
      }));

      return { comments: formattedComments };
    } catch (error) {
      console.error('Comments error:', error);
      return { error: 'Failed to fetch comments' };
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
