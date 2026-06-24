<script lang="ts">
  import type { MediaRef } from '$lib/types';
  import { onMount } from 'svelte';
  import { requestVideo, pollVideo } from '$lib/api';
  import 'vidstack/player/styles/default/theme.css';
  import 'vidstack/player/styles/default/layouts/video.css';

  let { media, cid = null, postMid = null }:
    { media: MediaRef[]; cid?: string | null; postMid?: number | null } = $props();

  type Tile = { kind: 'photo' | 'video'; url?: string; poster?: string; w?: number; h?: number; mid?: number; duration?: number };
  const tiles: Tile[] = $derived.by(() => {
    const out: Tile[] = [];
    for (const m of media) {
      if (m.kind === 'photo') out.push({ kind: 'photo', url: m.url, w: m.w, h: m.h });
      else if (m.kind === 'video') out.push({ kind: 'video', poster: m.poster, w: m.w, h: m.h, mid: (m as any).mid, duration: m.duration });
      else if (m.kind === 'album') for (const it of m.items) out.push({ kind: 'photo', url: it.url, w: it.w, h: it.h });
    }
    return out;
  });
  const single = $derived(tiles.length === 1);

  let vidstackReady = $state(false);
  onMount(async () => {
    try { await import('vidstack/player'); await import('vidstack/player/layouts/default'); vidstackReady = true; }
    catch { vidstackReady = false; }
  });

  // Лайтбокс: открыт индекс плитки (или null). Видео грузится lazy по mid.
  let open = $state<number | null>(null);
  let vState = $state<Record<number, 'idle' | 'loading' | 'ready' | 'error'>>({});
  let vUrl = $state<Record<number, string>>({});

  const midOf = (t: Tile): number | null => (t.mid != null ? t.mid : postMid);
  const mainSrc = (t: Tile): string | undefined => (t.kind === 'video' ? t.poster : t.url);
  function ratio(w?: number, h?: number, fb = 16 / 9): number {
    const ww = Number(w) || 0, hh = Number(h) || 0; return ww > 0 && hh > 0 ? ww / hh : fb;
  }
  function fmtDur(s?: number): string {
    if (!s) return ''; const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`;
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

  function closeLightbox() { open = null; }

  async function openTile(i: number, t: Tile) {
    open = i;
    if (t.kind !== 'video') return;
    if (vState[i] === 'ready' || vState[i] === 'loading') return;
    const vmid = midOf(t);
    if (!cid || vmid == null) { vState = { ...vState, [i]: 'error' }; return; }
    vState = { ...vState, [i]: 'loading' };
    try {
      let r = await requestVideo(cid, vmid);
      for (let k = 0; k < 60 && r.status !== 'done' && r.status !== 'error'; k++) {
        await new Promise((res) => setTimeout(res, k < 4 ? 600 : 1500));
        r = await pollVideo(cid, vmid);
      }
      if (r.status === 'done' && r.url) { vUrl = { ...vUrl, [i]: r.url }; vState = { ...vState, [i]: 'ready' }; }
      else vState = { ...vState, [i]: 'error' };
    } catch { vState = { ...vState, [i]: 'error' }; }
  }

  const act = $derived(open != null ? tiles[open] : null);
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') closeLightbox(); }} />

<!-- Сетка плиток (компактно, не разворачивается в ленте → вёрстка не прыгает) -->
<div class="mb-3 grid {single ? 'grid-cols-1' : layout} gap-1">
  {#each tiles as t, i (i)}
    <button type="button" onclick={() => openTile(i, t)} class="group/v relative block overflow-hidden rounded-lg border border-line bg-ink/10">
      <div class="w-full {single ? '' : 'aspect-square'}" style={single ? `aspect-ratio:${ratio(t.w, t.h)}; max-height:70vh` : ''}>
        {#if mainSrc(t)}
          <img src={mainSrc(t)} alt="" loading="lazy" class="h-full w-full {single ? 'object-contain' : 'object-cover'}" />
        {/if}
      </div>
      {#if t.kind === 'video'}
        <div class="absolute inset-0 flex items-center justify-center">
          <span class="flex h-12 w-12 items-center justify-center rounded-full bg-paper/90 text-ink shadow-sm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5z" /></svg>
          </span>
        </div>
        {#if t.duration}<span class="absolute bottom-1.5 right-1.5 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-paper tnum">{fmtDur(t.duration)}</span>{/if}
      {/if}
    </button>
  {/each}
</div>

<!-- Модальный лайтбокс: fixed-оверлей, лента НЕ сдвигается -->
{#if open != null && act}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-3 sm:p-6" role="presentation" onclick={closeLightbox}>
    <button onclick={closeLightbox} aria-label="Закрыть" class="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-paper/15 text-lg text-paper transition hover:bg-paper/30">✕</button>
    <!-- stopPropagation: клики по плееру/фото не закрывают -->
    <div class="relative w-full max-w-[1100px]" role="presentation" onclick={(e) => e.stopPropagation()}>
      {#if act.kind === 'video'}
        <!-- ОДИН плеер (как демо): обложка сразу, src лениво в тот же элемент → плавно обложка→видео; без подмены/autoplay -->
        <div class="relative">
          {#if vidstackReady}
            <media-player class="mx-auto block w-full" style="aspect-ratio:{ratio(act.w, act.h)}; max-height:90vh" src={vUrl[open] ?? ''} poster={act.poster ?? ''} playsinline load="eager">
              <media-provider></media-provider>
              <media-video-layout></media-video-layout>
            </media-player>
          {:else}
            <video class="mx-auto block w-full" style="aspect-ratio:{ratio(act.w, act.h)}; max-height:90vh" src={vUrl[open] ?? undefined} poster={act.poster} controls playsinline></video>
          {/if}
          {#if vState[open] === 'loading'}
            <div class="pointer-events-none absolute inset-0 flex items-center justify-center"><span class="h-8 w-8 animate-spin rounded-full border-2 border-paper/40 border-t-paper"></span></div>
          {:else if vState[open] === 'error'}
            <div class="absolute inset-0 flex items-center justify-center"><span class="rounded bg-ink/80 px-3 py-1.5 font-mono text-xs text-paper">видео недоступно</span></div>
          {/if}
        </div>
      {:else}
        <img src={act.url} alt="" class="mx-auto block max-h-[90vh] w-auto object-contain" />
      {/if}
    </div>
  </div>
{/if}
