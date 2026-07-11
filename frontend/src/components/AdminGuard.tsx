import { useState, useCallback, useEffect, useRef } from "react";
import { safeRemoveItem } from "../lib/safeStorage";
import { getAdminKey, setAdminKey, ADMIN_KEY_CLEARED_EVENT } from "../lib/adminKey";
import { API_BASE } from "../config";

/** Old boolean flag from a previous version — never grants access anymore. */
const LEGACY_STORAGE_KEY = "calsight-admin-authenticated";

/**
 * Route guard for admin pages. On successful verification the admin key is
 * kept in memory (never web storage — see lib/adminKey) and attached to
 * /api/etl/* requests as the X-ETL-API-Key header. When the backend rejects
 * the key (403), the key is cleared and this guard drops back to the locked
 * state. A full page reload drops the in-memory key and re-prompts.
 */
export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(() => getAdminKey() !== null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Migrate away from the legacy localStorage boolean: it only recorded that
  // a key was once verified, without the key itself, so it cannot be trusted.
  useEffect(() => {
    safeRemoveItem(LEGACY_STORAGE_KEY);
  }, []);

  // Re-lock when the stored key is cleared (e.g. an ETL request came back 403).
  useEffect(() => {
    const onCleared = () => setAuthenticated(false);
    window.addEventListener(ADMIN_KEY_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(ADMIN_KEY_CLEARED_EVENT, onCleared);
  }, []);

  useEffect(() => {
    if (!authenticated) {
      inputRef.current?.focus();
    }
  }, [authenticated]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/admin/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: password }),
      });
      if (res.ok) {
        setAdminKey(password);
        setPassword("");
        setAuthenticated(true);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.detail ?? "Invalid admin key");
      }
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, [password]);

  if (authenticated) {
    return <>{children}</>;
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm p-6 rounded-lg border border-outline-variant/40 bg-surface-container-lowest ambient-shadow space-y-4"
      >
        <h2 className="text-lg font-semibold text-on-surface">
          Admin Access Required
        </h2>
        <p className="text-sm text-on-surface-variant">
          Enter the admin key to access this page.
        </p>
        <input
          ref={inputRef}
          type="password"
          aria-label="Admin key"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin key"
          className="w-full px-3 py-2 rounded border border-outline-variant bg-surface-container text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {error && (
          <p className="text-sm text-error">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full px-4 py-2 rounded bg-primary text-on-primary font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Verifying..." : "Unlock"}
        </button>
      </form>
    </div>
  );
}
