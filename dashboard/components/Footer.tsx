import Image from 'next/image';
import { getI18n } from '@/locales/server';

export async function Footer() {
  const t = await getI18n();

  return (
    <footer className="py-8 px-6 md:px-8 lg:px-12 border-t border-neutral-800/50">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-accent-400">
          <Image
            src="/puppetgram-logo.png"
            alt="Puppetgram"
            width={56}
            height={56}
            className="w-10 h-10"
          />
          <span className="text-sm text-tertiary">{t('footer.copyright')}</span>
        </div>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/litury/puppetgram"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-tertiary hover:text-secondary transition-colors"
          >
            GitHub
          </a>
          <a
            href="https://t.me/divatoz"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-tertiary hover:text-secondary transition-colors"
          >
            Telegram
          </a>
        </div>
      </div>
    </footer>
  );
}
