# Rebuilding Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a non-blocking "data is being rebuilt" top bar while a materialized view is being repopulated (e.g. mid-deploy), instead of silently serving zeros.

**Architecture:** `/api/health` gains a third state, `rebuilding`, detected automatically from `pg_class.relispopulated` over the project's materialized-view list and returned with HTTP 200 (service is up, only data is degraded). The frontend health hook maps that body to a `"rebuilding"` state, and a new `RebuildingBanner` renders a slim top bar that auto-clears when health returns to `ok`. The existing full-screen `MaintenanceGate` is untouched.

**Tech Stack:** FastAPI + SQLAlchemy (backend), React + TanStack Query + Vitest + Testing Library (frontend), Postgres materialized views.

## Global Constraints

- Health "rebuilding" response MUST be HTTP **200** (not 503) so uptime monitors stay green; the frontend distinguishes state by response body, not status code.
- `maintenance_mode` (503) ALWAYS takes precedence over `rebuilding`.
- Detection must never break the health endpoint: any catalog-query error falls back to "not rebuilding".
- Banner copy (exact): `Some data is being rebuilt and may be temporarily incomplete.`
- Banner is non-blocking, `role="status"`, `aria-live="polite"`, no dismiss button.
- The MV name list is single-sourced in `app/health.py` (`MATERIALIZED_VIEWS`); `etl/refresh_materialized_views.py` imports it rather than redefining.
- All backend commands run from `backend/`. All frontend commands run from `frontend/`.
- No co-author / AI attribution in commit messages.

---

### Task 1: Backend — `rebuilding` detection + `/api/health` state

**Files:**
- Create: `backend/app/health.py`
- Modify: `backend/app/main.py:209-217` (the `health()` handler)
- Modify: `backend/etl/refresh_materialized_views.py:39-48` (`_VIEWS` → import shared list)
- Test: `backend/tests/api/test_health.py` (create)

**Interfaces:**
- Produces: `app.health.MATERIALIZED_VIEWS: tuple[str, ...]` and
  `app.health.is_rebuilding(db: Session, views: Iterable[str] | None = None) -> bool`.
  Returns `True` iff at least one named relation exists and is unpopulated
  (`relispopulated = false`); `False` when all populated, none match, or on error.
- Consumes (in main.py): `from app.health import is_rebuilding`.

- [ ] **Step 1: Write the failing test for the detection helper**

Create `backend/tests/api/test_health.py`:

```python
"""Tests for /api/health rebuilding detection (mv_crashes_wide etc.)."""

import pytest
from sqlalchemy import text

import app.main as main_module
from app.health import is_rebuilding

pytestmark = pytest.mark.integration


def test_is_rebuilding_true_when_view_unpopulated(db_session):
    # A throwaway matview created WITH NO DATA is unpopulated.
    db_session.execute(text("CREATE MATERIALIZED VIEW mv_probe_unpop AS SELECT 1 AS x WITH NO DATA"))
    assert is_rebuilding(db_session, views=["mv_probe_unpop"]) is True


def test_is_rebuilding_false_when_view_populated(db_session):
    db_session.execute(text("CREATE MATERIALIZED VIEW mv_probe_pop AS SELECT 1 AS x WITH NO DATA"))
    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_probe_pop"))
    assert is_rebuilding(db_session, views=["mv_probe_pop"]) is False


def test_is_rebuilding_false_when_no_views_match(db_session):
    assert is_rebuilding(db_session, views=["mv_does_not_exist"]) is False
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/api/test_health.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.health'`.

- [ ] **Step 3: Create the detection module**

Create `backend/app/health.py`:

```python
"""Detection of a materialized-view rebuild window for /api/health.

A matview created/recreated WITH NO DATA has pg_class.relispopulated=false
until it is first populated. Normal nightly refreshes use REFRESH ...
CONCURRENTLY, which keeps the view populated throughout — so this only
fires during the non-concurrent initial population after a recreate
(the deploy scenario), not during routine refreshes.
"""

from __future__ import annotations

from typing import Iterable

from sqlalchemy import text
from sqlalchemy.orm import Session

# Single source of truth for the MV names the API serves from.
# etl/refresh_materialized_views.py imports this list.
MATERIALIZED_VIEWS: tuple[str, ...] = (
    "mv_crashes_by_year",
    "mv_crashes_by_cause",
    "mv_crashes_by_hour",
    "mv_crashes_by_month",
    "mv_crash_victims_by_demographics",
    "mv_at_fault_parties_by_demographics",
    "mv_crash_rates",
    "mv_crashes_wide",
)


def is_rebuilding(db: Session, views: Iterable[str] | None = None) -> bool:
    """True iff at least one named matview exists and is unpopulated.

    bool_and over zero matching rows is NULL → treated as not rebuilding.
    Any error is swallowed → not rebuilding, so health never breaks itself.
    """
    names = list(views if views is not None else MATERIALIZED_VIEWS)
    if not names:
        return False
    try:
        populated = db.execute(
            text("SELECT bool_and(relispopulated) FROM pg_class WHERE relname = ANY(:names)"),
            {"names": names},
        ).scalar()
    except Exception:
        return False
    return populated is False
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `python -m pytest tests/api/test_health.py -v`
Expected: 3 passed.

- [ ] **Step 5: Write the failing endpoint tests**

Append to `backend/tests/api/test_health.py`:

```python
def test_health_reports_rebuilding(client, monkeypatch):
    monkeypatch.setattr(main_module, "is_rebuilding", lambda db: True)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "rebuilding"


