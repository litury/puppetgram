/**
 * Channel Checker — постоянный сервис предпроверки каналов (read-only).
 *
 * Зачем: основной комментатор упирается в лимит Telegram на ResolveUsername
 * (~200 резолвов → ~24ч флуд). Если в очереди много каналов с закрытыми
 * комментами, лимит тратится впустую. Этот сервис на ОТДЕЛЬНОМ расходном пуле
 * аккаунтов (SESSION_STRING_CHECKER_*) только ЧИТАЕТ каждый канал
 * (ResolveUsername + GetFullChannel) и проставляет `comments_state`
 * (open/closed/join_required/invalid). Чтение за спам не банит — максимум
 * FloodWait, который мы пережидаем ротацией аккаунтов.
 *
 * Комментатор потом включает фильтр REQUIRE_CHAT и берёт только comments_state='open'.
 *
 * Колонка `comments_state` ортогональна `status` (его пишет комментатор) →
 * сервисы не затирают друг друга. Claim партии — через
 * claimUncheckedBatch (UPDATE … FOR UPDATE SKIP LOCKED), безопасно при
 * нескольких инстансах.
 */

import * as dotenv from "dotenv";
import { GramClient } from "../../../telegram/adapters/gramClient";
import { CommentCheckerService } from "../../commentChecker/services/commentCheckerService";
import {
  TargetChannelsRepository,
  AccountFloodWaitRepository,
  CommentsState,
} from "../../../shared/database";
import { EnvAccountsParser, Account } from "../../../shared/utils/envAccountsParser";
import { createLogger } from "../../../shared/utils/logger";

dotenv.config();

const log = createLogger("ChannelChecker");

