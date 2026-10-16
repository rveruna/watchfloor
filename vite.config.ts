import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    // the mock API and websocket run on 8787 in development
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,vue}', 'shared/**/*.ts', 'server/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/test/**', 'src/main.ts', 'server/index.ts'],
    },
  },
});
