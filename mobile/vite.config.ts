import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const nextRoot = path.resolve(root, '../math-mover-next').replace(/\\/g, '/');

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.html': 'text/html',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};

/** 开发模式下把 /vendor 映射到 www/vendor，避免复制 117MB 的 GeoGebra 资源。 */
function ggbVendor(): Plugin {
  return {
    name: 'ggb-vendor',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!pathname.startsWith('/vendor/')) return next();
        const filePath = path.join(root, 'www', pathname);
        if (!filePath.startsWith(path.join(root, 'www', 'vendor'))) {
          res.statusCode = 403;
          res.end();
          return;
        }
        fs.createReadStream(filePath)
          .on('open', () => {
            res.setHeader('Content-Type', MIME[path.extname(filePath)] ?? 'application/octet-stream');
          })
          .on('error', () => {
            res.statusCode = 404;
            res.end();
          })
          .pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ggbVendor()],
  resolve: {
    // ggb-canvas/ggb-bridge 仍然复用桌面的 GeoGebra 运行库与桥接层。
    alias: [
      { find: /^@\/lib\//, replacement: `${nextRoot}/lib/` },
      { find: /^@\/components\//, replacement: `${nextRoot}/components/` },
    ],
  },
  build: {
    outDir: 'www',
    // www/vendor 下是 117MB 的本地 GeoGebra 资源，不能被清空。
    emptyOutDir: false,
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
  server: {
    host: true,
  },
});
