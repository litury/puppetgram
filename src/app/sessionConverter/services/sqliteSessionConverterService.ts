import { TelegramClient } from "telegram";
import { StoreSession, StringSession } from "telegram/sessions";
import { Logger } from "telegram/extensions";
import * as path from "path";
import * as fs from "fs";
import {
  ISqliteSessionConversionRequest,
  ISqliteSessionConversionResult,
  ISqliteSessionConverterOptions,
} from "../interfaces/sqliteSessionConversion.interface";
import { IConvertedSessionInfo, ISessionAccountInfo } from "../interfaces/sqliteSessionInfo.interface";
import { SessionFileAdapter } from "../adapters/sessionFileAdapter";
import { scanSessionDirectory } from "../parts/sqliteSessionHelpers";

// @ts-ignore - fdy-convertor не имеет типов
import FdyConvertor from "fdy-convertor";

/**
 * Сервис для конвертации SQLite сессий в StringSession
 */
export class SqliteSessionConverterService {
  private options: ISqliteSessionConverterOptions;

  constructor(options?: Partial<ISqliteSessionConverterOptions>) {
    this.options = {
      outputDirectory: options?.outputDirectory || "exports/session-converted",
      sessionDirectory: options?.sessionDirectory || "session",
    };
  }

  /**
   * Сканирует директорию сессий и возвращает список доступных аккаунтов
   */
  async getAvailableAccounts(): Promise<ISessionAccountInfo[]> {
    return scanSessionDirectory(this.options.sessionDirectory);
  }

  /**
   * Конвертирует Telethon/Pyrogram сессию через fdy-convertor
   */
  private async convertWithFdyConvertor(
    request: ISqliteSessionConversionRequest,
    metadata: any
  ): Promise<string | null> {
    try {
      console.log("\n🔄 Попытка конвертации через fdy-convertor (Telethon/Pyrogram → GramJS)...");

      const sessionDir = path.dirname(request.sessionPath);
      const sessionFileName = path.basename(request.sessionPath);

      // Создаем временную директорию для входных файлов
      const tempInputDir = path.join(sessionDir, "temp_input");
      if (!fs.existsSync(tempInputDir)) {
        fs.mkdirSync(tempInputDir, { recursive: true });
      }

      // Создаем временную директорию для выходных файлов
      const tempOutputDir = path.join(sessionDir, "temp_output");
      if (!fs.existsSync(tempOutputDir)) {
        fs.mkdirSync(tempOutputDir, { recursive: true });
      }

      // Копируем .session файл во временную входную директорию
      const tempSessionPath = path.join(tempInputDir, sessionFileName);
      fs.copyFileSync(request.sessionPath, tempSessionPath);

      // Используем fdy-convertor с savePath
      const converter = new FdyConvertor({
        path: tempInputDir,
        savePath: tempOutputDir,
        fileExt: "session",
        prefix: ""
      });

      await converter.convert();
      const result = converter.save({
        apiId: metadata.app_id.toString(),
        apiHash: metadata.app_hash
      });

      console.log("📊 Результат fdy-convertor:");
      console.log("  Сконвертированные файлы:", result?.new);

      // Проверяем, что конвертация прошла успешно
      if (result && result.new && result.new.length > 0) {
        // fdy-convertor сохраняет файлы в tempOutputDir
        // Нужно прочитать сконвертированный .session файл
        const convertedFileName = result.new[0];
        const convertedFilePath = path.join(tempOutputDir, convertedFileName);

        console.log(`  Путь к сконвертированному файлу: ${convertedFilePath}`);

        if (fs.existsSync(convertedFilePath)) {
          // Читаем содержимое файла
          const fileContent = fs.readFileSync(convertedFilePath, "utf-8").trim();

          // Удаляем временные директории
          fs.rmSync(tempInputDir, { recursive: true, force: true });
          fs.rmSync(tempOutputDir, { recursive: true, force: true });

          try {
            // fdy-convertor сохраняет JSON с полями: apiId, apiHash, sessionString
            const parsed = JSON.parse(fileContent);

            if (parsed.sessionString && typeof parsed.sessionString === "string") {
              console.log("✓ Успешно сконвертировано через fdy-convertor!");
              console.log(`  StringSession длина: ${parsed.sessionString.length} символов`);
              return parsed.sessionString;
            } else {
              console.log("✗ JSON не содержит поле 'sessionString'");
              console.log("  Структура:", Object.keys(parsed));
            }
          } catch (parseError) {
            // Возможно, это не JSON, а чистый StringSession
            console.log("⚠ Не удалось распарсить как JSON, пробуем использовать как есть");
            if (fileContent && fileContent.length > 0) {
              console.log("✓ Успешно сконвертировано через fdy-convertor!");
              console.log(`  StringSession длина: ${fileContent.length} символов`);
              return fileContent;
            }
          }
        } else {
          console.log(`✗ Сконвертированный файл не найден: ${convertedFilePath}`);
        }
      }

      // Удаляем временные директории в случае неудачи
      fs.rmSync(tempInputDir, { recursive: true, force: true });
      fs.rmSync(tempOutputDir, { recursive: true, force: true });

      console.log("⚠ fdy-convertor не смог сконвертировать файл");
      return null;
    } catch (error: any) {
      console.error(`✗ Ошибка fdy-convertor: ${error.message}`);
      return null;
    }
  }

