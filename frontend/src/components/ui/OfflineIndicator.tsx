import { useEffect, useState } from "react";

/**
 * Floating pill that appears when the browser loses network connectivity.
 * Listens to `online` / `offline` window events.
 */
export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-14 md:top-20 left-1/2 -translate-x-1/2 z-50 bg-error-container text-on-error-container px-4 py-2 rounded-full ambient-shadow flex items-center gap-2 text-xs font-bold"
    >
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">cloud_off</span>
      <span>You're offline</span>
    </div>
  );
}
