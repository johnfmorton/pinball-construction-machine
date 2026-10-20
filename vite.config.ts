import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import laravel from 'laravel-vite-plugin';

// Vite runs inside the ddev web container; Laravel serves the pages and @vite()
// points them at this server. Port 5280, not 5173: the ddev router already
// claims 5173 for other projects' Vite servers.
const DDEV_URL = 'https://pinball-construction-machine.ddev.site';

export default defineConfig({
  plugins: [
    laravel({
      input: ['src/play/style.css', 'src/play/main.ts', 'src/editor/main.ts', 'src/debug/style.css', 'src/debug/main.ts'],
      refresh: ['resources/views/**', 'routes/**', 'config/**'],
    }),
    svelte(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5280,
    strictPort: true,
    origin: `${DDEV_URL}:5280`,
    cors: { origin: DDEV_URL },
    watch: { ignored: ['**/storage/framework/views/**', '**/vendor/**'] },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
