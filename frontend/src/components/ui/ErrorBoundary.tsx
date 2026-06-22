import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { queryClient } from "../../lib/queryClient";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div role="alert" className="flex flex-col items-center justify-center p-8 text-center min-h-[200px]">
          <span className="material-symbols-outlined text-[32px] text-error mb-2" aria-hidden="true">error</span>
          <p className="text-on-surface font-semibold">Something went wrong</p>
          <button
            type="button"
            onClick={() => { queryClient.clear(); this.setState({ hasError: false }); }}
            className="mt-3 px-4 py-2 bg-primary text-on-primary rounded-full text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
