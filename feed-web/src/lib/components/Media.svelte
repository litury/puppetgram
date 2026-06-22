<script lang="ts">
  import type { MediaRef } from '$lib/types';
  import Icon from './Icon.svelte';

  let { media }: { media: MediaRef } = $props();

  function fmtDur(s?: number): string {
    if (!s) return '';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
</script>

{#if media.kind === 'photo'}
  <figure class="mb-3 overflow-hidden rounded-lg border border-line">
    <img src={media.url} alt="" loading="lazy" class="block w-full object-cover" style="aspect-ratio: {(media.w ?? 16) / (media.h ?? 10)}" />
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
  <figure class="group/v relative mb-3 overflow-hidden rounded-lg border border-line">
    <img src={media.poster} alt="" loading="lazy" class="block w-full object-cover" style="aspect-ratio: {(media.w ?? 16) / (media.h ?? 9)}" />
    <div class="absolute inset-0 flex items-center justify-center">
      <span class="flex h-12 w-12 items-center justify-center rounded-full bg-paper/90 text-ink shadow-sm transition group-hover/v:scale-105">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5z" /></svg>
      </span>
    </div>
    {#if media.duration}
      <span class="absolute bottom-2 right-2 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-paper tnum">{fmtDur(media.duration)}</span>
    {/if}
  </figure>

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
      <span class="font-mono text-[11px] uppercase tracking-wider text-muted">{media.site ?? new URL(media.url).hostname}</span>
    </span>
  </a>
{/if}
