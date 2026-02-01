import { MetadataRoute } from 'next'
import { BRAND_COLOR, BACKGROUND_COLOR } from '@/lib/design-tokens'

/**
 * PWA Manifest - динамически генерируется Next.js
 * Использует цвета из design-tokens.ts (синхронизировано с globals.css)
 *
 * SEO Impact:
 * - Google Lighthouse PWA score
 * - Mobile-first indexing boost
 * - Add to Home Screen capability
 * - Improved user engagement metrics
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Puppetgram - AI-платформа для роста личного бренда в Telegram',
    short_name: 'Puppetgram',
    description: 'Привлекайте аудиторию через умные AI-комментарии. Автоматизация присутствия в Telegram с ротацией аккаунтов и аналитикой роста.',
    start_url: '/',
    display: 'standalone',
    background_color: BACKGROUND_COLOR, // #0a0a0f из design-tokens
    theme_color: BRAND_COLOR, // #8b7cf6 из design-tokens
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/favicon-16x16.png',
        sizes: '16x16',
        type: 'image/png',
      },
      {
        src: '/favicon-32x32.png',
        sizes: '32x32',
        type: 'image/png',
      },
      {
        src: '/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
      {
        src: '/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
    categories: ['business', 'productivity', 'social'],
    lang: 'ru-RU',
    dir: 'ltr',
  }
}
