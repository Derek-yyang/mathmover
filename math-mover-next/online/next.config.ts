import path from 'node:path';
import fs from 'node:fs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next bundles ws with optional native accelerators stubbed as empty modules.
  // Keep the portable JavaScript frame implementation in serverless functions.
  env: {
    WS_NO_BUFFER_UTIL: '1',
    WS_NO_UTF_8_VALIDATE: '1',
  },
  output: 'standalone',
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  outputFileTracingExcludes: {
    '/api/run': ['./.next/**/*', './.next-desktop/**/*', './site/**/*', './public/**/*',
      './online/public/**/*', './online/.next/cache/**/*', './online/.next/standalone/**/*',
      './online/.next/static/**/*', './online/.next/lock', './online/.next/trace'],
  },
  outputFileTracingIncludes: {
    '/api/run': [
      './runtime/**/*',
      `../node_modules/opencode-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}/bin/*`,
      './node_modules/ws/**/*',
      '../node_modules/ws/**/*',
      '../../node_modules/ws/**/*',
      ...JSON.parse(fs.readFileSync(path.join(__dirname, 'runtime-trace.json'), 'utf8')),
    ],
  },
  async redirects() { return [{ source: '/', destination: '/dashboard', permanent: false }]; },
};
export default nextConfig;
