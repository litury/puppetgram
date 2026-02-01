import Link from 'next/link';
import Image from 'next/image';
import { setStaticParamsLocale } from 'next-international/server';
import { getI18n } from '@/locales/server';
import { Header } from '@/components/Header';
import { HeroSection } from '@/components/HeroSection';
import { AnimatedCounter } from './components/AnimatedCounter';

// Generate static params for both locales (required for static export)
export function generateStaticParams() {
  return [{ locale: 'ru' }, { locale: 'en' }];
}

// SVG ICONS
function PuppetgramLogo({ className = "w-6 h-6", size = 24 }: { className?: string; size?: number }) {
  return (
    <Image
      src="/bot-avatar-masks.svg"
      alt="Puppetgram"
      width={size}
      height={size}
      className={`${className} rounded-full`}
    />
  );
}

function TargetIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4.5c-1.5-1.5-4-1.5-5.5 0s-1.5 4 0 5.5" />
      <path d="M6.5 10c-1.5 1-2 3.5-.5 5s3.5 1.5 5 0" />
      <path d="M12 15c0 2 1.5 4.5 4 4.5s4-2.5 4-4.5" />
      <path d="M16 15c2-1 3-3 2-5s-3-3-5-2" />
      <path d="M12 4.5c1.5-1.5 4-1.5 5.5 0s1.5 4 0 5.5" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 16l4-4 4 4 5-6" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function DevicesIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="12" y1="18" x2="12" y2="18.01" />
    </svg>
  );
}

function FeatureCard({ icon, title, description, delay }: { icon: React.ReactNode; title: string; description: string; delay: number }) {
  return (
    <div
      className="group p-6 bg-neutral-900 border border-neutral-800 rounded-xl hover:border-accent-500/30 transition-all duration-300 animate-slide-up"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
    >
      <div className="w-12 h-12 rounded-lg bg-accent-500/10 flex items-center justify-center mb-4 group-hover:bg-accent-500/20 transition-colors text-accent-400">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-primary mb-2">{title}</h3>
      <p className="text-sm text-tertiary leading-relaxed">{description}</p>
    </div>
  );
}

// MAIN LANDING PAGE (Server Component)
export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setStaticParamsLocale(locale);

  const t = await getI18n();

  return (
    <div className="min-h-screen">
      <Header currentPage="landing" />

      <HeroSection />

      {/* STATS SECTION */}
      <section className="py-16 px-6 border-y border-neutral-800/50 bg-neutral-900/30">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <p className="text-3xl md:text-4xl font-bold text-primary mb-1">
                <AnimatedCounter target={50000} suffix="+" />
              </p>
              <p className="text-sm text-tertiary">{t('stats.interactions')}</p>
            </div>
            <div className="text-center">
              <p className="text-3xl md:text-4xl font-bold text-accent-500 mb-1">
                <AnimatedCounter target={2500} suffix="+" />
              </p>
              <p className="text-sm text-tertiary">{t('stats.subscribers')}</p>
            </div>
            <div className="text-center">
              <p className="text-3xl md:text-4xl font-bold text-primary mb-1">
                <AnimatedCounter target={150} suffix="+" />
              </p>
              <p className="text-sm text-tertiary">{t('stats.channels')}</p>
            </div>
            <div className="text-center">
              <p className="text-3xl md:text-4xl font-bold text-primary mb-1">
                <AnimatedCounter target={15} suffix="%" />
              </p>
              <p className="text-sm text-tertiary">{t('stats.growth')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES SECTION */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs uppercase tracking-widest text-accent-400 mb-3">{t('features.subtitle')}</p>
            <h2 className="text-3xl md:text-4xl font-bold text-primary">
              {t('features.title')}
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={<BrainIcon />}
              title={t('features.ai_comments.title')}
              description={t('features.ai_comments.description')}
              delay={0}
            />
            <FeatureCard
              icon={<DevicesIcon />}
              title={t('features.scalable.title')}
              description={t('features.scalable.description')}
              delay={100}
            />
            <FeatureCard
              icon={<ShieldIcon />}
              title={t('features.protection.title')}
              description={t('features.protection.description')}
              delay={200}
            />
            <FeatureCard
              icon={<ChartIcon />}
              title={t('features.analytics.title')}
              description={t('features.analytics.description')}
              delay={300}
            />
            <FeatureCard
              icon={<TargetIcon />}
              title={t('features.targeting.title')}
              description={t('features.targeting.description')}
              delay={400}
            />
            <FeatureCard
              icon={<BoltIcon />}
              title={t('features.automation.title')}
              description={t('features.automation.description')}
              delay={500}
            />
          </div>
        </div>
      </section>

      {/* CTA SECTION */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="p-12 bg-gradient-to-br from-accent-500/10 to-accent-600/5 rounded-2xl border border-accent-500/20">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">
              {t('cta.title')}
            </h2>
            <p className="text-secondary mb-8 max-w-xl mx-auto">
              {t('cta.description')}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="https://github.com/litury/puppetgram"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-3 bg-accent-500 hover:bg-accent-600 text-white font-medium rounded-lg transition-colors inline-flex items-center gap-2"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                {t('cta.github')}
              </a>
              <Link
                href="dashboard"
                className="text-secondary hover:text-primary transition-colors"
              >
                {t('cta.demo')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-8 px-6 md:px-8 lg:px-12 border-t border-neutral-800/50">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-accent-400">
            <PuppetgramLogo className="w-14 h-14" size={56} />
            <span className="text-sm text-tertiary">{t('footer.copyright')}</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://github.com/litury/puppetgram" target="_blank" rel="noopener noreferrer" className="text-sm text-tertiary hover:text-secondary transition-colors">
              GitHub
            </a>
            <a href="https://t.me/divatoz" target="_blank" rel="noopener noreferrer" className="text-sm text-tertiary hover:text-secondary transition-colors">
              Telegram
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