  /**
   * Конвертирует SQLite сессию в StringSession
   */
  async convertToStringSession(
    request: ISqliteSessionConversionRequest
  ): Promise<ISqliteSessionConversionResult> {
    try {
      // Читаем метаданные
      const metadata = SessionFileAdapter.readSessionMetadata(request.jsonPath);

      if (!metadata.app_id || !metadata.app_hash) {
        return {
          success: false,
          error: "В метаданных отсутствуют app_id или app_hash",
        };
      }

      // Проверяем существование .session файла
      if (!SessionFileAdapter.sessionFileExists(request.sessionPath)) {
        return {
          success: false,
          error: `.session файл не найден: ${request.sessionPath}`,
        };
      }

      // ПОПЫТКА 1: Пробуем fdy-convertor (для Telethon/Pyrogram сессий)
      const fdySessionString = await this.convertWithFdyConvertor(request, metadata);

      if (fdySessionString) {
        // Успешно сконвертировали через fdy-convertor
        console.log("✓ Использован StringSession из fdy-convertor");

        // Логирование для отладки
        console.log("\n📋 Анализ StringSession:");
        console.log(`  Длина: ${fdySessionString.length}`);
        console.log(`  Первые 50 символов: ${fdySessionString.substring(0, 50)}`);
        console.log(`  Последние 50 символов: ${fdySessionString.substring(fdySessionString.length - 50)}`);
        console.log(`  Содержит переносы строк: ${fdySessionString.includes('\n')}`);
        console.log(`  Содержит пробелы: ${fdySessionString.includes(' ')}`);

        // Генерируем имена файлов для сохранения
        const phone = metadata.phone || metadata.session_file || `account_${request.accountNumber}`;
        const fileName = SessionFileAdapter.generateFileName(phone);
        const outputDir = request.outputDirectory || this.options.outputDirectory;

        const sessionFilePath = path.join(outputDir, `${fileName}.session`);
        const jsonFilePath = path.join(outputDir, `${fileName}.json`);

        // Сохраняем StringSession
        SessionFileAdapter.saveSessionString(fdySessionString, sessionFilePath);

        // Проверяем сессию через подключение
        console.log("\nПроверка сконвертированной сессии...");
        const stringSession = new StringSession(fdySessionString);
        const logger = new Logger("none" as any);
        const client = new TelegramClient(stringSession, metadata.app_id, metadata.app_hash, {
          connectionRetries: 3,
          baseLogger: logger,
        });

        try {
          await client.connect();
          const me = await client.getMe();
          await client.disconnect();

          console.log(`✓ Сессия валидна! Аккаунт: ${me.firstName || metadata.first_name}`);

          // Сохраняем метаданные
          const convertedInfo: IConvertedSessionInfo = {
            phone: metadata.phone || phone,
            username: me.username || null,
            firstName: me.firstName || metadata.first_name,
            userId: me.id?.toJSNumber() || null,
            sessionString: fdySessionString,
            convertedAt: new Date().toISOString(),
            sessionFilePath,
            jsonFilePath,
          };

          SessionFileAdapter.saveConvertedMetadata(
            {
              ...convertedInfo,
              app_id: metadata.app_id,
              app_hash: metadata.app_hash,
              device: metadata.device,
              sdk: metadata.sdk,
              app_version: metadata.app_version,
              twoFA: request.twoFAPassword || metadata.twoFA,
            },
            jsonFilePath
          );

          return {
            success: true,
            sessionString: fdySessionString,
            phone: metadata.phone || phone,
            username: me.username || null,
            userId: me.id?.toJSNumber() || null,
            sessionFilePath,
            jsonFilePath,
          };
        } catch (validationError: any) {
          console.error(`✗ Сессия не валидна: ${validationError.message}`);
          return {
            success: false,
            error: `Сконвертированная сессия не прошла проверку: ${validationError.message}`,
          };
        }
      }

      // ПОПЫТКА 2: Пробуем StoreSession (для GramJS нативных сессий)
      console.log("\n🔄 Попытка загрузки через StoreSession (GramJS нативный формат)...");

      // Получаем путь к папке и имя файла без расширения
      const sessionDir = path.dirname(request.sessionPath);
      const sessionFileName = path.basename(request.sessionPath, ".session");
      const sessionPath = path.join(sessionDir, sessionFileName);

      console.log(`\nДиагностика подключения:`);
      console.log(`  Исходный путь: ${request.sessionPath}`);
      console.log(`  Путь для StoreSession: ${sessionPath}`);
      console.log(`  Существование файла: ${SessionFileAdapter.sessionFileExists(request.sessionPath)}`);
      console.log(`  API ID: ${metadata.app_id}`);
      console.log(`  API Hash: ${metadata.app_hash ? 'установлен' : 'отсутствует'}`);

      // Создаем StoreSession для загрузки SQLite сессии
      const storeSession = new StoreSession(sessionPath);

      // Создаем клиента
      const logger = new Logger("none" as any);
      const client = new TelegramClient(storeSession, metadata.app_id, metadata.app_hash, {
        connectionRetries: 5,
        baseLogger: logger,
        autoReconnect: true,
      });

      console.log("\nПодключение к Telegram...");

      try {
        // Подключаемся
        await client.connect();
        console.log("✓ Подключено к серверу");

        // Проверяем авторизацию
        const isAuthorized = await client.isUserAuthorized();
        console.log(`✓ Проверка авторизации: ${isAuthorized ? 'авторизован' : 'не авторизован'}`);

        if (!isAuthorized) {
          await client.disconnect();
          return {
            success: false,
            error: "Сессия не авторизована. Возможно, файл .session создан другим приложением или сессия устарела.",
          };
        }
      } catch (connectError: any) {
        console.error(`✗ Ошибка подключения: ${connectError.message}`);
        try {
          await client.disconnect();
        } catch {}
        return {
          success: false,
          error: `Ошибка при подключении: ${connectError.message}`,
        };
      }

      // Получаем информацию о пользователе
      const me = await client.getMe();

      // Экспортируем StringSession
      // Создаем новый StringSession и копируем данные из StoreSession
      const stringSession = new StringSession("");
      stringSession.setDC(
        client.session.dcId,
        client.session.serverAddress,
        client.session.port || 443
      );
      if (client.session.authKey) {
        stringSession.setAuthKey(client.session.authKey);
      }
      const sessionString = stringSession.save();

      // Отключаемся
      await client.disconnect();

      console.log("Сессия успешно сконвертирована");

      // Генерируем имена файлов для сохранения
      const phone = metadata.phone || metadata.session_file || `account_${request.accountNumber}`;
      const fileName = SessionFileAdapter.generateFileName(phone);
      const outputDir = request.outputDirectory || this.options.outputDirectory;

      const sessionFilePath = path.join(outputDir, `${fileName}.session`);
      const jsonFilePath = path.join(outputDir, `${fileName}.json`);

      // Сохраняем StringSession
      SessionFileAdapter.saveSessionString(sessionString, sessionFilePath);

      // Сохраняем метаданные
      const convertedInfo: IConvertedSessionInfo = {
        phone: metadata.phone || phone,
        username: me.username || null,
        firstName: me.firstName || metadata.first_name,
        userId: me.id?.toJSNumber() || null,
        sessionString,
        convertedAt: new Date().toISOString(),
        sessionFilePath,
        jsonFilePath,
      };

      SessionFileAdapter.saveConvertedMetadata(
        {
          ...convertedInfo,
          app_id: metadata.app_id,
          app_hash: metadata.app_hash,
          device: metadata.device,
          sdk: metadata.sdk,
          app_version: metadata.app_version,
          twoFA: request.twoFAPassword || metadata.twoFA,
        },
        jsonFilePath
      );

      return {
        success: true,
        sessionString,
        phone: metadata.phone || phone,
        username: me.username || null,
        userId: me.id?.toJSNumber() || null,
        sessionFilePath,
        jsonFilePath,
      };
    } catch (error: any) {
      console.error("Ошибка при конвертации:", error.message);
      return {
        success: false,
        error: error.message || "Неизвестная ошибка при конвертации",
      };
    }
  }

  /**
   * Конвертирует несколько аккаунтов
   */
  async convertMultipleAccounts(
    accounts: ISessionAccountInfo[],
    twoFAPassword?: string,
    outputDirectory?: string
  ): Promise<ISqliteSessionConversionResult[]> {
    const results: ISqliteSessionConversionResult[] = [];

    for (const account of accounts) {
      console.log(`\nКонвертация аккаунта #${account.accountNumber}: ${account.phone}`);

      const request: ISqliteSessionConversionRequest = {
        accountNumber: account.accountNumber,
        sessionPath: account.sessionPath,
        jsonPath: account.jsonPath,
        twoFAPassword,
        outputDirectory,
      };

      const result = await this.convertToStringSession(request);
      results.push(result);

      if (result.success) {
        console.log(`✓ Успешно: ${result.phone}`);
      } else {
        console.log(`✗ Ошибка: ${result.error}`);
      }
    }

    return results;
  }
}
