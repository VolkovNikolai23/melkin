import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// На GitHub Pages приложение живёт в подпапке /<имя-репозитория>/ — её передаёт workflow через BASE_PATH.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  // Одно офлайн-приложение — большой бандл не страшен, он целиком в precache.
  build: { chunkSizeWarningLimit: 1500 },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Мелькин <3',
        short_name: 'Мелькин',
        description: 'Конспекты, карточки и интервальное повторение офлайн',
        lang: 'ru',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        background_color: '#f7f6f3',
        theme_color: '#f7f6f3',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Кэшируем всё, включая шрифты KaTeX, — после первой загрузки сеть не нужна.
        globPatterns: ['**/*.{js,mjs,css,html,woff2,woff,ttf,pfb,png,svg,ico,webmanifest,bcmap,wasm,icc}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // обработчик push-уведомлений (public/push-sw.js)
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.js'],
  },
});
