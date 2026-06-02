import {
  MutationCache,
  onlineManager,
  QueryCache,
  QueryClient,
} from '@tanstack/react-query';
import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';

/**
 * Wire React Query's online manager to expo-network so queries pause while
 * offline and automatically refetch on reconnect (audit P2-14). Without this
 * RQ assumes it is always online on React Native and never resumes paused
 * fetches when connectivity returns.
 */
onlineManager.setEventListener((setOnline) => {
  // Seed the current state immediately so RQ doesn't start in the wrong mode.
  void getNetworkStateAsync()
    .then((state) => {
      setOnline(
        (state.isConnected ?? true) && (state.isInternetReachable ?? true),
      );
    })
    .catch(() => {
      // Default to online if the probe fails — fail open so the app still fetches.
      setOnline(true);
    });

  const subscription = addNetworkStateListener((state) => {
    setOnline(
      (state.isConnected ?? true) && (state.isInternetReachable ?? true),
    );
  });

  return () => subscription.remove();
});

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
 *
 * QueryCache/MutationCache `onError` give every query and mutation a single
 * centralized failure logger (audit P2-15). In production this is the hook
 * point for Sentry/Crashlytics once one is wired.
 */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (__DEV__) {
        console.error('[QueryCache] query error:', query.queryKey, error);
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (__DEV__) {
        console.error(
          '[MutationCache] mutation error:',
          mutation.options.mutationKey,
          error,
        );
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000, // 10 min
      gcTime: 15 * 60 * 1000, // 15 min
      retry: 2,
    },
  },
});
