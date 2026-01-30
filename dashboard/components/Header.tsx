'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ThemeToggle } from './ThemeToggle';

interface HeaderProps {
  currentPage: 'landing' | 'dashboard';
}

export function Header({ currentPage }: HeaderProps) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-neutral-950/80 border-b border-neutral-800/50">
      <div className="mx-auto px-6 md:px-8 lg:px-12 h-14 sm:h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-accent-400 hover:opacity-80 transition-opacity">
          <Image
            src="/bot-avatar-masks.svg"
            alt="Puppetgram"
            width={40}
            height={40}
            className="w-8 h-8 sm:w-10 sm:h-10 rounded-full"
          />
          <span className="font-semibold text-primary text-sm sm:text-base">Puppetgram</span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-3 sm:gap-4">
          {currentPage === 'landing' ? (
            <Link
              href="/dashboard"
              className="text-sm text-secondary hover:text-primary transition-colors"
            >
              Dashboard
            </Link>
          ) : (
            <span className="text-sm text-accent-400 font-medium">Dashboard</span>
          )}

          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
