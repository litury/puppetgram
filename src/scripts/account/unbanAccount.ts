/**
 * Скрипт ручного снятия spam-бана аккаунта.
 *
 * Используется после того как ты подал appeal через @SpamBot в Telegram
 * (зашёл в аккаунт, /start @SpamBot, нажал кнопку «Это ошибка», заполнил форму)
 * и Telegram снял ограничение.
 *
 * Запуск:
 *   npm run account:unban -- --name=test65479 [--notes="Appeal принят 23.06"]
 *   npm run account:unban -- --list                    # показать список активных банов
 *   npm run account:unban -- --all                     # снять все активные баны
 */

import * as dotenv from 'dotenv';
import { AccountBansRepository } from '../../shared/database';

dotenv.config();

function parseArgs(): { name?: string; notes?: string; list?: boolean; all?: boolean } {
  const args = process.argv.slice(2);
  const result: { name?: string; notes?: string; list?: boolean; all?: boolean } = {};
  for (const arg of args) {
    if (arg.startsWith('--name=')) result.name = arg.slice(7);
    else if (arg.startsWith('--notes=')) result.notes = arg.slice(8);
    else if (arg === '--list') result.list = true;
    else if (arg === '--all') result.all = true;
  }
  return result;
}

async function main() {
  const { name, notes, list, all } = parseArgs();
  const repo = new AccountBansRepository();

  if (list) {
    const active = await repo.getActiveBans();
    if (active.length === 0) {
      console.log('✅ Активных банов нет');
      return;
    }
    console.log(`📋 Активных банов: ${active.length}\n`);
    for (const ban of active) {
      console.log(`  • ${ban.accountName}`);
      console.log(`    бан с: ${ban.bannedAt?.toISOString()}`);
      if (ban.banReason) console.log(`    причина: ${ban.banReason}`);
      console.log('');
    }
    return;
  }

  if (all) {
    const active = await repo.getActiveBans();
    if (active.length === 0) {
      console.log('✅ Активных банов нет, нечего снимать');
      return;
    }
    console.log(`🔓 Снимаем ${active.length} банов...`);
    for (const ban of active) {
      await repo.unban(ban.accountName, notes || 'Снято через --all');
      console.log(`  ✅ ${ban.accountName} разбанен`);
    }
    return;
  }

  if (!name) {
    console.error('❌ Не указан --name=<account_name>');
    console.error('');
    console.error('Примеры:');
    console.error('  npm run account:unban -- --name=test65479');
    console.error('  npm run account:unban -- --name=test65479 --notes="Appeal принят"');
    console.error('  npm run account:unban -- --list');
    console.error('  npm run account:unban -- --all');
    process.exit(1);
  }

  const existing = await repo.getByAccountName(name);
  if (!existing) {
    console.log(`⚠️  Аккаунт ${name} не найден в account_bans (никогда не был забанен)`);
    return;
  }

  if (existing.unbannedAt) {
    console.log(`ℹ️  Аккаунт ${name} уже разбанен (${existing.unbannedAt.toISOString()})`);
    return;
  }

  await repo.unban(name, notes);
  console.log(`✅ Аккаунт ${name} помечен как разбаненный`);
  console.log('   Бот при следующем рестарте снова попробует этот аккаунт.');
}

main()
  .catch(error => {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  })
  .finally(() => process.exit(0));
