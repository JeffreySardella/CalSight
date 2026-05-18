import { useState, useCallback, useEffect, useRef } from "react";
import { API_BASE } from "../config";

const STORAGE_KEY = "calsight-admin-authenticated";

/**
 * Route guard for admin pages. Stores only a boolean flag in localStorage
 * (never the actual key) to remember authentication state across sessions.
 */
export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === "true";
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
      const res = await fetch(
        `${API_BASE}/api/admin/verify?key=${encodeURIComponent(password)}`
      );
      if (res.ok) {
        localStorage.setItem(STORAGE_KEY, "true");
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
        className="w-full max-w-sm p-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm space-y-4"
      >
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Admin Access Required
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Enter the admin key to access this page.
        </p>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin key"
          className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Verifying..." : "Unlock"}
        </button>
      </form>
    </div>
  );
}
