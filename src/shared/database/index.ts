/**
 * Database Module - публичный API модуля базы данных
 *
 * index.ts служит точкой входа в модуль.
 * Импортируйте отсюда, а не из внутренних файлов:
 *
 * @example
 * // Правильно:
 * import { CommentsRepository, TargetChannelsRepository } from '../../shared/database';
 *
 * // Неправильно:
 * import { CommentsRepository } from '../../shared/database/repositories/commentsRepository';
 */

// Репозитории
export { CommentsRepository, SaveCommentData } from './repositories/commentsRepository';
export { TargetChannelsRepository, ChannelData, CommentsState } from './repositories/targetChannelsRepository';
export { AccountFloodWaitRepository } from './repositories/accountFloodWaitRepository';
export { AccountBansRepository } from './repositories/accountBansRepository';

// Клиент БД (если нужен прямой доступ)
export { getDatabase, createDatabase, DatabaseClient } from './client';

// Схема и типы (для продвинутого использования)
export { comments, targetChannels, accountFloodWait, accountBans, Comment, NewComment, TargetChannel, NewTargetChannel, AccountFloodWait, NewAccountFloodWait, AccountBan, NewAccountBan } from './schema';
