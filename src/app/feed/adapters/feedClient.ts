/**
 * FeedClient — параметризованный билдер GramJS-клиента для МУЛЬТИ-сессионного listener'а.
 *
 * В отличие от shared/adapters/gramClient.ts (одна env-сессия) и чекера (ротация одной
 * сессии через process.env), листенеру нужны КОНКУРЕНТНЫЕ постоянные клиенты. Поэтому
 * creds передаются явно (sessionString/apiId/apiHash/proxy) — из Account.meta с фоллбэком
 * на env. Один FeedClient = одна живая сессия с навешенными обработчиками апдейтов.
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Logger } from 'telegram/extensions';
import { Account } from '../../../shared/utils/envAccountsParser';
import { createLogger } from '../../../shared/utils/logger';

const log = createLogger('FeedClient');

export interface FeedClientCreds {
  name: string;
  sessionString: string;
  apiId: number;
  apiHash: string;
  proxy?: { ip: string; port: number };
}

/** Разобрать "host:port" в объект proxy (для meta.proxy / env). */
function parseProxy(raw?: string | null): { ip: string; port: number } | undefined {
  if (!raw) return undefined;
  const [ip, port] = raw.split(':');
  if (!ip || !port) return undefined;
  return { ip, port: Number(port) };
}

/**
 * Извлечь creds из Account (форма EnvAccountsParser): apiId/apiHash приходят из env,
 * но meta может переопределить (для 2–3 разных api_id в пуле feed). proxy — из meta.proxy
 * или env PROXY_HOST/PROXY_PORT.
 */
export function credsFromAccount(a: Account): FeedClientCreds {
  const meta = a as Record<string, any>;
  return {
    name: a.name,
    sessionString: a.sessionValue || a.session || '',
    apiId: Number(meta.apiId || process.env.API_ID || 0),
    apiHash: String(meta.apiHash || process.env.API_HASH || ''),
    proxy:
      parseProxy(meta.proxy) ||
      parseProxy(process.env.PROXY_HOST ? `${process.env.PROXY_HOST}:${process.env.PROXY_PORT}` : undefined),
  };
}

export class FeedClient {
  private client: TelegramClient;
  readonly name: string;

  constructor(creds: FeedClientCreds) {
    this.name = creds.name;
    if (!creds.apiId || !creds.apiHash) {
      throw new Error(`FeedClient[${creds.name}]: apiId/apiHash не заданы (meta или env)`);
    }
    const logger = new Logger('none' as any);
    const opts: any = {
      connectionRetries: 5,
      useWSS: false,
      baseLogger: logger,
      requestRetries: 3,
      autoReconnect: true,
      // Низкий порог: FLOOD_WAIT > N сек бросается ошибкой (не молчаливый авто-сон до 60с),
      // чтобы backfill/краул сразу делали break и не блокировали однопоточный pollLoop.
      floodSleepThreshold: Number(process.env.FEED_FLOOD_SLEEP_THRESHOLD || 5),
      deviceModel: 'Desktop',
      systemVersion: 'macOS 14.5.0',
      appVersion: '1.0.0',
      langCode: 'ru',
      systemLangCode: 'ru',
    };
    if (creds.proxy) {
      opts.proxy = { ...creds.proxy, socksType: 5, timeout: 10 };
    }
    this.client = new TelegramClient(new StringSession(creds.sessionString), creds.apiId, creds.apiHash, opts);
  }

  /** Подключиться и убедиться в авторизации. Дёргает getMe() — иначе Telegram не шлёт апдейты. */
  async connect(): Promise<void> {
    await this.client.connect();
    const authorized = await this.client.isUserAuthorized();
    if (!authorized) {
      throw new Error(`FeedClient[${this.name}]: сессия не авторизована`);
    }
    // Обязательно: high-level вызов, чтобы Telegram начал слать поток апдейтов.
    await this.client.getMe();
    log.debug('Подключён', { account: this.name });
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
    } catch (e) {
      log.warn('Ошибка отключения', { account: this.name, error: (e as Error).message });
    }
  }

  getClient(): TelegramClient {
    return this.client;
  }

  get connected(): boolean {
    return this.client.connected ?? false;
  }
}
