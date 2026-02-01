import { MetadataRoute } from 'next'

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const locales = ['ru', 'en'];
  const baseUrl = 'https://puppetgram.ru';

  // Generate sitemap entries for each locale
  const localeEntries = locales.flatMap((locale) => [
    // Landing page for each locale
    {
      url: `${baseUrl}/${locale}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: locale === 'ru' ? 1 : 0.9,
      alternates: {
        languages: {
          ru: `${baseUrl}/ru`,
          en: `${baseUrl}/en`,
        },
      },
    },
    // Dashboard for each locale
    {
      url: `${baseUrl}/${locale}/dashboard`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.8,
      alternates: {
        languages: {
          ru: `${baseUrl}/ru/dashboard`,
          en: `${baseUrl}/en/dashboard`,
        },
      },
    },
  ]);

  // Root redirect entry
  const rootEntry = {
    url: baseUrl,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 1,
    alternates: {
      languages: {
        ru: `${baseUrl}/ru`,
        en: `${baseUrl}/en`,
      },
    },
  };

  return [rootEntry, ...localeEntries];
}
