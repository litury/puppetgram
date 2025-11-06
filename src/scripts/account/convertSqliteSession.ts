import prompts from "prompts";
import { SqliteSessionConverterService } from "../../app/sessionConverter/services/sqliteSessionConverterService";
import { formatAccountInfo, isAccountValid } from "../../app/sessionConverter/parts/sqliteSessionHelpers";
import { ISessionAccountInfo } from "../../app/sessionConverter/interfaces/sqliteSessionInfo.interface";
import { ISqliteSessionConversionRequest } from "../../app/sessionConverter/interfaces/sqliteSessionConversion.interface";

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Конвертер SQLite Session → StringSession");
  console.log("═══════════════════════════════════════════════════════\n");

  const converter = new SqliteSessionConverterService();

  // Получаем список доступных аккаунтов
  console.log("Сканирование директории /session/...\n");
  const accounts = await converter.getAvailableAccounts();

  if (accounts.length === 0) {
    console.log("❌ Аккаунты не найдены в директории /session/");
    console.log("Убедитесь, что файлы находятся в подпапках: /session/1/, /session/2/, и т.д.");
    return;
  }

  console.log(`✓ Найдено аккаунтов: ${accounts.length}\n`);
  console.log("Доступные аккаунты:");
  console.log("─────────────────────────────────────────────────────");

  accounts.forEach((account) => {
    const validation = isAccountValid(account);
    const statusIcon = validation.valid ? "✓" : "✗";
    const info = formatAccountInfo(account);
    console.log(`${statusIcon} ${info}`);
    if (!validation.valid) {
      console.log(`  └─ Ошибка: ${validation.reason}`);
    }
  });

  console.log("─────────────────────────────────────────────────────\n");

  // Фильтруем только валидные аккаунты
  const validAccounts = accounts.filter((acc) => isAccountValid(acc).valid);

  if (validAccounts.length === 0) {
    console.log("❌ Нет валидных аккаунтов для конвертации");
    return;
  }

  // Выбор действия
  const actionResponse = await prompts({
    type: "select",
    name: "action",
    message: "Выберите действие:",
    choices: [
      { title: "Конвертировать один аккаунт", value: "single" },
      { title: "Конвертировать все аккаунты", value: "all" },
      { title: "Выход", value: "exit" },
    ],
  });

  if (actionResponse.action === "exit" || !actionResponse.action) {
    console.log("Выход...");
    return;
  }

  let selectedAccounts: ISessionAccountInfo[] = [];

  if (actionResponse.action === "single") {
    // Выбор конкретного аккаунта
    const accountResponse = await prompts({
      type: "select",
      name: "accountNumber",
      message: "Выберите аккаунт:",
      choices: validAccounts.map((acc) => ({
        title: formatAccountInfo(acc),
        value: acc.accountNumber,
      })),
    });

    if (!accountResponse.accountNumber) {
      console.log("Отменено");
      return;
    }

    const selectedAccount = validAccounts.find(
      (acc) => acc.accountNumber === accountResponse.accountNumber
    );

    if (selectedAccount) {
      selectedAccounts = [selectedAccount];
    }
  } else {
    selectedAccounts = validAccounts;
  }

  // Запрос 2FA пароля
  const twoFAResponse = await prompts({
    type: "text",
    name: "password",
    message: "Введите 2FA пароль (оставьте пустым, если нет):",
    initial: "",
  });

  const twoFAPassword = twoFAResponse.password || undefined;

  // Подтверждение
  console.log(`\n✓ Будет сконвертировано аккаунтов: ${selectedAccounts.length}`);

  const confirmResponse = await prompts({
    type: "confirm",
    name: "confirm",
    message: "Начать конвертацию?",
    initial: true,
  });

  if (!confirmResponse.confirm) {
    console.log("Отменено");
    return;
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Начало конвертации");
  console.log("═══════════════════════════════════════════════════════\n");

  // Конвертация
  const results = await converter.convertMultipleAccounts(
    selectedAccounts,
    twoFAPassword
  );

  // Статистика
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Результаты конвертации");
  console.log("═══════════════════════════════════════════════════════\n");

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  console.log(`✓ Успешно: ${successCount}`);
  console.log(`✗ Ошибок: ${failCount}\n`);

  if (successCount > 0) {
    console.log("Сконвертированные сессии:");
    console.log("─────────────────────────────────────────────────────");
    results.forEach((result) => {
      if (result.success) {
        console.log(`✓ ${result.phone || "Unknown"}`);
        console.log(`  Username: ${result.username || "N/A"}`);
        console.log(`  User ID: ${result.userId || "N/A"}`);
        console.log(`  Session: ${result.sessionFilePath}`);
        console.log(`  JSON: ${result.jsonFilePath}\n`);
      }
    });
  }

  if (failCount > 0) {
    console.log("Ошибки:");
    console.log("─────────────────────────────────────────────────────");
    results.forEach((result) => {
      if (!result.success) {
        console.log(`✗ Ошибка: ${result.error}\n`);
      }
    });
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Конвертация завершена");
  console.log("═══════════════════════════════════════════════════════");
}

main().catch((error) => {
  console.error("\n❌ Критическая ошибка:", error.message);
  process.exit(1);
});
