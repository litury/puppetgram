import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from '@/components/ThemeProvider';
import { StructuredData } from '@/components/StructuredData';
import { BRAND_COLOR } from '@/lib/design-tokens';
import Script from 'next/script';

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: 'Puppetgram - AI-платформа для роста личного бренда в Telegram',
  description: 'Привлекайте аудиторию через умные AI-комментарии. Автоматизация присутствия в Telegram с ротацией аккаунтов и аналитикой роста.',
  keywords: ['AI автоматизация Telegram', 'рост личного бренда', 'автоматизация комментариев', 'AI бот Telegram', 'лидогенерация Telegram'],

  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/manifest.json',

  themeColor: BRAND_COLOR,
  other: {
    'msapplication-TileColor': BRAND_COLOR,
    'google-site-verification': '3AEXpuqi4ZVUNjJ_E9t5Xr_5cCeBjJ_lTOJYAMX1Onw',
    'yandex-verification': '1a6c6eb8e0efa35a',
    'geo.region': 'RU',
    'geo.placename': 'Россия',
  },

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

  twitter: {
    card: 'summary_large_image',
    title: 'Puppetgram - AI для роста в Telegram',
    description: 'Привлекайте аудиторию через умные AI-комментарии',
    images: ['/og-image.png'],
  },

  alternates: {
    canonical: 'https://puppetgram.io',
  },

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
      <body className={`${inter.variable} font-sans antialiased`}>
        <Script
          id="theme-script"
          strategy="beforeInteractive"
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
        <StructuredData />
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
