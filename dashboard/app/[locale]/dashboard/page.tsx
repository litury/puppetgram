import { setStaticParamsLocale } from 'next-international/server';
import { DashboardPageClient } from './DashboardPageClient';

// Generate static params for both locales (required for static export)
export function generateStaticParams() {
  return [{ locale: 'ru' }, { locale: 'en' }];
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setStaticParamsLocale(locale);

  return <DashboardPageClient />;
}
