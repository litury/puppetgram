import { setStaticParamsLocale } from 'next-international/server';
import { SettingsPageClient } from './SettingsPageClient';

export function generateStaticParams() {
  return [{ locale: 'ru' }, { locale: 'en' }];
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setStaticParamsLocale(locale);
  return <SettingsPageClient />;
}
