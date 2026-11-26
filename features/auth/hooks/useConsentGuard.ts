import { router, useRootNavigationState, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';

import { track } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';
import { useShallow } from 'zustand/react/shallow';
import { captureTradeSession } from '@/services/tradeOperation';

/**
 * Mandatory-consent navigation guard.
 *
 * A Firebase account can exist WITHOUT having completed the Loi 25 consent step
 * (no `dateOfBirth` written by recordSignupConsent) — e.g. a bare email signup,
 * a fresh social sign-in, OR a user who killed the app on the consent route.
 * `authStore.hydrateFromFirebase` flags these as `pendingConsent` (NOT a plain
 * guest, NOT fully connected). This guard forces them to app/complete-profile.tsx
 * and keeps new acquisition behind consent. Existing private agreements,
 * their recourse and financial servicing remain reachable.
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
  const { pendingConsent, uid } = useAuthStore(useShallow(s => ({ pendingConsent: s.pendingConsent, uid: s.authenticatedUid })));
  const segments = useSegments() as string[];
  const rootNavigationState = useRootNavigationState();
  // Guards a single signup_resumed per pendingConsent episode (a cold-start
  // redirect can re-run before navigation settles).
  const resumedTrackedRef = useRef(false);

  useEffect(() => {
    // Bail until the root navigator is mounted (see doc above).
    if (!rootNavigationState?.key) return;
    if (pendingConsent) {
      // Legal docs must stay reachable during consent (Loi 25 art. 12).
      if (segments[0] === 'complete-profile' || segments[0] === 'legal' || segments[0] === 'account-deletion') return;
      // Explicit owner reads/servicing navigation only. No legacy consent heuristic.
      let ownerSessionCurrent = false;
      try { if (uid) { captureTradeSession(uid); ownerSessionCurrent = true; } } catch { /* Cached identity does not grant servicing access. */ }
      if (ownerSessionCurrent && ((segments[0] === 'admin' && ['eligibility', 'support', 'privacy-incidents', 'account-access', 'fraud-reviews', 'transport-reviews', 'disputes', 'product-reviews', 'label-lifecycle', 'tax'].includes(segments[1])) || ['my-orders', 'my-sales', 'my-swaps', 'my-articles', 'wallet', 'product-review', 'label-lifecycle'].includes(segments[0]) ||
          (segments[0] === 'orders' && segments[1] === '[id]') ||
          (segments[0] === 'orders' && segments[1] === 'decisions' && segments[2] === '[id]') ||
          (segments[0] === 'chat' && segments[1] === '[id]') ||
          (segments[0] === 'swap' && segments[1] === '[id]') ||
          (segments[0] === 'payment' && segments[1] === '[transactionId]') ||
          (segments[0] === 'article' && segments[1] === 'privacy' && segments[2] === '[id]') ||
          (segments[0] === 'article' && segments[1] === 'moderation' && (segments.length === 2 || segments[2] === '[id]')) ||
          (segments[0] === 'settings' && (!segments[1] ||
            ['help', 'eligibility', 'decisions', 'stripe-onboarding', 'bank-account', 'privacy', 'notifications', 'account-security', 'account-control', 'delete-account', 'erase-account', 'export-data', 'tax'].includes(segments[1]) ||
            (segments[1] === 'support' && (segments.length === 2 || segments[2] === '[id]')))))) return;
      // Reaching here means the user is NOT already on the consent route while
      // pendingConsent is set — i.e. a cold resume of an abandoned signup (the
      // in-session flow navigates to /complete-profile itself before this runs).
      if (!resumedTrackedRef.current) {
        resumedTrackedRef.current = true;
        track('signup_resumed', {
          signup_method:
            useAuthStore.getState().pendingConsentUser?.authProvider ?? 'email',
          cold_resume: true,
        });
      }
      router.replace('/complete-profile' as never);
      return;
    }
    resumedTrackedRef.current = false;
    // Consent just completed (signIn cleared pendingConsent + set user) but the
    // user is still on /complete-profile — actively resume the normal flow
    // (index → preferences onboarding / tabs). Without this the account is
    // created yet the screen never redirects.
    if (segments[0] === 'complete-profile') {
      router.replace('/' as never);
    }
  }, [pendingConsent, uid, segments, rootNavigationState?.key]);
}
