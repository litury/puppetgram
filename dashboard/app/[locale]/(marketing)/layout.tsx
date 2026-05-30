import { ReactNode } from 'react';
import { setStaticParamsLocale } from 'next-international/server';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

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
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
