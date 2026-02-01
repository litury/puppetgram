import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';

// For static export with [locale] routing
export default getRequestConfig(async ({ locale }) => {
  // Validate that the incoming locale parameter is valid
  if (!locale || !['ru', 'en'].includes(locale)) {
    notFound();
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
