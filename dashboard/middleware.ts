import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  locales: ['ru', 'en'],
  defaultLocale: 'ru',
  localePrefix: 'as-needed' // /ru только для русского, / - для дефолтного
});

export const config = {
  matcher: ['/', '/(ru|en)/:path*']
};
