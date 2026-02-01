import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: 'export',
  // Статическая генерация — все API вызовы идут на ws-server
  trailingSlash: true,
};

export default withNextIntl(nextConfig);
