/**
 * Клиент LZT Market (Lolzteam) API для закупки Telegram-аккаунтов.
 *
 * Использует нативный fetch (Node 18+), Bearer-токен из LZT_API_TOKEN.
 * Поля ответов маркета размечены защитно (несколько возможных путей) — структура
 * айтема на проде может отличаться, поэтому сырой ответ логируется на первом прогоне.
 *
 * Док: https://lzt-market.readme.io/  (telegram-login-code эндпоинт подтверждён).
 */

const BASE = process.env.LZT_API_BASE || "https://prod-api.lzt.market";

export interface LztItem {
  itemId: number;
  price?: number;          // цена в валюте аккаунта маркета
  priceCurrency?: string;
  phone?: string;          // телефон аккаунта (для логина)
  twoFaPassword?: string;  // пароль 2FA, если продавец его задал
  raw: any;                // сырой объект айтема (для отладки/доп. полей)
}

export class LztMarketClient {
  private token: string;

  constructor(token?: string) {
    const t = token || process.env.LZT_API_TOKEN || "";
    if (!t) {
      throw new Error("LZT_API_TOKEN не задан в env — нужен Bearer-токен LZT Market API.");
    }
    this.token = t;
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { _raw: text };
    }

    if (!res.ok) {
      const msg = json?.errors?.join?.("; ") || json?.error || json?.message || text || res.statusText;
      throw new Error(`LZT ${method} ${path} → HTTP ${res.status}: ${msg}`);
    }
    return json;
  }

  /** Информация об айтеме (цена, телефон, 2FA). */
  async getItem(itemId: number): Promise<LztItem> {
    const json = await this.request("GET", `/${itemId}`);
    const it = json?.item ?? json;
    return {
      itemId,
      price: numberOr(it?.price ?? it?.price_currency ?? json?.price),
      priceCurrency: it?.price_currency_symbol || it?.currency || undefined,
      phone: extractPhone(it),
      twoFaPassword: extractTwoFa(it),
      raw: it,
    };
  }

  /**
   * Покупка айтема (fast-buy). Guard: не покупаем, если цена выше maxPrice.
   * ⚠️ Тратит реальные деньги.
   */
  async fastBuy(itemId: number, maxPrice: number): Promise<any> {
    const item = await this.getItem(itemId);
    if (item.price != null && maxPrice != null && item.price > maxPrice) {
      throw new Error(
        `Цена айтема ${itemId} = ${item.price} превышает лимит LZT_MAX_PRICE=${maxPrice}. Покупка отменена.`
      );
    }
    // price/currency передаём для защиты от изменения цены на стороне маркета.
    return this.request("POST", `/${itemId}/fast-buy`, {
      price: item.price,
      currency: item.priceCurrency,
    });
  }

  /**
   * Получить код входа Telegram для купленного айтема. Поллинг до прихода кода.
   * GET /{itemId}/telegram-login-code (подтверждён по доке).
   */
  async getTelegramLoginCode(
    itemId: number,
    opts?: { timeoutMs?: number; intervalMs?: number; notEqualTo?: string; freshAfterSec?: number },
  ): Promise<string> {
    const timeoutMs = opts?.timeoutMs ?? 120_000;
    const intervalMs = opts?.intervalMs ?? 4_000;
    const notEqualTo = opts?.notEqualTo;
    const freshAfter = opts?.freshAfterSec ?? 0; // 0 = любой код (без проверки даты)
    const deadline = Date.now() + timeoutMs;

    let lastErr: any = null;
    let polls = 0;
    while (Date.now() < deadline) {
      polls++;
      try {
        const json = await this.request("GET", `/${itemId}/telegram-login-code`);
        // Берём НОВЕЙШИЙ код (codes[] с датами) и принимаем его только если он
        // СВЕЖИЙ (date >= старт логина) и не равен baseline — иначе Telegram отвергнет
        // устаревший код (PHONE_CODE_INVALID).
        const best = extractNewestCode(json);
        if (best) {
          const ageMin = best.date ? Math.round((Date.now() / 1000 - best.date) / 60) : -1;
          if (best.date >= freshAfter && best.code !== notEqualTo) {
            console.log(`   [код] свежий получен (возраст ${ageMin}м, попытка ${polls})`);
            return best.code;
          }
          console.log(`   [код] только устаревший (возраст ${ageMin}м), жду свежий… (попытка ${polls})`);
        } else {
          console.log(`   [код] codes пусто, жду… (попытка ${polls})`);
        }
      } catch (e) {
        lastErr = e; // код мог ещё не прийти / API троттлит — притормаживаем (backoff)
        console.log(`   [код] запрос упал, backoff: ${(e as Error).message?.slice(0, 60)} (попытка ${polls})`);
        await sleep(Math.max(intervalMs, 12_000)); // на 403 retry_request / 504 — даём API отдышаться
        continue;
      }
      await sleep(intervalMs);
    }
    throw new Error(
      `Свежий код входа для айтема ${itemId} не пришёл за ${Math.round(timeoutMs / 1000)}с` +
        (lastErr ? ` (последняя ошибка: ${lastErr.message})` : "")
    );
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function numberOr(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Достаём телефон из айтема — пробуем известные поля LZT. */
function extractPhone(it: any): string | undefined {
  const cand =
    it?.telegram_phone ||
    it?.phone ||
    it?.loginData?.login ||
    it?.login_data?.login ||
    it?.account_data?.phone;
  if (!cand) return undefined;
  const s = String(cand).trim();
  return s.startsWith("+") ? s : `+${s.replace(/[^\d]/g, "")}`;
}

/** Достаём 2FA-пароль из айтема, если есть. */
function extractTwoFa(it: any): string | undefined {
  const cand =
    it?.telegram_2fa ||
    it?.two_factor_password ||
    it?.password ||
    it?.loginData?.password ||
    it?.login_data?.password;
  return cand ? String(cand) : undefined;
}

/**
 * Новейший код из ответа telegram-login-code: API отдаёт `codes: [{code,date}]`
 * (несколько кодов, включая устаревшие) — берём с максимальной датой.
 */
function extractNewestCode(json: any): { code: string; date: number } | undefined {
  let best: { code: string; date: number } | undefined;
  if (Array.isArray(json?.codes)) {
    for (const c of json.codes) {
      const digits = String(c?.code ?? "").replace(/[^\d]/g, "");
      if (digits.length < 4 || digits.length > 6) continue;
      const date = Number(c?.date) || 0;
      if (!best || date > best.date) best = { code: digits, date };
    }
  }
  if (!best) {
    const flat = json?.code || json?.login_code || json?.telegram_login_code;
    const digits = flat ? String(flat).replace(/[^\d]/g, "") : "";
    if (digits.length >= 4 && digits.length <= 6) best = { code: digits, date: 0 };
  }
  return best;
}
