/**
 * feedJoinerService — онбординг каналов в ленту (РАЗОВАЯ стадия на канал).
 *
 * resolve username → getEntity → кэш (accountId, channelId)→access_hash → JoinChannel
 * (live-апдейты идут только подписчику). С троттлингом: вступление = действие (флуд/лимит
 * ~500/акк). Один канал = один аккаунт (шардинг — на вызывающей стороне). После вступления
 * канал ведёт уже feedListener (слушает + backfill), joiner его больше не трогает.
 */

import { Api, TelegramClient } from 'telegram';
import { createLogger } from '../../../shared/utils/logger';
import { ChannelCursorsRepository } from '../../../shared/database/repositories/channelCursorsRepository';
import { AccessHashCacheRepository } from '../../../shared/database/repositories/accessHashCacheRepository';

const log = createLogger('FeedJoiner');

export type JoinOutcome = 'joined' | 'already' | 'channels_too_much' | 'flood' | 'error';

export interface JoinResult {
  username: string;
  outcome: JoinOutcome;
  channelId?: number;
  retryAfter?: number;
  reason?: string;
}

export class FeedJoinerService {
  private cursors = new ChannelCursorsRepository();
  private ahc = new AccessHashCacheRepository();

  constructor(private client: TelegramClient, private accountId: number) {}

  /**
   * Онбординг одного канала: резолв + кэш access_hash + cursor + (опц.) JoinChannel.
   * Кэш и cursor пишем ДО join (даже если вступление упрётся в лимит — данные для чтения уже есть).
   * `join=false` (read-only режим) — только резолв+кэш+курсор, без вступления (риск как у чекера).
   */
  async onboard(username: string, opts: { join?: boolean } = {}): Promise<JoinResult> {
    const join = opts.join !== false;
    const uname = username.replace('@', '').trim();
    let entity: any;
    try {
      entity = await this.client.getEntity(uname);
    } catch (e: any) {
      return { username: uname, outcome: 'error', reason: e?.errorMessage || e?.message || 'resolve_failed' };
    }

    const channelId = entity?.id != null ? Number(entity.id.toString()) : undefined;
    const accessHash = entity?.accessHash != null ? BigInt(entity.accessHash.toString()) : undefined;
    if (channelId == null) {
      return { username: uname, outcome: 'error', reason: 'no_channel_id' };
    }

    // Кэшируем доступ + заводим курсор (чтение/ backfill возможны даже без вступления).
    if (accessHash != null) {
      await this.ahc.set(this.accountId, channelId, accessHash, uname);
    }
    await this.cursors.ensure(channelId, uname);

    // Read-only: не вступаем (публичные каналы читаются через getMessages без подписки).
    if (!join) {
      return { username: uname, outcome: 'already', channelId };
    }

    // Вступление (нужно для live-апдейтов).
    try {
      await this.client.invoke(new Api.channels.JoinChannel({ channel: entity }));
      log.info('Вступили в канал', { username: uname, channelId });
      return { username: uname, outcome: 'joined', channelId };
    } catch (e: any) {
      const code = e?.errorMessage as string | undefined;
      if (code === 'USER_ALREADY_PARTICIPANT') {
        return { username: uname, outcome: 'already', channelId };
      }
      if (code === 'CHANNELS_TOO_MUCH') {
        return { username: uname, outcome: 'channels_too_much', channelId };
      }
      if (code === 'FLOOD_WAIT' || e?.constructor?.name === 'FloodWaitError') {
        return { username: uname, outcome: 'flood', channelId, retryAfter: e?.seconds || 60 };
      }
      return { username: uname, outcome: 'error', channelId, reason: code || 'join_failed' };
    }
  }
}
