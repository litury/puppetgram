/**
 * feedMediaService — скачать медиа поста через GramJS и положить в MediaStore, вернуть mediaRefs
 * с НАШИМИ URL (телеграм-файлы публично не доступны). Фото — как есть (Telegram уже ~1280px JPEG),
 * видео — оригинальный mp4 с лимитом размера (обычно H.264 → играет нативно), постер — thumb.
 * Тяжёлое/файлы не качаем (метаданные + ссылка). Best-effort: при ошибке — null, текст всё равно есть.
 */

import { TelegramClient } from 'telegram';
import { spawn } from 'child_process';
import { writeFile, readFile, rm, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createLogger } from '../../../shared/utils/logger';
import { getMediaStore } from './mediaStore';

// sharp — тяжёлая нативная зависимость; грузим ЛЕНИВО, чтобы её отсутствие в образе НЕ роняло коллектор.
let sharpMod: any = null;
let sharpTried = false;
function getSharp(): any | null {
  if (!sharpTried) {
    sharpTried = true;
    try { sharpMod = require('sharp'); } catch { sharpMod = null; }
  }
  return sharpMod;
}

const log = createLogger('FeedMedia');
const VIDEO_MAX_MB = Number(process.env.FEED_VIDEO_MAX_MB || 30);
const VIDEO_MAX_SEC = Number(process.env.FEED_VIDEO_MAX_SEC || 600);
const VIDEO_DL_WORKERS = Number(process.env.FEED_VIDEO_DL_WORKERS || 8);
const REMUX_MAX_MB = Number(process.env.FEED_REMUX_MAX_MB || 300); // больше — пропускаем faststart (не жжём диск 2×)

export type MediaRef =
  | { kind: 'photo'; url: string; w?: number; h?: number }
  | { kind: 'video'; url?: string; poster?: string; duration?: number; w?: number; h?: number; gif?: boolean; mid?: number }
  | { kind: 'file'; name: string; ext?: string; size?: string }
  | { kind: 'link'; url: string; title?: string; site?: string };

function attr(doc: any, cls: string): any {
  return (doc?.attributes || []).find((a: any) => a?.className === cls);
}

/**
 * Remux MP4 в faststart (moov-атом в начало) — БЕЗ перекодирования (-c copy), быстро.
 * Нужно для стриминга/перемотки в браузере: Telegram кладёт moov в конец → seek не работает.
 * При отсутствии/ошибке ffmpeg возвращает исходный буфер (видео всё равно играет, просто без seek).
 */
export async function remuxFaststart(buf: Buffer): Promise<Buffer> {
  let dir = '';
  try {
    dir = await mkdtemp(join(tmpdir(), 'vid-'));
    const inp = join(dir, 'in.mp4'), out = join(dir, 'out.mp4');
    await writeFile(inp, buf);
    await new Promise<void>((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', inp, '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'ignore' });
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code))));
    });
    const r = await readFile(out);
    return r && r.length ? r : buf;
  } catch (e: any) {
    log.warn('faststart remux не удался — кладу как есть', { error: e?.message });
    return buf;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Remux faststart файл→файл (для крупных видео, без буфера в памяти). true = outPath готов. */
async function remuxFaststartFile(inPath: string, outPath: string): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', inPath, '-c', 'copy', '-movflags', '+faststart', outPath], { stdio: 'ignore' });
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code))));
    });
    return true;
  } catch (e: any) {
    log.warn('faststart remux (file) не удался — кладу как есть', { error: e?.message });
    return false;
  }
}

/**
 * LAZY: скачать ОДНО видео сообщения по запросу зрителя и положить в MediaStore (S3). Вернуть url или null.
 * channelInput — InputChannel (из кэша access_hash), username или channelId. Кап размера FEED_VIDEO_LAZY_MAX_MB.
 */
