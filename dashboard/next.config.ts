import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  // Статическая генерация — все API вызовы идут на ws-server
  trailingSlash: true,
};

export default nextConfig;
