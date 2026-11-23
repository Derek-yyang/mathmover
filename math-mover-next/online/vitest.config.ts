import path from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({ resolve: { alias: { '@': path.resolve(__dirname, '..') } },
  test: { include: ['online/server/*.test.ts'], testTimeout: 60000 } });
