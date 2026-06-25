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

const SYSTEM = `Ты классификатор постов для IT-ленты. Для каждого поста реши ОДНО: это контент для IT/технической аудитории?

is_it=true — разработка, код, ИИ/ML, devops/инфра, ИБ, базы/данные, железо/гаджеты, IT-стартапы/продукты, UI/UX, IT-карьера, технологии/наука.
is_it=false — политика, общие новости, реклама/проданный пост, спам, лайфстайл, мемы не про IT, гороскопы, всё прочее не про IT.

reason — короткий ярлык-причина (одно слово):
  для is_it=true — подтема: dev | ai_ml | devops | security | data | hardware | startup_biz | design | career | science | it_other
  для is_it=false — причина: politics | news | ads | spam | offtopic | other

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
