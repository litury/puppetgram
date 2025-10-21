import { GramClient } from "./telegram/adapters/gramClient";

import {
  SessionGeneratorService,
  InteractiveAuthAdapter,
  SessionStorageAdapter,
  SessionResultAdapter,
  ISessionGenerationOptions
} from "./modules/sessionGenerator";
import prompts from "prompts";

async function main() {
  const gramClient = new GramClient();

  try {
    await gramClient.connect();
    console.log("\n=== Управление сессиями Telegram ===\n");
    console.log("ℹ️  Для анализа каналов используйте: npm run parse-channel");
    console.log("ℹ️  Для других функций смотрите доступные команды в конце файла\n");

    // Только генерация сессий
    await handleSessionGeneration();

  } catch (error) {
    console.error("\nПроизошла ошибка:", error);
  } finally {
    await gramClient.disconnect();
    console.log("\nРабота программы завершена");
  }
}

async function handleSessionGeneration() {
  console.log("\n🔐 === УПРАВЛЕНИЕ СЕССИЯМИ TELEGRAM ===\n");

  try {
    // Проверяем наличие API_ID и API_HASH
    const apiId = Number(process.env.API_ID);
    const apiHash = process.env.API_HASH;

    if (!apiId || !apiHash) {
      console.error("❌ Ошибка: API_ID и API_HASH должны быть указаны в .env файле");
      console.log("\n💡 Инструкции:");
      console.log("1. Получите API_ID и API_HASH на https://my.telegram.org");
      console.log("2. Добавьте их в .env файл:");
      console.log("   API_ID=ваш_api_id");
      console.log("   API_HASH=ваш_api_hash");
      return;
    }

    // Создаем адаптеры и сервисы
    const authAdapter = new InteractiveAuthAdapter();
    const storageAdapter = new SessionStorageAdapter();
    const sessionGenerator = new SessionGeneratorService(authAdapter);

    // Показываем меню действий
    const actionResponse = await prompts({
      type: 'select',
      name: 'action',
      message: 'Выберите действие:',
      choices: [
        { title: '🆕 Создать новую сессию', value: 'generate' },
        { title: '📋 Просмотреть сохраненные сессии', value: 'list' },
        { title: '🔍 Проверить сессию', value: 'validate' },
        { title: '🗑️ Удалить сессию', value: 'delete' }
      ],
      initial: 0
    });

    if (!actionResponse.action) {
      console.log("Операция отменена");
      return;
    }

    switch (actionResponse.action) {
      case 'generate':
        await handleGenerateSessionInMain(sessionGenerator, storageAdapter, apiId, apiHash);
        break;
      case 'list':
        await handleListSessionsInMain(storageAdapter);
        break;
      case 'validate':
        await handleValidateSessionInMain(sessionGenerator, storageAdapter);
        break;
      case 'delete':
        await handleDeleteSessionInMain(storageAdapter);
        break;
    }

  } catch (error) {
    console.error(SessionResultAdapter.formatError(error as Error));
  }
}

/**
 * Обработка генерации новой сессии в главном приложении
 */
async function handleGenerateSessionInMain(
  sessionGenerator: SessionGeneratorService,
  storageAdapter: SessionStorageAdapter,
  apiId: number,
  apiHash: string
) {
  try {
    console.log("\n🚀 Начинается процесс создания сессии...");
    console.log("📝 Подготовьте ваш телефон для получения кода подтверждения\n");

    const options: ISessionGenerationOptions = {
      apiId,
      apiHash,
      deviceModel: "Desktop",
      systemVersion: "Windows 10",
      appVersion: "1.0.0",
      connectionRetries: 5,
      timeout: 30000
    };

    // Генерируем сессию
    const result = await sessionGenerator.generateSession(options);

    // Отображаем результат
    console.log(SessionResultAdapter.formatGenerationResult(result));

    // Предлагаем сохранить сессию
    const saveResponse = await prompts({
      type: 'confirm',
      name: 'save',
      message: 'Сохранить сессию в файл?',
      initial: true
    });

    if (saveResponse.save) {
      const filename = await storageAdapter.saveSession(result);
      console.log(`\n💾 Сессия сохранена в файл: ${filename}`);

      const storageInfo = storageAdapter.getStorageInfo();
      console.log(`📁 Директория: ${storageInfo.directory}`);
    }

    // Показываем инструкции по использованию
    console.log(SessionResultAdapter.formatUsageInstructions(result.sessionString));

  } catch (error) {
    console.error(SessionResultAdapter.formatError(error as Error));
  }
}

/**
 * Обработка просмотра сохраненных сессий в главном приложении
 */
async function handleListSessionsInMain(storageAdapter: SessionStorageAdapter) {
  try {
    const sessions = await storageAdapter.listSessions();
    console.log(SessionResultAdapter.formatSessionsList(sessions));

    if (sessions.length > 0) {
      const storageInfo = storageAdapter.getStorageInfo();
      console.log(`\n📁 Директория: ${storageInfo.directory}`);
      console.log(`📊 Всего сессий: ${storageInfo.totalSessions}`);
    }
  } catch (error) {
    console.error(`❌ Ошибка получения списка сессий: ${error}`);
  }
}

