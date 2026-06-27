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
  • reason="jobs" — КОНКРЕТНАЯ вакансия/резюме/наём (не показываем в основной ленте):
     - «требуется/ищем <роль>», «вакансия», описание позиции (зарплата, город, занятость, требуемые навыки, ссылка-отклик career.habr/hh/@progjob и т.п.);
     - «резюме <уровень/стек>», «ищу работу», форварды job-бордов.
     ЭТО НЕ career: обсуждение/аналитика рынка БЕЗ конкретной вакансии → career (см. ниже).
Честный IT-контент (туториал, разбор, новость технологии, открытый код, обсуждение по теме) — НЕ ads и НЕ promo.

is_it=true (если НЕ продажа/анонс/самопиар/вакансия) — разработка/код, ИИ/ML, devops/инфра, ИБ, базы/данные, железо/гаджеты, IT-стартапы/продукты, UI/UX, технологии/наука; а также IT-карьера/рынок труда как ОБСУЖДЕНИЕ (тренды найма, «нужны ли джуны», как расти) — reason="career", но БЕЗ конкретной вакансии (конкретная вакансия/резюме → jobs).
is_it=false — jobs, ads, promo, политика, общие новости, спам, лайфстайл/мемы не про IT, прочее.
Важно про it_other: искусство/культура/выставки/лайфстайл — это offtopic, ДАЖЕ если вскользь упомянуты вуз/студенты/программирование. it_other — только реально про технологии.

reason — короткий ярлык:
  is_it=true: dev | ai_ml | devops | security | data | hardware | startup_biz | design | career | science | it_other
  is_it=false: jobs | ads | promo | politics | news | spam | offtopic | other

Важно: слово «фронт» в IT = фронтенд, НЕ политика. Технические термины не путай.
Отвечай СТРОГО JSON: {"items":[{"mid":<число>,"is_it":<true|false>,"reason":"<ярлык>","confidence":<0..1>}]}.
Без текста вне JSON.`;

export class FeedClassifierService {
  private client = createLlmClient();

  /** Канальный IT-фильтр по названию(+описанию): {key, isIt}. Для отбора каналов при харвесте (без чтения постов). */
  async classifyChannelsIT(channels: Array<{ key: string; title: string; about?: string }>): Promise<Array<{ key: string; isIt: boolean }>> {
    if (!channels.length) return [];
    const sys = `Ты решаешь, брать ли Telegram-КАНАЛ в IT-ленту, видя только название (+описание, если есть). Сигнал слабый — поэтому будь ЩЕДРЫМ к IT.
is_it=true — любой намёк на технику: разработка/код, языки/фреймворки (JS, React, Vue, Node, Python, Go, …), ИИ/ML/нейросети, devops/облака, ИБ, данные/аналитика, железо/гаджеты, IT-стартапы/продукты, дизайн UI/UX, IT-карьера/вакансии, технологии/наука. Если СОМНЕВАЕШЬСЯ или название неоднозначное/сленговое — лучше ВЗЯТЬ (is_it=true).
is_it=false — только если ЯВНО не про IT: общие новости/политика, бизнес/финансы/трейдинг/крипто-торговля не про технологии, лайфстайл/развлечения/мемы; И инфобиз-каналы по самому НАЗВАНИЮ (менторство, «научу/с нуля за N», курсы/академия/буткемп, коучинг).
СТРОГО JSON: {"items":[{"key":"<key>","is_it":<true|false>}]}. Без текста вне JSON.`;
    const user = channels.map((c) => `${c.key} | ${c.title}${c.about ? ' — ' + c.about.slice(0, 160) : ''}`).join('\n');
    try {
      const resp = await this.client.chat.completions.create({
        model: LLM_MODEL, temperature: 0, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user.replace(/[\uD800-\uDFFF]/g, '') }],
      });
      const parsed: any = JSON.parse(resp.choices[0]?.message?.content || '{}');
      const arr: any[] = Array.isArray(parsed) ? parsed : parsed.items || [];
      return arr.map((x) => ({ key: String(x?.key), isIt: x?.is_it === true })).filter((x) => x.key);
    } catch (e: any) {
      log.warn('Канальная классификация не удалась', { error: e?.message, batch: channels.length });
      return [];
    }
  }

  async classifyBatch(posts: ClassifyInput[]): Promise<ClassifyResult[]> {
    if (!posts.length) return [];
    // slice может разрезать эмодзи → одиночный суррогат → невалидный JSON в запросе к LLM (400). Чистим суррогаты.
    const clean = (s: string) => s.slice(0, TEXT_CAP).replace(/[\uD800-\uDFFF]/g, '').replace(/\s+/g, ' ').trim();
    const user = posts.map((p) => `#${p.mid}: ${clean(p.text || '')}`).join('\n---\n');

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
