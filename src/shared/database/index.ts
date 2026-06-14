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
export { AccountsRepository } from './repositories/accountsRepository';
export { AccountGroupMembershipsRepository } from './repositories/accountGroupMembershipsRepository';

// Клиент БД (если нужен прямой доступ)
export { getDatabase, createDatabase, DatabaseClient } from './client';

// Схема и типы (для продвинутого использования)
export { comments, targetChannels, accountFloodWait, accountBans, accounts, accountGroupMemberships, Comment, NewComment, TargetChannel, NewTargetChannel, AccountFloodWait, NewAccountFloodWait, AccountBan, NewAccountBan, AccountRow, NewAccountRow, AccountGroupMembership, NewAccountGroupMembership } from './schema';
