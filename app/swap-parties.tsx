/**
 * Swap Parties — legacy route.
 *
 * The Swap Zone is now a single, always-active generalist zone served at the
 * clean route `/swap-zone`. This route is kept only for back-compat and
 * redirects there.
 */

import { useEffect } from 'react';
import { Redirect } from 'expo-router';

import { track } from '@/lib/analytics';

export default function SwapPartiesRedirect() {
  useEffect(() => {
    track('legacy_route_redirected', { legacy_route: '/swap-parties' });
  }, []);
  return <Redirect href="/swap-zone" />;
}
