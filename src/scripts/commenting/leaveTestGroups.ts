/**
 * Revert-скрипт: выход из всех чатов обсуждения, в которые комментатор вступил
 * во время теста авто-вступления (account_group_memberships, left_at IS NULL).
 *
 * Возвращает состояние «как до теста»: по каждому аккаунту подключается его сессией
 * и выходит из групп по id+access_hash (entity-кэш в отдельном процессе пуст).
 *
 * Запуск: npm run comment:leave-test-groups
 */

import * as dotenv from 'dotenv';
import {
  AccountsRepository,
  AccountGroupMembershipsRepository,
} from '../../shared/database';
import { GramClient } from '../../telegram/adapters/gramClient';
import { ChannelJoinerService } from '../../app/channelJoiner/services/channelJoinerService';

dotenv.config();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('\n🧹 === REVERT: выход из вступленных чатов обсуждения ===\n');

  const membershipsRepo = new AccountGroupMembershipsRepository();
  const accountsRepo = new AccountsRepository();

  const active = await membershipsRepo.listActive();
  if (active.length === 0) {
    console.log('✅ Активных членств нет — возвращать нечего.');
    process.exit(0);
  }
  console.log(`Найдено активных членств: ${active.length}`);

  // Сессии аккаунтов пула комментатора (name -> sessionValue)
  const pool = await accountsRepo.getActiveByPool('commenter');
  const sessionByName = new Map<string, string>();
  for (const a of pool) {
    if (a.sessionValue) sessionByName.set(a.name, a.sessionValue);
  }

  // Группируем членства по аккаунту
  const byAccount = new Map<string, typeof active>();
  for (const m of active) {
    const list = byAccount.get(m.accountName) ?? [];
    list.push(m);
    byAccount.set(m.accountName, list);
  }

  let leftTotal = 0;
  let skipped = 0;

  for (const [accountName, rows] of byAccount) {
    const session = sessionByName.get(accountName);
    if (!session) {
      console.warn(`⚠️ Нет сессии для аккаунта ${accountName} — пропускаю ${rows.length} групп`);
      skipped += rows.length;
      continue;
    }

    process.env.SESSION_STRING = session;
    const gram = new GramClient();
    try {
      await gram.connect();
    } catch (e) {
      console.warn(`⚠️ Не удалось подключить ${accountName}: ${(e as Error).message}`);
      skipped += rows.length;
      continue;
    }

    const joiner = new ChannelJoinerService(gram.getClient());
    console.log(`\n👤 ${accountName}: выхожу из ${rows.length} групп`);

    for (const m of rows) {
      let ok = false;
      if (m.groupAccessHash != null) {
        ok = await joiner.leaveByIdHash(m.groupId, m.groupAccessHash);
      } else {
        ok = await joiner.leaveByPeer(m.groupId);
      }
      if (ok) {
        await membershipsRepo.markLeft(accountName, m.groupId);
        leftTotal++;
        console.log(`   ✅ вышел: ${m.groupId} ${m.groupUsername ? `(@${m.groupUsername})` : ''}`);
      } else {
        skipped++;
        console.warn(`   ❌ не удалось выйти: ${m.groupId}`);
      }
      await sleep(2000); // не частить LeaveChannel
    }

    await gram.disconnect();
  }

  console.log(`\n📊 Готово. Вышли: ${leftTotal}, пропущено: ${skipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Фатальная ошибка revert-скрипта:', e);
  process.exit(1);
});