/**
 * Обработка валидации сессии в главном приложении
 */
async function handleValidateSessionInMain(
  sessionGenerator: SessionGeneratorService,
  storageAdapter: SessionStorageAdapter
) {
  try {
    const validationResponse = await prompts({
      type: 'select',
      name: 'source',
      message: 'Откуда взять сессию для проверки?',
      choices: [
        { title: '📝 Ввести SESSION_STRING вручную', value: 'manual' },
        { title: '📂 Выбрать из сохраненных файлов', value: 'file' }
      ]
    });

    let sessionString = '';

    if (validationResponse.source === 'manual') {
      const inputResponse = await prompts({
        type: 'text',
        name: 'sessionString',
        message: 'Введите SESSION_STRING:',
        validate: (value: string) => value.trim().length > 0 ? true : 'SESSION_STRING не может быть пустым'
      });

      if (!inputResponse.sessionString) {
        console.log("Операция отменена");
        return;
      }

      sessionString = inputResponse.sessionString.trim();
    } else {
      const sessions = await storageAdapter.listSessions();

      if (sessions.length === 0) {
        console.log("❌ Сохраненные сессии не найдены");
        return;
      }

      const fileResponse = await prompts({
        type: 'select',
        name: 'filename',
        message: 'Выберите файл сессии:',
        choices: sessions.map(session => ({ title: session, value: session }))
      });

      if (!fileResponse.filename) {
        console.log("Операция отменена");
        return;
      }

      const sessionData = await storageAdapter.loadSession(fileResponse.filename);
      sessionString = sessionData.sessionString;
    }

    console.log("\n🔍 Проверка сессии...");

    const isValid = await sessionGenerator.validateExistingSession(sessionString);

    if (isValid) {
      console.log("✅ Сессия действительна");

      try {
        const sessionInfo = await sessionGenerator.getSessionInfo(sessionString);
        console.log(SessionResultAdapter.formatSessionInfo(sessionInfo));
      } catch (error) {
        console.log("⚠️  Не удалось получить подробную информацию о сессии");
      }
    } else {
      console.log("❌ Сессия недействительна или истекла");
    }

  } catch (error) {
    console.error(`❌ Ошибка валидации сессии: ${error}`);
  }
}

/**
 * Обработка удаления сессии в главном приложении
 */
async function handleDeleteSessionInMain(storageAdapter: SessionStorageAdapter) {
  try {
    const sessions = await storageAdapter.listSessions();

    if (sessions.length === 0) {
      console.log("❌ Сохраненные сессии не найдены");
      return;
    }

    const choices = [
      ...sessions.map(session => ({ title: session, value: session })),
      { title: '🗑️ Удалить все сессии', value: 'all' }
    ];

    const deleteResponse = await prompts({
      type: 'select',
      name: 'target',
      message: 'Что удалить?',
      choices
    });

    if (!deleteResponse.target) {
      console.log("Операция отменена");
      return;
    }

    if (deleteResponse.target === 'all') {
      const confirmResponse = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: '⚠️  Вы уверены, что хотите удалить ВСЕ сессии?',
        initial: false
      });

      if (confirmResponse.confirm) {
        const deletedCount = await storageAdapter.clearAllSessions();
        console.log(`✅ Удалено сессий: ${deletedCount}`);
      } else {
        console.log("Операция отменена");
      }
    } else {
      const confirmResponse = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: `Удалить сессию ${deleteResponse.target}?`,
        initial: false
      });

      if (confirmResponse.confirm) {
        const success = await storageAdapter.deleteSession(deleteResponse.target);
        if (success) {
          console.log(`✅ Сессия ${deleteResponse.target} удалена`);
        } else {
          console.log(`❌ Не удалось удалить сессию ${deleteResponse.target}`);
        }
      } else {
        console.log("Операция отменена");
      }
    }

  } catch (error) {
    console.error(`❌ Ошибка удаления сессии: ${error}`);
  }
}



// Запуск приложения
main().catch((error) => {
  console.error("Критическая ошибка:", error);
  process.exit(1);
});

/**
 * ДОСТУПНЫЕ МОДУЛИ:
 * 
 * npm start                - Управление сессиями Telegram
 * npm run parse-channel    - Полный парсинг канала с медиа и ссылками
 * npm run check-comments   - Проверка комментариев в каналах
 * npm run post-comments    - Автоматическое комментирование
 * npm run join-channels    - Автоматическое вступление в каналы
 * npm run analyze-posts    - Анализ топ постов каналов
 * npm run generate-session - Генерация сессий Telegram
 * npm run auth             - Авторизация в Telegram
 * npm run schedule-twitter - Планирование постов в Twitter
 * npm run parse-similar    - Парсинг похожих каналов
 */
