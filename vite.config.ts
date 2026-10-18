import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Own port, bound to IPv4 explicitly, so we never silently share a port with
  // the ddev router (which claims 5173 for other projects' Vite servers).
  server: { host: '127.0.0.1', port: 5280, strictPort: true },
  preview: { host: '127.0.0.1', port: 5281, strictPort: true },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
