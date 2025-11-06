import * as fs from "fs";
import * as path from "path";
import { ISessionMetadata } from "../interfaces/sqliteSessionInfo.interface";

/**
 * Адаптер для работы с файлами сессий
 */
export class SessionFileAdapter {
  /**
   * Читает JSON файл с метаданными сессии
   */
  static readSessionMetadata(jsonPath: string): ISessionMetadata {
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`JSON файл не найден: ${jsonPath}`);
    }

    const content = fs.readFileSync(jsonPath, "utf-8");
    return JSON.parse(content) as ISessionMetadata;
  }

  /**
   * Проверяет существование .session файла
   */
  static sessionFileExists(sessionPath: string): boolean {
    return fs.existsSync(sessionPath);
  }

  /**
   * Сохраняет StringSession в текстовый файл
   */
  static saveSessionString(
    sessionString: string,
    outputPath: string
  ): void {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, sessionString, "utf-8");
  }

  /**
   * Сохраняет метаданные сконвертированной сессии
   */
  static saveConvertedMetadata(
    metadata: any,
    outputPath: string
  ): void {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(metadata, null, 2), "utf-8");
  }

  /**
   * Генерирует имя файла из номера телефона
   */
  static generateFileName(phone: string): string {
    // Заменяем пробелы и + на подчеркивания
    return phone.replace(/[\s+]/g, "_");
  }

  /**
   * Читает StringSession из файла
   */
  static readSessionString(sessionPath: string): string {
    if (!fs.existsSync(sessionPath)) {
      throw new Error(`Session файл не найден: ${sessionPath}`);
    }

    return fs.readFileSync(sessionPath, "utf-8").trim();
  }
}
