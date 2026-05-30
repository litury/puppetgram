'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/config';

interface Stats {
  totalComments: number;
  channelsCount: number;
  totalReach: number;
}

function compact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace('.0', '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

function useCountUp(target: number, run: boolean, duration = 1400): number {
  const [val, setVal] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!run || !target) return;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, run, duration]);
  return val;
}

export function LiveMetrics({
  labels,
}: {
  labels: { comments: string; channels: string; reach: string };
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/public-stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats({ totalComments: 145000, channelsCount: 254000, totalReach: 1320000000 }));
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && setVisible(true),
      { threshold: 0.3 }
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  const run = visible && !!stats;
  const c = useCountUp(stats?.totalComments ?? 0, run);
  const ch = useCountUp(stats?.channelsCount ?? 0, run);
  const r = useCountUp(stats?.totalReach ?? 0, run);

  const items = [
    { v: c, label: labels.comments },
    { v: ch, label: labels.channels },
    { v: r, label: labels.reach },
  ];

  return (
    <div ref={ref} className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-border bg-border">
      {items.map((it, i) => (
        <div key={i} className="bg-background/80 px-4 py-6 text-center backdrop-blur-sm sm:px-6 sm:py-8">
          <div
            className="text-2xl font-bold tabular-nums text-foreground sm:text-4xl"
            style={{ fontFamily: 'var(--font-jetbrains)' }}
          >
            {compact(it.v)}
            <span className="text-primary">+</span>
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground sm:text-xs">
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}
