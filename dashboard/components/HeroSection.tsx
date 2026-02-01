import Link from 'next/link';
import { AnimatedNetwork } from './AnimatedNetwork';
import { AnimatedNetworkMobile } from './AnimatedNetworkMobile';

export function HeroSection() {
  return (
    <section className="min-h-[calc(100vh-3.5rem)] sm:min-h-[calc(100vh-4rem)] flex flex-col px-4 sm:px-6">
      <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-16 pt-6 sm:pt-10 pb-6">
        {/* Text Content */}
        <div className="lg:flex-1 text-center lg:text-left animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-500/10 border border-accent-500/20 text-accent-400 text-xs sm:text-sm mb-4 sm:mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
            Автоматизация комментирования
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-primary mb-4 sm:mb-6 tracking-tight animate-slide-up" style={{ animationDelay: '100ms' }}>
            Умный бот для
            <br />
            <span className="bg-gradient-to-r from-accent-400 to-accent-600 bg-clip-text text-transparent">
              Telegram-каналов
            </span>
          </h1>
          <p className="text-base sm:text-lg text-secondary max-w-2xl mx-auto lg:mx-0 mb-6 sm:mb-8 animate-slide-up" style={{ animationDelay: '200ms' }}>
            AI-комментирование через DeepSeek/OpenAI с ротацией аккаунтов.
            Детект shadowban, защита от блокировок, real-time аналитика.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 sm:gap-4 animate-slide-up" style={{ animationDelay: '300ms' }}>
            <a
              href="https://github.com/litury/puppetgram"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-8 py-3 bg-accent-500 hover:bg-accent-600 text-white font-medium rounded-lg transition-colors text-center inline-flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              Клонировать
            </a>
            <Link
              href="/dashboard"
              className="w-full sm:w-auto px-8 py-3 bg-neutral-850 hover:bg-neutral-800 text-primary font-medium rounded-lg border border-neutral-700 transition-colors text-center"
            >
              Открыть Dashboard
            </Link>
          </div>
        </div>

        {/* Network Animation - fills remaining space */}
        <div className="flex-1 min-h-0 animate-scale-in" style={{ animationDelay: '400ms' }}>
          {/* Desktop: full AnimatedNetwork */}
          <div className="hidden lg:block h-full min-h-100">
            <AnimatedNetwork />
          </div>
          {/* Mobile/Tablet: wide compact AnimatedNetworkMobile */}
          <div className="lg:hidden w-full max-w-md mx-auto">
            <AnimatedNetworkMobile />
          </div>
        </div>
      </div>
    </section>
  );
}
