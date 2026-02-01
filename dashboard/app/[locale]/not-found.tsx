import { setStaticParamsLocale } from 'next-international/server';
import { getI18n } from '@/locales/server';
import { defaultLocale } from '@/locales';
import Link from 'next/link';

export default async function NotFound({ params }: { params?: Promise<{ locale?: string }> }) {
  // Get locale from params or use default
  const resolvedParams = await params;
  const locale = resolvedParams?.locale || defaultLocale;
  setStaticParamsLocale(locale);

  const t = await getI18n();

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-white mb-4">404</h1>
        <p className="text-xl text-secondary mb-8">
          {t('notFound.message')}
        </p>
        <Link
          href="/"
          className="px-6 py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors"
        >
          {t('notFound.backHome')}
        </Link>
      </div>
    </div>
  );
}
