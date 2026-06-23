import type { TgEntity } from './types';
import twemoji from 'twemoji';

/** Опции twemoji: SVG-ассеты с поддерживаемого форка (jdecked) через jsDelivr. */
const TWEMOJI_OPTS = {
  folder: 'svg',
  ext: '.svg',
  base: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/',
  className: 'tg-emoji',
} as const;

/**
 * Рендер текста Telegram + entities → безопасный HTML.
 * offset/length у Telegram считаются в UTF-16-единицах — совпадает с индексами JS-строки.
 * Стек-алгоритм с пере-открытием корректно обрабатывает вложенность (напр. жирная ссылка).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeUrl(url: string): string | null {
  const u = url.trim();
  if (/^(https?:)?\/\//i.test(u) || /^(tg|mailto):/i.test(u)) return u.replace(/"/g, '%22');
  return null;
}

/** Открывающий/закрывающий тег для типа entity. null — если не оборачиваем. */
function tagFor(e: TgEntity, rawText: string): { open: string; close: string } | null {
  switch (e.type) {
    case 'Bold': return { open: '<b>', close: '</b>' };
    case 'Italic': return { open: '<i>', close: '</i>' };
    case 'Underline': return { open: '<u>', close: '</u>' };
    case 'Strike': return { open: '<s>', close: '</s>' };
    case 'Code': return { open: '<code class="tg-code">', close: '</code>' };
    case 'Pre': return { open: '<pre class="tg-pre"><code>', close: '</code></pre>' };
    case 'Spoiler': return { open: '<span class="tg-spoiler">', close: '</span>' };
    case 'Blockquote': return { open: '<blockquote class="tg-quote">', close: '</blockquote>' };
    case 'TextUrl': {
      const u = e.url ? safeUrl(e.url) : null;
      return u ? { open: `<a href="${u}" target="_blank" rel="noreferrer nofollow">`, close: '</a>' } : null;
    }
    case 'Url': {
      const raw = rawText.slice(e.offset, e.offset + e.length);
      const u = safeUrl(raw.startsWith('http') ? raw : `https://${raw}`);
      return u ? { open: `<a href="${u}" target="_blank" rel="noreferrer nofollow">`, close: '</a>' } : null;
    }
    case 'Mention': {
      const handle = rawText.slice(e.offset, e.offset + e.length).replace(/^@/, '');
      return handle ? { open: `<a href="https://t.me/${handle}" target="_blank" rel="noreferrer">`, close: '</a>' } : null;
    }
    default: return null; // BotCommand, Hashtag, Email, Phone и пр. — оставляем текстом
  }
}

export function renderEntities(text: string | null, entities: TgEntity[] | null): string {
  if (!text) return '';
  if (!entities || entities.length === 0) return escapeHtml(text);

  // События открытия/закрытия по позициям. Закрытия раньше открытий на одной позиции,
  // длинные entity открываются раньше (внешний слой).
  const valid = entities.filter((e) => tagFor(e, text) && e.length > 0 && e.offset >= 0);
  const opensAt = new Map<number, TgEntity[]>();
  const closesAt = new Map<number, TgEntity[]>();
  for (const e of valid) {
    (opensAt.get(e.offset) ?? opensAt.set(e.offset, []).get(e.offset)!).push(e);
    const end = e.offset + e.length;
    (closesAt.get(end) ?? closesAt.set(end, []).get(end)!).push(e);
  }

  let out = '';
  const stack: TgEntity[] = []; // открытые сейчас (для пере-открытия при перекрытии)

  const closeTag = (e: TgEntity) => { const t = tagFor(e, text); if (t) out += t.close; };
  const openTag = (e: TgEntity) => { const t = tagFor(e, text); if (t) out += t.open; };

  for (let i = 0; i <= text.length; i++) {
    const closing = closesAt.get(i);
    if (closing && closing.length) {
      // закрываем до самых внешних закрываемых, пере-открывая невинно задетые
      const toClose = new Set(closing);
      const reopen: TgEntity[] = [];
      while (stack.length) {
        const top = stack.pop()!;
        closeTag(top);
        if (toClose.has(top)) { toClose.delete(top); if (toClose.size === 0) break; }
        else reopen.push(top);
      }
      for (let r = reopen.length - 1; r >= 0; r--) { stack.push(reopen[r]); openTag(reopen[r]); }
    }
    const opening = opensAt.get(i);
    if (opening && opening.length) {
      // длинные раньше (внешние)
      opening.sort((a, b) => b.length - a.length);
      for (const e of opening) { stack.push(e); openTag(e); }
    }
tities целы
    if (i < text.length) out += escapeHtml(text[i]);
  }
  return out;
}

/**
 * renderEntities + twemoji: каждый эмодзи → SVG-картинка (`img.tg-emoji`), единый ч/б через CSS-filter.
 * Изоморфно (строковый режим twemoji работает и в SSR, и на клиенте) → без hydration mismatch.
 */
export function renderRich(text: string | null, entities: TgEntity[] | null): string {
  return twemoji.parse(renderEntities(text, entities), TWEMOJI_OPTS as any);
}
