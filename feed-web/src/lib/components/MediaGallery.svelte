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

  let expanded = $state<number | null>(null);
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
  function collapse() { expanded = null; }

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

  async function onTile(i: number, t: Tile) {
    if (t.kind === 'photo') { expanded = i; return; }
    expanded = i;
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
</script>

<div class="mb-3 grid {single ? 'grid-cols-1' : layout} gap-1">
  {#each tiles as t, i (i)}
    {#if expanded === i}
      <!-- Развёрнуто: НЕ кнопка (клики идут в плеер/контролы), сворачивание — отдельной кнопкой ✕ -->
      <div class="relative overflow-hidden rounded-lg border border-line bg-ink/5 {single ? '' : 'col-span-full'}">
        {#if t.kind === 'video' && vState[i] === 'ready' && vUrl[i]}
          {#if vidstackReady}
            <media-player class="block w-full" style="aspect-ratio:{ratio(t.w, t.h)}; max-height:85vh" src={vUrl[i]} poster={t.poster ?? ''} muted autoplay playsinline load="eager">
              <media-provider></media-provider>
              <media-video-layout></media-video-layout>
            </media-player>
          {:else}
            <video class="block w-full" style="aspect-ratio:{ratio(t.w, t.h)}; max-height:85vh" src={vUrl[i]} poster={t.poster} controls autoplay muted playsinline></video>
          {/if}
        {:else}
          <!-- фото развёрнуто ИЛИ видео грузится: контейн + blur-заливка -->
          <div class="relative w-full overflow-hidden bg-ink/10" style="aspect-ratio:{ratio(t.w, t.h)}; max-height:85vh">
            {#if mainSrc(t)}
              <img src={mainSrc(t)} alt="" aria-hidden="true" class="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl opacity-60" />
              <img src={mainSrc(t)} alt="" class="relative z-10 mx-auto h-full w-full object-contain" />
            {/if}
            {#if t.kind === 'video'}
              <div class="absolute inset-0 z-20 flex items-center justify-center">
                <span class="flex h-12 w-12 items-center justify-center rounded-full bg-paper/90 text-ink shadow-sm">
                  {#if vState[i] === 'error'}✕{:else}<span class="h-5 w-5 animate-spin rounded-full border-2 border-ink/25 border-t-ink"></span>{/if}
                </span>
              </div>
              {#if vState[i] === 'error'}<span class="absolute bottom-2 left-2 z-20 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-paper">видео недоступно</span>{/if}
            {/if}
          </div>
        {/if}
        <button onclick={() => collapse()} aria-label="Свернуть" class="absolute right-2 top-2 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-ink/70 text-[13px] text-paper transition hover:bg-ink">✕</button>
      </div>
    {:else}
      <!-- Свёрнутая плитка (кнопка): постер object-cover; видео → Play -->
      <button type="button" onclick={() => onTile(i, t)} class="group/v relative block overflow-hidden rounded-lg border border-line bg-ink/10">
        <div class="w-full {single ? '' : 'aspect-square'}" style={single ? `aspect-ratio:${ratio(t.w, t.h)}; max-height:70vh` : ''}>
          {#if mainSrc(t)}<img src={mainSrc(t)} alt="" loading="lazy" class="h-full w-full object-cover" />{/if}
        </div>
        {#if t.kind === 'video'}
          <div class="absolute inset-0 flex items-center justify-center">
            <span class="flex h-12 w-12 items-center justify-center rounded-full bg-paper/90 text-ink shadow-sm">
              {#if vState[i] === 'loading'}<span class="h-5 w-5 animate-spin rounded-full border-2 border-ink/25 border-t-ink"></span>
              {:else}<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5z" /></svg>{/if}
            </span>
          </div>
          {#if t.duration}<span class="absolute bottom-1.5 right-1.5 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-paper tnum">{fmtDur(t.duration)}</span>{/if}
        {/if}
      </button>
    {/if}
  {/each}
</div>
