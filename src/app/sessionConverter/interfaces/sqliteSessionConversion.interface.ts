/**
 * Запрос на конвертацию SQLite сессии
 */
export interface ISqliteSessionConversionRequest {
  accountNumber: number;
  sessionPath: string;
  jsonPath: string;
  twoFAPassword?: string;
  outputDirectory?: string;
}

/**
 * Результат конвертации SQLite сессии
 */
export interface ISqliteSessionConversionResult {
  success: boolean;
  sessionString?: string;
  phone?: string;
  username?: string | null;
  userId?: number | null;
  sessionFilePath?: string;
  jsonFilePath?: string;
  error?: string;
}

/**
 * Опции для конвертера
 */
export interface ISqliteSessionConverterOptions {
  outputDirectory: string;
  sessionDirectory: string;
}
