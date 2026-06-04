/**
 * Username assignment callable.
 * Firebase Functions v2 (onCall) — region northamerica-northeast1, 512MiB.
 *
 * assignUsername: generates, reserves and persists the persistent, unique,
 * IMMUTABLE @handle for a user, atomically (runTransaction). Server-authoritative:
 *
 *   - The slug is derived from the user's displayName (transliterate accents,
 *     lowercase, spaces -> '.', strip illegal chars, collapse separators).
 *   - Uniqueness is enforced via the usernames/{username} registry. If the slug
 *     is taken, a numeric suffix (.2, .3, ...) is appended until a free one is
 *     found, all within the transaction.
 *   - IDEMPOTENT / IMMUTABLE: if users/{uid}.username already exists, it is
 *     returned as-is (no-op). The function can NEVER change an assigned username.
 *
 * SECURITY: usernames/{username} is written exclusively here (Admin SDK bypasses
 * the Firestore rules, which forbid all client access). The users/{uid}.username
 * field is in the protected set on the users rules (client cannot add/edit it).
 *
 * Call this right after the users/{uid} doc is created, for ALL providers
 * (email + Google + Apple). Auth required; the caller assigns their OWN username.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';

export const USERNAME_MIN_LEN = 3;
export const USERNAME_MAX_LEN = 30;

// Upper bound for a USER-CHOSEN handle (signup route + availability check). The
// auto-derived slug path (assignUsername) keeps the wider USERNAME_MAX_LEN for
// legacy/fallback derivations; a human picking a handle is held to the tighter
// 20-char cap. min is shared (USERNAME_MIN_LEN = 3).
export const CHOSEN_USERNAME_MAX_LEN = 20;

// Allowed character class for any handle: lowercase letters, digits and the
// three separators. Shared between the auto-slug path and the chosen-username
// validator so both stay aligned.
const USERNAME_CHARSET = /^[a-z0-9._-]+$/;
// Separators that may not lead, trail, or be doubled in a chosen username.
const USERNAME_SEPARATOR = /[._-]/;

// Max numeric suffixes to try before giving up (collision is astronomically
// unlikely; this just bounds the transaction work).
const MAX_SUFFIX_ATTEMPTS = 50;

/**
 * Reasons a chosen username can be rejected. Mirrored to the client contract
 * (checkUsernameAvailability + recordSignupConsent error payloads).
 */
export type UsernameRejectionReason = 'too_short' | 'too_long' | 'invalid_chars';

/**
 * Server-authoritative format validation for a USER-CHOSEN username (signup
 * route + availability check). Never trust the client; both the availability
 * lookup and the reservation submit run this.
 *
 * Rules (in priority order so the returned reason is deterministic):
 *   - too_short    : length < CHOSEN_USERNAME_MIN_LEN (3)
 *   - too_long     : length > CHOSEN_USERNAME_MAX_LEN (20)
 *   - invalid_chars: any char outside [a-z0-9._-], OR a separator (. _ -) that
 *                    leads, trails, or is doubled.
 *
 * Returns { valid: true, username } with the (already-lowercased) handle when
 * the input is well-formed, or { valid: false, reason } otherwise. Does NOT
 * mutate/transliterate beyond a trim + lowercase: a chosen handle is accepted
 * or rejected as-is so the user sees exactly what they typed.
 */
export function validateChosenUsername(
  input: unknown
): { valid: true; username: string } | { valid: false; reason: UsernameRejectionReason } {
  const raw = typeof input === 'string' ? input.trim().toLowerCase() : '';

  if (raw.length < USERNAME_MIN_LEN) {
    return { valid: false, reason: 'too_short' };
  }
  if (raw.length > CHOSEN_USERNAME_MAX_LEN) {
    return { valid: false, reason: 'too_long' };
  }
  if (!USERNAME_CHARSET.test(raw)) {
    return { valid: false, reason: 'invalid_chars' };
  }
  // No leading/trailing separator.
  if (USERNAME_SEPARATOR.test(raw[0]) || USERNAME_SEPARATOR.test(raw[raw.length - 1])) {
    return { valid: false, reason: 'invalid_chars' };
  }
  // No doubled separators (e.g. "a..b", "a__b", "a.-b").
  if (/[._-]{2,}/.test(raw)) {
    return { valid: false, reason: 'invalid_chars' };
  }
  return { valid: true, username: raw };
}

/**
 * Transliterate common accented Latin characters to their ASCII equivalent.
 * Uses Unicode NFD normalization to strip combining diacritical marks, then a
 * few explicit mappings for letters that don't decompose (ø, æ, œ, ß, ...).
 */
function transliterate(input: string): string {
  const stripped = input
    .normalize('NFD')
    // Remove combining diacritical marks (U+0300–U+036F).
    .replace(/[̀-ͯ]/g, '');

  const map: Record<string, string> = {
    æ: 'ae',
    Æ: 'ae',
    œ: 'oe',
    Œ: 'oe',
    ø: 'o',
    Ø: 'o',
    ß: 'ss',
    đ: 'd',
    Đ: 'd',
    ł: 'l',
    Ł: 'l',
    ı: 'i',
  };
  return stripped.replace(/[æÆœŒøØßđĐłŁı]/g, (ch) => map[ch] ?? ch);
}

/**
 * Build a deterministic fallback handle for degenerate displayNames.
 * `user.<6 hex chars derived from the uid>`, bounded to USERNAME_MAX_LEN.
 */
