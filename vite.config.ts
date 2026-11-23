import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Emits sw.js: a service worker that stores every built file so the app opens
 * with no network. The cache name changes with every build, which is what
 * makes an updated build replace the old one.
 */
function serviceWorker(): Plugin {
  return {
    name: 'reel-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = ['./', ...Object.keys(bundle).map((f) => `./${f}`)];
      // Files copied from public/ are not in the bundle; list the ones the app needs.
      files.push('./manifest.webmanifest', './favicon.png', './icon-180.png', './icon-192.png', './icon-512.png');
      const hash = createHash('sha256');
      for (const [name, chunk] of Object.entries(bundle)) {
        hash.update(name);
        hash.update(chunk.type === 'chunk' ? chunk.code : chunk.source);
      }
      // index.html is not part of the bundle here, so the build time covers changes to it.
      hash.update(String(Date.now()));
      const cache = `reel-${hash.digest('hex').slice(0, 12)}`;
      const source = `// Generated at build time.
const CACHE = ${JSON.stringify(cache)};
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('reel-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) =>
      (await cache.match(event.request, { ignoreSearch: true, ignoreVary: true })) ?? fetch(event.request),
    ),
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any GitHub Pages sub-path.
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
  plugins: [serviceWorker()],
  test: { include: ['src/**/*.test.ts'] },
});