const CONFIG = {
  batchSize: Number(process.env.CHECKER_BATCH_SIZE || 100),
  // Пауза между проверками каналов (мягко к API; флуд всё равно ловится и ротируется)
  delayBetweenChecksMs: Number(process.env.CHECKER_DELAY_MS || 2500),
  // Сон когда непроверенных нет (защита от пустых запросов к БД)
  idleSleepMs: Number(process.env.CHECKER_IDLE_SLEEP_MS || 7 * 60 * 1000),
  // TTL перепроверки: канал, проверенный давнее этого, проверяется заново
  ttlDays: Number(process.env.CHECKER_TTL_DAYS || 14),
  // FloodWait по умолчанию, если Telegram не вернул секунды
  defaultFloodSeconds: Number(process.env.CHECKER_DEFAULT_FLOOD_SECONDS || 3600),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** policy из CommentCheckerService → наш comments_state */
function mapPolicyToState(policy: string): CommentsState {
  switch (policy) {
    case "enabled":
      return "open";
    case "members_only":
    case "approval_required":
      return "join_required";
    case "disabled":
    case "restricted":
      return "closed";
    default:
      return "invalid"; // unknown — определить не удалось
  }
}

/** Текст ошибки указывает на постоянную проблему (мёртвый/невалидный канал) */
function isPermanentError(msg: string): boolean {
  return /не найден|не является каналом|Неверный формат|недоступен|USERNAME_INVALID|USERNAME_NOT_OCCUPIED|No user has|Cannot find any entity|CHANNEL_INVALID|CHANNEL_PRIVATE|private|inaccessible/i.test(
    msg
  );
}

/** Текст ошибки = FloodWait */
function isFloodError(msg: string): boolean {
  return /FloodWait|FLOOD/i.test(msg);
}

/** Достаём секунды ожидания из текста FloodWait */
function parseFloodSeconds(msg: string): number {
  const m = msg.match(/(\d+)\s*секунд/);
  return m ? Number(m[1]) : CONFIG.defaultFloodSeconds;
}

class ChannelChecker {
  private channelsRepo = new TargetChannelsRepository();
  private floodRepo = new AccountFloodWaitRepository();
  private accounts: Account[] = [];
  private floodUntil = new Map<string, number>(); // accountName → unlock ms

  private currentClient: GramClient | null = null;
  private currentAccount: Account | null = null;
  private checker: CommentCheckerService | null = null;

  private running = true;
  // Накопительные счётчики итоговых состояний (вместо seq-scan по 258k каждый батч)
  private stateCounts: Record<string, number> = {};

  async start(): Promise<void> {
    log.info("Запуск channel-checker");

    this.accounts = new EnvAccountsParser().getAvailableAccounts("CHECKER");
    if (this.accounts.length === 0) {
      throw new Error(
        "Не найдено ни одного аккаунта чекера. Добавьте SESSION_STRING_CHECKER_* (+ USERNAME_CHECKER_*) в env."
      );
    }
    log.info("Аккаунты чекера загружены", {
      count: this.accounts.length,
      names: this.accounts.map((a) => a.name),
    });

    // Персистентные FloodWait из БД (между перезапусками)
    const activeFloods = await this.floodRepo.getActiveFloodWaits();
    for (const fw of activeFloods) {
      this.floodUntil.set(fw.accountName, new Date(fw.unlockAt).getTime());
    }

    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());

    while (this.running) {
      // Если ВСЕ аккаунты во FloodWait — ждём ближайшую разблокировку, не трогаем БД
      const floodWaitMs = this.allFloodedWaitMs();
      if (floodWaitMs > 0) {
        log.warn("Все аккаунты чекера во FloodWait — ожидание", { waitMs: floodWaitMs });
        await sleep(Math.min(floodWaitMs, CONFIG.idleSleepMs));
        continue;
      }

      const batch = await this.channelsRepo.claimUncheckedBatch(CONFIG.batchSize, CONFIG.ttlDays);

      if (batch.length === 0) {
        log.info("Непроверенных каналов нет — сон", { idleMs: CONFIG.idleSleepMs });
        await sleep(CONFIG.idleSleepMs);
        continue;
      }

      log.info("Взята партия на проверку", { size: batch.length });
      let done = 0;
      for (const ch of batch) {
        if (!this.running) break;
        const handled = await this.checkOne(ch.username);
        if (handled) done++;
        await sleep(CONFIG.delayBetweenChecksMs);
      }

      // In-process счётчики (без обращения к БД на каждом батче)
      log.info("Партия обработана", {
        handled: done,
        total: batch.length,
        cumulative: this.stateCounts,
      });
    }

    await this.disconnectCurrent();
  }

  /**
   * Проверить один канал. true — если состояние записано; false — отложен
   * (флуд/транзиент), останется 'checking' и будет перезахвачен reaper-ом.
   */
  private async checkOne(username: string): Promise<boolean> {
    let attempts = 0;
    while (this.running) {
      const acc = await this.ensureAccount();
      if (!acc) {
        // Все аккаунты во флуде — выходим быстро, ожидание сделает главный цикл
        return false;
      }

      const resp = await this.checker!.checkChannelComments({ channelName: username });

      if (resp.success) {
        // Degraded-ответ: GetFullChannel не отработал, сработал фоллбэк на голый
        // ResolveUsername → linkedChatId недостоверен. НЕ пишем open/closed
        // (иначе открытый канал ложно уедет в closed на TTL). Оставляем на recheck.
        if (resp.channel.fullInfoFetched === false) {
          log.warn("Degraded-ответ (нет полной инфы) — отложено", { username });
          return false;
        }
        const state = mapPolicyToState(resp.channel.commentsPolicy);
        await this.channelsRepo.setCommentsState(username, state);
        this.stateCounts[state] = (this.stateCounts[state] ?? 0) + 1;
        log.debug("Канал проверен", { username, policy: resp.channel.commentsPolicy, state });
        return true;
      }

      const errMsg = resp.error || "";

      if (isFloodError(errMsg)) {
        const seconds = parseFloodSeconds(errMsg);
        await this.markFlood(acc.name, seconds);
        log.warn("FloodWait у аккаунта чекера — ротация", { account: acc.name, seconds });
        await this.disconnectCurrent();
        attempts++;
        if (attempts > this.accounts.length) return false; // все попробовали — отложить канал
        continue; // retry того же канала другим аккаунтом
      }

      if (isPermanentError(errMsg)) {
        await this.channelsRepo.setCommentsState(username, "invalid");
        this.stateCounts.invalid = (this.stateCounts.invalid ?? 0) + 1;
        log.debug("Канал невалиден", { username, error: errMsg });
        return true;
      }

      // Транзиентная ошибка — не пишем состояние, оставляем 'checking' под reaper
      log.warn("Транзиентная ошибка проверки — отложено", { username, error: errMsg });
      return false;
    }
    return false;
  }

  /** Гарантирует подключённый не-флудящий аккаунт. null — если все во флуде. */
  private async ensureAccount(): Promise<Account | null> {
    const now = Date.now();

    // Текущий ещё годен?
    if (this.currentAccount && this.currentClient) {
      const until = this.floodUntil.get(this.currentAccount.name) ?? 0;
      if (until <= now && this.currentClient.connected) return this.currentAccount;
    }

    // Ищем свободный аккаунт
    const free = this.accounts.find((a) => (this.floodUntil.get(a.name) ?? 0) <= now);
    if (!free) return null;

    await this.disconnectCurrent();
    try {
      process.env.SESSION_STRING = free.sessionValue;
      const client = new GramClient();
      await client.connect();
      this.currentClient = client;
      this.currentAccount = free;
      this.checker = new CommentCheckerService(client.getClient());
      log.info("Подключён аккаунт чекера", { account: free.name });
      return free;
    } catch (e: any) {
      log.error("Не удалось подключить аккаунт чекера", e as Error, { account: free.name });
      // Помечаем коротким флудом, чтобы не долбить, и пробуем следующий
      this.floodUntil.set(free.name, now + 5 * 60 * 1000);
      return this.ensureAccount();
    }
  }

  private async markFlood(accountName: string, seconds: number): Promise<void> {
    const unlock = new Date(Date.now() + seconds * 1000);
    this.floodUntil.set(accountName, unlock.getTime());
    try {
      await this.floodRepo.setFloodWait(accountName, unlock, "FloodWait при предпроверке (checker)");
    } catch (e) {
      log.warn("Не удалось сохранить FloodWait в БД", { account: accountName });
    }
  }

  /** >0 (мс до ближайшей разблокировки), только если ВСЕ аккаунты во FloodWait; иначе 0 */
  private allFloodedWaitMs(): number {
    const now = Date.now();
    const unlocks = this.accounts.map((a) => this.floodUntil.get(a.name) ?? 0);
    const allFlooded = unlocks.every((t) => t > now);
    if (!allFlooded) return 0;
    return Math.max(1000, Math.min(...unlocks) - now);
  }

  private async disconnectCurrent(): Promise<void> {
    if (this.currentClient) {
      try {
        await this.currentClient.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.currentClient = null;
    this.currentAccount = null;
    this.checker = null;
  }

  private shutdown(): void {
    if (!this.running) return;
    log.info("Останов channel-checker (сигнал)");
    this.running = false;
  }
}

new ChannelChecker().start().catch((e) => {
  log.error("Фатальная ошибка channel-checker", e as Error);
  process.exit(1);
});
