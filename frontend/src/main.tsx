import './instrument' // must be first — initializes Sentry before app code

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { captureException, reactErrorHandler } from '@sentry/react'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource-variable/public-sans'
import '@fontsource-variable/inter'
import App from './App'
import { armUpdateGate } from './lib/pwa/swUpdateGate'
import './index.css'

registerSW({
  immediate: true,
  // Without onNeedReload, autoUpdate mode calls window.location.reload() the
  // instant a new worker activates — on a phone that lands mid-pinch, seconds
  // after the link opens. Defer it to the next quiet moment; see swUpdateGate.
  onNeedReload() {
    armUpdateGate(() => window.location.reload())
  },
  // A failed registration means updates stop arriving silently — surface
  // it. captureException is a no-op when Sentry isn't initialized.
  onRegisterError(error: unknown) {
    console.error('Service worker registration failed', error)
    captureException(error)
  },
})

// React 19 root-level error hooks route uncaught render errors to Sentry
// (no-ops when Sentry is not initialized).
createRoot(document.getElementById('root')!, {
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
