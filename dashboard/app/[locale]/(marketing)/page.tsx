import { setStaticParamsLocale } from 'next-international/server';
import { getI18n } from '@/locales/server';
import { HeroSection } from '@/components/HeroSection';

export function generateStaticParams() {
  return [{ locale: 'ru' }, { locale: 'en' }];
}

function BrainIcon() {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4.5c-1.5-1.5-4-1.5-5.5 0s-1.5 4 0 5.5" /><path d="M6.5 10c-1.5 1-2 3.5-.5 5s3.5 1.5 5 0" /><path d="M12 15c0 2 1.5 4.5 4 4.5s4-2.5 4-4.5" /><path d="M16 15c2-1 3-3 2-5s-3-3-5-2" /><path d="M12 4.5c1.5-1.5 4-1.5 5.5 0s1.5 4 0 5.5" /><line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}
function DevicesIcon() {
  return <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12" y2="18.01" /></svg>;
}
function ShieldIcon() {
  return <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>;
}
function ChartIcon() {
  return <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 16l4-4 4 4 5-6" /></svg>;
}
function TargetIcon() {
  return <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>;
}
function BoltIcon() {
  return <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>;
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/30">
      <div className="absolute -right-8 -top-8 size-24 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:opacity-100 opacity-0" />
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
        {icon}
      </div>
      <h3 className="mb-2 text-lg font-semibold text-foreground" style={{ fontFamily: 'var(--font-bricolage)' }}>{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setStaticParamsLocale(locale);
  const t = await getI18n();

  return (
    <>
      <HeroSection />

      {/* FEATURES */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-primary">{t('features.subtitle')}</p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl" style={{ fontFamily: 'var(--font-bricolage)' }}>
              {t('features.title')}
            </h2>
          </div>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <FeatureCard icon={<BrainIcon />} title={t('features.ai_comments.title')} description={t('features.ai_comments.description')} />
            <FeatureCard icon={<DevicesIcon />} title={t('features.scalable.title')} description={t('features.scalable.description')} />
            <FeatureCard icon={<ShieldIcon />} title={t('features.protection.title')} description={t('features.protection.description')} />
            <FeatureCard icon={<ChartIcon />} title={t('features.analytics.title')} description={t('features.analytics.description')} />
            <FeatureCard icon={<TargetIcon />} title={t('features.targeting.title')} description={t('features.targeting.description')} />
            <FeatureCard icon={<BoltIcon />} title={t('features.automation.title')} description={t('features.automation.description')} />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-28">
        <div className="mx-auto max-w-4xl">
          <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card px-8 py-16 text-center">
            <div className="pointer-events-none absolute -top-24 left-1/2 size-80 -translate-x-1/2 rounded-full bg-primary/15 blur-[100px]" />
            <h2 className="relative text-3xl font-bold tracking-tight text-foreground sm:text-4xl" style={{ fontFamily: 'var(--font-bricolage)' }}>
              {t('cta.title')}
            </h2>
            <p className="relative mx-auto mt-4 max-w-xl text-muted-foreground">{t('cta.description')}</p>
            <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="https://github.com/litury/puppetgram"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-7 text-sm font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/30"
              >
                <svg className="size-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
                {t('cta.github')}
              </a>
              <a href={`/${locale}/dashboard`} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                {t('cta.demo')} →
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