def test_health_ok_when_not_rebuilding(client, monkeypatch):
    monkeypatch.setattr(main_module, "is_rebuilding", lambda db: False)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_maintenance_precedes_rebuilding(client, monkeypatch):
    monkeypatch.setattr(main_module.settings, "maintenance_mode", True)
    monkeypatch.setattr(main_module, "is_rebuilding", lambda db: True)
    resp = client.get("/api/health")
    assert resp.status_code == 503
    assert resp.json()["status"] == "maintenance"
```

- [ ] **Step 6: Run the endpoint tests to verify they fail**

Run: `python -m pytest tests/api/test_health.py -v`
Expected: `test_health_reports_rebuilding` FAILS (health still returns `ok`); `AttributeError` is acceptable if `is_rebuilding` isn't imported into `main` yet.

- [ ] **Step 7: Wire detection into the health handler**

In `backend/app/main.py`, add the import near the other `app.*` imports:

```python
from app.health import is_rebuilding
```

Replace the handler at `backend/app/main.py:209-217` with:

```python
@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    if settings.maintenance_mode:
        return JSONResponse(status_code=503, content={"status": "maintenance"})
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(status_code=503, content={"status": "db_unavailable"})
    if is_rebuilding(db):
        return {"status": "rebuilding"}
    return {"status": "ok"}
```

- [ ] **Step 8: DRY the ETL view list**

In `backend/etl/refresh_materialized_views.py`, replace the `_VIEWS = [ ... ]` literal (lines 39-48) with:

```python
from app.health import MATERIALIZED_VIEWS

