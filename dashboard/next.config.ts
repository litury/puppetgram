import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

// Configure next-intl with the request config location
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'export',
  // Статическая генерация — все API вызовы идут на ws-server
  trailingSlash: true,
};

export default withNextIntl(nextConfig);
