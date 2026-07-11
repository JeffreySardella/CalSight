import * as Sentry from '@sentry/react'

// Sentry error monitoring. No-op unless VITE_SENTRY_DSN is set at build time,
// mirroring the env-gated pattern the backend uses for SENTRY_DSN. This file
// must be imported first in main.tsx so Sentry initializes before any app code.
const dsn = import.meta.env.VITE_SENTRY_DSN

// Global observability for unhandled promise rejections (issue #303). When
// Sentry is active its GlobalHandlers integration reports these to Sentry;
// this listener guarantees a recognizable console trail in EVERY environment
// (including builds without a DSN) so silent async failures stay visible.
window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  console.error('[calsight:unhandledrejection]', event.reason)
})

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    // Tracing — keep low; raise locally if profiling a perf issue.
    tracesSampleRate: 0.1,
    // Session Replay — sample a slice of sessions, but always record on error.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  })
}
