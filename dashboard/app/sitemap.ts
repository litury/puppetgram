import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://puppetgram.io',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
      alternates: {
        languages: {
          ru: 'https://puppetgram.io/ru',
          en: 'https://puppetgram.io/en',
        },
      },
    },
    {
      url: 'https://puppetgram.io/dashboard',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
  ]
}
