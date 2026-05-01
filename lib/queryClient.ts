import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client.
 *
 * Defined as a module-level singleton (instead of inline in _layout.tsx) so
 * non-React code — services, store actions, the resetAllStores utility —
 * can call `queryClient.clear()` on logout without prop-drilling or
 * importing from a route file.
 *
 * gcTime > staleTime so queries don't get GC'd while still considered
 * fresh (audit perf #18).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000, // 10 min
      gcTime: 15 * 60 * 1000, // 15 min
      retry: 2,
    },
  },
});
