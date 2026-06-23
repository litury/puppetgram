<script lang="ts">
  import type { FeedPost, MediaRef } from '$lib/types';
  import Icon from './Icon.svelte';
  import Media from './Media.svelte';
  import { renderRich } from '$lib/entities';

  let { post, rank }: { post: FeedPost; rank: number } = $props();

  function fmt(n: number | null): string {
    if (!n) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace('.0', '') + 'K';
    return String(n);
  }

  function totalReactions(r: Record<string, number> | null): number {
    if (!r) return 0;
    return Object.values(r).reduce((a, b) => a + (b || 0), 0);
  }

  function timeAgo(iso: string | null): string {
    if (!iso) return '';
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  // Честный «почему» — из доминирующего сигнала, без выдумок.
  function whyRanked(p: FeedPost): string {
    const v = p.views || 1;
    const fwd = (p.forwards || 0) / v;
    const rep = (p.repliesCount || 0) / v;
    const rec = totalReactions(p.reactions) / v;
    const top = Math.max(fwd, rep, rec);
    if (top === fwd && fwd > 0) return 'Расходится репостами';
    if (top === rep && rep > 0) return 'Живое обсуждение';
    if (rec > 0) return 'Сильный отклик';
    return 'В тренде ниши';
  }

  const LIMIT = 360;
  let expanded = $state(false);
  const full = $derived(post.text ?? '');
  const isLong = $derived(full.length > LIMIT);
  // Рендерим ВСЕГДА полный текст с форматированием; обрезку делаем CSS-клэмпом (не slice),
  // чтобы не ломать offset'ы entities.
  const html = $derived(renderRich(post.text, post.entities));
  const reactions = $derived(totalReactions(post.reactions));
  const rankStr = $derived(String(rank).padStart(2, '0'));
  // mediaRefs может быть одиночным или массивом — нормализуем.
  const mediaList = $derived(
    post.mediaRefs ? (Array.isArray(post.mediaRefs) ? post.mediaRefs : [post.mediaRefs]) : []
  ) as MediaRef[];
</script>

<article
  class="group border-t border-line py-6 transition-colors hover:bg-ink/[0.015]"
>
  <div class="min-w-0">
    <!-- Мета (ранг компактно справа) -->
    <div class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted">
      {#if post.channelAvatar}
        <img src={post.channelAvatar} alt="" loading="lazy" class="h-5 w-5 shrink-0 rounded-full object-cover" />
      {:else}
        <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted/15 text-[9px] uppercase text-muted">{(post.channelUsername ?? '?').slice(0, 1)}</span>
      {/if}
      <span class="font-medium text-ink">@{post.channelUsername ?? '—'}</span>
      <span class="tnum">{timeAgo(post.postedAt)}</span>
      {#if post.category}
        <span class="uppercase tracking-wider text-accent">/ {post.category}</span>
      {/if}
      <span class="tnum ml-auto select-none {rank === 1 ? 'text-accent' : 'text-line group-hover:text-accent'}">#{rankStr}</span>
    </div>

    <!-- Текст -->
    {#if full}
      <!-- eslint-disable-next-line svelte/no-at-html-tags — entities санитизированы в renderEntities -->
      <p class="tg-text mb-1 whitespace-pre-line text-[15.5px] leading-relaxed text-ink/90 {!expanded && isLong ? 'tg-clamp' : ''}">{@html html}</p>
      {#if isLong}
        <button
          onclick={() => (expanded = !expanded)}
          class="mb-3 font-mono text-[11px] uppercase tracking-wider text-accent underline-offset-4 hover:underline"
        >
          {expanded ? 'Свернуть' : 'Читать дальше'}
        </button>
      {:else}
        <div class="mb-3"></div>
      {/if}
    {/if}

    {#each mediaList as m}
      <Media media={m} />
    {/each}

    <!-- Метрики + почему + ссылка -->
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/70 pt-3 font-mono text-[12px] text-ink/65">
      <span class="tnum inline-flex items-center gap-1.5" title="просмотры"><Icon name="eye" /> {fmt(post.views)}</span>
      <span class="tnum inline-flex items-center gap-1.5" title="репосты"><Icon name="repost" /> {fmt(post.forwards)}</span>
      <span class="tnum inline-flex items-center gap-1.5" title="комментарии"><Icon name="comment" /> {fmt(post.repliesCount)}</span>
      <span class="tnum inline-flex items-center gap-1.5" title="реакции"><Icon name="spark" /> {fmt(reactions)}</span>

      <span class="inline-flex items-center gap-1.5 text-ink/55">
        <Icon name="trend" /> <span class="uppercase tracking-wide">{whyRanked(post)}</span>
      </span>

      {#if post.link}
        <a
          href={post.link}
          target="_blank"
          rel="noreferrer"
          class="ml-auto inline-flex items-center gap-1 text-ink underline-offset-4 transition hover:text-accent hover:underline"
        >
          Открыть <Icon name="arrow" />
        </a>
      {/if}
    </div>
  </div>
</article>
