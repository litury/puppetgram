/**
 * Database Module - публичный API модуля базы данных
 *
 * index.ts служит точкой входа в модуль.
 * Импортируйте отсюда, а не из внутренних файлов:
 *
 * @example
 * // Правильно:
 * import { CommentsRepository, SessionsRepository } from '../../shared/database';
 *
 * // Неправильно:
 * import { CommentsRepository } from '../../shared/database/repositories/commentsRepository';
 */

// Репозитории
export { CommentsRepository, SaveCommentData } from './repositories/commentsRepository';
export { SessionsRepository, SessionStats } from './repositories/sessionsRepository';
export { FailedChannelsRepository, SaveFailedChannelData, ErrorType } from './repositories/failedChannelsRepository';
export { TargetChannelsRepository } from './repositories/targetChannelsRepository';

// Клиент БД (если нужен прямой доступ)
export { getDatabase, createDatabase, DatabaseClient } from './client';

// Схема и типы (для продвинутого использования)
export { comments, sessions, failedChannels, targetChannels, Comment, NewComment, Session, NewSession, FailedChannel, NewFailedChannel, TargetChannel, NewTargetChannel } from './schema';
