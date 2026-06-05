import { router, useRootNavigationState, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { useAuthStore } from '@/store/authStore';

/**
 * Mandatory-consent navigation guard.
 *
 * A Firebase account can exist WITHOUT having completed the Loi 25 consent step
 * (no `dateOfBirth` written by recordSignupConsent) — e.g. a bare email signup,
 * a fresh social sign-in, OR a user who killed the app on the consent route.
 * `authStore.hydrateFromFirebase` flags these as `pendingConsent` (NOT a plain
 * guest, NOT fully connected). This guard forces them to app/complete-profile.tsx
 * and prevents access to the rest of the app until consent is recorded.
 *
 * Priority: the consent guard is ABOVE the preferences-onboarding guard
 * (app/index.tsx + ONBOARDING_COMPLETED_KEY). A non-consented user must consent
 * before anything else; the preferences onboarding then resumes normally (it is
 * only reachable once `user` is set, i.e. consent is done).
 *
 * Loop avoidance: while `pendingConsent` is true we only `router.replace` to
 * `complete-profile` when not already there (or on `legal`). When `completeConsent`
 * succeeds, `pendingConsent` flips to false and the guard replaces `complete-profile`
 * with `/` once (index → onboarding/tabs); on any other route it stays idle.
 *
 * Mounted from <GlobalListeners> (root layout) so its store-driven re-renders
 * never reach the navigator tree.
 */
export function useConsentGuard(): void {
  const pendingConsent = useAuthStore((s) => s.pendingConsent);
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    // Bail until the root navigator is mounted (see doc above).
    if (!rootNavigationState?.key) return;
    if (pendingConsent) {
      // Legal docs must stay reachable during consent (Loi 25 art. 12).
      if (segments[0] === 'complete-profile' || segments[0] === 'legal') return;
      router.replace('/complete-profile' as never);
      return;
    }
    // Consent just completed (signIn cleared pendingConsent + set user) but the
    // user is still on /complete-profile — actively resume the normal flow
    // (index → preferences onboarding / tabs). Without this the account is
    // created yet the screen never redirects.
    if (segments[0] === 'complete-profile') {
      router.replace('/' as never);
    }
  }, [pendingConsent, segments, rootNavigationState?.key]);
}
