<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<div class="mx-auto min-h-screen max-w-3xl px-5 sm:px-8">
  <header class="flex items-end justify-between border-b border-ink/85 pb-3 pt-8">
    <div>
      <div class="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
        Тащит лучшее из Telegram · IT
      </div>
      <a href="/" class="font-display text-[34px] font-semibold leading-none tracking-tight text-ink">
        Coroka<span class="text-accent">.</span>
      </a>
    </div>
    <a
      href="/"
      class="font-mono text-[11px] uppercase tracking-wider text-muted underline-offset-4 transition hover:text-ink hover:underline"
    >
      Подключить Telegram
    </a>
  </header>

  {@render children()}

  <footer class="mt-16 border-t border-line py-6 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
    Ранжирование по вовлечённости и выстрелу над нормой канала — не по охвату.
  </footer>
</div>
