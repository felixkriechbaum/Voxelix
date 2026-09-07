import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// Project-page path on GitHub Pages: https://felixkriechbaum.github.io/Voxelix/
// Kept off the dev server so `bun run dev` still serves from the root.
const ghPagesBase = '/Voxelix/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? ghPagesBase : '/',
  plugins: [
    vue(),
    VitePWA({
      // an editor must never reload out from under unsaved work — prompt instead
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.png', 'apple-touch-icon-180x180.png'],
      workbox: {
        // voxel projects live in IndexedDB, not the cache — just precache the shell
        globPatterns: ['**/*.{js,css,html,wasm}'],
        // GLTFExporter + three pull the JS bundle well past the default 2 MiB
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Voxelix',
        short_name: 'Voxelix',
        description: 'Fast browser-based 3D voxel editor with per-object glTF export.',
        theme_color: '#14161d',
        background_color: '#14161d',
        display: 'standalone',
        start_url: ghPagesBase,
        scope: ghPagesBase,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
}));
