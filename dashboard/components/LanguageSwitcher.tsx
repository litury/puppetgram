'use client';

import { useChangeLocale, useCurrentLocale } from '@/locales/client';

export function LanguageSwitcher() {
  const changeLocale = useChangeLocale();
  const locale = useCurrentLocale();

  return (
    <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-lg p-1">
      <button
        onClick={() => changeLocale('ru')}
        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          locale === 'ru'
            ? 'bg-accent-500 text-white'
            : 'text-tertiary hover:text-secondary'
        }`}
      >
        RU
      </button>
      <button
        onClick={() => changeLocale('en')}
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
