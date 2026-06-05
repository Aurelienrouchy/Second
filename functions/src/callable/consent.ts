/**
 * Consent & age-gate callable functions
 * Firebase Functions v7 - using onCall
 *
 * recordSignupConsent: persists the signup-time legal consents (CGU + politique
 * de confidentialité, et marketing si opt-in) plus la date de naissance de
 * l'utilisateur. L'âge est validé côté serveur (>= 16 pour s'inscrire/acheter).
 *
 * SECURITY: les documents de consentement (users/{uid}/consents/{autoId}) sont
 * écrits exclusivement par cette fonction via l'Admin SDK. Les règles Firestore
 * interdisent toute écriture client (allow write: if false).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { validateChosenUsername } from './username';

/**
 * Shared naming contract (backend <-> app). Do not drift without updating both.
 */
export const POLICY_VERSION = '2026-05-31';
export const MIN_AGE_REGISTER = 16; // s'inscrire / acheter

type ConsentType = 'terms' | 'privacy_policy' | 'marketing';

interface RecordSignupConsentInput {
  dateOfBirth: string; // ISO "YYYY-MM-DD"
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  marketingOptIn: boolean;
  /**
   * USER-CHOSEN @handle picked on the signup route. Optional for backward
   * compatibility, but the new signup flow ALWAYS sends it. Reserved
   * atomically alongside the consent write (all-or-nothing). A chosen handle
   * that is already taken (by another uid) is REJECTED ('already-exists') —
   * there is no auto suffix (unlike the legacy auto-derived assignUsername
   * path), so the user picks another. The chosen handle WINS over any
   * pre-consent auto-derived placeholder (see contract below).
   */
  desiredUsername?: string;
}

/**
 * Validate the "YYYY-MM-DD" shape and that it is a real calendar date.
 * Returns the parsed {year, month, day} (month 1-12) or null if invalid.
 */
function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-trip through Date (UTC) to reject impossible dates like 2026-02-30.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * Compute the age in whole years as of today, accounting for whether the
 * birthday has already occurred this year.
 *
 * Le jour calendaire courant est résolu dans le fuseau America/Toronto (marché
 * cible) plutôt qu'en UTC, afin d'aligner le calcul serveur sur l'heure locale
 * des utilisateurs canadiens (le client calcule en heure locale).
 */
function computeAge(dob: { year: number; month: number; day: number }): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const partValue = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);

  const todayYear = partValue('year');
  const todayMonth = partValue('month'); // 1-12
  const todayDay = partValue('day');

  let age = todayYear - dob.year;
  // Birthday not reached yet this year => subtract one.
  if (todayMonth < dob.month || (todayMonth === dob.month && todayDay < dob.day)) {
    age -= 1;
  }
  return age;
}

/**
 * recordSignupConsent
 *
 * input  = { dateOfBirth: "YYYY-MM-DD", acceptedTerms, acceptedPrivacy,
 *            marketingOptIn, desiredUsername? }
 * output = { ok: true, age: number, username?: string }
 *
 * SINGLE submit entry point for the signup route. In ONE runTransaction
 * (all-or-nothing), it:
 *   - Auth requise.
 *   - Âge >= MIN_AGE_REGISTER (16) sinon invalid-argument.
 *   - acceptedTerms et acceptedPrivacy doivent être true (consentement obligatoire).
 *   - Réserve atomiquement le pseudo CHOISI s'il est fourni (voir ci-dessous),
 *     écrit users/{uid}.dateOfBirth (string ISO) + username, et crée les docs
 *     consents : terms + privacy_policy toujours ; marketing seulement si
 *     marketingOptIn === true. version = POLICY_VERSION.
 *
 * USERNAME contract (desiredUsername):
 *   - Format re-validated SERVER-SIDE (3–20, charset, no leading/trailing/
 *     doubled separators) — invalid → HttpsError('invalid-argument', ...) with
 *     `details: { field: 'username', reason }`.
 *   - If usernames/{desiredUsername} already belongs to ANOTHER uid →
 *     HttpsError('already-exists', ...) with `details: { field: 'username' }`.
 *     NO auto suffix: a taken chosen handle is rejected so the user picks again.
 *     This MUST be an inline field error client-side — the account is NOT rolled
 *     back.
 *   - The chosen handle WINS over any PRE-CONSENT auto-derived placeholder
 *     (legacy at-creation slug, login safety-net). Because this call writes
 *     dateOfBirth, the account is pre-consent here: an existing username is just
 *     a placeholder. If it differs from the chosen one, the chosen one is
 *     reserved and the stale registry entry (if owned by this uid) is released —
 *     all atomically. Immutability ONLY protects a handle chosen post-consent,
 *     i.e. an account that ALREADY has dateOfBirth from a prior submit; there
 *     the existing handle wins and the new value is ignored.
 *   - Idempotence (double submit of the SAME handle): no-op, returned unchanged.
 */
