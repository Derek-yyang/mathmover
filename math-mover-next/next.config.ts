import path from 'node:path';
import type { NextConfig } from "next";

const backendInternalUrl = process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:5000';

const nextConfig: NextConfig = {
  output: 'standalone',

  // Turbopack 默认只解析项目根内的模块。我们的共享包在仓库根的 packages/ 下
  // （@mathmover/agent-runtime 等，经 file: 依赖软链进来），必须把根提到仓库级，
  // 否则报 "Module not found"。这同时也消除了"多个 lockfile 导致根目录推断"的警告。
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendInternalUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
