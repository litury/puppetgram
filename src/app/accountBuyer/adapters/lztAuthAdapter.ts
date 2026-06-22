/**
 * LZT auth-адаптер: подставляет данные купленного аккаунта вместо ручного ввода.
 *
 * Реализует тот же IInteractiveAuthHandler, что и консольный InteractiveAuthAdapter,
 * поэтому инжектится в существующий SessionGeneratorService без изменений движка:
 *   - requestPhoneNumber → телефон купленного айтема;
 *   - requestPhoneCode   → поллинг LZT API (GET /{itemId}/telegram-login-code);
 *   - requestPassword    → 2FA-пароль из инфо айтема (или внятная ошибка).
 */

import * as fs from "fs";
import prompts from "prompts";
import { IInteractiveAuthHandler } from "../../sessionGenerator/interfaces";
import { LztMarketClient } from "./lztMarketClient";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LztAuthAdapter implements IInteractiveAuthHandler {
  constructor(
    private readonly market: LztMarketClient,
    private readonly itemId: number,
    private readonly phone: string,
    private readonly twoFaPassword?: string,
    // Устаревший код, лежавший на аккаунте ДО нашего sendCode — его пропускаем,
    // ждём свежий (иначе PHONE_CODE_INVALID).
    private readonly baselineCode?: string,
    // Если у аккаунта код виден только на панели LZT (API отдаёт "Code is empty") —
    // спрашиваем код вручную (телефон/2FA всё равно подставляются авто).
    private readonly manualCode?: boolean,
    // Файл, из которого ждём код (его пишет внешний оркестратор, прочитав код с
    // панели LZT через браузер). Позволяет провижнить без интерактивного ввода.
    private readonly codeFile?: string,
    // Unix-секунды старта логина: принимаем только коды с date >= этого (свежие).
    private readonly freshAfterSec?: number,
  ) {}

  async requestPhoneNumber(): Promise<string> {
    return this.phone;
  }

  async requestPhoneCode(): Promise<string> {
    if (this.codeFile) {
      // Поллим файл: оркестратор прочитает код с панели LZT (браузер) и впишет сюда.
      console.log(`⏳ Жду код входа в файле ${this.codeFile} (айтем ${this.itemId})…`);
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        try {
          const raw = fs.readFileSync(this.codeFile, "utf8");
          const code = raw.replace(/[^\d]/g, "");
          if (code.length >= 4 && code.length <= 6) {
            console.log(`✅ Код получен из файла`);
            return code;
          }
        } catch {
          // файла ещё нет — ждём
        }
        await sleep(2000);
      }
      throw new Error(`Код не появился в файле ${this.codeFile} за 180с`);
    }
    if (this.manualCode) {
      const r = await prompts({
        type: "text",
        name: "code",
        message: `Код входа для ${this.phone} (возьми на панели lzt.market/${this.itemId}):`,
        validate: (v: string) => (v && v.trim().length >= 4 ? true : "Код не может быть пустым"),
      });
      return String(r.code || "").trim();
    }
    console.log(
      `📨 Жду свежий код входа у LZT (айтем ${this.itemId}, baseline=${this.baselineCode ?? "нет"})…`,
    );
    const code = await this.market.getTelegramLoginCode(this.itemId, {
      notEqualTo: this.baselineCode,
      freshAfterSec: this.freshAfterSec,
      timeoutMs: 20_000, // рабочий код обычно на 1-й попытке (~7с); запас для медленной доставки
      intervalMs: 3_000,
    });
    console.log(`✅ Код получен`);
    return code;
  }

  async requestPassword(): Promise<string> {
    if (this.twoFaPassword) return this.twoFaPassword;
    throw new Error(
      "Аккаунту требуется 2FA-пароль, но LZT его не вернул. " +
        "Проверь данные айтема или возьми пароль из интерфейса маркета.",
    );
  }

  displayMessage(message: string): void {
    console.log(message);
  }

  displayError(error: string): void {
    console.error(`❌ ${error}`);
  }

  displaySuccess(message: string): void {
    console.log(`✅ ${message}`);
  }
}
