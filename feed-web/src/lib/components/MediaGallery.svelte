<script lang="ts">
  import type { MediaRef } from '$lib/types';

  let { media }: { media: MediaRef[] } = $props();

  type Tile = { kind: 'photo' | 'video'; url?: string; poster?: string; w?: number; h?: number; duration?: number };
  const tiles: Tile[] = $derived.by(() => {
    const out: Tile[] = [];
    for (const m of media) {
      if (m.kind === 'photo') out.push({ kind: 'photo', url: m.url, w: m.w, h: m.h });
      else if (m.kind === 'video') out.push({ kind: 'video', url: (m as any).url, poster: m.poster, w: m.w, h: m.h, duration: m.duration });
      else if (m.kind === 'album') for (const it of m.items) out.push({ kind: 'photo', url: it.url, w: it.w, h: it.h });
    }
    return out;
  });
  const single = $derived(tiles.length === 1);

  function fmtDur(s?: number): string {
    if (!s) return ''; const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`;
  }
</script>

<div class="mb-3 grid {single ? 'grid-cols-1' : 'grid-cols-2'} gap-1">
  {#each tiles as t, i (i)}
    <figure class="relative m-0 overflow-hidden rounded-lg border border-line bg-ink/10">
      {#if t.kind === 'video'}
        {#if t.url}
          <video controls preload="metadata" playsinline poster={t.poster} src={t.url} class="block w-full max-h-[70vh]"></video>
          {#if t.duration}<span class="absolute bottom-1.5 right-1.5 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-paper">{fmtDur(t.duration)}</span>{/if}
        {:else}
          <!-- отладка: видно, что слой данных не дал url -->
          <div class="flex aspect-video items-center justify-center text-xs text-ink/50">видео: нет url</div>
        {/if}
      {:else if t.url}
        <img src={t.url} alt="" loading="lazy" class="block w-full max-h-[70vh] object-contain" />
      {:else}
        <div class="flex aspect-video items-center justify-center text-xs text-ink/50">фото: нет url</div>
      {/if}
    </figure>
  {/each}
</div>
