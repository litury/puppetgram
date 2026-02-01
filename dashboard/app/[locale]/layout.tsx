import { ReactNode } from 'react';
import { I18nProviderClient } from '@/locales/client';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import type { Metadata } from "next";

type Props = {
  params: Promise<{ locale: string }>;
  children: ReactNode;
};

// Generate static params for both locales (required for static export)
export function generateStaticParams() {
  return [{ locale: 'ru' }, { locale: 'en' }];
}

// Locale-aware metadata
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const isRussian = locale === 'ru';

  return {
    title: isRussian
      ? 'Puppetgram - AI-платформа для роста личного бренда в Telegram'
      : 'Puppetgram - AI Platform for Personal Brand Growth in Telegram',
    description: isRussian
      ? 'Привлекайте аудиторию через умные AI-комментарии. Автоматизация присутствия в Telegram с ротацией аккаунтов и аналитикой роста.'
      : 'Attract audience through smart AI comments. Automate Telegram presence with account rotation and growth analytics.',
    alternates: {
      canonical: `https://puppetgram.ru/${locale}`,
      languages: {
        'ru': 'https://puppetgram.ru/ru',
        'en': 'https://puppetgram.ru/en',
      },
    },
  };
}

export default async function LocaleLayout({ params, children }: Props) {
  const { locale } = await params;

  return (
    <I18nProviderClient locale={locale}>
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1">{children}</div>
        <Footer />
      </div>
    </I18nProviderClient>
  );
}
