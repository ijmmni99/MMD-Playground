import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'MMD Studio',
        short_name: 'MMD Studio',
        description: 'Browser-based MikuMikuDance playground: load models and motions, pose, record.',
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f1115',
        theme_color: '#161920',
        categories: ['entertainment', 'graphics'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'files',
                accept: [
                  '.pmx',
                  '.pmd',
                  '.vmd',
                  '.zip',
                  'application/zip',
                  'audio/*',
                  'application/octet-stream',
                ],
              },
            ],
          },
        },
      },
      injectManifest: {
        // App shell + engine + Bullet WASM. Monaco (desktop-only, lazy) is runtime-cached instead.
        globPatterns: ['**/*.{js,css,html,wasm,png,svg,webmanifest}'],
        globIgnores: [
          '**/editor.api-*.js',
          '**/*.worker-*.js',
          '**/Playground-*.js',
          '**/sample/**',
          '**/mediapipe/**',
          '**/lspLanguageFeatures-*.js',
        ],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
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
