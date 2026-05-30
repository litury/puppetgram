import { setStaticParamsLocale } from 'next-international/server';
import { CommentsPageClient } from './CommentsPageClient';

export function generateStaticParams() {
  return [{ locale: 'ru' }, { locale: 'en' }];
}

export default async function CommentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setStaticParamsLocale(locale);
  return <CommentsPageClient />;
}
