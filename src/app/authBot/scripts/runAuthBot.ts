/**
 * Скрипт запуска Auth Bot
 *
 * Запуск: npx tsx src/app/authBot/scripts/runAuthBot.ts
 *
 * Требуемые переменные окружения:
 * - AUTH_BOT_TOKEN: токен бота от @BotFather
 * - WS_SERVER_URL: URL ws-server (по умолчанию http://localhost:4000)
 * - AUTH_BOT_SECRET: секретный ключ для подтверждения авторизации
 */

import { AuthBotService } from '../services/authBotService';
import { config } from 'dotenv';

// Загружаем .env
config();

async function main() {
  console.log('============================================');
  console.log('  Puppetgram Auth Bot');
  console.log('============================================');
  console.log('');

  // Проверяем переменные окружения
  if (!process.env.AUTH_BOT_TOKEN) {
    console.error('❌ AUTH_BOT_TOKEN не указан в .env');
    console.error('   Получите токен у @BotFather и добавьте в .env:');
    console.error('   AUTH_BOT_TOKEN=your_bot_token_here');
    process.exit(1);
  }

  try {
    const bot = new AuthBotService();
    await bot.start();

    // Обработка остановки
    process.on('SIGINT', () => {
      console.log('\nОстановка бота...');
      bot.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      bot.stop();
      process.exit(0);
    });
  } catch (error: any) {
    console.error('❌ Ошибка запуска бота:', error.message);
    process.exit(1);
  }
}

main();
