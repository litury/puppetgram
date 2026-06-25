/**
 * feedClassifierService — авто-классификация постов ПОЗИТИВНО: «это IT для тех-аудитории?» да/нет + причина.
 *
 * Не перечисляем все виды мусора (бесконечно/дырявно) — одно правило «IT», всё прочее отсекается.
 * reason — свободный короткий ярлык (для аналитики): IT-подтема или politics/ads/news/trash/offtopic/other.
 * Пачка постов → один LLM-вызов (DeepSeek) → строгий JSON [{mid, is_it, reason, confidence}].
 */

import { createLlmClient, LLM_MODEL } from '../adapters/llmClient';
import { createLogger } from '../../../shared/utils/logger';

const log = createLogger('FeedClassifier');
const TEXT_CAP = 600;

export interface ClassifyInput { mid: number; text: string; }
export interface ClassifyResult { mid: number; isIt: boolean; reason: string; confidence: number; }

const SYSTEM = `Ты классификатор постов для умной IT-ленты. Лента нужна ради СОДЕРЖАТЕЛЬНОГО IT-контента: разбор, гайд, новость технологии, релиз, код, обсуждение по существу.

ГЛАВНОЕ ПРАВИЛО: мета-контент/призыв/коммерция важнее темы. Если пост — это продажа, сбор денег, анонс или самопиар, то is_it=false, ДАЖE если тема про IT и канал хороший.
  • reason="ads" — продажа/инфобиз/деньги:
     - курсы/менторство/обучение, «запишись», «успей купить», «осталось N мест», промокоды;
     - success-story как реклама услуги («оффер за N дней с ментором», «прошёл курс → зарплата X»);
     - донаты/сбор средств: boosty, donatealerts, patreon, «поддержи проект/автора», «копилка», «сбор на серверы», кошельки/реквизиты (TON, USDT, СБП, номер карты, «250руб+ ревью резюме»);
     - реферальные/партнёрские ссылки, нативная реклама, платные подписки/каналы.
  • reason="promo" — анонс/самопиар без существа:
     - анонсы стримов/митапов/эфиров/событий («АНОНС СТРИМА», «стартуем в 19:00», ссылки twitch/youtube/vk на трансляцию), «подпишись/залетай», «я завёл канал/буст».
Честный IT-контент (туториал, разбор, новость технологии, открытый код, обсуждение по теме) — НЕ ads и НЕ promo.

is_it=true (если НЕ продажа/анонс/самопиар) — разработка/код, ИИ/ML, devops/инфра, ИБ, базы/данные, железо/гаджеты, IT-стартапы/продукты, UI/UX, IT-карьера (вакансии — ок), технологии/наука.
is_it=false — ads, promo, политика, общие новости, спам, лайфстайл/мемы не про IT, прочее.

reason — короткий ярлык:
  is_it=true: dev | ai_ml | devops | security | data | hardware | startup_biz | design | career | science | it_other
  is_it=false: ads | promo | politics | news | spam | offtopic | other

Важно: слово «фронт» в IT = фронтенд, НЕ политика. Технические термины не путай.
Отвечай СТРОГО JSON: {"items":[{"mid":<число>,"is_it":<true|false>,"reason":"<ярлык>","confidence":<0..1>}]}.
Без текста вне JSON.`;

export class FeedClassifierService {
  private client = createLlmClient();

  async classifyBatch(posts: ClassifyInput[]): Promise<ClassifyResult[]> {
    if (!posts.length) return [];
    const user = posts
      .map((p) => `#${p.mid}: ${(p.text || '').slice(0, TEXT_CAP).replace(/\s+/g, ' ').trim()}`)
      .join('\n---\n');

    let raw = '{}';
    try {
      const resp = await this.client.chat.completions.create({
        model: LLM_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      });
      raw = resp.choices[0]?.message?.content || '{}';
    } catch (e: any) {
      log.warn('LLM-вызов не удался', { error: e?.message, batch: posts.length });
      return [];
    }

    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { log.warn('JSON парс не удался', { raw: raw.slice(0, 200) }); return []; }
    const arr: any[] = Array.isArray(parsed) ? parsed : parsed.items || parsed.results || [];

    return arr
      .map((x) => ({
        mid: Number(x?.mid),
        isIt: x?.is_it === true,
        reason: String(x?.reason || 'other').toLowerCase().slice(0, 20),
        confidence: Number(x?.confidence ?? 0),
      }))
      .filter((x) => Number.isFinite(x.mid));
  }
}
