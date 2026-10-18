import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // Own port, bound to IPv4 explicitly, so we never silently share a port with
  // the ddev router (which claims 5173 for other projects' Vite servers).
  server: { host: '127.0.0.1', port: 5280, strictPort: true },
  preview: { host: '127.0.0.1', port: 5281, strictPort: true },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        play: resolve(import.meta.dirname, 'index.html'),
        lab: resolve(import.meta.dirname, 'lab.html'),
        editor: resolve(import.meta.dirname, 'editor.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