_VIEWS = list(MATERIALIZED_VIEWS)
```

(Place the import with the other top-of-file imports; keep the literal's
order — it matches `MATERIALIZED_VIEWS`.)

- [ ] **Step 9: Run the full backend health + maintenance + refresh-affected suites**

Run: `python -m pytest tests/api/test_health.py tests/test_maintenance.py tests/api/test_stats.py -v`
Expected: all passed (existing maintenance tests still green; new health tests green).

- [ ] **Step 10: Commit**

```bash
git add backend/app/health.py backend/app/main.py backend/etl/refresh_materialized_views.py backend/tests/api/test_health.py
git commit -m "feat(health): add rebuilding state from pg_class.relispopulated"
```

---

### Task 2: Frontend — `useApiHealth` gains `"rebuilding"`

**Files:**
- Modify: `frontend/src/hooks/useApiHealth.ts`
- Test: `frontend/src/hooks/useApiHealth.test.tsx` (create)

**Interfaces:**
- Produces: `ApiHealth = "ok" | "rebuilding" | "maintenance" | "down"`; `useApiHealth()`
  returns `"rebuilding"` when `/api/health` responds `200 {status:"rebuilding"}`.
- Consumed by: Task 3 (`RebuildingBanner`).

- [ ] **Step 1: Write the failing hook test**

Create `frontend/src/hooks/useApiHealth.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useApiHealth } from "./useApiHealth";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("useApiHealth", () => {
  it("maps a 200 rebuilding body to 'rebuilding'", async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 200, ok: true, json: async () => ({ status: "rebuilding" }),
    } as Response);
    const { result } = renderHook(() => useApiHealth(), { wrapper });
    await waitFor(() => expect(result.current).toBe("rebuilding"));
  });

  it("maps a 200 ok body to 'ok'", async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 200, ok: true, json: async () => ({ status: "ok" }),
    } as Response);
    const { result } = renderHook(() => useApiHealth(), { wrapper });
    await waitFor(() => expect(result.current).toBe("ok"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/useApiHealth.test.tsx`
Expected: FAIL — `maps a 200 rebuilding body to 'rebuilding'` gets `"ok"` (hook ignores the 200 body today).

- [ ] **Step 3: Update the hook**

In `frontend/src/hooks/useApiHealth.ts`:

Change the type (line 4):
```ts
export type ApiHealth = "ok" | "rebuilding" | "maintenance" | "down";
```

Replace the `queryFn` body's tail (the part after the 503 block) so the 200 body is parsed:
```ts
      if (!res.ok) throw new Error("api-unhealthy");
      const body = (await res.json().catch(() => null)) as { status?: string } | null;
      if (body?.status === "rebuilding") return "rebuilding" as const;
      return "ok" as const;
```

Add `rebuilding` to the fast-poll predicate (the `refetchInterval`):
```ts
    refetchInterval: (q) =>
      q.state.data === "maintenance" ||
      q.state.data === "rebuilding" ||
      q.state.fetchFailureCount > 0
        ? 10_000
        : 45_000,
```

Add the mapping in the return block, before the `down`/`ok` lines:
```ts
  if (query.data === "maintenance") return "maintenance";
  if (query.data === "rebuilding") return "rebuilding";
  if (query.failureCount >= 3) return "down";
  return "ok";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/useApiHealth.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Run the existing gate test to confirm no regression**

Run: `npx vitest run src/components/MaintenanceGate.test.tsx`
Expected: 3 passed (the `ApiHealth` union widened but existing states unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useApiHealth.ts frontend/src/hooks/useApiHealth.test.tsx
git commit -m "feat(health): map 200 rebuilding body to a 'rebuilding' state"
```

---

### Task 3: Frontend — `RebuildingBanner` + mount

**Files:**
- Create: `frontend/src/components/RebuildingBanner.tsx`
- Create: `frontend/src/components/RebuildingBanner.test.tsx`
- Modify: `frontend/src/App.tsx` (import + mount beside `MaintenanceGate`, ~line 53)

**Interfaces:**
- Consumes: `useApiHealth()` (Task 2) — renders only when it returns `"rebuilding"`.
- Produces: default-exported `RebuildingBanner` React component.

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/components/RebuildingBanner.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import RebuildingBanner from "./RebuildingBanner";
import { useApiHealth, type ApiHealth } from "../hooks/useApiHealth";

vi.mock("../hooks/useApiHealth", () => ({ useApiHealth: vi.fn() }));
const mockHealth = (status: ApiHealth) =>
  (useApiHealth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(status);

describe("RebuildingBanner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when healthy", () => {
    mockHealth("ok");
    const { container } = render(<RebuildingBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the banner while rebuilding", () => {
    mockHealth("rebuilding");
    render(<RebuildingBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/being rebuilt/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/RebuildingBanner.test.tsx`
Expected: FAIL — cannot resolve `./RebuildingBanner`.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/RebuildingBanner.tsx`:

```tsx
import { useApiHealth } from "../hooks/useApiHealth";

/**
 * Slim, non-blocking top bar shown while a materialized view is being
 * repopulated (e.g. mid-deploy). The site stays usable; the bar auto-clears
 * when /api/health returns to "ok". Distinct from MaintenanceGate, which is a
 * full-screen overlay for "maintenance"/"down".
 */
export default function RebuildingBanner() {
  const health = useApiHealth();
  if (health !== "rebuilding") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[900] flex items-center justify-center gap-2 bg-primary text-on-primary text-xs px-4 py-1.5 text-center"
    >
      <span className="material-symbols-outlined text-[16px] animate-spin" aria-hidden="true">
        sync
      </span>
      <span>Some data is being rebuilt and may be temporarily incomplete.</span>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/RebuildingBanner.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Mount it in App**

In `frontend/src/App.tsx`, add the import beside the `MaintenanceGate` import (line 18):
```tsx
import RebuildingBanner from "./components/RebuildingBanner";
```

Add the element immediately after `<MaintenanceGate />` (line 53):
```tsx
          <MaintenanceGate />
          <RebuildingBanner />
```

- [ ] **Step 6: Run the frontend suite to confirm no regression**

Run: `npx vitest run src/components/RebuildingBanner.test.tsx src/components/MaintenanceGate.test.tsx src/hooks/useApiHealth.test.tsx`
Expected: all passed.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/RebuildingBanner.tsx frontend/src/components/RebuildingBanner.test.tsx frontend/src/App.tsx
git commit -m "feat(health): non-blocking RebuildingBanner top bar"
```

---

## Final verification

- [ ] Backend: from `backend/`, run `python -m pytest tests/ -q` → all pass.
- [ ] Frontend: from `frontend/`, run `npx vitest run` → all pass.
- [ ] Open PR off `feat/rebuilding-banner`; let CI run; merge when green.
