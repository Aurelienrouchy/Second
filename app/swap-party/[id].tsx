/**
 * Swap Party Detail — legacy route.
 *
 * The Swap Zone is now a single, always-active generalist zone served at the
 * clean route `/swap-zone`. This dynamic route is kept only for back-compat
 * with existing deep links / notifications and redirects there.
 */

import { Redirect } from 'expo-router';

export default function SwapPartyRedirect() {
  return <Redirect href="/swap-zone" />;
}
