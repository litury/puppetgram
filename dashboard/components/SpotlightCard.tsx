'use client';

import { useRef, type ReactNode, type PointerEvent } from 'react';

// Карточка фичи со spotlight: свечение и подсветка рамки следуют за курсором.
export function SpotlightCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      className="group relative overflow-hidden rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/30"
    >
      {/* Заливка-свечение под курсором */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(220px circle at var(--mx, 50%) var(--my, 0%), color-mix(in srgb, var(--primary) 16%, transparent), transparent 70%)',
        }}
      />
      {/* Подсветка рамки под курсором (виден только бордер через mask-composite) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-60"
        style={{
          padding: '1px',
          background:
            'radial-gradient(220px circle at var(--mx, 50%) var(--my, 0%), var(--primary), transparent 70%)',
          WebkitMask:
            'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          maskComposite: 'exclude',
        }}
      />

      <div className="relative mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
        {icon}
      </div>
      <h3 className="relative mb-2 text-lg font-semibold text-foreground" style={{ fontFamily: 'var(--font-bricolage)' }}>
        {title}
      </h3>
      <p className="relative text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