function fallbackSlug(uid: string): string {
  const suffix = (uid || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 6)
    .padEnd(6, '0');
  return `user.${suffix}`.slice(0, USERNAME_MAX_LEN);
}

/**
 * Derive a clean slug from displayName:
 *   transliterate -> lowercase -> spaces to '.' -> strip non [a-z0-9._-]
 *   -> collapse repeated separators -> trim border separators -> bound length.
 * Returns the fallback slug when the result is empty or too short.
 */
export function slugifyUsername(displayName: string | undefined | null, uid: string): string {
  const raw = typeof displayName === 'string' ? displayName : '';

  let slug = transliterate(raw)
    .toLowerCase()
    // Whitespace runs -> single dot.
    .replace(/\s+/g, '.')
    // Drop anything outside the allowed character class.
    .replace(/[^a-z0-9._-]/g, '')
    // Collapse runs of separators (., _, -) into a single dot.
    .replace(/[._-]{2,}/g, '.')
    // Trim leading/trailing separators.
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '');

  if (slug.length < USERNAME_MIN_LEN) {
    return fallbackSlug(uid);
  }

  // Bound max length, then re-trim a trailing separator the cut may have left.
  if (slug.length > USERNAME_MAX_LEN) {
    slug = slug.slice(0, USERNAME_MAX_LEN).replace(/[._-]+$/, '');
  }
  // Length could dip below the min after the trailing trim.
  if (slug.length < USERNAME_MIN_LEN) {
    return fallbackSlug(uid);
  }
  return slug;
}

/**
 * Append a numeric suffix to a base slug while respecting USERNAME_MAX_LEN.
 * e.g. ("marie.dupont", 2) -> "marie.dupont.2". If adding the suffix would
 * exceed the max length, the base is truncated to make room.
 */
function withSuffix(base: string, n: number): string {
  const suffix = `.${n}`;
  if (base.length + suffix.length <= USERNAME_MAX_LEN) {
    return base + suffix;
  }
  const truncated = base
    .slice(0, USERNAME_MAX_LEN - suffix.length)
    .replace(/[._-]+$/, '');
  return truncated + suffix;
}

interface AssignUsernameResult {
  ok: true;
  username: string;
  /** true when a username already existed and was returned unchanged. */
  alreadyAssigned: boolean;
}

/**
 * assignUsername
 *
 * input  = {} (none — the username is derived server-side from displayName)
 * output = { ok: true, username: string, alreadyAssigned: boolean }
 *
 * - Auth required; operates on request.auth.uid (the caller's own doc).
 * - Idempotent: if users/{uid}.username exists, returns it (alreadyAssigned: true).
 * - Otherwise derives a slug from displayName, finds a free variant, reserves
 *   usernames/{final} and writes users/{uid}.username = final atomically.
 */
export const assignUsername = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request): Promise<AssignUsernameResult> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Auth required');
    }
    const uid = request.auth.uid;

    try {
      const result = await db.runTransaction(async (tx) => {
        const userRef = db.collection('users').doc(uid);
        const userSnap = await tx.get(userRef);

        if (!userSnap.exists) {
          // The users doc must already be created by the client signup flow.
          throw new HttpsError('failed-precondition', 'User document does not exist');
        }

        const userData = userSnap.data() ?? {};
        const existing = userData.username;

        // ── Immutability / idempotence: never regenerate an assigned username. ──
        if (typeof existing === 'string' && existing.length > 0) {
          return { username: existing, alreadyAssigned: true };
        }

        const base = slugifyUsername(userData.displayName, uid);

        // Find the first free variant. All reads happen before any write so the
        // transaction stays valid; the registry doc reservation makes concurrent
        // assignments for the same slug mutually exclusive (one retries).
        let candidate = base;
        let attempt = 1;
        // The unbounded fallback (uid-derived) is highly unlikely to collide, but
        // we still bound the loop to avoid pathological transaction sizes.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const regRef = db.collection('usernames').doc(candidate);
          const regSnap = await tx.get(regRef);
          if (!regSnap.exists) {
            // Reserve registry + persist on the user doc, atomically.
            tx.set(regRef, { uid, createdAt: FieldValue.serverTimestamp() });
            tx.set(
              userRef,
              { username: candidate, updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
            return { username: candidate, alreadyAssigned: false };
          }

          attempt += 1;
          if (attempt > MAX_SUFFIX_ATTEMPTS) {
            // Extremely unlikely. Fall back to a uid-derived handle which is
            // collision-resistant by construction.
            const fb = fallbackSlug(uid);
            const fbRef = db.collection('usernames').doc(fb);
            const fbSnap = await tx.get(fbRef);
            if (!fbSnap.exists) {
              tx.set(fbRef, { uid, createdAt: FieldValue.serverTimestamp() });
              tx.set(
                userRef,
                { username: fb, updatedAt: FieldValue.serverTimestamp() },
                { merge: true }
              );
              return { username: fb, alreadyAssigned: false };
            }
            throw new HttpsError('resource-exhausted', 'Could not allocate a unique username');
          }
          candidate = withSuffix(base, attempt);
        }
      });

      logger.info('assignUsername: username resolved', {
        uid,
        username: result.username,
        alreadyAssigned: result.alreadyAssigned,
      });

      return { ok: true as const, username: result.username, alreadyAssigned: result.alreadyAssigned };
    } catch (error: unknown) {
      if (error instanceof HttpsError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('assignUsername failed', { uid, error: message });
      throw new HttpsError('internal', 'Failed to assign username: ' + message);
    }
  }
);
