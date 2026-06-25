<script lang="ts">
  import type { MediaRef } from '$lib/types';
  import { requestVideo, pollVideo } from '$lib/api';

  let { media, cid = null, postMid = null }:
    { media: MediaRef[]; cid?: string | null; postMid?: number | null } = $props();

  type Tile = { kind: 'photo' | 'video'; url?: string; poster?: string; w?: number; h?: number; mid?: number; duration?: number };
  const tiles: Tile[] = $derived.by(() => {
    const out: Tile[] = [];
    for (const m of media) {
      if (m.kind === 'photo') out.push({ kind: 'photo', url: m.url, w: m.w, h: m.h });
      else if (m.kind === 'video') out.push({ kind: 'video', url: (m as any).url, poster: m.poster, w: m.w, h: m.h, mid: (m as any).mid, duration: m.duration });
      else if (m.kind === 'album') for (const it of m.items) out.push({ kind: 'photo', url: it.url, w: it.w, h: it.h });
    }
    return out;
  });
  const single = $derived(tiles.length === 1);

  // Lazy-URL для видео без готового url (старые посты до эагер-загрузки). Новые имеют t.url сразу.
  let vUrl = $state<Record<number, string>>({});
  let vState = $state<Record<number, 'idle' | 'loading' | 'error'>>({});

  const midOf = (t: Tile): number | null => (t.mid != null ? t.mid : postMid);
  function ratio(w?: number, h?: number, fb = 16 / 9): number {
    const ww = Number(w) || 0, hh = Number(h) || 0; return ww > 0 && hh > 0 ? ww / hh : fb;
  }
  function fmtDur(s?: number): string {
    if (!s) return ''; const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`;
  }
  // Самолечение картинок: при ошибке — один ретрай с cache-buster (S3 иногда отбивает burst → залипает битой).
  function retryImg(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    if (img.dataset.retried) return;
    img.dataset.retried = '1';
    img.src = img.src.split('?')[0] + '?r=' + Date.now();
  }

  async function loadVideo(i: number, t: Tile) {
    if (vState[i] === 'loading') return;
    const vmid = midOf(t);
    if (!cid || vmid == null) { vState = { ...vState, [i]: 'error' }; return; }
    vState = { ...vState, [i]: 'loading' };
    try {
      let r = await requestVideo(cid, vmid);
      for (let k = 0; k < 60 && r.status !== 'done' && r.status !== 'error'; k++) {
        await new Promise((res) => setTimeout(res, k < 4 ? 600 : 1500));
        r = await pollVideo(cid, vmid);
      }
      if (r.status === 'done' && r.url) { vUrl = { ...vUrl, [i]: r.url }; vState = { ...vState, [i]: 'idle' }; }
      else vState = { ...vState, [i]: 'error' };
    } catch { vState = { ...vState, [i]: 'error' }; }
  }

  const layout = $derived.by(() => {
    const n = tiles.length;
    if (n <= 1) return 'grid-cols-1';
    const allLand = tiles.every((t) => (Number(t.w) || 0) > (Number(t.h) || 0) * 1.1);
    const allPort = tiles.every((t) => (Number(t.h) || 0) > (Number(t.w) || 0) * 1.1);
    if (n === 2) return allLand ? 'grid-cols-1' : 'grid-cols-2';
    if (n === 3) return allPort ? 'grid-cols-3' : 'grid-cols-2';
    if (n === 4) return 'grid-cols-2';
    return 'grid-cols-3';
  });
</script>

<div class="mb-3 grid {single ? 'grid-cols-1' : layout} gap-1">
  {#each tiles as t, i (i)}
    {@const vurl = t.url || vUrl[i]}
    <figure class="relative m-0 overflow-hidden rounded-lg border border-line bg-ink/10">
      {#if t.kind === 'video'}
        {#if vurl}
          <!-- Нативный инлайн-плеер: контролы/перемотка/громкость/фуллскрин браузера. Не ломает вёрстку. -->
          <video controls preload="metadata" playsinline poster={t.poster} src={vurl}
            class="block w-full {single ? 'object-contain' : 'object-cover'}"
            style="aspect-ratio:{ratio(t.w, t.h)}; max-height:{single ? '70vh' : '100%'}"></video>
        {:else}
          <!-- url ещё нет (старый пост) — постер + Play, грузим по клику -->
          <button type="button" onclick={() => loadVideo(i, t)} class="group/v block w-full">
            <div class="w-full {single ? '' : 'aspect-square'}" style={single ? `aspect-ratio:${ratio(t.w, t.h)}; max-height:70vh` : ''}>
              {#if t.poster}<img src={t.poster} alt="" loading="lazy" decoding="async" onerror={retryImg} class="h-full w-full {single ? 'object-contain' : 'object-cover'}" />{/if}
            </div>
            <span class="absolute inset-0 flex items-center justify-center">
              <span class="flex h-12 w-12 items-center justify-center rounded-full bg-paper/90 text-ink shadow-sm">
                {#if vState[i] === 'loading'}<span class="h-5 w-5 animate-spin rounded-full border-2 border-ink/25 border-t-ink"></span>
                {:else}<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5z" /></svg>{/if}
              </span>
            </span>
            {#if t.duration}<span class="absolute bottom-1.5 right-1.5 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-paper tnum">{fmtDur(t.duration)}</span>{/if}
            {#if vState[i] === 'error'}<span class="absolute bottom-1.5 left-1.5 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-paper">видео недоступно</span>{/if}
          </button>
        {/if}
      {:else}
        <!-- фото -->
        <div class="w-full {single ? '' : 'aspect-square'}" style={single ? `aspect-ratio:${ratio(t.w, t.h)}; max-height:70vh` : ''}>
          {#if t.url}<img src={t.url} alt="" loading="lazy" decoding="async" onerror={retryImg} class="h-full w-full {single ? 'object-contain' : 'object-cover'}" />{/if}
        </div>
      {/if}
    </figure>
  {/each}
</div>
