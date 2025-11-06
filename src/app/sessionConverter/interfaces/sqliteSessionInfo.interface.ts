/**
 * Метаданные аккаунта из JSON файла
 */
export interface ISessionMetadata {
  app_id: number;
  app_hash: string;
  device: string;
  sdk: string;
  app_version: string;
  system_lang_pack: string;
  system_lang_code: string;
  lang_pack: string;
  lang_code: string;
  twoFA: string | null;
  role: string;
  id: number | null;
  phone: string | null;
  username: string | null;
  date_of_birth: string | null;
  date_of_birth_integrity: string | null;
  is_premium: boolean;
  has_profile_pic: boolean;
  spamblock: string | null;
  register_time: number;
  last_check_time: number;
  avatar: string | null;
  first_name: string;
  last_name: string;
  sex: number | null;
  proxy: any;
  ipv6: boolean;
  session_file: string;
}

/**
 * Информация об аккаунте для отображения
 */
export interface ISessionAccountInfo {
  accountNumber: number;
  phone: string;
  username: string | null;
  firstName: string;
  sessionPath: string;
  jsonPath: string;
  metadata: ISessionMetadata;
}

/**
 * Результат конвертации сессии
 */
export interface IConvertedSessionInfo {
  phone: string;
  username: string | null;
  firstName: string;
  userId: number | null;
  sessionString: string;
  convertedAt: string;
  sessionFilePath: string;
  jsonFilePath: string;
}
