/**
 * Drizzle ORM Schema - структура таблиц для трекинга комментирования
 * PostgreSQL версия
 */

import { pgTable, text, integer, serial, timestamp, index, boolean, bigint, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';

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
  commentIdIdx: index('idx_comments_comment_id').on(table.commentId),
  sessionIdx: index('idx_comments_session').on(table.sessionId),
  uniqueCommentIdx: uniqueIndex('idx_comments_unique').on(table.channelUsername, table.postId, table.accountName),
}));

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

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

  // Фаза предпроверки чекером (read-only GetFullChannel):
  // комментарии у канала открыты или нет — отдельная ортогональная колонка,
  // чтобы чекер (пишет comments_state) и комментатор (пишет status) не мешали друг другу.
  // null = не проверен / open = есть линкованная группа / closed = нет / join_required = нужно вступить / invalid = мёртвый юзернейм
  commentsState: text('comments_state'),
  checkedAt: timestamp('checked_at'),

  // Метаданные канала, собранные чекером из GetFullChannel (бесплатно, без доп. вызовов).
  // Гибкий JSONB-блоб: about, тип, scam/fake/verified, slowmode, boosts, online и т.д.
  // (новые поля добавляются без миграций). checkedBy — каким аккаунтом размечено (пер-аккаунт стата).
  channelMeta: jsonb('channel_meta'),
  checkedBy: text('checked_by'),
}, (table) => ({
  statusIdx: index('idx_target_channels_status').on(table.status),
  parsedIdx: index('idx_target_channels_parsed').on(table.parsed),
  participantsIdx: index('idx_target_channels_participants').on(table.participants),
  commentsStateIdx: index('idx_target_channels_comments_state').on(table.commentsState),
  checkedByIdx: index('idx_target_channels_checked_by').on(table.checkedBy),
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

/**
 * Таблица account_bans — реальные бан-метки от Telegram антиспама (через @SpamBot).
 * Отличается от account_flood_wait тем, что бан бессрочный (пока пользователь не подаст
 * appeal через @SpamBot и Telegram его не снимет). Загружается при старте бота
 * и аккаунты в активном бане никогда не используются.
 */
export const accountBans = pgTable('account_bans', {
  id: serial('id').primaryKey(),
  accountName: text('account_name').notNull().unique(),
  bannedAt: timestamp('banned_at').notNull().defaultNow(),
  banReason: text('ban_reason'),
  spambotResponse: text('spambot_response'),
  unbannedAt: timestamp('unbanned_at'),
  notes: text('notes'),
}, (table) => ({
  activeIdx: index('idx_account_bans_active').on(table.accountName),
}));

export type AccountBan = typeof accountBans.$inferSelect;
export type NewAccountBan = typeof accountBans.$inferInsert;

/**
 * Таблица account_group_memberships — учёт вступлений аккаунтов в чаты обсуждения.
 * Чтобы прокомментировать канал с включёнными комментами (linked discussion group),
 * аккаунт должен быть участником ЭТОЙ группы (иначе CHAT_GUEST_SEND_FORBIDDEN).
 * Членство per-account: при ротации новый аккаунт вступает заново.
 * Используется для reaper'а — у потолка ~500 членств выходим из самых старых.
 */
export const accountGroupMemberships = pgTable('account_group_memberships', {
  id: serial('id').primaryKey(),
  accountName: text('account_name').notNull(),
  groupId: bigint('group_id', { mode: 'number' }).notNull(),
  // access_hash группы — нужен, чтобы выйти из неё в ОТДЕЛЬНОМ процессе (revert-скрипт),
  // где entity-кэш пуст и резолв по «голому» id невозможен.
  groupAccessHash: bigint('group_access_hash', { mode: 'bigint' }),
  groupUsername: text('group_username'),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
  lastCommentAt: timestamp('last_comment_at'),
  leftAt: timestamp('left_at'),
}, (table) => ({
  accountActiveIdx: index('idx_agm_account_active').on(table.accountName, table.leftAt),
  accountJoinedIdx: index('idx_agm_account_joined').on(table.accountName, table.joinedAt),
  accountGroupIdx: uniqueIndex('idx_agm_account_group').on(table.accountName, table.groupId),
}));

export type AccountGroupMembership = typeof accountGroupMemberships.$inferSelect;
export type NewAccountGroupMembership = typeof accountGroupMemberships.$inferInsert;

/**
 * Таблица accounts — единый реестр Telegram-аккаунтов (вместо env-переменных).
 * Generic: колонка `pool` различает назначение (checker/commenter/parser/usa/profile),
 * поэтому одна таблица обслуживает любой сервис. Сервис грузит аккаунты по своему пулу;
 * добавить аккаунт = INSERT (без редеплоя). Пилот — пул 'checker'.
 */
export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  sessionString: text('session_string').notNull().unique(),
  pool: text('pool').notNull(), // checker | commenter | parser | usa | profile
  tgId: bigint('tg_id', { mode: 'number' }),
  username: text('username'),
  phone: text('phone'),
  status: text('status').notNull().default('active'), // active | flooded | banned | dead
  proxy: text('proxy'),
  sourceItemId: text('source_item_id'), // LZT-айтем, откуда куплен
  notes: text('notes'),
  // Доп. поля, специфичные для пула (напр. password комментатора) — generic,
  // чтобы хранить разные свойства разных пулов без новых колонок.
  meta: jsonb('meta'),
  createdAt: timestamp('created_at').defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
}, (table) => ({
  poolStatusIdx: index('idx_accounts_pool_status').on(table.pool, table.status),
}));

export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;

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
