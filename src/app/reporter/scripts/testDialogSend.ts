/**
 * Тестовый скрипт отправки сообщения через диалоги
 * Использует REPORTER_SESSION_KEY и REPORT_RECIPIENT из .env
 *
 * npm run test:dialog-send -- pravku
 * npm run test:dialog-send  (возьмёт REPORT_RECIPIENT)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { GramClient } from '../../../telegram/adapters/gramClient';
import { Api } from 'telegram';
import { createLogger } from '../../../shared/utils/logger';

const log = createLogger('TestDialogSend');

async function main() {
  // Получаем username из аргумента или из .env
  const defaultRecipient = process.env.REPORT_RECIPIENT?.replace('@', '').toLowerCase();
  const targetUsername = process.argv[2]?.replace('@', '').toLowerCase() || defaultRecipient;

  if (!targetUsername) {
    console.log('Использование: npm run test:dialog-send -- <username>');
    console.log('Или укажите REPORT_RECIPIENT в .env');
    process.exit(1);
  }

  // Используем сессию из REPORTER_SESSION_KEY
  const sessionKey = process.env.REPORTER_SESSION_KEY || 'SESSION_STRING_1';
  const sessionString = process.env[sessionKey];

  if (!sessionString) {
    log.error(`Session не найдена: ${sessionKey}`);
    process.exit(1);
  }

  log.info(`Использую сессию: ${sessionKey}`);
  log.info(`Ищу пользователя: @${targetUsername}`);

  // Подменяем SESSION_STRING для GramClient
  const originalSession = process.env.SESSION_STRING;
  process.env.SESSION_STRING = sessionString;

  const client = new GramClient();
  await client.connect();

  try {
    const dialogs = await client.getClient().getDialogs({ limit: 500 });
    log.info(`Получено диалогов: ${dialogs.length}`);

    let foundUser: { id: Api.User['id']; name: string } | null = null;

    for (const dialog of dialogs) {
      const entity = dialog.entity;
      if (entity?.className === 'User') {
        const user = entity as Api.User;
        if (user.username?.toLowerCase() === targetUsername) {
          foundUser = {
            id: user.id,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          };
          break;
        }
      }
    }

    if (!foundUser) {
      log.error(`Пользователь @${targetUsername} не найден в диалогах!`);
      log.info('Убедитесь что вы ранее писали этому пользователю.');
      process.exit(1);
    }

    log.info(`Найден: ${foundUser.name} (ID: ${foundUser.id})`);

    await client.getClient().sendMessage(foundUser.id.toJSNumber(), {
      message: 'Hello World! 🚀 Test message via dialog ID.',
    });

    log.info(`Сообщение отправлено @${targetUsername}!`);

  } finally {
    await client.disconnect();
    process.env.SESSION_STRING = originalSession;
  }
}

main().catch(console.error);
