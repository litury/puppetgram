import { ReactNode } from 'react';
import { setStaticParamsLocale } from 'next-international/server';
import { Bricolage_Grotesque, JetBrains_Mono } from 'next/font/google';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

// Display-шрифт лендинга (характерный, не Inter) + моно для метрик
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  weight: ['600', '700', '800'],
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  weight: ['500', '700'],
});

/**
 * Маркетинговый chrome (лендинг): шапка + футер.
 * Route group `(marketing)` — не влияет на URL. Дашборд использует свой
 * sidebar-layout без этой шапки.
 *
 * `setStaticParamsLocale` обязателен: Footer — серверный компонент с getI18n(),
 * которому нужен locale во время pre-render (static export).
 */
export function generateStaticParams() {
  return [{ locale: 'ru' }, { locale: 'en' }];
}

export default async function MarketingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setStaticParamsLocale(locale);

  return (
    <div className={`${display.variable} ${mono.variable} flex min-h-screen flex-col`}>
      <Header />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
