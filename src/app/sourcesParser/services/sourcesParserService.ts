/**
 * Сервис для парсинга рекомендаций каналов из базы данных
 *
 * Логика:
 * 1. Загружаем все юзернеймы из БД в knownChannels (для фильтрации)
 * 2. Получаем каналы где parsed=false (источники для парсинга)
 * 3. Для каждого канала:
 *    - GetChannelRecommendations → фильтруем (только новые)
 *    - Сохраняем новые в БД (addChannels)
 *    - Помечаем источник как parsed=true (markParsed)
 *    - При FloodWait → ротация на другой аккаунт
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram';
import { IParserAccount, IParseProgress } from '../interfaces';
import { TargetChannelsRepository, ChannelData } from '../../../shared/database';
import { analyzeFloodWaitError, formatWaitTime } from '../../../shared/utils/floodWaitHandler';
import { createLogger } from '../../../shared/utils/logger';
import { SpamChecker } from '../../../shared/services/spamChecker';

const log = createLogger('SourcesParser');

const CONFIG = {
  DELAY_BETWEEN_REQUESTS: 2000,  // 2 секунды между запросами
  DELAY_AFTER_ERROR: 5000,       // 5 секунд после ошибки
  MAX_RETRIES: 3,                // Максимум попыток для одного канала
  DEFAULT_BATCH_SIZE: 1000       // Количество каналов для парсинга за раз
};

export class SourcesParserService {
  private sources: { username: string }[] = [];
  private knownChannels: Set<string> = new Set();
  private accounts: IParserAccount[] = [];
  private clients: Map<string, TelegramClient> = new Map();
  private currentAccountIndex: number = 0;
  private currentClient: TelegramClient | null = null;
  private floodWaitAccounts: Map<string, Date> = new Map();
  private revokedAccounts: Set<string> = new Set();
  private noPremiumAccounts: Set<string> = new Set();
  private newChannelsCount: number = 0;
  private notFoundStreak: number = 0;
  private lowRecsStreak: number = 0;
  private spamChecker: SpamChecker = new SpamChecker();
  private repo: TargetChannelsRepository = new TargetChannelsRepository();

  constructor(accounts: IParserAccount[]) {
    this.accounts = accounts;
  }

  /**
   * Загрузка данных из БД
   */
  async loadData(batchSize: number = CONFIG.DEFAULT_BATCH_SIZE): Promise<void> {
    log.info('Загрузка данных из БД...');

    // 1. Загружаем все известные каналы (для фильтрации дубликатов)
    this.knownChannels = await this.repo.getAllUsernames();
    log.info(`Всего известно каналов: ${this.knownChannels.size}`);

    // 2. Получаем каналы для парсинга (parsed=false)
    const unparsed = await this.repo.getUnparsed(batchSize);
    this.sources = unparsed.map(ch => ({ username: ch.username }));
    log.info(`Загружено источников для парсинга: ${this.sources.length}`);

    if (this.sources.length === 0) {
      log.warn('Нет каналов для парсинга (все уже спарсены)');
    }

    // 3. Показываем статистику
    const stats = await this.repo.getParsedStats();
    log.info(`Статистика: спарсено ${stats.parsed}, не спарсено ${stats.unparsed}`);
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
    if (this.clients.has(account.name)) {
      const client = this.clients.get(account.name)!;
      if (client.connected) {
        return client;
      }
    }

    const clientOpts: any = { connectionRetries: 5 };
    const proxyHost = process.env.PROXY_HOST;
    const proxyPort = process.env.PROXY_PORT;
    if (proxyHost && proxyPort) {
      clientOpts.proxy = {
        ip: proxyHost,
        port: Number(proxyPort),
        socksType: 5,
        timeout: 10,
      };
    }

    const client = new TelegramClient(
      new StringSession(account.sessionValue),
      account.apiId,
      account.apiHash,
      clientOpts
    );

    await client.connect();
    this.clients.set(account.name, client);

    return client;
  }

  /**
   * Форматирование времени ожидания
   */
  private formatWaitTime(seconds: number): string {
    if (seconds < 60) {
      return `${seconds} сек`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes} мин`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return `${hours} ч`;
    }
    return `${hours} ч ${remainingMinutes} м`;
  }

  /**
   * Форматирование времени разблокировки
   */
  private formatUnlockTime(date: Date): string {
    return date.toLocaleString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit'
    });
  }

  /**
   * Ожидает разблокировки ближайшего аккаунта из FLOOD_WAIT
   */
  private async waitForAccountUnlock(): Promise<IParserAccount | null> {
    if (this.floodWaitAccounts.size === 0) {
      return null;
    }

    const now = Date.now();

    // Находим аккаунт с минимальным временем ожидания
    let nearestUnlock: [string, Date] | null = null;
    let minWaitTime = Infinity;

    for (const [name, unlockTime] of this.floodWaitAccounts.entries()) {
      const waitMs = unlockTime.getTime() - now;
      if (waitMs > 0 && waitMs < minWaitTime) {
        minWaitTime = waitMs;
        nearestUnlock = [name, unlockTime];
      }
    }

    if (!nearestUnlock) {
      return null;
    }

    const [accountName, unlockTime] = nearestUnlock;
    const waitSeconds = Math.max(0, Math.ceil((unlockTime.getTime() - now) / 1000));
    const bufferSeconds = 60;
    const totalWaitSeconds = waitSeconds + bufferSeconds;

    log.info(`Ожидание разблокировки аккаунта ${accountName} (через ${this.formatWaitTime(totalWaitSeconds)})`);

    // Логируем каждые 5 минут
    const logInterval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((unlockTime.getTime() - Date.now()) / 1000));
      log.info(`Продолжаем ожидание ${accountName} (осталось ${this.formatWaitTime(remaining + bufferSeconds)})`);
    }, 5 * 60 * 1000);

    // Ждём разблокировки
    await new Promise(resolve => setTimeout(resolve, totalWaitSeconds * 1000));

    clearInterval(logInterval);

    // Удаляем из FLOOD_WAIT
    this.floodWaitAccounts.delete(accountName);

    log.info(`Аккаунт ${accountName} разблокирован`);

    // Возвращаем разблокированный аккаунт
    const account = this.accounts.find(a => a.name === accountName);
    return account || null;
  }

  /**
   * Ротация на следующий аккаунт
   */
  private async rotateAccount(waitSeconds: number = 0): Promise<boolean> {
    const currentAccount = this.accounts[this.currentAccountIndex];

    if (waitSeconds > 0) {
      const unlockTime = new Date(Date.now() + waitSeconds * 1000);
      this.floodWaitAccounts.set(currentAccount.name, unlockTime);
      log.warn(`Аккаунт ${currentAccount.name} в FloodWait до ${unlockTime.toLocaleString('ru-RU')}`);
    } else {
      this.floodWaitAccounts.set(currentAccount.name, new Date());
      log.warn(`Аккаунт ${currentAccount.name} в FloodWait, ищем следующий...`);
    }

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

    // Если есть аккаунты в FLOOD_WAIT - ждём разблокировки
    if (this.floodWaitAccounts.size > 0) {
      log.info('Все аккаунты в FLOOD_WAIT, ожидаем разблокировки ближайшего...');
      const unlockedAccount = await this.waitForAccountUnlock();

      if (unlockedAccount) {
        try {
          const client = await this.connectAccount(unlockedAccount);
          this.currentClient = client;
          this.currentAccountIndex = this.accounts.findIndex(a => a.name === unlockedAccount.name);
          log.info(`Переключились на разблокированный аккаунт: ${unlockedAccount.name}`);
          return true;
        } catch (error) {
          log.error(`Ошибка подключения к разблокированному аккаунту ${unlockedAccount.name}: ${(error as Error).message}`);
        }
      }
    }

    log.error('Все аккаунты недоступны (FloodWait/Revoked)!');
    return false;
  }

  /**
   * Получение рекомендаций для канала (с расширенными данными)
   */
  private async getRecommendations(channelName: string): Promise<ChannelData[]> {
    if (!this.currentClient) {
      throw new Error('Нет подключенного клиента');
    }

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

    const recommendations = await this.currentClient.invoke(
      new Api.channels.GetChannelRecommendations({
        channel: inputChannel
      })
    );

    const channels: ChannelData[] = [];

    if (recommendations?.chats) {
      for (const recChat of recommendations.chats) {
        const channel = recChat as Api.Channel;
        if (channel.username) {
          // Собираем все доступные данные из Channel объекта
          channels.push({
            username: channel.username,
            channelId: channel.id.toJSNumber(),
            title: channel.title,
            participants: channel.participantsCount,
            isVerified: channel.verified ?? false,
            isScam: channel.scam ?? false,
            isFake: channel.fake ?? false,
          });
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

    for (const sourceObj of this.sources) {
      const source = sourceObj.username;
      const currentAccount = this.accounts[this.currentAccountIndex];
      log.info(`[${processedCount + 1}/${this.sources.length}] Парсим @${source} (аккаунт: ${currentAccount.name})`);

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
                continue;
              }
            } else {
              this.lowRecsStreak = 0;
            }

            // Фильтруем — оставляем только новые каналы
            const newChannels = recommendations.filter(ch => !this.knownChannels.has(ch.username.toLowerCase()));

            if (newChannels.length > 0) {
              // Сохраняем в БД с расширенными данными
              const added = await this.repo.addChannelsWithData(newChannels);
              // Добавляем в Set для последующей фильтрации
              newChannels.forEach(ch => this.knownChannels.add(ch.username.toLowerCase()));
              newChannelsFound += added;
              this.newChannelsCount += added;

              // Логируем статистику по подписчикам
              const withParticipants = newChannels.filter(ch => ch.participants && ch.participants > 0);
              const totalSubs = withParticipants.reduce((sum, ch) => sum + (ch.participants || 0), 0);
              log.info(`  Новых: ${added} из ${recommendations.length} (подписчиков: ${totalSubs.toLocaleString()})`);
            } else {
              log.info(`  Все ${recommendations.length} уже известны`);
            }
          } else {
            log.warn(`  Нет рекомендаций для @${source}`);
          }

          // Помечаем источник как спарсенный
          await this.repo.markParsed(source);
          processedCount++;
          success = true;
          this.notFoundStreak = 0;

          // Задержка между запросами
          await this.delay(CONFIG.DELAY_BETWEEN_REQUESTS);

        } catch (error: any) {
          const floodAnalysis = analyzeFloodWaitError(error);

          if (floodAnalysis.isFloodWait) {
            log.warn(`FloodWait: ${formatWaitTime(floodAnalysis.seconds)}`);

            const rotated = await this.rotateAccount(floodAnalysis.seconds);
            if (!rotated) {
              log.error('Все аккаунты в FloodWait, останавливаемся');
              return this.createProgress(processedCount, newChannelsFound, source);
            }

            retries++;
          } else if (error.message?.includes('SESSION_REVOKED') || error.message?.includes('AUTH_KEY_UNREGISTERED')) {
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
            this.notFoundStreak++;
            log.warn(`  Канал @${source} не найден, пропускаем (подряд: ${this.notFoundStreak})`);

            if (this.notFoundStreak >= 3) {
              log.warn(`⚠️ ${this.notFoundStreak} каналов подряд не найдены — проверяю на спам...`);
              const currentAccount = this.accounts[this.currentAccountIndex];

              try {
                const isSpammed = await this.spamChecker.isAccountSpammed(this.currentClient!, currentAccount.name);
                if (isSpammed) {
                  log.error(`🚫 Аккаунт ${currentAccount.name} в спаме!`);
                  this.floodWaitAccounts.set(currentAccount.name, new Date(Date.now() + 24 * 60 * 60 * 1000)); // 24 часа
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

            // Помечаем как спарсенный (даже если канал не найден)
            await this.repo.markParsed(source);
            processedCount++;
            success = true;
          } else {
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
        // Всё равно помечаем как спарсенный чтобы не застрять
        await this.repo.markParsed(source);
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
  async getStats(): Promise<{ total: number; parsed: number; unparsed: number; newChannels: number; knownChannels: number }> {
    const dbStats = await this.repo.getParsedStats();
    return {
      total: dbStats.total,
      parsed: dbStats.parsed,
      unparsed: dbStats.unparsed,
      newChannels: this.newChannelsCount,
      knownChannels: this.knownChannels.size
    };
  }
}
