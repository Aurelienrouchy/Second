/**
 * Swap Parties — legacy route.
 *
 * The Swap Zone is now a single, always-active generalist zone served at the
 * clean route `/swap-zone`. This route is kept only for back-compat and
 * redirects there.
 */

import { Redirect } from 'expo-router';

export default function SwapPartiesRedirect() {
  return <Redirect href="/swap-zone" />;
}
