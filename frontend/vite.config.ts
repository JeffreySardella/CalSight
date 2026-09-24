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
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // The precache is the app shell only: index.html plus the build's
        // hashed files. On a first visit the worker downloads all of it one
        // file at a time, competing with the page, so on a slow phone every
        // extra file costs a round trip. What's left out:
        // - public/: icons and og-default.png, which no page renders, and the
        //   map geometry, runtime-cached below.
        //   Precaching ca-counties.topo.json downloaded it twice per first
        //   visit: Workbox refetches unhashed files with cache: 'reload'.
        // - Font subsets other than latin: the @font-face unicode-range means
        //   the browser only fetches them for text that needs them.
        // - jspdf's optional dependencies (html2canvas, dompurify, canvg):
        //   jspdf imports them only for .html() and addSvgAsImage(), which
        //   CalSight never calls, so no page ever loads these chunks.
        globPatterns: ['index.html', 'assets/*.{js,css,svg,png,webp}', 'assets/*-latin-wght-*.woff2'],
        globIgnores: ['assets/{html2canvas.esm,purify.es,index.es}-*.js'],
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
            // Every basemap host in src/lib/map/basemaps.ts, or a provider
            // fallback loses tile caching. Cache name kept from when CARTO
            // was the only provider: renaming it would orphan the tiles
            // already cached in every existing user's browser.
            urlPattern: /^https:\/\/(?:[a-d]\.basemaps\.cartocdn\.com|server\.arcgisonline\.com|tile\.openstreetmap\.org)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'carto-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Map geometry (counties, highways, tracts) left out of the
            // precache: cached on first use instead, so the map still draws
            // offline on later visits. functions/_middleware.ts 404s an HTML
            // answer for these paths, so a 200 here is always the real file.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /^\/ca-[\w-]+\.(?:topo\.json|geojson)$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'map-geometry',
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) =>
              (sameOrigin || url.origin === 'https://api.calsight.org') &&
              /^\/api\/(etl|ask|live-)/.test(url.pathname),
            handler: 'NetworkOnly',
          },
          {
            // PII guard: the raw /api/crashes rows (per-row lat/lng + involvement
            // flags) and the parties/victims endpoints are served with
            // Cache-Control: no-store and must never be cached. This must
            // precede the api-data route below, whose `crashes` prefix would
            // otherwise cache them. Note the `$` after `crashes` — it excludes
            // the aggregated /api/crashes/heatmap and /api/crashes/clusters,
            // which stay cacheable.
            urlPattern: ({ url, sameOrigin }) =>
              (sameOrigin || url.origin === 'https://api.calsight.org') &&
              (/^\/api\/crashes$/.test(url.pathname) ||
                /^\/api\/(parties|victims)(\/|$)/.test(url.pathname) ||
                /^\/api\/crashes\/\d+\/(parties|victims)(\/|$)/.test(url.pathname)),
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
