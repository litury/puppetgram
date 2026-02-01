'use client';

import Link from 'next/link';
import { useScopedI18n } from '@/locales/client';
import { AnimatedNetwork } from './AnimatedNetwork';
import { AnimatedNetworkMobile } from './AnimatedNetworkMobile';

function GithubIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

export function HeroSection() {
  const t = useScopedI18n('hero');

  return (
    <section className="relative min-h-screen overflow-hidden bg-neutral-950">
      {/* Full-screen AnimatedNetwork Background */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="hidden md:block w-full h-full">
          <AnimatedNetwork />
        </div>
        <div className="md:hidden w-full h-full flex items-center justify-center">
          <AnimatedNetworkMobile />
        </div>
      </div>

      {/* Content Overlay */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 sm:px-6 pt-16 sm:pt-20 pb-8 sm:pb-12">
        <div className="max-w-3xl w-full text-center space-y-4 sm:space-y-6">

          {/* Badge */}
          <div className="flex justify-center mb-3 sm:mb-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full bg-accent-950/95 border border-accent-500/50 text-accent-400 text-xs sm:text-sm shadow-lg shadow-accent-500/30 hover:border-accent-500/70 transition-all duration-[--duration-normal]">
              <span
                className="size-1.5 rounded-full bg-accent-400 animate-pulse"
                style={{
                  filter: 'drop-shadow(0 0 8px rgba(162, 145, 247, 0.8))',
                  animationDuration: '2s'
                }}
              />
              {t('badge')}
            </div>
          </div>

          {/* Title with minimal shadow - works in both themes */}
          <h1
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-primary leading-[1.1] px-2"
            style={{
              textShadow: '0 1px 2px rgba(0, 0, 0, 0.1)'
            }}
          >
            {t('title')}
          </h1>

          {/* Description without box - let animation show through */}
          <p
            className="text-base sm:text-lg md:text-xl text-secondary leading-relaxed max-w-2xl mx-auto px-4"
            style={{
              textShadow: '0 1px 2px rgba(0, 0, 0, 0.08)'
            }}
          >
            {t('description')}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 pt-2 sm:pt-4">
            <a
              href="https://github.com/litury/puppetgram"
              target="_blank"
              rel="noopener noreferrer"
              className="group w-full sm:w-auto px-6 py-3 sm:px-8 sm:py-3.5 bg-accent-500 hover:bg-accent-600 text-white text-base sm:text-lg font-medium rounded-lg sm:rounded-xl inline-flex items-center justify-center gap-2 sm:gap-3 transition-all duration-[--duration-fast] shadow-lg sm:shadow-xl shadow-accent-500/20 sm:shadow-accent-500/30 hover:shadow-accent-500/40 hover:scale-105"
            >
              <GithubIcon />
              {t('cta_primary')}
            </a>
            <Link
              href="dashboard"
              className="w-full sm:w-auto px-6 py-3 sm:px-8 sm:py-3.5 bg-neutral-850/95 hover:bg-neutral-800 backdrop-blur-sm text-primary text-base sm:text-lg font-medium rounded-lg sm:rounded-xl border border-neutral-700 sm:border-2 hover:border-accent-500/50 transition-all duration-[--duration-fast] hover:scale-105"
            >
              {t('cta_secondary')}
            </Link>
          </div>

        </div>
      </div>
    </section>
  );
}
