/**
 * feedMediaService — скачать медиа поста через GramJS и положить в MediaStore, вернуть mediaRefs
 * с НАШИМИ URL (телеграм-файлы публично не доступны). Фото — как есть (Telegram уже ~1280px JPEG),
 * видео — оригинальный mp4 с лимитом размера (обычно H.264 → играет нативно), постер — thumb.
 * Тяжёлое/файлы не качаем (метаданные + ссылка). Best-effort: при ошибке — null, текст всё равно есть.
 */

import { TelegramClient } from 'telegram';
import { createLogger } from '../../../shared/utils/logger';
import { getMediaStore } from './mediaStore';

const log = createLogger('FeedMedia');
const VIDEO_MAX_MB = Number(process.env.FEED_VIDEO_MAX_MB || 30);
const VIDEO_MAX_SEC = Number(process.env.FEED_VIDEO_MAX_SEC || 600);

export type MediaRef =
  | { kind: 'photo'; url: string; w?: number; h?: number }
  | { kind: 'video'; url?: string; poster?: string; duration?: number; w?: number; h?: number; gif?: boolean }
  | { kind: 'file'; name: string; ext?: string; size?: string }
  | { kind: 'link'; url: string; title?: string; site?: string };

function attr(doc: any, cls: string): any {
  return (doc?.attributes || []).find((a: any) => a?.className === cls);
}

function largestPhotoDims(photo: any): { w?: number; h?: number } {
  const sizes = photo?.sizes || [];
  let best: any = null;
  for (const s of sizes) {
    const w = s?.w ?? (Array.isArray(s?.sizes) ? 0 : 0);
    if (w && (!best || w > best.w)) best = s;
  }
  return best ? { w: best.w, h: best.h } : {};
}

function humanSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Скачать медиа сообщения, сохранить в MediaStore, вернуть mediaRefs (массив; обычно 1 элемент).
 * key-схема: `<channelId>_<tgMessageId>[_p].<ext>`.
 */
export async function fetchAndStoreMedia(
  client: TelegramClient,
  msg: any,
  channelId: number,
  tgMessageId: number,
): Promise<MediaRef[] | null> {
  const media = msg?.media;
  if (!media) return null;
  const cls = String(media.className || '');
  const store = getMediaStore();
  const base = `${channelId}_${tgMessageId}`;

  try {
    // --- Фото ---
    if (cls === 'MessageMediaPhoto' || media.photo) {
      const key = `${base}.jpg`;
      const dims = largestPhotoDims(media.photo);
      if (!(await store.has(key))) {
        const buf = (await client.downloadMedia(msg, {})) as Buffer;
        if (!buf || !buf.length) return null;
        await store.put(key, buf, 'image/jpeg');
      }
      return [{ kind: 'photo', url: store.url(key), ...dims }];
    }

    // --- Документ: видео / gif / файл ---
    if (cls === 'MessageMediaDocument' && media.document) {
      const doc = media.document;
      const mime = String(doc.mimeType || '');
      const vAttr = attr(doc, 'DocumentAttributeVideo');
      const animated = attr(doc, 'DocumentAttributeAnimated');
      const isVideo = !!vAttr || mime.startsWith('video/') || !!animated;
      const sizeBytes = Number(doc.size || 0);

      if (isVideo) {
        const duration = vAttr?.duration ? Math.round(Number(vAttr.duration)) : undefined;
        const w = vAttr?.w, h = vAttr?.h;
        // постер из thumb (если есть)
        let posterUrl: string | undefined;
        const pkey = `${base}_p.jpg`;
        if ((doc.thumbs || []).length) {
          try {
            if (!(await store.has(pkey))) {
              const tbuf = (await client.downloadMedia(msg, { thumb: (doc.thumbs.length - 1) })) as Buffer;
              if (tbuf?.length) await store.put(pkey, tbuf, 'image/jpeg');
            }
            if (await store.has(pkey)) posterUrl = store.url(pkey);
          } catch { /* постер не критичен */ }
        }
        // само видео — только если в лимитах
        const tooBig = sizeBytes > VIDEO_MAX_MB * (1 << 20);
        const tooLong = duration != null && duration > VIDEO_MAX_SEC;
        if (!tooBig && !tooLong) {
          const vkey = `${base}.mp4`;
          if (!(await store.has(vkey))) {
            const vbuf = (await client.downloadMedia(msg, {})) as Buffer;
            if (vbuf?.length) await store.put(vkey, vbuf, 'video/mp4');
          }
          return [{ kind: 'video', url: store.url(vkey), poster: posterUrl, duration, w, h, gif: !!animated }];
        }
        // тяжёлое — постер + без url (фронт даст «открыть в Telegram»)
        return [{ kind: 'video', poster: posterUrl, duration, w, h }];
      }

      // обычный файл — метаданные, не качаем
      const name = attr(doc, 'DocumentAttributeFilename')?.fileName || 'file';
      const ext = (name.includes('.') ? name.split('.').pop() : (mime.split('/')[1] || '')) as string;
      return [{ kind: 'file', name, ext, size: humanSize(sizeBytes) }];
    }

    // --- Превью ссылки (webpage) ---
    if (cls === 'MessageMediaWebPage' && media.webpage && media.webpage.className === 'WebPage') {
      const wp = media.webpage;
      return [{ kind: 'link', url: String(wp.url || ''), title: wp.title || undefined, site: wp.siteName || undefined }];
    }

    return null;
  } catch (e: any) {
    log.warn('Скачивание медиа не удалось', { channelId, tgMessageId, error: e?.message });
    return null;
  }
}
