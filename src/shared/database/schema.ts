/**
 * Drizzle ORM Schema - структура таблиц для трекинга комментирования
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Таблица comments - успешные комментарии
 */
export const comments = sqliteTable('comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelUsername: text('channel_username').notNull(),
  commentText: text('comment_text'),
  postId: integer('post_id'),
  commentId: integer('comment_id'),
  accountName: text('account_name').notNull(),
  targetChannel: text('target_channel').notNull(),
  sessionId: text('session_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => ({
  channelIdx: index('idx_comments_channel').on(table.channelUsername),
  sessionIdx: index('idx_comments_session').on(table.sessionId),
  commentIdIdx: index('idx_comments_comment_id').on(table.commentId),
}));

/**
 * Таблица sessions - статистика запусков скрипта
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  targetChannel: text('target_channel').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  successfulCount: integer('successful_count').default(0),
  failedCount: integer('failed_count').default(0),
  newChannelsCount: integer('new_channels_count').default(0),
  accountsUsed: text('accounts_used'),
});

/**
 * Таблица failed_channels - неудачные попытки (заменяет 8+ текстовых файлов)
 *
 * errorType: BANNED | UNAVAILABLE | SUBSCRIPTION_REQUIRED | MODERATED | POST_SKIPPED | FLOOD_WAIT | OTHER
 */
export const failedChannels = sqliteTable('failed_channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelUsername: text('channel_username').notNull(),
  errorType: text('error_type').notNull(),
  errorMessage: text('error_message'),
  targetChannel: text('target_channel').notNull(),
  sessionId: text('session_id'),
  postId: integer('post_id'),
  createdAt: integer('created_at').default(sql`(unixepoch())`),
}, (table) => ({
  errorTypeIdx: index('idx_failed_error_type').on(table.errorType),
  channelIdx: index('idx_failed_channel').on(table.channelUsername),
}));

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type FailedChannel = typeof failedChannels.$inferSelect;
export type NewFailedChannel = typeof failedChannels.$inferInsert;
