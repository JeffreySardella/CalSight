/**
 * Decides *when* a freshly activated service worker is allowed to reload the
 * page.
 *
 * vite-plugin-pwa's `autoUpdate` mode calls `window.location.reload()` from its
 * `activated` handler the moment a new worker takes over (see
 * node_modules/vite-plugin-pwa/dist/client/build/register.js). On a phone that
 * lands a few seconds after the link opens — mid-pinch, mid-pan — and reads as
 * "the map is broken". Passing `onNeedReload` suppresses that reload and hands
 * the timing to us.
 *
 * Policy: apply the update at the first moment the user is demonstrably not
 * interacting — the tab going to the background, or a route change — whichever
 * comes first. If neither happens inside the grace window, stop listening and
 * leave the new version for the next visit; a page that has been open for ten
 * minutes has earned the right not to be yanked out from under its reader.
 *
 * The decision itself is a pure function so it can be tested without a service
 * worker, a Workbox instance, or a real reload.
 */

export type UpdateTrigger =
  /** The tab became hidden (backgrounded, app switched, screen locked). */
  | "hidden"
  /** The SPA navigated to a different route. */
  | "route-change"
  /** The grace window elapsed with neither of the above. */
  | "expired";

export interface GateState {
  /** A reload was already triggered — never fire a second one. */
  applied: boolean;
  /** The grace window elapsed; the update waits for the next visit. */
  expired: boolean;
}

/** Pure policy: should *this* trigger reload the page right now? */
export function decideUpdate(trigger: UpdateTrigger, state: GateState): "apply" | "ignore" {
  if (state.applied) return "ignore";
  if (state.expired) return "ignore";
  // Expiry is the absence of an opportunity, never an opportunity itself.
  if (trigger === "expired") return "ignore";
  return "apply";
}

/** How long we wait for a quiet moment before giving up on this session. */
const UPDATE_GRACE_MS = 10 * 60 * 1000;

let state: GateState = { applied: false, expired: false };
let applyFn: (() => void) | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function onVisibilityChange() {
  if (document.visibilityState === "hidden") fire("hidden");
}

function stopListening() {
  document.removeEventListener("visibilitychange", onVisibilityChange);
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

function fire(trigger: UpdateTrigger) {
  if (decideUpdate(trigger, state) === "ignore") return;
  state = { ...state, applied: true };
  stopListening();
  const apply = applyFn;
  applyFn = null;
  apply?.();
}

/**
 * Arm the gate. Called once, from the service worker's `onNeedReload`.
 * Re-arming while already armed is a no-op (the worker is already waiting).
 */
export function armUpdateGate(apply: () => void, graceMs: number = UPDATE_GRACE_MS): void {
  if (applyFn !== null || state.applied) return;
  applyFn = apply;
  document.addEventListener("visibilitychange", onVisibilityChange);
  expiryTimer = setTimeout(() => {
    state = { ...state, expired: true };
    stopListening();
    applyFn = null;
  }, graceMs);
}

/** Called by the router on every SPA navigation after the first. */
export function notifyRouteChange(): void {
  fire("route-change");
}

/** Test-only: drop all gate state and listeners. */
export function resetUpdateGate(): void {
  stopListening();
  state = { applied: false, expired: false };
  applyFn = null;
}
