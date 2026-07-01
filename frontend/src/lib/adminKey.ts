/**
 * Admin/ETL API key storage.
 *
 * The key lives in sessionStorage (never localStorage) so it does not outlive
 * the tab. When the backend rejects the key (403), `clearAdminKey` wipes it
 * and broadcasts an event so <AdminGuard> can fall back to the locked state.
 */

const KEY_STORAGE = "calsight-admin-key";

/** Header name expected by the backend (see backend/app/routers/etl.py). */
export const ETL_KEY_HEADER = "X-ETL-API-Key";

/** Fired on `window` whenever the stored key is cleared. */
export const ADMIN_KEY_CLEARED_EVENT = "calsight-admin-key-cleared";

export function getAdminKey(): string | null {
  try {
    return sessionStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setAdminKey(key: string): void {
  try {
    sessionStorage.setItem(KEY_STORAGE, key);
  } catch {
    // Private browsing, quota exceeded, or storage disabled
  }
}

export function clearAdminKey(): void {
  try {
    sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // Swallow
  }
  window.dispatchEvent(new Event(ADMIN_KEY_CLEARED_EVENT));
}

/** Headers to attach to every /api/etl/* request. */
export function etlAuthHeaders(): Record<string, string> {
  const key = getAdminKey();
  return key ? { [ETL_KEY_HEADER]: key } : {};
}
