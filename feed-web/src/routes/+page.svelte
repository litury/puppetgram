<script lang="ts">
  import PostCard from '$lib/components/PostCard.svelte';
  import { fetchFeed } from '$lib/api';
  import type { FeedPost } from '$lib/types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const PAGE = 50;
  const dedupeInit = (list: FeedPost[]) => {
    const seen = new Set<number>();
    return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  };
  let tab = $state<'hot' | 'latest'>('hot');
  let posts = $state<FeedPost[]>(dedupeInit(data.posts));
  let offset = $state(data.posts.length);
  let loading = $state(false);
  let done = $state(data.posts.length < PAGE);

  // Дедуп по id: offset-пагинация по живому score-списку может вернуть уже показанный пост
  // (энричер пере-скорит → порядок сдвигается → окна перекрываются). Дубль ключа роняет {#each}.
  function dedupe(list: FeedPost[]): FeedPost[] {
    const seen = new Set<number>();
    return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }

  async function switchTab(next: 'hot' | 'latest') {
    if (tab === next) return;
    tab = next;
    loading = true;
    posts = dedupe(await fetchFeed({ limit: PAGE, offset: 0, latest: next === 'latest' }));
    offset = posts.length;
    done = posts.length < PAGE;
    loading = false;
  }

  async function loadMore() {
    if (loading || done) return;
    loading = true;
    const more = await fetchFeed({ limit: PAGE, offset, latest: tab === 'latest' });
    posts = dedupe([...posts, ...more]); // отбрасываем уже показанные id
    offset += more.length;               // двигаемся по серверным страницам по числу полученных
    done = more.length < PAGE;
    loading = false;
  }

  let sentinel: HTMLElement;
  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore());
    io.observe(sentinel);
    return () => io.disconnect();
  });

  const tabs: { id: 'hot' | 'latest'; label: string }[] = [
    { id: 'hot', label: 'Сигнал' },
    { id: 'latest', label: 'Свежее' },
  ];
</script>

<svelte:head>
  <title>Coroka — тащит лучшее из Telegram (IT)</title>
  <meta name="description" content="Coroka собирает лучший IT-контент Telegram и ранжирует по вовлечённости, а не охвату." />
</svelte:head>

<!-- Текстовые тогглы -->
<nav class="flex items-center gap-6 border-b border-line py-3 font-mono text-[12px] uppercase tracking-[0.16em]">
  {#each tabs as t}
    <button
      onclick={() => switchTab(t.id)}
      class="relative py-1 transition-colors {tab === t.id ? 'text-ink' : 'text-muted hover:text-ink'}"
    >
      {t.label}
      {#if tab === t.id}
        <span class="absolute -bottom-[13px] left-0 h-[2px] w-full bg-accent"></span>
      {/if}
    </button>
  {/each}
  <span class="tnum ml-auto text-[11px] tracking-normal text-muted">{posts.length} постов</span>
</nav>

{#if data.error}
  <div class="border-t border-line py-10 text-center font-mono text-[12px] text-muted">
    Лента недоступна: {data.error}.<br />Проверь, что ws-server запущен.
  </div>
{:else if posts.length === 0}
  <div class="border-t border-line py-16 text-center font-mono text-[12px] uppercase tracking-wider text-muted">
    Лента пуста — запусти сбор (feed:listen + feed:enrich)
  </div>
{:else}
  <div>
    {#each posts as post, i (post.id)}
      <div class="rise" style="animation-delay: {Math.min(i, 12) * 35}ms">
        <PostCard {post} rank={i + 1} />
      </div>
    {/each}
  </div>
  <div bind:this={sentinel} class="border-t border-line py-8 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
    {#if loading}Загрузка…{:else if done}Конец ленты{:else}Прокрути дальше{/if}
  </div>
{/if}
