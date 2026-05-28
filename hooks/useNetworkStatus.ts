import { useNetworkState } from 'expo-network';

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
 */
export function useNetworkStatus(): {
  isConnected: boolean;
  isInternetReachable: boolean;
} {
  const networkState = useNetworkState();

  return {
    isConnected: networkState.isConnected ?? true,
    isInternetReachable: networkState.isInternetReachable ?? true,
  };
}
