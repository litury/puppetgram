/**
 * Drizzle ORM Schema - структура таблиц для трекинга комментирования
 * PostgreSQL версия
 */

import { pgTable, text, integer, serial, timestamp, index, boolean, bigint } from 'drizzle-orm/pg-core';

/**
 * Таблица comments - успешные комментарии
 */
export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  channelUsername: text('channel_username').notNull(),
  commentText: text('comment_text'),
  postId: integer('post_id'),
  commentId: integer('comment_id'),
  accountName: text('account_name').notNull(),
  targetChannel: text('target_channel').notNull(),
  sessionId: text('session_id'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  channelIdx: index('idx_comments_channel').on(table.channelUsername),
  sessionIdx: index('idx_comments_session').on(table.sessionId),
  commentIdIdx: index('idx_comments_comment_id').on(table.commentId),
}));

/**
 * Таблица sessions - статистика запусков скрипта
 */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  targetChannel: text('target_channel').notNull(),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  successfulCount: integer('successful_count').default(0),
  failedCount: integer('failed_count').default(0),
  newChannelsCount: integer('new_channels_count').default(0),
  accountsUsed: text('accounts_used'),
});

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

/**
 * Таблица target_channels - очередь каналов для комментирования
 *
 * status:
 * - new: ещё не обработан
 * - done: успешно прокомментирован
 * - error: ошибка при комментировании
 * - skipped: пропущен (нет постов, закрытые комменты)
 *
 * parsed:
 * - false: рекомендации ещё не собраны
 * - true: рекомендации уже спарсены
 */
export const targetChannels = pgTable('target_channels', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  status: text('status').notNull().default('new'),
  parsed: boolean('parsed').notNull().default(false),
  errorMessage: text('error_message'),
  processedAt: timestamp('processed_at'),
  parsedAt: timestamp('parsed_at'),
  createdAt: timestamp('created_at').defaultNow(),

  // Фаза 1: данные из рекомендаций (без доп. запросов)
  channelId: bigint('channel_id', { mode: 'number' }),
  title: text('title'),
  participants: integer('participants'),
  isVerified: boolean('is_verified').default(false),
  isScam: boolean('is_scam').default(false),
  isFake: boolean('is_fake').default(false),

  // Фаза 2: метрики из постов (при комментировании)
  avgViews: integer('avg_views'),
  avgReactions: integer('avg_reactions'),
  metricsAt: timestamp('metrics_at'),
}, (table) => ({
  statusIdx: index('idx_target_channels_status').on(table.status),
  parsedIdx: index('idx_target_channels_parsed').on(table.parsed),
  participantsIdx: index('idx_target_channels_participants').on(table.participants),
}));

export type TargetChannel = typeof targetChannels.$inferSelect;
export type NewTargetChannel = typeof targetChannels.$inferInsert;

/**
 * Таблица account_flood_wait - хранение состояния FLOOD_WAIT аккаунтов
 * Позволяет сохранять состояние между перезапусками контейнера
 */
export const accountFloodWait = pgTable('account_flood_wait', {
  id: serial('id').primaryKey(),
  accountName: text('account_name').notNull().unique(),
  unlockAt: timestamp('unlock_at').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  unlockIdx: index('idx_account_flood_wait_unlock').on(table.unlockAt),
}));

export type AccountFloodWait = typeof accountFloodWait.$inferSelect;
export type NewAccountFloodWait = typeof accountFloodWait.$inferInsert;

// ============================================
// АВТОРИЗАЦИЯ
// ============================================

/**
 * Таблица users - пользователи дашборда
 */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  username: text('username'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  photoUrl: text('photo_url'),
  createdAt: timestamp('created_at').defaultNow(),
  lastLoginAt: timestamp('last_login_at'),
}, (table) => ({
  telegramIdIdx: index('idx_users_telegram_id').on(table.telegramId),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * Таблица auth_tokens - временные токены для Bot Deep Link авторизации
 * Живут 5 минут, после подтверждения создаётся сессия
 */
export const authTokens = pgTable('auth_tokens', {
  id: serial('id').primaryKey(),
  token: text('token').notNull().unique(),
  telegramId: bigint('telegram_id', { mode: 'number' }), // NULL пока не подтверждён
  status: text('status').notNull().default('pending'), // pending, confirmed, expired
  createdAt: timestamp('created_at').defaultNow(),
  confirmedAt: timestamp('confirmed_at'),
  expiresAt: timestamp('expires_at').notNull(),
}, (table) => ({
  tokenIdx: index('idx_auth_tokens_token').on(table.token),
  statusIdx: index('idx_auth_tokens_status').on(table.status),
}));

export type AuthToken = typeof authTokens.$inferSelect;
export type NewAuthToken = typeof authTokens.$inferInsert;

/**
 * Таблица user_sessions - сессии пользователей
 */
export const userSessions = pgTable('user_sessions', {
  id: text('id').primaryKey(), // UUID или random string
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_user_sessions_user_id').on(table.userId),
  expiresAtIdx: index('idx_user_sessions_expires_at').on(table.expiresAt),
}));

export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
