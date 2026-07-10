import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: false,
      includeAssets: [
        'favicon.ico',
        'favicon.svg',
        'favicon-96x96.png',
        'apple-touch-icon.png',
        'web-app-manifest-192x192.png',
        'web-app-manifest-512x512.png',
        'site.webmanifest',
        'ca-counties.topo.json',
      ],
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webp}'],
        globIgnores: ['**/ca-counties.geojson'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/admin\//],
        // NOTE on the /api/* routes below: Workbox only applies RegExp routes
        // to cross-origin requests when the match starts at index 0 of the
        // full href, so path-only patterns like /\/api\/stats/ silently never
        // match the prod API origin (https://api.calsight.org). Function
        // matchers cover both the same-origin dev/preview proxy and the
        // cross-origin prod API. These functions are serialized into the
        // generated service worker, so they must be self-contained (no
        // closure variables — the prod origin is inlined in each one).
        // Routes are evaluated in registration order, so the NetworkOnly
        // guard must stay first to take precedence over the cacheable routes.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'carto-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) =>
              (sameOrigin || url.origin === 'https://api.calsight.org') &&
              /^\/api\/(etl|ask|live-)/.test(url.pathname),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url, sameOrigin }) =>
              (sameOrigin || url.origin === 'https://api.calsight.org') &&
              /^\/api\/(insights|calenviroscreen|unemployment|data-quality|meta)/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-reference',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) =>
              (sameOrigin || url.origin === 'https://api.calsight.org') &&
              /^\/api\/(stats|crashes|demographics|context|heatmap)/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-data',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 2,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-leaflet': ['leaflet', 'leaflet.heat', 'react-leaflet', 'react-leaflet-cluster'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': process.env.VITE_API_TARGET || 'http://127.0.0.1:8000',
    },
  },
  preview: {
    proxy: {
      '/api': process.env.VITE_API_TARGET || 'http://127.0.0.1:8000',
    },
  },
})
