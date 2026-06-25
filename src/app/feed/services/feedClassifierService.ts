/**
 * feedClassifierService — авто-классификация постов по теме (IT vs политика/реклама/новости/спам).
 *
 * Пачка постов → один LLM-вызов (DeepSeek) → строгий JSON [{mid, category, confidence}].
 * category из фикс-таксономии (contentCategories). Дёшево: батчим, температура 0, текст обрезаем.
 */

import { createLlmClient, LLM_MODEL } from '../adapters/llmClient';
import { ALL_CATEGORIES, ContentCategory } from '../config/contentCategories';
import { createLogger } from '../../../shared/utils/logger';

const log = createLogger('FeedClassifier');
const TEXT_CAP = 600; // символов на пост — хватает для темы, бьёт по токенам

export interface ClassifyInput { mid: number; text: string; }
export interface ClassifyResult { mid: number; category: ContentCategory; confidence: number; }

const SYSTEM = `Ты классификатор постов для IT-ленты. Каждому посту присвой ОДНУ категорию.

IT (целевое): dev (разработка/код), ai_ml (ИИ/ML), devops (инфра/облака), security (ИБ),
data (БД/аналитика), hardware (железо/гаджеты), startup_biz (IT-стартапы/продукты), design (UI/UX),
career (карьера/вакансии в IT), science (наука/технологии).
НЕ IT: politics (политика), news (общие новости не про IT), ads (реклама/проданный пост),
spam (мусор), offtopic (лайфстайл/мемы не про IT/прочее).

Важно: слово «фронт» в IT = фронтенд, НЕ политика. Технические термины не путай с политикой.
Отвечай СТРОГО JSON: {"items":[{"mid":<число>,"category":"<одна категория>","confidence":<0..1>}]}.
Никакого текста вне JSON.`;

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
        category: (ALL_CATEGORIES.includes(x?.category) ? x.category : 'offtopic') as ContentCategory,
        confidence: Number(x?.confidence ?? 0),
      }))
      .filter((x) => Number.isFinite(x.mid));
  }
}
