/**
 * Drizzle ORM Schema - структура таблиц для трекинга комментирования
 * PostgreSQL версия
 */

import { pgTable, text, integer, serial, timestamp, index, boolean } from 'drizzle-orm/pg-core';

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
}, (table) => ({
  statusIdx: index('idx_target_channels_status').on(table.status),
  parsedIdx: index('idx_target_channels_parsed').on(table.parsed),
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