export const recordSignupConsent = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Auth required');
    }
    const uid = request.auth.uid;

    const data = (request.data ?? {}) as Partial<RecordSignupConsentInput>;
    const { dateOfBirth, acceptedTerms, acceptedPrivacy, marketingOptIn, desiredUsername } = data;

    // ── Validation ──
    if (typeof dateOfBirth !== 'string') {
      throw new HttpsError('invalid-argument', 'dateOfBirth is required (format YYYY-MM-DD)');
    }
    const dob = parseIsoDate(dateOfBirth);
    if (!dob) {
      throw new HttpsError('invalid-argument', 'dateOfBirth must be a valid ISO date (YYYY-MM-DD)');
    }
    if (typeof acceptedTerms !== 'boolean' || typeof acceptedPrivacy !== 'boolean') {
      throw new HttpsError('invalid-argument', 'acceptedTerms and acceptedPrivacy must be booleans');
    }
    if (!acceptedTerms || !acceptedPrivacy) {
      throw new HttpsError(
        'failed-precondition',
        'Les conditions générales et la politique de confidentialité doivent être acceptées'
      );
    }
    const wantsMarketing = marketingOptIn === true;

    const age = computeAge(dob);
    if (age < MIN_AGE_REGISTER) {
      throw new HttpsError(
        'invalid-argument',
        `Vous devez avoir au moins ${MIN_AGE_REGISTER} ans pour utiliser Second`
      );
    }

    // ── Chosen-username format validation (server-authoritative). ──
    // desiredUsername is optional for backward compat; when present it must be
    // well-formed. We never trust the client's debounced availability check.
    const hasDesiredUsername =
      typeof desiredUsername === 'string' && desiredUsername.trim().length > 0;
    let normalizedUsername: string | null = null;
    if (hasDesiredUsername) {
      const validation = validateChosenUsername(desiredUsername);
      if (!validation.valid) {
        throw new HttpsError(
          'invalid-argument',
          'Pseudo invalide',
          { field: 'username', reason: validation.reason }
        );
      }
      normalizedUsername = validation.username;
    }

    const consentTypes: ConsentType[] = ['terms', 'privacy_policy'];
    if (wantsMarketing) {
      consentTypes.push('marketing');
    }

    try {
      // ATOMIC: consent write + username reservation in a single transaction.
      // All reads (user doc + username registry) precede all writes, as the
      // Firestore transaction API requires.
      const resolvedUsername = await db.runTransaction(async (tx) => {
        const userRef = db.collection('users').doc(uid);
        const userSnap = await tx.get(userRef);
        const userData = userSnap.exists ? (userSnap.data() ?? {}) : {};
        const existingUsername =
          typeof userData.username === 'string' && userData.username.length > 0
            ? (userData.username as string)
            : undefined;
        // dateOfBirth is written ONLY by this callable. Its presence means the
        // account already consented on a PRIOR submit → the handle is now an
        // established, immutable choice (not a pre-consent placeholder).
        const alreadyConsented =
          typeof userData.dateOfBirth === 'string' && userData.dateOfBirth.length > 0;

        // ── Resolve the username to persist. ──
        // Principle: a username auto-derived BEFORE the user made a deliberate
        // choice (legacy at-creation slug, or the login safety-net) is a
        // PLACEHOLDER, not an immutable handle. Immutability only protects a
        // handle chosen post-consent. Since this call writes dateOfBirth, the
        // account is pre-consent here UNLESS a prior submit already consented it
        // (alreadyConsented) — only then does the existing handle win.
        let usernameToWrite: string | null = null;
        let registryToRelease: string | null = null;

        if (alreadyConsented) {
          // IMMUTABLE: established handle wins, desiredUsername ignored. No-op.
          usernameToWrite = null;
        } else if (normalizedUsername) {
          if (existingUsername === normalizedUsername) {
            // Same handle re-submitted (idempotent). Nothing to change; the
            // registry already points to us from the prior reservation.
            usernameToWrite = null;
          } else {
            // The chosen handle differs from (or there is no) existing handle.
            // It WINS. Reserve usernames/{chosen}; reject only if owned by
            // ANOTHER uid (no auto suffix). All reads precede all writes.
            const regRef = db.collection('usernames').doc(normalizedUsername);
            const regSnap = await tx.get(regRef);

            // Pre-read the old registry entry too (before any write) so we can
            // safely release it within the all-reads-first contract.
            let existingOwnedByUs = false;
            if (existingUsername) {
              const oldRegRef = db.collection('usernames').doc(existingUsername);
              const oldRegSnap = await tx.get(oldRegRef);
              existingOwnedByUs = oldRegSnap.exists && oldRegSnap.data()?.uid === uid;
            }

            if (regSnap.exists && regSnap.data()?.uid !== uid) {
              // Taken by someone else → reject, NO auto suffix.
              throw new HttpsError(
                'already-exists',
                'Ce pseudo est déjà pris',
                { field: 'username' }
              );
            }

            usernameToWrite = normalizedUsername;
            // Free the stale auto-derived placeholder ONLY if it points to us.
            if (existingUsername && existingOwnedByUs) {
              registryToRelease = existingUsername;
            }
          }
        }
        // No desiredUsername provided → keep whatever exists (backward compat).

        // ── Writes (all after the reads above). Never undefined. ──
        if (usernameToWrite) {
          const regRef = db.collection('usernames').doc(usernameToWrite);
          tx.set(regRef, { uid, createdAt: FieldValue.serverTimestamp() });
        }
        if (registryToRelease) {
          tx.delete(db.collection('usernames').doc(registryToRelease));
        }

        const userPayload: Record<string, unknown> = {
          dateOfBirth,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (usernameToWrite) {
          userPayload.username = usernameToWrite;
        }
        tx.set(userRef, userPayload, { merge: true });

        // ── Append the consent proof docs (auto-id). ──
        const consentsRef = userRef.collection('consents');
        for (const type of consentTypes) {
          tx.set(consentsRef.doc(), {
            type,
            version: POLICY_VERSION,
            acceptedAt: FieldValue.serverTimestamp(),
            channel: 'app',
          });
        }

        // Effective handle for the response: the newly written one, else the
        // (kept) existing one.
        return usernameToWrite ?? existingUsername ?? null;
      });

      logger.info('recordSignupConsent: consents recorded', {
        uid,
        age,
        policyVersion: POLICY_VERSION,
        marketing: wantsMarketing,
        usernameReserved: resolvedUsername != null,
      });

      return resolvedUsername
        ? { ok: true as const, age, username: resolvedUsername }
        : { ok: true as const, age };
    } catch (error: unknown) {
      if (error instanceof HttpsError) {
        // Preserve precise codes (already-exists / invalid-argument) for the
        // client's inline field error.
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('recordSignupConsent failed', { uid, error: message });
      throw new HttpsError('internal', 'Failed to record consent: ' + message);
    }
  }
);

