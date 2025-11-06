import * as fs from "fs";
import * as path from "path";
import { ISessionAccountInfo, ISessionMetadata } from "../interfaces/sqliteSessionInfo.interface";
import { SessionFileAdapter } from "../adapters/sessionFileAdapter";

/**
 * Сканирует директорию /session/ на наличие аккаунтов
 */
export function scanSessionDirectory(sessionDir: string): ISessionAccountInfo[] {
  const accounts: ISessionAccountInfo[] = [];

  if (!fs.existsSync(sessionDir)) {
    return accounts;
  }

  const items = fs.readdirSync(sessionDir);

  for (const item of items) {
    const itemPath = path.join(sessionDir, item);
    const stat = fs.statSync(itemPath);

    // Проверяем только директории с числовыми именами (1, 2, 3, ...)
    if (stat.isDirectory() && /^\d+$/.test(item)) {
      const accountNumber = parseInt(item, 10);
      const files = fs.readdirSync(itemPath);

      // Ищем .json файлы
      const jsonFiles = files.filter((f) => f.endsWith(".json"));

      for (const jsonFile of jsonFiles) {
        const jsonPath = path.join(itemPath, jsonFile);
        const sessionFileName = jsonFile.replace(".json", ".session");
        const sessionPath = path.join(itemPath, sessionFileName);

        // Проверяем наличие парного .session файла
        if (SessionFileAdapter.sessionFileExists(sessionPath)) {
          try {
            const metadata = SessionFileAdapter.readSessionMetadata(jsonPath);

            accounts.push({
              accountNumber,
              phone: metadata.phone || metadata.session_file,
              username: metadata.username,
              firstName: metadata.first_name || metadata.phone || "Unknown",
              sessionPath,
              jsonPath,
              metadata,
            });
          } catch (error) {
            console.warn(`Не удалось прочитать метаданные из ${jsonPath}: ${error}`);
          }
        }
      }
    }
  }

  return accounts.sort((a, b) => a.accountNumber - b.accountNumber);
}

/**
 * Форматирует информацию об аккаунте для отображения
 */
export function formatAccountInfo(account: ISessionAccountInfo): string {
  const phone = account.phone || "N/A";
  const username = account.username ? `@${account.username}` : "";
  const firstName = account.firstName || "";

  let info = `${account.accountNumber}. ${phone}`;

  if (firstName && firstName !== phone) {
    info += ` (${firstName})`;
  }

  if (username) {
    info += ` ${username}`;
  }

  // Пометка для неполных аккаунтов
  if (!account.metadata.phone || !account.metadata.first_name) {
    info += " [неполный]";
  }

  return info;
}

/**
 * Проверяет, валиден ли аккаунт для конвертации
 */
export function isAccountValid(account: ISessionAccountInfo): { valid: boolean; reason?: string } {
  if (!account.metadata.app_id || !account.metadata.app_hash) {
    return { valid: false, reason: "Отсутствуют app_id или app_hash" };
  }

  if (!SessionFileAdapter.sessionFileExists(account.sessionPath)) {
    return { valid: false, reason: ".session файл не найден" };
  }

  return { valid: true };
}
