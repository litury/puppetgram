/**
 * Настройка профиля @puppetgram_auth_bot через Telegram Bot API
 *
 * Запуск: bun run src/app/authBot/setup-bot-profile.ts
 *
 * Устанавливает:
 * - Имя бота
 * - Описание (при первом открытии)
 * - About (в профиле)
 * - Команды меню
 *
 * Аватар нужно загрузить вручную через @BotFather
 */

const BOT_TOKEN = process.env.AUTH_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ AUTH_BOT_TOKEN не найден в .env');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

interface ApiResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

async function callApi(method: string, params: Record<string, unknown>): Promise<ApiResponse> {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

async function setupBotProfile() {
  console.log('Настройка профиля @puppetgram_auth_bot...\n');

  // 1. Имя бота
  console.log('[1/4] Имя бота...');
  const nameResult = await callApi('setMyName', {
    name: 'Puppetgram Auth',
  });
  console.log(nameResult.ok ? '      OK: Puppetgram Auth' : `      FAIL: ${nameResult.description}`);

  // 2. Описание (512 символов) - показывается при первом открытии бота
  console.log('[2/4] Description...');
  const description = `Авторизация в Puppetgram Dashboard

Подтверждает вашу личность для доступа к приватным данным комментирования.

- Данные не хранятся
- Один клик для входа
- Сессия активна 30 дней

Нажмите Start для авторизации.`;

  const descResult = await callApi('setMyDescription', { description });
  console.log(descResult.ok ? `      OK: ${description.length}/512 символов` : `      FAIL: ${descResult.description}`);

  // 3. About (120 символов) - показывается в профиле и при шаринге
  console.log('[3/4] About...');
  const shortDescription = 'Безопасная авторизация в Puppetgram Dashboard через Telegram.';

  const aboutResult = await callApi('setMyShortDescription', {
    short_description: shortDescription,
  });
  console.log(aboutResult.ok ? `      OK: ${shortDescription.length}/120 символов` : `      FAIL: ${aboutResult.description}`);

  // 4. Команды меню
  console.log('[4/4] Команды...');
  const commands = [
    { command: 'start', description: 'Начать авторизацию' },
    { command: 'help', description: 'Справка' },
  ];

  const cmdResult = await callApi('setMyCommands', { commands });
  if (cmdResult.ok) {
    console.log('      OK:');
    commands.forEach(cmd => console.log(`         /${cmd.command} - ${cmd.description}`));
  } else {
    console.log(`      FAIL: ${cmdResult.description}`);
  }

  // Финальное сообщение
  console.log('\n' + '-'.repeat(50));
  console.log('Настройка завершена.\n');
  console.log('Аватар загрузить вручную через @BotFather:');
  console.log('  /mybots > @puppetgram_auth_bot > Edit Botpic');
  console.log('  Загрузить assets/bot-avatar-lock-512.png как фото\n');
  console.log('Проверить: https://t.me/puppetgram_auth_bot');
}

setupBotProfile().catch(console.error);
