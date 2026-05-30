import { setStaticParamsLocale } from 'next-international/server';
import { AccountsPageClient } from './AccountsPageClient';

export function generateStaticParams() {
  return [{ locale: 'ru' }, { locale: 'en' }];
}

export default async function AccountsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setStaticParamsLocale(locale);
  return <AccountsPageClient />;
}
