<script lang="ts">
  import type { MediaRef } from '$lib/types';
  import Icon from './Icon.svelte';
  // Используется только для file/link (визуальное медиа рендерит MediaGallery). Без Vidstack.
  let { media }: { media: MediaRef; cid?: string | null; mid?: number | null } = $props();

  function retryImg(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    if (img.dataset.retried) return;
    img.dataset.retried = '1';
    img.src = img.src.split('?')[0] + '?r=' + Date.now();
  }
  function hostOf(url?: string): string {
    if (!url) return '';
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }
</script>

{#if media.kind === 'file'}
  <a href="#" class="mb-3 flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 transition hover:border-ink/30">
    <span class="flex h-9 w-9 items-center justify-center rounded bg-muted/15 font-mono text-[10px] uppercase text-muted">{media.ext ?? 'file'}</span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-[13px] text-ink">{media.name}</span>
      {#if media.size}<span class="font-mono text-[11px] text-muted">{media.size}</span>{/if}
    </span>
    <Icon name="arrow" />
  </a>
{:else if media.kind === 'link'}
  <a href={media.url} target="_blank" rel="noreferrer" class="mb-3 flex overflow-hidden rounded-lg border border-line transition hover:border-ink/30">
    {#if media.thumb}
      <img src={media.thumb} alt="" loading="lazy" decoding="async" onerror={retryImg} class="h-[72px] w-[72px] shrink-0 object-cover" />
    {/if}
    <span class="min-w-0 flex-1 px-3 py-2">
      <span class="block truncate text-[13px] font-medium text-ink">{media.title ?? media.url}</span>
      <span class="font-mono text-[11px] uppercase tracking-wider text-muted">{media.site ?? hostOf(media.url)}</span>
    </span>
  </a>
{/if}
