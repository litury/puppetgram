import prompts from "prompts";
import { ConvertedSessionLoader } from "../../app/messageListener/services/convertedSessionLoader";
import { MessageListenerService } from "../../app/messageListener/services/messageListenerService";
import { IListenerConfig } from "../../app/messageListener/interfaces/listenerConfig.interface";

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Прослушивание входящих сообщений Telegram");
  console.log("═══════════════════════════════════════════════════════\n");

  const sessionLoader = new ConvertedSessionLoader();

  // Загружаем доступные сессии
  console.log("Загрузка сконвертированных сессий...\n");
  const sessions = await sessionLoader.getAvailableSessions();

  if (sessions.length === 0) {
    console.log("❌ Сконвертированные сессии не найдены");
    console.log("\nСначала выполните конвертацию:");
    console.log("  npm run session:convert-sqlite");
    console.log("\nЭто создаст StringSession из ваших SQLite .session файлов\n");
    return;
  }

  console.log(`✓ Найдено сессий: ${sessions.length}\n`);
  console.log("Доступные аккаунты:");
  console.log("─────────────────────────────────────────────────────");

  sessions.forEach((session, index) => {
    console.log(sessionLoader.formatSessionInfo(session, index));
  });

  console.log("─────────────────────────────────────────────────────\n");

  // Выбор аккаунта
  const accountResponse = await prompts({
    type: "select",
    name: "index",
    message: "Выберите аккаунт:",
    choices: sessions.map((session, index) => ({
      title: sessionLoader.formatSessionInfo(session, index),
      value: index,
    })),
  });

  if (accountResponse.index === undefined) {
    console.log("Отменено");
    return;
  }

  const selectedSession = sessions[accountResponse.index];

  // Настройка фильтров
  const filterResponse = await prompts([
    {
      type: "select",
      name: "messageType",
      message: "Какие сообщения слушать?",
      choices: [
        { title: "Только личные (private)", value: "private" },
        { title: "Только группы", value: "groups" },
        { title: "Только каналы", value: "channels" },
        { title: "Все типы", value: "all" },
      ],
      initial: 0,
    },
  ]);

  if (!filterResponse.messageType) {
    console.log("Отменено");
    return;
  }

  // Формируем конфигурацию
  const config: IListenerConfig = {
    privateOnly: filterResponse.messageType === "private",
    groupsOnly: filterResponse.messageType === "groups",
    channelsOnly: filterResponse.messageType === "channels",
    incomingOnly: true,
  };

  // Если выбрано "все типы", убираем фильтры
  if (filterResponse.messageType === "all") {
    config.privateOnly = false;
    config.groupsOnly = false;
    config.channelsOnly = false;
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Запуск прослушивания");
  console.log("═══════════════════════════════════════════════════════");

  try {
    // Создаем сервис
    const listener = new MessageListenerService(config);

    // Подключаемся
    await listener.connect(selectedSession);

    // Начинаем прослушивание
    await listener.startListening();
  } catch (error: any) {
    console.error("\n❌ Ошибка:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Критическая ошибка:", error.message);
  process.exit(1);
});