interface SetMarketingConsentInput {
  enabled: boolean;
}

/**
 * setMarketingConsent
 *
 * input  = { enabled: boolean }
 * output = { ok: true, enabled: boolean }
 *
 * Loi 25 (art. 14) / LCAP : le retrait du consentement marketing doit être
 * (a) journalisé de manière append-only comme preuve, et (b) appliqué côté
 * serveur de sorte qu'aucun envoi marketing ne parte après le retrait.
 *
 * - Auth requise.
 * - Journalise APPEND-ONLY un nouveau doc dans users/{uid}/consents :
 *   { type: 'marketing', granted, version, acceptedAt, channel }. Les docs
 *   existants ne sont JAMAIS modifiés (preuve immuable).
 * - Applique l'effet via Admin SDK :
 *     users/{uid}.preferences.marketingConsent = enabled
 *     users/{uid}.preferences.notifications.priceDrops / articleFavorited /
 *       swapZoneReminder = enabled
 *   Ces préférences sont relues par les triggers existants
 *   (functions/src/triggers/favorites.ts) avant tout envoi : couper ces flags
 *   garantit qu'aucune notification marketing n'est émise après le retrait.
 * - N'écrit jamais undefined (booléens dérivés de `enabled`).
 */
export const setMarketingConsent = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Auth required');
    }
    const uid = request.auth.uid;

    const data = (request.data ?? {}) as Partial<SetMarketingConsentInput>;
    const { enabled } = data;

    if (typeof enabled !== 'boolean') {
      throw new HttpsError('invalid-argument', 'enabled must be a boolean');
    }

    try {
      const batch = db.batch();
      const userRef = db.collection('users').doc(uid);
      const consentsRef = userRef.collection('consents');

      // (a) Append-only proof — new doc, never touch existing ones.
      batch.set(consentsRef.doc(), {
        type: 'marketing' as ConsentType,
        granted: enabled,
        version: POLICY_VERSION,
        acceptedAt: FieldValue.serverTimestamp(),
        channel: 'app',
      });

      // (b) Server-side enforcement — mirror onto the preferences read by triggers.
      batch.set(
        userRef,
        {
          preferences: {
            marketingConsent: enabled,
            notifications: {
              priceDrops: enabled,
              articleFavorited: enabled,
              swapZoneReminder: enabled,
            },
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await batch.commit();

      logger.info('setMarketingConsent: consent updated', {
        uid,
        granted: enabled,
        policyVersion: POLICY_VERSION,
      });

      return { ok: true as const, enabled };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('setMarketingConsent failed', { uid, error: message });
      throw new HttpsError('internal', 'Failed to set marketing consent: ' + message);
    }
  }
);
