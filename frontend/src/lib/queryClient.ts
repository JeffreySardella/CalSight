import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      // 24h, matched to the offline-persistence maxAge in queryPersistence.ts —
      // a query must stay in-cache to keep being written to the persisted snapshot.
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
