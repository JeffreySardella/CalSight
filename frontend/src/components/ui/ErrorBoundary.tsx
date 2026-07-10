import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  // When provided, rendered instead of the default retry UI on error.
  // Presence is checked with `'fallback' in props` (not ??), so passing
  // fallback={null} explicitly opts into "render nothing" rather than
  // falling through to the default UI. Omitting the prop entirely gives
  // you the default retry UI.
  fallback?: ReactNode;
  // When this value changes, a latched error is cleared. Pass the route (e.g.
  // location.pathname) so navigating away from a crashed page shows the new
  // page instead of the stale error fallback (M-F12).
  resetKey?: unknown;
}

interface State {
  hasError: boolean;
  retryCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, retryCount: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    // Navigation (or any resetKey change) clears a latched error so the next
    // route isn't hidden behind a stale fallback (M-F12).
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, retryCount: 0 });
      return;
    }
    // Child rendered successfully after a retry — reset count for the next error episode.
    if (prevState.hasError && !this.state.hasError) {
      this.setState({ retryCount: 0 });
    }
  }

  render() {
    if (this.state.hasError) {
      if ('fallback' in this.props) return <>{this.props.fallback}</>;
      const exhausted = this.state.retryCount >= 3;
      return (
        <div role="alert" className="flex flex-col items-center justify-center p-8 text-center min-h-[200px]">
          <span className="material-symbols-outlined text-[32px] text-error mb-2" aria-hidden="true">error</span>
          <p className="text-on-surface font-semibold">Something went wrong</p>
          <button
            type="button"
            onClick={() => {
              if (exhausted) {
                window.location.reload();
              } else {
                // Retry is a subtree re-render only. Deliberately does NOT
                // touch the query cache: boundaries wrap individual chart
                // cards, and clearing the client here caused an app-wide
                // refetch storm and overwrote the persisted offline snapshot
                // with an emptied cache (audit M17).
                this.setState(s => ({ hasError: false, retryCount: s.retryCount + 1 }));
              }
            }}
            className="mt-3 px-4 py-2 bg-primary text-on-primary rounded-full text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            {exhausted ? "Reload page" : "Try again"}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
