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
    <section className="relative min-h-screen overflow-hidden">
      {/* Layer 1: Animated Network Background (z-0) */}
      <div className="absolute inset-0 z-0">
        <div className="hidden md:block w-full h-full">
          <AnimatedNetwork />
        </div>
        <div className="md:hidden w-full h-full flex items-center justify-center">
          <AnimatedNetworkMobile />
        </div>
      </div>

      {/* Layer 2: Animated Gradient Mesh (z-[5]) - Living Background */}
      <div
        className="absolute inset-0 z-[5] opacity-30"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 50% 0%, rgba(139, 124, 246, 0.15), transparent),
            radial-gradient(ellipse 60% 80% at 0% 50%, rgba(109, 92, 214, 0.1), transparent),
            radial-gradient(ellipse 60% 80% at 100% 50%, rgba(162, 145, 247, 0.1), transparent)
          `,
          animation: 'gradientShift 15s ease infinite',
        }}
      />

      {/* Layer 3: Gradient Overlay (z-10) - Depth Effect */}
      <div className="absolute inset-0 z-10 bg-gradient-to-b from-neutral-950/40 via-transparent to-neutral-950/60" />

      {/* Layer 4: Content Container (z-20) */}
      <div className="relative z-20 min-h-screen flex items-center justify-center px-4 sm:px-6 pt-14 sm:pt-16 pb-12">
        <div className="w-full max-w-3xl">

          {/* Floating Badge */}
          <div className="mb-6 flex justify-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent-950/80 backdrop-blur-sm border border-accent-500/30 text-accent-400 text-sm shadow-lg shadow-accent-500/10 hover:border-accent-500/50 transition-all duration-[--duration-normal]">
              <span
                className="size-1.5 rounded-full bg-accent-400 animate-pulse"
                style={{
                  filter: 'drop-shadow(0 0 8px rgba(162, 145, 247, 0.6))',
                  animationDuration: '2s'
                }}
              />
              {t('badge')}
            </div>
          </div>

          {/* Glassmorphism Card */}
          <div
            className="relative backdrop-blur-xl bg-neutral-900/40 border border-neutral-700/50 rounded-2xl p-8 sm:p-10 md:p-12 shadow-2xl shadow-neutral-950/50 hover:shadow-accent-500/5 transition-shadow duration-[--duration-slow]"
            style={{
              animation: 'cardFloat 8s ease-in-out infinite'
            }}
          >

            {/* Inner Glow Effect */}
            <div
              className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent-500/5 via-transparent to-accent-600/5 pointer-events-none"
              style={{
                maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 70%)',
                WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 70%)',
                animation: 'glowPulse 6s ease-in-out infinite'
              }}
            />

            {/* Content - Always Centered */}
            <div className="relative space-y-6 text-center">

              {/* Title */}
              <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-primary leading-tight">
                {t('title')}
              </h1>

              {/* Description */}
              <p className="text-base sm:text-lg text-secondary max-w-2xl mx-auto leading-relaxed">
                {t('description')}
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 pt-4">
                <a
                  href="https://github.com/litury/puppetgram"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group w-full sm:w-auto px-8 py-3.5 bg-accent-500 hover:bg-accent-600 text-white font-medium rounded-lg inline-flex items-center justify-center gap-2 transition-all duration-[--duration-fast] shadow-lg shadow-accent-500/20 hover:shadow-accent-500/30 hover:scale-105"
                >
                  <GithubIcon />
                  {t('cta_primary')}
                </a>
                <Link
                  href="dashboard"
                  className="w-full sm:w-auto px-8 py-3.5 bg-neutral-850/80 hover:bg-neutral-800 backdrop-blur-sm text-primary font-medium rounded-lg border border-neutral-700/70 hover:border-neutral-600 transition-all duration-[--duration-fast] hover:scale-105"
                >
                  {t('cta_secondary')}
                </Link>
              </div>

            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
