/**
 * Swap Party Detail — legacy route.
 *
 * The Swap Zone is now a single, always-active generalist zone served at the
 * clean route `/swap-zone`. This dynamic route is kept only for back-compat
 * with existing deep links / notifications and redirects there.
 */

import { useEffect } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { track } from '@/lib/analytics';

export default function SwapPartyRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useEffect(() => {
    track('legacy_route_redirected', {
      legacy_route: '/swap-party/[id]',
      ...(id ? { legacy_party_id: id } : {}),
    });
  }, [id]);
  return <Redirect href="/swap-zone" />;
}
