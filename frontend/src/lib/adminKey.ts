/**
 * Admin/ETL API key storage.
 *
 * The key is held in memory only — a module-scoped variable, never
 * sessionStorage/localStorage/cookies. Persisting a secret to web storage is
 * clear-text storage of sensitive data (readable by any script on the page,
 * survives across navigations), so we keep it in a closure instead: it lives
 * exactly as long as the tab's JS context and vanishes on a full reload, at
 * which point <AdminGuard> re-prompts. When the backend rejects the key
 * (403), `clearAdminKey` wipes it and broadcasts an event so <AdminGuard>
 * falls back to the locked state.
 */

let adminKey: string | null = null;

/** Header name expected by the backend (see backend/app/routers/etl.py). */
export const ETL_KEY_HEADER = "X-ETL-API-Key";

/** Fired on `window` whenever the stored key is cleared. */
export const ADMIN_KEY_CLEARED_EVENT = "calsight-admin-key-cleared";

export function getAdminKey(): string | null {
  return adminKey;
}

export function setAdminKey(key: string): void {
  adminKey = key;
}

export function clearAdminKey(): void {
  adminKey = null;
  window.dispatchEvent(new Event(ADMIN_KEY_CLEARED_EVENT));
}

/** Headers to attach to every /api/etl/* request. */
export function etlAuthHeaders(): Record<string, string> {
  return adminKey ? { [ETL_KEY_HEADER]: adminKey } : {};
}
