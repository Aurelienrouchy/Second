/**
 * Swap Zone bootstrap — DEPRECATED as a standalone seeder.
 *
 * The single permanent generalist Swap Zone is now created idempotently by the
 * Cloud Function `ensureGeneralistZone` (and self-healed by
 * `getActiveSwapPartyInfo`). There is NO destructive seeding anymore, and no
 * thematic parties.
 *
 * To (re)create the zone in any environment, call the callable instead:
 *
 *   // Client (RN):
 *   import { httpsCallable } from 'firebase/functions';
 *   await httpsCallable(functions, 'ensureGeneralistZone')();
 *
 *   // Or via the Firebase console / a one-off Admin script hitting the callable.
 *
 * The zone lives at the deterministic document id `swapParties/generalist`.
 *
 * This file is intentionally a no-op to prevent accidental destructive seeding.
 */

console.log(
  '[seed-swap-parties] Deprecated. The Swap Zone is bootstrapped by the\n' +
  'ensureGeneralistZone Cloud Function (deterministic id: swapParties/generalist).\n' +
  'Call that callable from the app or console — no manual seeding required.'
);
process.exit(0);
