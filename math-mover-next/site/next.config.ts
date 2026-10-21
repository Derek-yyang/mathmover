import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  // Shared page/components live one directory above this static-only app.
  outputFileTracingRoot: import.meta.dirname + '/..',
};

export default nextConfig;
