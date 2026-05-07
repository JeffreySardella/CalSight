import { type HTMLAttributes } from "react";

/**
 * Pulsing placeholder block for loading states.
 * Compose with Tailwind sizing classes (e.g. `h-48 w-full`).
 */
export function Skeleton({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={`bg-surface-container-high animate-pulse rounded-md ${className}`}
      {...rest}
    />
  );
}
