/**
 * useSplashScreen — keep the native splash screen up until the app's
 * initial work is done, then hide it exactly once.
 *
 * The caller computes a single `ready` boolean (fonts loaded + auth
 * hydrated + critical data prefetched) and passes it in. As long as
 * `ready` is false the splash stays visible and the app can render
 * `null`, so no in-app spinner ever flashes during startup — every
 * loading state happens behind the splash.
 *
 * `preventAutoHideAsync()` must be called at module scope by the root
 * layout (before the first render) so Expo Router doesn't auto-hide the
 * splash before this gate resolves.
 *
 * `hideAsync()` is fired through `onLayoutRootView`, returned for use as
 * the root view's `onLayout`, so the splash is dismissed only after the
 * first real frame is committed (avoids a one-frame blank gap). A ref
 * guards against the double-invoke that `onLayout` can trigger.
 */

import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useRef } from 'react';

export function useSplashScreen(ready: boolean): {
  onLayoutRootView: () => void;
} {
  const hiddenRef = useRef(false);

  const onLayoutRootView = useCallback(() => {
    if (!ready || hiddenRef.current) return;
    hiddenRef.current = true;
    // Fire-and-forget: hiding is idempotent and any rejection (splash
    // already hidden) is irrelevant to the running app.
    void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  return { onLayoutRootView };
}
