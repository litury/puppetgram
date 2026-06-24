<script lang="ts">
  import type { MediaRef } from '$lib/types';
  import { onMount } from 'svelte';
  import { requestVideo, pollVideo } from '$lib/api';
  // Vidstack CSS — SSR-safe; web-components регистрируем в onMount (клиент).
  import 'vidstack/player/styles/default/theme.css';
  import 'vidstack/player/styles/default/layouts/video.css';

  let { media, cid = null, postMid = null }:
    { media: MediaRef[]; cid?: string | null; postMid?: number | null } = $props();

  // Нормализуем рефы в плоский список плиток (фото/видео). Альбом-обёртку разворачиваем в фото.
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

  let vidstackReady = $state(false);
  onMount(async () => {
    try { await import('vidstack/player'); await import('vidstack/player/layouts/default'); vidstackReady = true; }
    catch { vidstackReady = false; }
  });

  // Состояние раскрытия/видео — по индексу плитки.
  let expanded = $state<number | null>(null);
  let vState = $state<Record<number, 'idle' | 'loading' | 'ready' | 'error'>>({});
  let vUrl = $state<Record<number, string>>({});

  function ratio(w?: number, h?: number, fb = 16 / 9): number {
    const ww = Number(w) || 0, hh = Number(h) || 0; return ww > 0 && hh > 0 ? ww / hh : fb;
  }
  function ratioStr(w?: number, h?: number): string {
    const ww = Number(w) || 0, hh = Number(h) || 0; return ww > 0 && hh > 0 ? `${ww}/${hh}` : '16/9';
  }
  function fmtDur(s?: number): string {
    if (!s) return ''; const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  // Сетка по числу + ориентации (компактно, как альбом Telegram).
  const layout = $derived.by(() => {
    const n = tiles.length;
    if (n <= 1) return { grid: '', cell: 'single' };
    const allLand = tiles.every((t) => (Number(t.w) || 0) > (Number(t.h) || 0) * 1.1);
    const allPort = tiles.every((t) => (Number(t.h) || 0) > (Number(t.w) || 0) * 1.1);
    if (n === 2) return allLand ? { grid: 'grid-cols-1', cell: 'wide' } : { grid: 'grid-cols-2', cell: 'sq' };
    if (n === 3) return allPort ? { grid: 'grid-cols-3', cell: 'sq' } : { grid: 'grid-cols-2', cell: 'sq' };
    if (n === 4) return { grid: 'grid-cols-2', cell: 'sq' };
    return { grid: 'grid-cols-3', cell: 'sq' };
  });

  // mid видео: у одиночного видео ref может быть без mid → postMid (= id того же сообщения) корректен.
  const midOf = (t: Tile): number | null => (t.mid != null ? t.mid : postMid);
  // src превью: постер (видео) или url (фото); может отсутствовать → плейсхолдер.
  const mainSrc = (t: Tile): string | undefined => (t.kind === 'video' ? t.poster : t.url);

  async function onTile(i: number, t: Tile) {
    if (t.kind === 'photo') { expanded = expanded === i ? null : i; return; }
    // видео
    if (expanded === i) { expanded = null; return; }
    expanded = i;
    if (vState[i] === 'ready' || vState[i] === 'loading') return;
    const vmid = midOf(t);
    if (!cid || vmid == null) { vState = { ...vState, [i]: 'error' }; return; }
    vState = { ...vState, [i]: 'loading' };
    try {
      let r = await requestVideo(cid, vmid);
      for (let k = 0; k < 40 && r.status !== 'done' && r.status !== 'error'; k++) {
        await new Promise((res) => setTimeout(res, k < 4 ? 600 : 1500));
        r = await pollVideo(cid, vmid);
      }
      if (r.status === 'done' && r.url) { vUrl = { ...vUrl, [i]: r.url }; vState = { ...vState, [i]: 'ready' }; }
      else vState = { ...vState, [i]: 'error' };
    } catch { vState = { ...vState, [i]: 'error' }; }
  }
</script>

{#if tiles.length === 1}
  {@const t = tiles[0]}
  <!-- Одиночное медиа -->
  <figure class="group/v relative mb-3 cursor-pointer overflow-hidden rounded-lg border border-line bg-ink/5"
    onclick={() => onTile(0, t)} role="button" tabindex="0"
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onTile(0, t); }}>
    {#if t.kind === 'video' && vState[0] === 'ready' && vUrl[0]}
      {#if vidstackReady}
        <media-player class="w-full" src={vUrl[0]} poster={t.poster ?? ''} aspect-ratio={ratioStr(t.w, t.h)} muted autoplay playsinline load="eager">
          <media-provider></media-provider>
          <media-video-layout></media-video-layout>
        </media-player>
      {:else}
        <video src={vUrl[0]} poster={t.poster} controls autoplay muted playsinline class="block max-h-[80vh] w-full object-contain"></video>
      {/if}
    {:else}
      <!-- blur backdrop + контейн (плейсхолдер, если постера нет) -->
      <div class="relative max-h-[70vh] w-full overflow-hidden bg-ink/10" style="aspect-ratio: {ratio(t.w, t.h)}">
        {#if mainSrc(t)}
          <img src={mainSrc(t)} alt="" aria-hidden="true" class="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl opacity-60" />
          <img src={mainSrc(t)} alt="" loading="lazy" class="relative z-10 mx-auto h-full w-full object-contain" />
        {/if}
      </div>
      {#if t.kind === 'video'}
        <div class="absolute inset-0 z-20 flex items-center justify-center">
          <span class="flex h-12 w-12 items-center justify-center rounded-full bg-paper/90 text-ink shadow-sm">
            {#if vState[0] === 'loading'}<span class="h-5 w-5 animate-spin rounded-full border-2 border-ink/25 border-t-ink"></span>
            {:else}<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5z" /></svg>{/if}
          </span>
        </div>
        {#if t.duration}<span class="absolute bottom-2 right-2 z-20 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-paper tnum">{fmtDur(t.duration)}</span>{/if}
        {#if vState[0] === 'error'}<span class="absolute bottom-2 left-2 z-20 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-paper">видео недоступно</span>{/if}
      {/if}
    {/if}
  </figure>

{:else}
  <!-- Сетка альбома -->
  <div class="mb-3 grid {layout.grid} gap-1 overflow-hidden rounded-lg">
    {#each tiles as t, i (i)}
      <figure
        class="group/v relative cursor-pointer overflow-hidden border border-line bg-ink/5 {expanded === i ? 'col-span-full' : ''}"
        onclick={() => onTile(i, t)} role="button" tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onTile(i, t); }}>
        {#if t.kind === 'video' && expanded === i && vState[i] === 'ready' && vUrl[i]}
          {#if vidstackReady}
            <media-player class="w-full" src={vUrl[i]} poster={t.poster ?? ''} aspect-ratio={ratioStr(t.w, t.h)} muted autoplay playsinline load="eager">
              <media-provider></media-provider>
              <media-video-layout></media-video-layout>
            </media-player>
          {:else}
            <video src={vUrl[i]} poster={t.poster} controls autoplay muted playsinline class="block max-h-[80vh] w-full object-contain"></video>
          {/if}
        {:else if expanded === i}
          <!-- раскрытое фото/постер: контейн + blur-заливка (плейсхолдер, если постера нет) -->
          <div class="relative max-h-[85vh] w-full overflow-hidden bg-ink/10" style="aspect-ratio: {ratio(t.w, t.h)}">
            {#if mainSrc(t)}
              <img src={mainSrc(t)} alt="" aria-hidden="true" class="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl opacity-60" />
              <img src={mainSrc(t)} alt="" class="relative z-10 mx-auto h-full w-full object-contain" />
            {/if}
          </div>
          {#if t.kind === 'video'}
            <div class="absolute inset-0 z-20 flex items-center justify-center">
              <span class="flex h-12 w-12 items-center justify-center rounded-full bg-paper/90 text-ink shadow-sm">
                {#if vState[i] === 'loading'}<span class="h-5 w-5 animate-spin rounded-full border-2 border-ink/25 border-t-ink"></span>
                {:else}<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5z" /></svg>{/if}
              </span>
            </div>
          {/if}
        {:else}
          <!-- свёрнутая плитка: object-cover, компактно (плейсхолдер, если постера нет) -->
          <div class="w-full bg-ink/10 {layout.cell === 'wide' ? '' : 'aspect-square'}" style={layout.cell === 'wide' ? `aspect-ratio:${ratio(t.w, t.h)}` : ''}>
            {#if mainSrc(t)}
              <img src={mainSrc(t)} alt="" loading="lazy" class="h-full w-full object-cover" />
            {/if}
          </div>
          {#if t.kind === 'video'}
            <div class="absolute inset-0 flex items-center justify-center">
              <span class="flex h-10 w-10 items-center justify-center rounded-full bg-paper/90 text-ink shadow-sm">
                {#if vState[i] === 'loading'}<span class="h-4 w-4 animate-spin rounded-full border-2 border-ink/25 border-t-ink"></span>
                {:else}<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5z" /></svg>{/if}
              </span>
            </div>
            {#if t.duration}<span class="absolute bottom-1.5 right-1.5 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-paper tnum">{fmtDur(t.duration)}</span>{/if}
          {/if}
        {/if}
      </figure>
    {/each}
  </div>
{/if}
