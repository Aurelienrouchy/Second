import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getNetworkStateAsync, useNetworkState } from 'expo-network';

/**
 * Thin wrapper around expo-network's useNetworkState.
 *
 * Returns stable booleans for connectivity status.
 * `isConnected` is false when there is no network interface.
 * `isInternetReachable` is false when connected to a network that cannot reach the internet
 * (e.g. captive portal, restricted Wi-Fi).
 *
 * Both default to `true` while the initial state is being resolved so that the
 * app does not flash an offline banner on cold start.
 *
 * On some platforms the passive listener does not fire when the app returns to
 * the foreground (e.g. connectivity restored while backgrounded), leaving a
 * stale offline banner. We re-query actively on foreground to reconcile.
 */
export function useNetworkStatus(): {
  isConnected: boolean;
  isInternetReachable: boolean;
} {
  const networkState = useNetworkState();
  const passiveConnected = networkState.isConnected;
  const passiveReachable = networkState.isInternetReachable;
  const [foregroundState, setForegroundState] = useState<{
    isConnected?: boolean | null;
    isInternetReachable?: boolean | null;
    passiveConnected?: boolean | null;
    passiveReachable?: boolean | null;
  } | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        getNetworkStateAsync()
          .then((state) =>
            setForegroundState({
              isConnected: state.isConnected,
              isInternetReachable: state.isInternetReachable,
              passiveConnected,
              passiveReachable,
            })
          )
          .catch((error) => {
            if (__DEV__) console.warn('[useNetworkStatus] foreground refresh failed:', error);
          });
      }
    });
    return () => subscription.remove();
  }, [passiveConnected, passiveReachable]);

  // Passive updates are the primary source — the foreground override only
  // applies until the listener reports a fresh value, to avoid masking it.
  const overrideActive =
    foregroundState !== null &&
    foregroundState.passiveConnected === passiveConnected &&
    foregroundState.passiveReachable === passiveReachable;

  const isConnected =
    (overrideActive ? foregroundState.isConnected : null) ?? passiveConnected ?? true;
  const isInternetReachable =
    (overrideActive ? foregroundState.isInternetReachable : null) ?? passiveReachable ?? true;

  return { isConnected, isInternetReachable };
}
