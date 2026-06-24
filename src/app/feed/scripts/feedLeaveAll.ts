/**
 * feedLeaveAll — одноразовая очистка аккаунта: выход из ВСЕХ каналов/супергрупп/групп.
 *
 * Используется когда аккаунт перепрофилируется под ленту (был комментатором → много мусорных
 * чатов обсуждения). Перечисляет диалоги через iterDialogs и выходит гентл-пейсингом (анти-FLOOD).
 *
 * Запуск: npm run feed:leave-all
 * ENV:
 *   FEED_ACCOUNT_POOL          пул аккаунта (default 'join')
 *   FEED_LEAVE_DRYRUN=1        только посчитать + сэмпл, НЕ выходить
 *   FEED_LEAVE_THROTTLE_MS     пауза между выходами (default 5000)
 *   FEED_LEAVE_LIMIT           макс. выходов за прогон (0 = без капа)
 *   FEED_FLOOD_SLEEP_THRESHOLD рекомендуется 60 (iterDialogs/короткие флуды авто-засыпают)
 */

import * as dotenv from 'dotenv';
import { Api } from 'telegram';
import { AccountsRepository } from '../../../shared/database/repositories/accountsRepository';
import { FeedClient, credsFromAccount } from '../adapters/feedClient';
import { createLogger } from '../../../shared/utils/logger';

dotenv.config();

const log = createLogger('FeedLeaveAll');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isFlood = (e: any): boolean =>
  /FLOOD/i.test(String(e?.errorMessage || e?.message || '')) || e?.constructor?.name === 'FloodWaitError';

async function main(): Promise<void> {
  const pool = process.env.FEED_ACCOUNT_POOL || 'join';
  const dryRun = process.env.FEED_LEAVE_DRYRUN === '1';
  const throttle = Number(process.env.FEED_LEAVE_THROTTLE_MS || 5000);
  const limit = Number(process.env.FEED_LEAVE_LIMIT || 0);

  const repo = new AccountsRepository();
  const accountsList = await repo.getActiveByPool(pool);
  if (!accountsList.length) {
    log.error('Нет активных аккаунтов в пуле', { pool });
    process.exit(1);
  }

  for (const acc of accountsList) {
    const fc = new FeedClient(credsFromAccount(acc));
    try {
      await fc.connect();
    } catch (e: any) {
      log.error('Не удалось подключить аккаунт — пропуск', { account: acc.name, error: e?.message });
      continue;
    }
    const client = fc.getClient();

    // Собираем цели: каналы/супергруппы (LeaveChannel) и базовые группы (DeleteChatUser).
    const channels: any[] = []; // d.entity.className === 'Channel'
    const chats: any[] = []; // d.entity.className === 'Chat'
    try {
      for await (const d of client.iterDialogs({})) {
        const e: any = d.entity;
        const cn = e?.className;
        if (cn === 'Channel') channels.push(d);
        else if (cn === 'Chat') chats.push(d);
      }
    } catch (e: any) {
      log.warn('iterDialogs прервался (частично собрано)', { account: acc.name, error: e?.message, channels: channels.length, chats: chats.length });
    }

    log.info('Диалоги собраны', { account: acc.name, channels: channels.length, chats: chats.length });

    if (dryRun) {
      const sample = [...channels, ...chats].slice(0, 12).map((d) => {
        const e: any = d.entity;
        return e?.username ? `@${e.username}` : (e?.title || String(e?.id));
      });
      log.info('DRY-RUN — вышли бы из', { account: acc.name, total: channels.length + chats.length, sample });
      await fc.disconnect();
      continue;
    }

    let left = 0;
    let fail = 0;
    let flood = 0;

    const leaveOne = async (d: any): Promise<boolean> => {
      const e: any = d.entity;
      if (e?.className === 'Chat') {
        await client.invoke(new Api.messages.DeleteChatUser({ chatId: e.id, userId: new Api.InputUserSelf() }));
      } else {
        await client.invoke(new Api.channels.LeaveChannel({ channel: d.entity }));
      }
      return true;
    };

    for (const d of [...channels, ...chats]) {
      if (limit && left >= limit) {
        log.info('Достигнут FEED_LEAVE_LIMIT', { limit });
        break;
      }
      try {
        await leaveOne(d);
        left++;
      } catch (e: any) {
        if (isFlood(e)) {
          flood++;
          const wait = Number(e?.seconds || 30);
          log.warn('FLOOD на leave — сплю и ретраю', { wait });
          await sleep((wait + 2) * 1000);
          try {
            await leaveOne(d);
            left++;
          } catch {
            fail++;
          }
        } else {
          fail++;
          log.warn('Выход не удался', { error: String(e?.errorMessage || e?.message || '').slice(0, 90) });
        }
      }
      await sleep(throttle);
    }

    log.info('Готово по аккаунту', { account: acc.name, left, fail, flood });
    await fc.disconnect();
  }

  process.exit(0);
}

main().catch((e) => {
  log.error('Фатальная ошибка feedLeaveAll', { error: (e as Error)?.message });
  process.exit(1);
});
