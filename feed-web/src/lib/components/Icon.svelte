<script lang="ts">
  // Hairline line-иконки (Lucide-стиль), currentColor, без эмодзи.
  type Name = 'eye' | 'repost' | 'comment' | 'spark' | 'arrow' | 'trend';
  let { name, size = 14 }: { name: Name; size?: number } = $props();

  const paths: Record<Name, string> = {
    eye: 'M1 8s2.7-5 7-5 7 5 7 5-2.7 5-7 5-7-5-7-5z M8 10.2A2.2 2.2 0 1 0 8 5.8a2.2 2.2 0 0 0 0 4.4z',
    repost: 'M3 4h7a3 3 0 0 1 3 3v1 M3 4l2.2-2.2 M3 4l2.2 2.2 M13 12H6a3 3 0 0 1-3-3V8 M13 12l-2.2-2.2 M13 12l-2.2 2.2',
    comment: 'M2 3.5h12v8H6l-3 2.5v-2.5H2z',
    spark: 'M8 1.5l1.7 4.3 4.3 1.7-4.3 1.7L8 13.5l-1.7-4.3L2 7.5l4.3-1.7z',
    arrow: 'M3.5 8h9 M9 4.5L12.5 8 9 11.5',
    trend: 'M2 11l3.5-3.5 2.5 2.5L13 4 M13 4h-3 M13 4v3',
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.25"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={paths[name]} />
</svg>
