/**
 * MVP-скрипт: купить ТГ-аккаунт на LZT Market → получить SESSION_STRING.
 *
 * Поток: getItem (цена/телефон) → fast-buy (guard по цене) → логин через
 * существующий SessionGeneratorService с LztAuthAdapter (код тянется из LZT API) →
 * вывод SESSION_STRING + дозапись в ./data/checker-sessions.env (для копипаста в env чекера).
 *
 * Запуск:
 *   npm run accounts:buy -- --item 239686059 --dry     # только показать цену/телефон
 *   npm run accounts:buy -- --item 239686059           # купить + залогинить
 *
 * ⚠️ Боевой режим ТРАТИТ реальные деньги. Покупает РОВНО один айтем за запуск,
 *    и только если цена ≤ LZT_MAX_PRICE.
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { LztMarketClient } from "../adapters/lztMarketClient";
import { LztAuthAdapter } from "../adapters/lztAuthAdapter";
import { SessionGeneratorService } from "../../sessionGenerator/services/sessionGeneratorService";
import { AccountsRepository } from "../../../shared/database";

dotenv.config();

function parseArgs(argv: string[]): { itemId?: number; dry: boolean; owned: boolean; manualCode: boolean } {
  let itemId: number | undefined;
  let dry = false;
  let owned = false;
  let manualCode = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--item") itemId = Number(argv[++i]);
    else if (argv[i] === "--dry") dry = true;
    else if (argv[i] === "--owned" || argv[i] === "--no-buy") owned = true;
    else if (argv[i] === "--manual-code") manualCode = true;
  }
  if (!itemId && process.env.LZT_ITEM_ID) itemId = Number(process.env.LZT_ITEM_ID);
  return { itemId, dry, owned, manualCode };
}

const OUT_FILE = path.join(process.cwd(), "data", "checker-sessions.env");

/** Следующий индекс SESSION_STRING_CHECKER_N по локальному файлу-стейджингу. */
function nextCheckerIndex(): number {
  try {
    const txt = fs.readFileSync(OUT_FILE, "utf8");
    const nums = [...txt.matchAll(/SESSION_STRING_CHECKER_(\d+)\s*=/g)].map((m) => Number(m[1]));
    return nums.length ? Math.max(...nums) + 1 : 1;
  } catch {
    return 1;
  }
}

async function main() {
  const { itemId, dry, owned, manualCode } = parseArgs(process.argv.slice(2));
  if (!itemId || !Number.isFinite(itemId)) {
    throw new Error("Не задан айтем. Пример: npm run accounts:buy -- --item 239686059 [--dry]");
  }

  const apiId = Number(process.env.API_ID);
  const apiHash = process.env.API_HASH || "";
  if (!apiId || !apiHash) {
    throw new Error("API_ID / API_HASH должны быть в .env");
  }
  const maxPrice = Number(process.env.LZT_MAX_PRICE || 15);

  const market = new LztMarketClient();

  // 1. Инфо об айтеме
  const item = await market.getItem(itemId);
  console.log(`🛒 Айтем ${itemId}: цена=${item.price ?? "?"} ${item.priceCurrency ?? ""}, телефон=${item.phone ?? "(появится после покупки)"}`);

  if (dry) {
    console.log("🔎 Dry-run — покупка не выполняется. Сырой объект айтема:");
    console.log(JSON.stringify(item.raw, null, 2).slice(0, 2000));
    return;
  }

  // 2. Покупка (guard по цене внутри fastBuy). При --owned пропускаем — айтем уже куплен.
  if (owned) {
    console.log(`↩️  --owned: пропускаю покупку, айтем ${itemId} считается уже купленным.`);
  } else {
    console.log(`💳 Покупаю айтем ${itemId} (лимит цены ${maxPrice})…`);
    await market.fastBuy(itemId, maxPrice);
    console.log("✅ Куплено.");
  }

  // 3. После покупки телефон/2FA могут стать доступны — перечитываем
  const bought = await market.getItem(itemId);
  const phone = bought.phone || item.phone;
  if (!phone) {
    throw new Error(
      `Не удалось определить телефон айтема ${itemId} после покупки. Сырой объект:\n` +
        JSON.stringify(bought.raw, null, 2).slice(0, 2000),
    );
  }

  // 4. Логин через существующий движок.
  //    Авто: LZT-адаптер тянет СВЕЖИЙ код (baseline = устаревший код, лежащий ДО
  //    нашего sendCode, его пропускаем — иначе PHONE_CODE_INVALID).
  //    --manual-code: ручной ввод кода (берёшь с панели LZT) — 100% надёжно.
  // Старт логина (unix-сек, с буфером) — коды старше этого считаем устаревшими.
  const loginStartSec = Math.floor(Date.now() / 1000) - 15;
  const baseline = manualCode
    ? undefined
    : await market.getTelegramLoginCode(itemId, { timeoutMs: 3000 }).catch(() => undefined);
  const auth = new LztAuthAdapter(
    market,
    itemId,
    phone,
    bought.twoFaPassword,
    baseline,
    manualCode,
    undefined,
    loginStartSec,
  );
  if (manualCode) {
    console.log(`✍️  Ручной режим: телефон ${phone}, код возьми на панели lzt.market/${itemId}.`);
  }
  const service = new SessionGeneratorService(auth);
  const result = await service.generateSession({ apiId, apiHash });

  // 5. Вывод + дозапись в стейджинг-файл
  const idx = nextCheckerIndex();
  const usernameVal = result.username || String(result.userId || phone.replace(/[^\d]/g, ""));
  const block =
    `\n# айтем ${itemId} | ${result.firstName ?? ""} ${result.lastName ?? ""} | ${phone}\n` +
    `SESSION_STRING_CHECKER_${idx}=${result.sessionString}\n` +
    `USERNAME_CHECKER_${idx}=${usernameVal}\n`;

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.appendFileSync(OUT_FILE, block, "utf8");

  // Основной путь: пишем аккаунт в БД-пул чекера (accounts) — без env/редеплоя.
  // Чекер подхватит его на ближайшем reload (~неск. минут).
  try {
    await new AccountsRepository().insertAccount({
      pool: "checker",
      sessionString: result.sessionString,
      tgId: result.userId,
      username: result.username || undefined,
      phone,
      sourceItemId: String(itemId),
    });
    console.log("🗄️  Аккаунт записан в БД-пул accounts(pool='checker').");
  } catch (e) {
    console.error(`⚠️ Не удалось записать в БД (есть копия в ${OUT_FILE}): ${(e as Error).message}`);
  }

  console.log("\n=== ГОТОВО ===");
  console.log(`SESSION_STRING_CHECKER_${idx} (бэкап) сохранён в ${OUT_FILE}`);
  console.log(`Аккаунт: @${result.username ?? "—"} (id ${result.userId ?? "?"}), телефон ${phone}`);
  console.log("Чекер подхватит аккаунт из БД на ближайшем reload — редеплой не нужен.");

  // Машинно-читаемая строка для скилла/оркестратора (одной строкой в stdout)
  console.log(
    "RESULT_JSON=" +
      JSON.stringify({
        itemId,
        sessionString: result.sessionString,
        userId: result.userId ?? null,
        username: result.username ?? null,
        phone,
      }),
  );
}

main().catch((e) => {
  console.error(`❌ accounts:buy: ${e?.message || e}`);
  process.exit(1);
});
