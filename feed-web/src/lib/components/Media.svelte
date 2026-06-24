<script lang="ts">
  import type { MediaRef } from '$lib/types';
  import Icon from './Icon.svelte';
  import { onMount } from 'svelte';
  import { requestVideo, pollVideo } from '$lib/api';
  // Vidstack theme/layout CSS — SSR-safe (только стили). Сами web-components регистрируем в onMount (клиент).
  import 'vidstack/player/styles/default/theme.css';
  import 'vidstack/player/styles/default/layouts/video.css';

  // cid/mid нужны для LAZY-загрузки видео по клику (async request-reply).
  let { media, cid = null, mid = null }: { media: MediaRef; cid?: string | null; mid?: number | null } = $props();

  let vState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let vUrl = $state<string | null>(null);
  let vidstackReady = $state(false);

  onMount(async () => {
    try {
      // Регистрация custom elements ТОЛЬКО на клиенте (touch customElements/window → не для SSR).
      await import('vidstack/player');
      await import('vidstack/player/layouts/default');
      vidstackReady = true;
    } catch {
      vidstackReady = false; // фолбэк на нативный <video>
    }
  });

  async function playVideo() {
    if (vState === 'loading' || vState === 'ready') return;
    if (!cid || mid == null) { vState = 'error'; return; }
    vState = 'loading';
    try {
      // Первый запрос сразу — при предзагрузке часто уже done (мгновенный cache-hit).
      let r = await requestVideo(cid, mid);
      for (let i = 0; i < 40 && r.status !== 'done' && r.status !== 'error'; i++) {
        await new Promise((res) => setTimeout(res, i < 4 ? 600 : 1500)); // первые опросы чаще
        r = await pollVideo(cid, mid);
      }
      if (r.status === 'done' && r.url) { vUrl = r.url; vState = 'ready'; }
      else vState = 'error';
    } catch {
      vState = 'error';
    }
  }

  function fmtDur(s?: number): string {
    if (!s) return '';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  // Аспект из реальных размеров видео/фото; защита от кривых/нулевых значений (иначе постер искажается).
  function ratio(w?: number, h?: number, fb = 16 / 9): number {
    const ww = Number(w) || 0, hh = Number(h) || 0;
    return ww > 0 && hh > 0 ? ww / hh : fb;
  }
  function ratioStr(w?: number, h?: number): string {
    const ww = Number(w) || 0, hh = Number(h) || 0;
    return ww > 0 && hh > 0 ? `${ww}/${hh}` : '16/9';
  }

  function hostOf(url?: string): string {
    if (!url) return '';
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }
</script>

{#if media.kind === 'photo'}
  <figure class="mb-3 overflow-hidden rounded-lg border border-line">
    <img src={media.url} alt="" loading="lazy" class="block w-full object-cover" style="aspect-ratio: {ratio(media.w, media.h, 16 / 10)}" />
  </figure>

{:else if media.kind === 'album'}
  <div class="mb-3 grid grid-cols-2 gap-1 overflow-hidden rounded-lg border border-line">
    {#each media.items.slice(0, 4) as it, i}
      <div class="relative">
        <img src={it.url} alt="" loading="lazy" class="block h-full w-full object-cover" style="aspect-ratio: 1.4" />
        {#if i === 3 && media.items.length > 4}
          <div class="absolute inset-0 flex items-center justify-center bg-ink/55 font-mono text-sm text-paper">
            +{media.items.length - 4}
          </div>
        {/if}
      </div>
    {/each}
  </div>

{:else if media.kind === 'video'}
  {#if vState === 'ready' && vUrl}
    <!-- Видео готово (lazy в S3) — крутой плеер Vidstack; фолбэк на нативный <video> если не загрузился -->
    <figure class="mb-3 overflow-hidden rounded-lg border border-line bg-ink/5">
      {#if vidstackReady}
        <media-player class="w-full" src={vUrl} poster={media.poster ?? ''} aspect-ratio={ratioStr(media.w, media.h)} autoplay playsinline crossorigin>
          <media-provider></media-provider>
          <media-video-layout></media-video-layout>
        </media-player>
      {:else}
        <video src={vUrl} poster={media.poster} controls autoplay playsinline
          class="block max-h-[70vh] w-full object-contain" style="aspect-ratio: {ratio(media.w, media.h)}"></video>
      {/if}
    </figure>
  {:else}
    <!-- Постер + Play: видео грузится ПО КЛИКУ (lazy). object-contain — не кропит/не искажает -->
    <figure class="group/v relative mb-3 cursor-pointer overflow-hidden rounded-lg border border-line bg-ink/5"
      onclick={playVideo} role="button" tabindex="0"
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') playVideo(); }}>
      {#if media.poster}
        <img src={media.poster} alt="" loading="lazy" class="block w-full object-contain" style="aspect-ratio: {ratio(media.w, media.h)}" />
      {:else}
        <div class="aspect-video w-full bg-ink/10"></div>
      {/if}
      <div class="absolute inset-0 flex items-center justify-center">
        <span class="flex h-12 w-12 items-center justify-center rounded-full bg-paper/90 text-ink shadow-sm">
          {#if vState === 'loading'}
            <span class="h-5 w-5 animate-spin rounded-full border-2 border-ink/25 border-t-ink"></span>
          {:else}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5z" /></svg>
          {/if}
        </span>
      </div>
      {#if media.duration}
        <span class="absolute bottom-2 right-2 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-paper tnum">{fmtDur(media.duration)}</span>
      {/if}
      {#if vState === 'error'}
        <span class="absolute bottom-2 left-2 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-paper">видео недоступно</span>
      {/if}
    </figure>
  {/if}

{:else if media.kind === 'file'}
  <a href="#" class="mb-3 flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 transition hover:border-ink/30">
    <span class="flex h-9 w-9 items-center justify-center rounded bg-muted/15 font-mono text-[10px] uppercase text-muted">
      {media.ext ?? 'file'}
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-[13px] text-ink">{media.name}</span>
      {#if media.size}<span class="font-mono text-[11px] text-muted">{media.size}</span>{/if}
    </span>
    <Icon name="arrow" />
  </a>

{:else if media.kind === 'link'}
  <a href={media.url} target="_blank" rel="noreferrer" class="mb-3 flex overflow-hidden rounded-lg border border-line transition hover:border-ink/30">
    {#if media.thumb}
      <img src={media.thumb} alt="" loading="lazy" class="h-[72px] w-[72px] shrink-0 object-cover" />
    {/if}
    <span class="min-w-0 flex-1 px-3 py-2">
      <span class="block truncate text-[13px] font-medium text-ink">{media.title ?? media.url}</span>
      <span class="font-mono text-[11px] uppercase tracking-wider text-muted">{media.site ?? hostOf(media.url)}</span>
    </span>
  </a>
{/if}
