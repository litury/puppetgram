import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from '@/components/ThemeProvider';
import { StructuredData } from '@/components/StructuredData';
import { BRAND_COLOR } from '@/lib/design-tokens';

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: 'Puppetgram - AI-платформа для роста личного бренда в Telegram',
  description: 'Привлекайте аудиторию через умные AI-комментарии. Автоматизация присутствия в Telegram с ротацией аккаунтов и аналитикой роста.',
  keywords: ['AI автоматизация Telegram', 'рост личного бренда', 'автоматизация комментариев', 'AI бот Telegram', 'лидогенерация Telegram'],

  // Open Graph (красивые карточки в соцсетях)
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    url: 'https://puppetgram.io',
    siteName: 'Puppetgram',
    title: 'Puppetgram - AI-платформа для роста в Telegram',
    description: 'Автоматизируйте присутствие в Telegram и отслеживайте рост вовлеченности',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Puppetgram Platform',
      },
    ],
  },

  // Twitter Card
  twitter: {
    card: 'summary_large_image',
    title: 'Puppetgram - AI для роста в Telegram',
    description: 'Привлекайте аудиторию через умные AI-комментарии',
    images: ['/og-image.png'],
  },

  // Canonical URL и i18n
  alternates: {
    canonical: 'https://puppetgram.io',
    languages: {
      'ru': 'https://puppetgram.io/ru',
      'en': 'https://puppetgram.io/en',
    },
  },

  // Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* Theme color для mobile браузеров - из design-tokens */}
        <meta name="theme-color" content={BRAND_COLOR} />
        <meta name="msapplication-TileColor" content={BRAND_COLOR} />

        {/* SEO Verification - для Google Search Console и Яндекс.Вебмастер */}
        <meta name="google-site-verification" content="3AEXpuqi4ZVUNjJ_E9t5Xr_5cCeBjJ_lTOJYAMX1Onw" />
        <meta name="yandex-verification" content="1a6c6eb8e0efa35a" />

        {/* Яндекс meta tags */}
        <meta name="geo.region" content="RU" />
        <meta name="geo.placename" content="Россия" />

        {/* Preload критичных ресурсов для Core Web Vitals */}
        <link rel="preload" href="/bot-avatar-masks.svg" as="image" />

        {/* Favicon - comprehensive set for all platforms */}
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />

        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const theme = localStorage.getItem('theme') || 'system';
                const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                const isDark = theme === 'dark' || (theme === 'system' && systemDark);
                document.documentElement.classList.add(isDark ? 'dark' : 'light');
              })();
            `,
          }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <StructuredData />
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
