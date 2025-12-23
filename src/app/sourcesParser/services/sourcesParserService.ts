/**
 * Сервис для парсинга рекомендаций каналов из списка источников
 *
 * Логика:
 * 1. Загружаем main-database.txt + new-channels.txt в knownChannels (для фильтрации)
 * 2. Загружаем sources.txt (каналы для парсинга)
 * 3. Загружаем processed.txt (уже обработанные источники)
 * 4. Для каждого канала из sources:
 *    - Пропускаем если уже в processed
 *    - GetChannelRecommendations → фильтруем (только новые)
 *    - Сохраняем новые в new-channels.txt + добавляем в knownChannels
 *    - Помечаем источник как обработанный в processed.txt
 *    - При FloodWait → ротация на другой аккаунт
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram';
import { IParserAccount, IParseProgress } from '../interfaces';
import {
  loadChannelsList,
  loadChannelsSet,
  appendChannel,
  appendChannels,
  countLines,
  fileExists,
  createFileWithHeader
} from '../parts/fileHelpers';
import { analyzeFloodWaitError, formatWaitTime } from '../../../shared/utils/floodWaitHandler';
import { createLogger } from '../../../shared/utils/logger';
import { SpamChecker } from '../../../shared/services/spamChecker';

const log = createLogger('SourcesParser');

const FILES = {
  SOURCES: 'sources.txt',
  PROCESSED: 'processed.txt',
  MAIN_DATABASE: 'main-database.txt',
  NEW_CHANNELS: 'new-channels.txt'
};

const CONFIG = {
  DELAY_BETWEEN_REQUESTS: 2000,  // 2 секунды между запросами
  DELAY_AFTER_ERROR: 5000,       // 5 секунд после ошибки
  MAX_RETRIES: 3                 // Максимум попыток для одного канала
};

export class SourcesParserService {
  private sources: string[] = [];
  private processed: Set<string> = new Set();
  private knownChannels: Set<string> = new Set();  // main-database + new-channels
  private accounts: IParserAccount[] = [];
  private clients: Map<string, TelegramClient> = new Map();
  private currentAccountIndex: number = 0;
  private currentClient: TelegramClient | null = null;
  private floodWaitAccounts: Set<string> = new Set();
  private revokedAccounts: Set<string> = new Set();  // Аккаунты с SESSION_REVOKED
  private noPremiumAccounts: Set<string> = new Set();  // Аккаунты без Premium
  private newChannelsCount: number = 0;
  private notFoundStreak: number = 0;  // Счётчик "не найден" подряд
  private lowRecsStreak: number = 0;   // Счётчик ≤15 рекомендаций подряд
  private spamChecker: SpamChecker = new SpamChecker();

  constructor(accounts: IParserAccount[]) {
    this.accounts = accounts;
  }

  /**
   * Загрузка данных из файлов
   */
  async loadData(): Promise<void> {
    log.info('Загрузка данных...');

    // 1. Загружаем main-database (read-only, для фильтрации)
    if (fileExists(FILES.MAIN_DATABASE)) {
      const mainDb = loadChannelsSet(FILES.MAIN_DATABASE);
      mainDb.forEach(ch => this.knownChannels.add(ch));
      log.info(`Загружено из main-database: ${mainDb.size}`);
    } else {
      log.warn(`Файл ${FILES.MAIN_DATABASE} не найден, фильтрация будет только по new-channels`);
    }

    // 2. Загружаем уже найденные новые каналы (для возобновления)
    if (fileExists(FILES.NEW_CHANNELS)) {
      const newChannels = loadChannelsSet(FILES.NEW_CHANNELS);
      newChannels.forEach(ch => this.knownChannels.add(ch));
      this.newChannelsCount = newChannels.size;
      log.info(`Загружено из new-channels: ${newChannels.size}`);
    }

    log.info(`Всего известно каналов: ${this.knownChannels.size}`);

    // 3. Загружаем источники
    this.sources = loadChannelsList(FILES.SOURCES);
    log.info(`Загружено источников: ${this.sources.length}`);

    if (this.sources.length === 0) {
      throw new Error(`Файл ${FILES.SOURCES} пуст или не найден. Добавьте каналы для парсинга.`);
    }

    // 4. Загружаем уже обработанные источники
    this.processed = loadChannelsSet(FILES.PROCESSED);
    log.info(`Уже обработано источников: ${this.processed.size}`);

    // Показываем прогресс
    const remaining = this.sources.length - this.processed.size;
    log.info(`Осталось обработать: ${remaining} каналов`);
  }

  /**
   * Подключение к первому доступному аккаунту
   */
  async connectFirstAccount(): Promise<boolean> {
    if (this.accounts.length === 0) {
      log.error('Не найдено PARSER аккаунтов в .env');
      return false;
    }

    for (let i = 0; i < this.accounts.length; i++) {
      const account = this.accounts[i];

      if (this.floodWaitAccounts.has(account.name)) {
        log.debug(`Пропускаем ${account.name} (в FloodWait)`);
        continue;
      }

      try {
        const client = await this.connectAccount(account);
        this.currentClient = client;
        this.currentAccountIndex = i;
        log.info(`Подключен аккаунт: ${account.name}`);
        return true;
      } catch (error) {
        log.error(`Ошибка подключения ${account.name}: ${(error as Error).message}`);
      }
    }

    return false;
  }

  /**
   * Подключение к конкретному аккаунту
   */
  private async connectAccount(account: IParserAccount): Promise<TelegramClient> {
    // Проверяем кэш
    if (this.clients.has(account.name)) {
      const client = this.clients.get(account.name)!;
      if (client.connected) {
        return client;
      }
    }

    const client = new TelegramClient(
      new StringSession(account.sessionValue),
      account.apiId,
      account.apiHash,
      { connectionRetries: 5 }
    );

    await client.connect();
    this.clients.set(account.name, client);

    return client;
  }

  /**
   * Ротация на следующий аккаунт
   */
  private async rotateAccount(): Promise<boolean> {
    const currentAccount = this.accounts[this.currentAccountIndex];
    this.floodWaitAccounts.add(currentAccount.name);

    log.warn(`Аккаунт ${currentAccount.name} в FloodWait, ищем следующий...`);

    // Ищем следующий доступный аккаунт
    for (let i = 0; i < this.accounts.length; i++) {
      const nextIndex = (this.currentAccountIndex + 1 + i) % this.accounts.length;
      const account = this.accounts[nextIndex];

      if (this.floodWaitAccounts.has(account.name) ||
          this.revokedAccounts.has(account.name) ||
          this.noPremiumAccounts.has(account.name)) {
        continue;
      }

      try {
        const client = await this.connectAccount(account);
        this.currentClient = client;
        this.currentAccountIndex = nextIndex;
        log.info(`Переключились на аккаунт: ${account.name}`);
        return true;
      } catch (error) {
        log.error(`Ошибка подключения ${account.name}: ${(error as Error).message}`);
      }
    }

    log.error('Все аккаунты недоступны (FloodWait/Revoked)!');
    return false;
  }

  /**
   * Получение рекомендаций для канала
   */
  private async getRecommendations(channelName: string): Promise<string[]> {
    if (!this.currentClient) {
      throw new Error('Нет подключенного клиента');
    }

    // Резолвим канал
    const resolveResult = await this.currentClient.invoke(
      new Api.contacts.ResolveUsername({ username: channelName })
    );

    if (!resolveResult?.chats?.length) {
      throw new Error(`Канал @${channelName} не найден`);
    }

    const chat = resolveResult.chats[0] as Api.Channel;
    const inputChannel = new Api.InputChannel({
      channelId: chat.id,
      accessHash: chat.accessHash!
    });

    // Получаем рекомендации
    const recommendations = await this.currentClient.invoke(
      new Api.channels.GetChannelRecommendations({
        channel: inputChannel
      })
    );

    // Извлекаем юзернеймы
    const channels: string[] = [];

    if (recommendations?.chats) {
      for (const recChat of recommendations.chats) {
        const channel = recChat as Api.Channel;
        if (channel.username) {
          channels.push(channel.username);
        }
      }
    }

    return channels;
  }

  /**
   * Основной метод парсинга
   */
  async parseAll(): Promise<IParseProgress> {
    const startTime = Date.now();
    let processedCount = 0;
    let newChannelsFound = 0;
    let errorsCount = 0;

    log.info('Начинаем парсинг...');

    for (const source of this.sources) {
      // Пропускаем уже обработанные
      if (this.processed.has(source)) {
        continue;
      }

      const currentAccount = this.accounts[this.currentAccountIndex];
      log.info(`[${processedCount + 1}/${this.sources.length - this.processed.size}] Парсим @${source} (аккаунт: ${currentAccount.name})`);

      let retries = 0;
      let success = false;

      while (retries < CONFIG.MAX_RETRIES && !success) {
        try {
          const recommendations = await this.getRecommendations(source);

          if (recommendations.length > 0) {
            // Проверяем на отсутствие Premium (≤15 рекомендаций)
            if (recommendations.length <= 15) {
              this.lowRecsStreak++;
              log.warn(`  ⚠️ Мало рекомендаций: ${recommendations.length} (подряд: ${this.lowRecsStreak})`);

              if (this.lowRecsStreak >= 3) {
                const currentAccount = this.accounts[this.currentAccountIndex];
                log.error(`🚫 Аккаунт ${currentAccount.name} без Premium (${this.lowRecsStreak}x ≤15 рекомендаций)`);
                this.noPremiumAccounts.add(currentAccount.name);

                const rotated = await this.rotateAccount();
                if (!rotated) {
                  log.error('Все аккаунты недоступны');
                  return this.createProgress(processedCount, newChannelsFound, source);
                }
                this.lowRecsStreak = 0;
                retries++;
                continue; // Повторить с новым аккаунтом
              }
            } else {
              this.lowRecsStreak = 0; // Сброс при нормальном количестве (>15)
            }

            // Фильтруем — оставляем только новые каналы (сравнение в lowercase)
            const newChannels = recommendations.filter(ch => !this.knownChannels.has(ch.toLowerCase()));

            if (newChannels.length > 0) {
              // Сохраняем СРАЗУ
              appendChannels(FILES.NEW_CHANNELS, newChannels);
              // Добавляем в Set для последующей фильтрации (в lowercase)
              newChannels.forEach(ch => this.knownChannels.add(ch.toLowerCase()));
              newChannelsFound += newChannels.length;
              this.newChannelsCount += newChannels.length;
              log.info(`  Новых: ${newChannels.length} из ${recommendations.length} (всего новых: ${this.newChannelsCount})`);
            } else {
              log.info(`  Все ${recommendations.length} уже известны`);
            }
          } else {
            log.warn(`  Нет рекомендаций для @${source}`);
          }

          // Помечаем источник как обработанный СРАЗУ
          appendChannel(FILES.PROCESSED, source);
          this.processed.add(source);
          processedCount++;
          success = true;
          this.notFoundStreak = 0;  // Сброс счётчика при успехе
          // lowRecsStreak уже сбрасывается выше при >15 рекомендациях

          // Задержка между запросами
          await this.delay(CONFIG.DELAY_BETWEEN_REQUESTS);

        } catch (error: any) {
          const floodAnalysis = analyzeFloodWaitError(error);

          if (floodAnalysis.isFloodWait) {
            log.warn(`FloodWait: ${formatWaitTime(floodAnalysis.seconds)}`);

            // Пробуем ротацию
            const rotated = await this.rotateAccount();
            if (!rotated) {
              log.error('Все аккаунты в FloodWait, останавливаемся');
              return this.createProgress(processedCount, newChannelsFound, source);
            }

            retries++; // Повторяем с новым аккаунтом
          } else if (error.message?.includes('SESSION_REVOKED') || error.message?.includes('AUTH_KEY_UNREGISTERED')) {
            // Сессия отозвана или ключ недействителен — аккаунт больше нельзя использовать
            const currentAccount = this.accounts[this.currentAccountIndex];
            const errorType = error.message?.includes('AUTH_KEY_UNREGISTERED') ? 'AUTH_KEY_UNREGISTERED' : 'SESSION_REVOKED';
            log.error(`Сессия ${currentAccount.name} недействительна (${errorType})`);
            this.revokedAccounts.add(currentAccount.name);

            const rotated = await this.rotateAccount();
            if (!rotated) {
              log.error('Все аккаунты недоступны, останавливаемся');
              return this.createProgress(processedCount, newChannelsFound, source);
            }
            retries++;
          } else if (error.message?.includes('не найден') || error.message?.includes('USERNAME_NOT_OCCUPIED')) {
            // Канал не существует - пропускаем
            this.notFoundStreak++;
            log.warn(`  Канал @${source} не найден, пропускаем (подряд: ${this.notFoundStreak})`);

            // 3+ подряд = возможный спам-бан
            if (this.notFoundStreak >= 3) {
              log.warn(`⚠️ ${this.notFoundStreak} каналов подряд не найдены — проверяю на спам...`);
              const currentAccount = this.accounts[this.currentAccountIndex];

              try {
                const isSpammed = await this.spamChecker.isAccountSpammed(this.currentClient!, currentAccount.name);
                if (isSpammed) {
                  log.error(`🚫 Аккаунт ${currentAccount.name} в спаме!`);
                  this.floodWaitAccounts.add(currentAccount.name);
                  const rotated = await this.rotateAccount();
                  if (!rotated) {
                    log.error('Все аккаунты недоступны');
                    return this.createProgress(processedCount, newChannelsFound, source);
                  }
                } else {
                  log.info(`✅ Аккаунт ${currentAccount.name} чистый, каналы действительно не существуют`);
                }
              } catch (spamCheckError) {
                log.warn(`Не удалось проверить спам: ${spamCheckError}`);
              }
              this.notFoundStreak = 0;
            }

            appendChannel(FILES.PROCESSED, source);
            this.processed.add(source);
            processedCount++;
            success = true;
          } else {
            // Другая ошибка
            log.error(`  Ошибка: ${error.message}`);
            retries++;
            errorsCount++;

            if (retries < CONFIG.MAX_RETRIES) {
              log.info(`  Повтор через ${CONFIG.DELAY_AFTER_ERROR / 1000} сек...`);
              await this.delay(CONFIG.DELAY_AFTER_ERROR);
            }
          }
        }
      }

      if (!success) {
        log.error(`  Не удалось обработать @${source} после ${CONFIG.MAX_RETRIES} попыток`);
        // Всё равно помечаем как обработанный чтобы не застрять
        appendChannel(FILES.PROCESSED, source);
        this.processed.add(source);
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    log.info(`\nПарсинг завершён за ${duration} сек`);
    log.info(`Обработано источников: ${processedCount}, Найдено новых каналов: ${newChannelsFound}, Ошибок: ${errorsCount}`);

    return this.createProgress(processedCount, newChannelsFound, '');
  }

  /**
   * Создание объекта прогресса
   */
  private createProgress(processedCount: number, resultsCount: number, currentSource: string): IParseProgress {
    return {
      totalSources: this.sources.length,
      processedCount,
      resultsCount,
      currentSource,
      currentAccount: this.accounts[this.currentAccountIndex]?.name || ''
    };
  }

  /**
   * Задержка
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Отключение всех клиентов
   */
  async disconnect(): Promise<void> {
    const entries = Array.from(this.clients.entries());
    for (const [name, client] of entries) {
      try {
        await client.disconnect();
        log.debug(`Отключен ${name}`);
      } catch (error) {
        // Игнорируем ошибки отключения
      }
    }
    this.clients.clear();
  }

  /**
   * Получение текущей статистики
   */
  getStats(): { total: number; processed: number; remaining: number; newChannels: number; knownChannels: number } {
    return {
      total: this.sources.length,
      processed: this.processed.size,
      remaining: this.sources.length - this.processed.size,
      newChannels: this.newChannelsCount,
      knownChannels: this.knownChannels.size
    };
  }
}
