import * as fs from "fs";
import * as path from "path";
import { IConvertedSessionData } from "../interfaces/listenerConfig.interface";

/**
 * Сервис для загрузки сконвертированных сессий
 */
export class ConvertedSessionLoader {
  private outputDirectory: string;

  constructor(outputDirectory: string = "exports/session-converted") {
    this.outputDirectory = outputDirectory;
  }

  /**
   * Получает список всех сконвертированных сессий
   */
  async getAvailableSessions(): Promise<IConvertedSessionData[]> {
    if (!fs.existsSync(this.outputDirectory)) {
      return [];
    }

    const files = fs.readdirSync(this.outputDirectory);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    const sessions: IConvertedSessionData[] = [];

    for (const jsonFile of jsonFiles) {
      const jsonPath = path.join(this.outputDirectory, jsonFile);
      const sessionFileName = jsonFile.replace(".json", ".session");
      const sessionPath = path.join(this.outputDirectory, sessionFileName);

      // Проверяем наличие парного .session файла
      if (fs.existsSync(sessionPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

          // Читаем StringSession из файла
          const sessionString = fs.readFileSync(sessionPath, "utf-8").trim();

          sessions.push({
            phone: metadata.phone,
            username: metadata.username || null,
            firstName: metadata.firstName,
            userId: metadata.userId || null,
            sessionString,
            app_id: metadata.app_id,
            app_hash: metadata.app_hash,
            convertedAt: metadata.convertedAt,
            sessionFilePath: sessionPath,
            jsonFilePath: jsonPath,
          });
        } catch (error) {
          console.warn(`Не удалось загрузить сессию из ${jsonPath}: ${error}`);
        }
      }
    }

    return sessions.sort((a, b) => {
      // Сортируем по дате конвертации (новые первые)
      return new Date(b.convertedAt).getTime() - new Date(a.convertedAt).getTime();
    });
  }

  /**
   * Загружает конкретную сессию по телефону
   */
  async loadSessionByPhone(phone: string): Promise<IConvertedSessionData | null> {
    const sessions = await this.getAvailableSessions();
    return sessions.find((s) => s.phone === phone) || null;
  }

  /**
   * Загружает сессию по индексу из списка
   */
  async loadSessionByIndex(index: number): Promise<IConvertedSessionData | null> {
    const sessions = await this.getAvailableSessions();
    return sessions[index] || null;
  }

  /**
   * Форматирует информацию о сессии для отображения
   */
  formatSessionInfo(session: IConvertedSessionData, index: number): string {
    const phone = session.phone || "N/A";
    const username = session.username ? `@${session.username}` : "";
    const firstName = session.firstName || "";
    const convertedDate = new Date(session.convertedAt).toLocaleDateString("ru-RU");

    let info = `${index + 1}. ${phone}`;

    if (firstName && firstName !== phone) {
      info += ` (${firstName})`;
    }

    if (username) {
      info += ` ${username}`;
    }

    info += ` - конвертирован ${convertedDate}`;

    return info;
  }
}
