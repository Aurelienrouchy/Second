/**
 * Username availability check callable.
 * Firebase Functions v2 (onCall) — region northamerica-northeast1, 512MiB.
 *
 * checkUsernameAvailability: read-only, idempotent probe used by the signup
 * "choose your @handle" route. The client debounces (~350ms) and calls this on
 * every keystroke to drive the inline availability indicator. It NEVER reserves
 * anything — reservation happens atomically at submit (recordSignupConsent).
 *
 * SECURITY / anti-enumeration:
 *   - Auth required (both signup flows arrive authenticated: the email flow
 *     creates the bare account before the route; Google/Apple are already
 *     signed in).
 *   - The response is a pure boolean (+ a reason for invalid format). It NEVER
 *     reveals the uid that owns a taken handle, so this endpoint cannot be used
 *     to map handles → users.
 *   - The usernames/{username} registry is read via the Admin SDK by document
 *     id (a direct get, NOT a query): no listing, no scan.
 *
 * Format validation is delegated to validateChosenUsername (shared with the
 * reservation path in consent.ts) so the availability check and the submit can
 * never drift: 3–20 chars, charset [a-z0-9._-], no leading/trailing/doubled
 * separators.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';
import { validateChosenUsername, UsernameRejectionReason } from './username';

interface CheckUsernameAvailabilityResult {
  ok: true;
  available: boolean;
  /** Present only when the result is unavailable; explains why. */
  reason?: UsernameRejectionReason | 'taken';
}

/**
 * checkUsernameAvailability
 *
 * input  = { username: string }
 * output = { ok: true, available: boolean, reason?: 'too_short' | 'too_long'
 *            | 'invalid_chars' | 'taken' }
 *
 * - available: true            → free and well-formed.
 * - available: false + reason  → either a format problem (too_short / too_long
 *   / invalid_chars) or already reserved by someone (taken).
 *
 * Read-only and idempotent: reserves NOTHING. The authoritative uniqueness
 * guarantee is enforced atomically at submit (recordSignupConsent's
 * runTransaction), so a "available: true" here is advisory — a concurrent
 * signup could still claim the handle first, in which case submit rejects with
 * 'already-exists'.
 */
export const checkUsernameAvailability = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request): Promise<CheckUsernameAvailabilityResult> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Auth required');
    }
    const uid = request.auth.uid;

    const data = (request.data ?? {}) as { username?: unknown };

    // ── Server-side format validation (never trust the client). ──
    const validation = validateChosenUsername(data.username);
    if (!validation.valid) {
      return { ok: true as const, available: false, reason: validation.reason };
    }

    const username = validation.username;

    try {
      // Direct doc lookup by id — no query, no enumeration.
      const regSnap = await db.collection('usernames').doc(username).get();

      if (regSnap.exists) {
        // ANTI-ENUMERATION: never echo the owning uid. Just "taken".
        return { ok: true as const, available: false, reason: 'taken' };
      }

      return { ok: true as const, available: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('checkUsernameAvailability failed', { uid, error: message });
      throw new HttpsError('internal', 'Failed to check username availability');
    }
  }
);
