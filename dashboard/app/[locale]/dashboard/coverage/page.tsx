import { setStaticParamsLocale } from 'next-international/server';
import { CoveragePageClient } from './CoveragePageClient';

export function generateStaticParams() {
  return [{ locale: 'ru' }, { locale: 'en' }];
}

export default async function CoveragePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setStaticParamsLocale(locale);
  return <CoveragePageClient />;
}
