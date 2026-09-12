# Playwright e2e suite

Run from `frontend/`. The config auto-starts `vite --port 5174`; Chromium must be installed (`npx playwright install chromium`).

- Hermetic (no backend): `npm run test:e2e` — the vite `/api` proxy points at `127.0.0.1:8000`, so
  specs that need chart/highway data skip themselves with a stated reason; the rest run offline.
- CI runs the hermetic mode on every PR/push (`e2e` job in `.github/workflows/ci.yml`); a failure
  there blocks deploy, and the HTML report is uploaded as the `playwright-report` artifact.
- Against the live API: `VITE_API_TARGET=https://api.calsight.org npm run test:e2e` — the proxy
  forwards `/api` to that origin and every spec runs. Point it at a local backend the same way.

The `VITE_API_TARGET` check is `process.env` in the spec, so set it for the *runner*, not just vite.
