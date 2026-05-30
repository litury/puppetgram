import { setStaticParamsLocale } from 'next-international/server';
import { ChannelsPageClient } from './ChannelsPageClient';

export function generateStaticParams() {
  return [{ locale: 'ru' }, { locale: 'en' }];
}

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setStaticParamsLocale(locale);
  return <ChannelsPageClient />;
}