export async function fetchVideoFile(
  client: TelegramClient,
  channelInput: any,
  channelId: number,
  tgMessageId: number,
): Promise<string | null> {
  const msgs: any[] = await client.getMessages(channelInput, { ids: [tgMessageId] });
  const msg = msgs?.[0];
  const doc = msg?.media?.document;
  if (!doc) return null;
  const mime = String(doc.mimeType || '');
  const isVideo = !!attr(doc, 'DocumentAttributeVideo') || mime.startsWith('video/') || !!attr(doc, 'DocumentAttributeAnimated');
  if (!isVideo) return null;
  const maxMb = Number(process.env.FEED_VIDEO_LAZY_MAX_MB || 50);
  if (Number(doc.size || 0) > maxMb * (1 << 20)) return null; // слишком большое — пропускаем
  const store = getMediaStore();
  const vkey = `${channelId}_${tgMessageId}.mp4`;
  if (!(await store.has(vkey))) {
    const buf = (await client.downloadMedia(msg, {})) as Buffer;
    if (!buf || !buf.length) return null;
    await store.put(vkey, await remuxFaststart(buf), 'video/mp4'); // faststart → перемотка в браузере
  }
  return store.url(vkey);
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
  opts: { skipVideoDownload?: boolean } = {},
): Promise<MediaRef[] | null> {
  const media = msg?.media;
  if (!media) return null;
  const cls = String(media.className || '');
  const store = getMediaStore();
  const base = `${channelId}_${tgMessageId}`;

  try {
    // --- Фото --- (конвертируем в WebP ~1080px q75 → ~40КБ вместо ~96КБ JPEG; экономия хранилища)
    if (cls === 'MessageMediaPhoto' || media.photo) {
      const key = `${base}.webp`;
      const dims = largestPhotoDims(media.photo);
      if (!(await store.has(key))) {
        const raw = (await client.downloadMedia(msg, {})) as Buffer;
        if (!raw || !raw.length) return null;
        let out: Buffer = raw, ctype = 'image/jpeg', okKey = `${base}.jpg`;
        const sh = getSharp();
        if (sh) {
          try {
            out = await sh(raw).rotate().resize({ width: 1080, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
            ctype = 'image/webp'; okKey = key;
          } catch (e: any) {
            log.warn('WebP-конвертация не удалась, кладу оригинал', { channelId, tgMessageId, error: e?.message });
          }
        }
        await store.put(okKey, out, ctype);
        return [{ kind: 'photo', url: store.url(okKey), ...dims }];
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
        // Постер: берём КРУПНЕЙШИЙ статичный thumb (не stripped-блюр!) → sharp resize 720 WebP.
        // Раньше брался thumbs[last] как есть (часто мелкий/stripped, без обработки) → пиксели/искажение.
        let posterUrl: string | undefined;
        const pkey = `${base}_p.webp`;
        const pkeyJpg = `${base}_p.jpg`;
        try {
          if (await store.has(pkey)) posterUrl = store.url(pkey);
          else if (await store.has(pkeyJpg)) posterUrl = store.url(pkeyJpg);
          else {
            const thumbs: any[] = doc.thumbs || [];
            let bestIdx = -1, bestArea = -1;
            thumbs.forEach((t, i) => {
              if (t?.className === 'PhotoStrippedSize' || t?.className === 'PhotoSizeEmpty') return;
              const area = Number(t?.w || 0) * Number(t?.h || 0);
              if (area > bestArea) { bestArea = area; bestIdx = i; }
            });
            if (bestIdx < 0 && thumbs.length) bestIdx = thumbs.length - 1;
            if (bestIdx >= 0) {
              const tbuf = (await client.downloadMedia(msg, { thumb: bestIdx })) as Buffer;
              if (tbuf?.length) {
                let out: Buffer = tbuf, ctype = 'image/jpeg', okKey = pkeyJpg;
                const sh = getSharp();
                if (sh) {
                  try {
                    out = await sh(tbuf).rotate().resize({ width: 720 }).webp({ quality: 80 }).toBuffer();
                    ctype = 'image/webp'; okKey = pkey;
                  } catch (e: any) {
                    log.warn('Постер WebP не удался, кладу JPEG', { channelId, tgMessageId, error: e?.message });
                  }
                }
                await store.put(okKey, out, ctype);
                posterUrl = store.url(okKey);
              }
            }
          }
        } catch (e: any) {
          log.warn('Постер не сделан', { channelId, tgMessageId, error: e?.message });
        }
        // само видео — только если в лимитах. Сквозной диск-поток (не в память) → хоть 3ГБ без OOM.
        const tooBig = sizeBytes > VIDEO_MAX_MB * (1 << 20);
        const tooLong = duration != null && duration > VIDEO_MAX_SEC;
        if (!tooBig && !tooLong) {
          const vkey = `${base}.mp4`;
          const have = await store.has(vkey);
          // heal-режим: видео НЕ качаем (утечка temp + ETIMEDOUT). Есть файл → url; нет → постер.
          if (opts.skipVideoDownload) {
            return have
              ? [{ kind: 'video', url: store.url(vkey), poster: posterUrl, duration, w, h, gif: !!animated, mid: tgMessageId }]
              : [{ kind: 'video', poster: posterUrl, duration, w, h, mid: tgMessageId }];
          }
          if (!have) {
            let dir = '';
            try {
              dir = await mkdtemp(join(tmpdir(), 'vid-'));
              const dl = join(dir, 'dl.mp4'), fixed = join(dir, 'fixed.mp4');
              await client.downloadMedia(msg, { outputFile: dl, workers: VIDEO_DL_WORKERS } as any); // на диск, параллельные чанки
              const small = sizeBytes > 0 && sizeBytes <= REMUX_MAX_MB * (1 << 20);
              const upPath = small && (await remuxFaststartFile(dl, fixed)) ? fixed : dl; // крупные — без faststart
              await store.putFile(vkey, upPath, 'video/mp4'); // потоковая выгрузка с диска
            } finally {
              if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
            }
          }
          return [{ kind: 'video', url: store.url(vkey), poster: posterUrl, duration, w, h, gif: !!animated, mid: tgMessageId }];
        }
        // тяжёлое/lazy — постер + без url (видео грузится по запросу по mid = id этого сообщения)
        return [{ kind: 'video', poster: posterUrl, duration, w, h, mid: tgMessageId }];
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
