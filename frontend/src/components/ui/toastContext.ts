import { createContext, useContext } from "react";

export type ToastVariant = "success" | "error" | "info";

export interface ToastOptions {
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. Defaults to 4000. */
  duration?: number;
}

export interface ToastContextValue {
  /** Enqueue a toast; returns its id (usable with dismissToast). */
  showToast: (message: string, options?: ToastOptions) => number;
  dismissToast: (id: number) => void;
}

/**
 * Default is a no-op so components with a toast affordance (ChatMessage,
 * CopyLinkButton, …) stay renderable in isolation (tests, storybook-style
 * harnesses) without wrapping every tree in ToastProvider. The real value is
 * supplied by <ToastProvider> mounted once in App.tsx.
 */
export const ToastContext = createContext<ToastContextValue>({
  showToast: () => -1,
  dismissToast: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
