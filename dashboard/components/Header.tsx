'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ThemeToggle } from './ThemeToggle';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useCurrentLocale } from '@/locales/client';

export function Header() {
  const locale = useCurrentLocale();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-neutral-950/80 border-b border-neutral-800/50">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 h-14 sm:h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href={`/${locale}`} className="flex items-center gap-2 text-accent-400 hover:opacity-80 transition-opacity">
          <Image
            src="/puppetgram-logo.png"
            alt="Puppetgram"
            width={40}
            height={40}
            className="w-8 h-8 sm:w-9 sm:h-9"
          />
          <span className="hidden sm:inline font-semibold text-primary text-sm sm:text-base">Puppetgram</span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-3 sm:gap-4">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
