'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';

export function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();

  const switchLanguage = (newLocale: string) => {
    // With [locale] routing, all routes have the locale prefix
    // Replace current locale with new locale in pathname
    const pathnameWithoutLocale = pathname.replace(/^\/(ru|en)/, '') || '/';
    const newPath = `/${newLocale}${pathnameWithoutLocale}`;

    router.push(newPath);
  };

  return (
    <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-lg p-1">
      <button
        onClick={() => switchLanguage('ru')}
        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          locale === 'ru'
            ? 'bg-accent-500 text-white'
            : 'text-tertiary hover:text-secondary'
        }`}
      >
        RU
      </button>
      <button
        onClick={() => switchLanguage('en')}
        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          locale === 'en'
            ? 'bg-accent-500 text-white'
            : 'text-tertiary hover:text-secondary'
        }`}
      >
        EN
      </button>
    </div>
  );
}
