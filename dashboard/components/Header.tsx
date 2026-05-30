'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useCurrentLocale } from '@/locales/client';

export function Header() {
  const locale = useCurrentLocale();
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    function onScroll() {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < 10) {
          setHidden(false);
        } else if (y > lastY.current && y > 80) {
          setHidden(true); // скролл вниз — прячем
        } else if (y < lastY.current) {
          setHidden(false); // скролл вверх — показываем
        }
        lastY.current = y;
        ticking.current = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={`fixed inset-x-0 top-3 z-50 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
        hidden ? '-translate-y-[150%]' : 'translate-y-0'
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Лого-пилюля */}
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1.5 text-accent-400 shadow-sm backdrop-blur-md transition-opacity hover:opacity-80"
        >
          <Image
            src="/puppetgram-logo.png"
            alt="Puppetgram"
            width={40}
            height={40}
            className="size-7 sm:size-8"
          />
          <span className="hidden pr-1 text-sm font-semibold text-primary sm:inline">Puppetgram</span>
        </Link>

        {/* Контролы — отдельные острова справа */}
        <div className="inline-flex items-center gap-2 sm:gap-3">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
