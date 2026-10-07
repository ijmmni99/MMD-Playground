import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // babylon-mmd deep-imports @babylonjs/core and loads its WASM via import.meta.url, so all three
  // must stay un-prebundled to share one copy of Babylon in dev.
  optimizeDeps: { exclude: ['babylon-mmd', '@babylonjs/core', '@babylonjs/materials'] },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
    // babylon-mmd ships extensionless ESM imports; let Vite transform it instead of Node.
    server: { deps: { inline: ['babylon-mmd', /@babylonjs/] } },
  },
});
