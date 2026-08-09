# Why `style-src` keeps `'unsafe-inline'`

The Content-Security-Policy in `frontend/public/_headers` allows
`style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`. The
`'unsafe-inline'` is a **deliberate, documented exception**, not an oversight
(flagged as a LOW finding in the 2026-08-08 audit).

## Why it can't simply be removed

The app is a Leaflet map. Leaflet positions tiles, panes, markers, the heatmap
canvas, and zoom transforms by writing to `element.style` on almost every
interaction. Browsers govern inline **style attributes** (`el.style.foo = …`
and `style="…"`) under `style-src-attr`, which falls back to `style-src`.
Removing `'unsafe-inline'` there would break map rendering and panning.

Unlike inline `<script>`, inline **styles** have no nonce/hash escape hatch
that covers runtime `element.style` mutations — a nonce only authorizes
`<style>` elements, not the style-attribute writes Leaflet relies on. So there
is no way to keep the map working while dropping `'unsafe-inline'` from
`style-src`.

## Why the residual risk is low

- `script-src` does **not** use `'unsafe-inline'` — it pins two hashes. Script
  injection, the path to actual code execution and data exfiltration, is
  closed.
- `connect-src`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  and `frame-ancestors 'none'` remain tight, so even injected styles have no
  exfiltration channel.
- The worst realistic abuse of inline-style injection here is cosmetic
  (restyling elements), not data theft or code execution.

## If this is ever revisited

Dropping `'unsafe-inline'` from `style-src` would require replacing Leaflet, or
a browser mechanism for hashing/nonce-ing style-attribute writes. Neither is
worth it for a cosmetic-only residual risk on a public open-data map.
