/**
 * feedRemuxFaststart — одноразовый ре-ремукс уже скачанных видео в faststart (moov в начало).
 * Скачивает каждый S3-mp4 по публичному URL → ffmpeg -c copy -movflags +faststart → перезаливает.
 * Нужно потому, что ранее видео клались сырыми (moov в конце) → перемотка в браузере не работала.
 *
 * Запуск: npm run feed:remux-faststart   (ENV: FEED_REMUX_LIMIT=1000)
 */

import * as dotenv from 'dotenv';
import { VideoRequestsRepository } from '../../../shared/database/repositories/videoRequestsRepository';
import { getMediaStore } from '../services/mediaStore';
import { remuxFaststart } from '../services/feedMediaService';
import { createLogger } from '../../../shared/utils/logger';

dotenv.config();
const log = createLogger('FeedRemux');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const limit = Number(process.env.FEED_REMUX_LIMIT || 1000);
  const repo = new VideoRequestsRepository();
  const store = getMediaStore();
  const list = await repo.listDone(limit);
  log.info('К ре-ремуксу', { count: list.length });

  let ok = 0, skip = 0, fail = 0;
  for (const v of list) {
    const key = `${v.channelId}_${v.tgMessageId}.mp4`;
    try {
      const res = await fetch(v.url);
      if (!res.ok) { skip++; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) { skip++; continue; }
      const out = await remuxFaststart(buf);
      await store.put(key, out, 'video/mp4');
      ok++;
      if (ok % 10 === 0) log.info('Прогресс', { ok, fail, skip });
    } catch (e: any) {
      fail++;
      log.warn('Ре-ремукс не удался', { key, error: e?.message });
    }
    await sleep(200);
  }
  log.info('Готово', { ok, fail, skip, total: list.length });
  process.exit(0);
}

main().catch((e) => { log.error('Фатальная ошибка feedRemuxFaststart', { error: (e as Error)?.message }); process.exit(1); });
