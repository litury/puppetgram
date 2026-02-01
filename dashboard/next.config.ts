import type { NextConfig } from "next";
import withSerwist from "@serwist/next";

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  // Явно указываем Turbopack для dev (заглушаем предупреждение Next.js 16)
  turbopack: {},
  experimental: {
    viewTransition: true,
  },
};

export default withSerwist({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
})(nextConfig);
