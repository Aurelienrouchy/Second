import { useEffect } from 'react';
import { usePathname, useSegments } from 'expo-router';

import { trackScreen } from '@/lib/analytics';

/**
 * Global screen tracking. Mounted once in the root layout: on every route
 * change it sends a PostHog screen view using the Expo Router route PATTERN
 * (e.g. `article/[id]`, from useSegments) as the screen name — never the
 * concrete URL with real ids — and threads the resolved pathname as a property.
 */
export function useScreenTracking(): void {
  const segments = useSegments();
  const pathname = usePathname();

  // segments already carry dynamic placeholders (`[id]`) and group names
  // (`(tabs)`), so joining them yields the stable route pattern.
  const pattern = segments.length > 0 ? segments.join('/') : 'index';

  useEffect(() => {
    trackScreen(pattern, { pathname });
  }, [pattern, pathname]);
}
