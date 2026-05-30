'use client';

import Link from 'next/link';
import { useI18n, useCurrentLocale } from '@/locales/client';
import { LiveMetrics } from './LiveMetrics';
import { HeroDashboardMock } from './HeroDashboardMock';

function GithubIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="size-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function HeroSection() {
  const t = useI18n();
  const locale = useCurrentLocale();

  return (
    <section className="relative overflow-hidden">
      {/* Background layers */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute top-1/3 -left-20 h-72 w-72 rounded-full bg-primary/10 blur-[100px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-6 pb-16 pt-28 text-center sm:pt-36">
        {/* Badge */}
        <div className="mb-6 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur-sm">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
            </span>
            {t('hero.badge')}
          </span>
        </div>

        {/* Headline */}
        <h1
          className="mx-auto max-w-4xl whitespace-pre-line text-balance text-5xl font-extrabold leading-[0.98] tracking-tight text-foreground sm:text-7xl"
          style={{ fontFamily: 'var(--font-bricolage)' }}
        >
          {t('hero.title')}
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          {t('hero.description')}
        </p>

        {/* CTAs */}
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={`/${locale}/dashboard`}
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/30 sm:w-auto"
          >
            {t('hero.cta_primary')}
            <ArrowIcon />
          </Link>
          <a
            href="https://github.com/litury/puppetgram"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card/50 px-7 text-sm font-semibold text-foreground backdrop-blur-sm transition-colors hover:border-primary/40 sm:w-auto"
          >
            <GithubIcon />
            {t('hero.cta_secondary')}
          </a>
        </div>

        {/* Metrics */}
        <div className="mx-auto mt-14 max-w-2xl">
          <LiveMetrics
            labels={{
              comments: t('stats.comments'),
              channels: t('stats.channels'),
              reach: t('stats.reach'),
            }}
          />
        </div>

        {/* Product mockup — живой DOM (адаптируется к теме и языку) */}
        <div
          className="relative mx-auto mt-16 max-w-5xl"
          style={{
            maskImage: 'linear-gradient(to bottom, black 86%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 86%, transparent 100%)',
          }}
        >
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-black/20">
            <div className="flex items-center gap-2 border-b border-border bg-background/60 px-4 py-3">
              <span className="size-2.5 rounded-full bg-destructive/60" />
              <span className="size-2.5 rounded-full bg-warning/60" />
              <span className="size-2.5 rounded-full bg-success/60" />
              <span className="ml-3 hidden rounded-md bg-muted px-3 py-1 text-xs text-muted-foreground sm:block">
                puppetgram.ru/dashboard
              </span>
            </div>
            <HeroDashboardMock />
          </div>
        </div>
      </div>
    </section>
  );
}
