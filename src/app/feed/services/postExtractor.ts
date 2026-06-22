/**
 * postExtractor — вытащить поля поста из GramJS-сообщения (Api.Message) в форму
 * UpsertPostInput. Используется и listener'ом (live-событие), и backfill'ом (GetHistory).
 */

import { UpsertPostInput } from '../../../shared/database/repositories/postsRepository';

/** Суммарное число реакций (для метрик/скоринга). */
export function totalReactions(reactions: Record<string, number> | null): number {
  if (!reactions) return 0;
  return Object.values(reactions).reduce((a, b) => a + (b || 0), 0);
}

/** Разобрать Api.MessageReactions в { emoji|customId: count }. */
function extractReactions(msg: any): Record<string, number> | null {
  const results = msg?.reactions?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const out: Record<string, number> = {};
  for (const r of results) {
    const reaction = r?.reaction;
    const key =
      reaction?.emoticon ??
      (reaction?.documentId != null ? `custom:${reaction.documentId}` : 'unknown');
    out[key] = (out[key] || 0) + (r?.count || 0);
  }
  return out;
}

/** channelId из peerId сообщения (Api.PeerChannel). null — если не канал. */
export function channelIdFromMessage(msg: any): number | null {
  const cid = msg?.peerId?.channelId;
  if (cid == null) return null;
  return Number(cid.toString());
}

/**
 * Сериализовать Api.MessageEntity[] в лёгкий JSON для рендера форматирования/ссылок на фронте.
 * Тип (без префикса MessageEntity), offset/length (в UTF-16-единицах), url для текстовых ссылок.
 */
export function extractEntities(msg: any): Array<Record<string, any>> | null {
  const ents = msg?.entities;
  if (!Array.isArray(ents) || ents.length === 0) return null;
  const out: Array<Record<string, any>> = [];
  for (const e of ents) {
    const cls = String(e?.className ?? '').replace(/^MessageEntity/, '');
    if (!cls || e?.offset == null || e?.length == null) continue;
    const item: Record<string, any> = { type: cls, offset: Number(e.offset), length: Number(e.length) };
    if (e.url) item.url = String(e.url);                 // TextUrl — вшитая ссылка
    if (e.language) item.language = String(e.language);   // Pre — язык кода
    out.push(item);
  }
  return out.length ? out : null;
}

/**
 * Преобразовать GramJS-сообщение в UpsertPostInput.
 * channelId передаём явно (он известен из контекста подписки/курсора), чтобы не зависеть
 * от формы peerId, но если не задан — берём из сообщения.
 */
export function messageToPost(msg: any, channelId?: number, channelUsername?: string | null): UpsertPostInput | null {
  const tgMessageId = msg?.id;
  if (tgMessageId == null) return null;
  const cid = channelId ?? channelIdFromMessage(msg);
  if (cid == null) return null;

  return {
    channelId: cid,
    channelUsername: channelUsername ?? null,
    tgMessageId: Number(tgMessageId),
    text: (msg?.message ?? msg?.text ?? null) || null,
    mediaType: msg?.media?.className ?? null,
    mediaRefs: null, // медиа-файлы скачивает collector отдельной фазой (mediaPipeline)
    entities: extractEntities(msg),
    views: msg?.views ?? null,
    reactions: extractReactions(msg),
    forwards: msg?.forwards ?? null,
    repliesCount: msg?.replies?.replies ?? null,
    postedAt: msg?.date ? new Date(msg.date * 1000) : null,
    editedAt: msg?.editDate ? new Date(msg.editDate * 1000) : null,
  };
}
