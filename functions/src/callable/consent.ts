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
   * that is already taken is REJECTED ('already-exists') — there is no auto
   * suffix (unlike the legacy auto-derived assignUsername path), so the user
   * picks another. Idempotent: a double-submit returns the existing username.
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
 *   - Idempotence (double submit): if users/{uid}.username already exists, it is
 *     returned unchanged. If desiredUsername equals the existing handle that is
 *     also fine (no-op reservation). If they differ, the existing handle wins
 *     (immutable) and is returned — the new value is ignored.
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
        const existingUsername = userSnap.exists
          ? (userSnap.data()?.username as string | undefined)
          : undefined;

        // ── Resolve the username to persist (with idempotence). ──
        let usernameToWrite: string | null = null;
        if (typeof existingUsername === 'string' && existingUsername.length > 0) {
          // IMMUTABLE: an assigned handle is never overwritten. Return it as-is,
          // even if desiredUsername differs (the new value is ignored).
          usernameToWrite = null; // nothing to write on the username front
        } else if (normalizedUsername) {
          // No existing handle: attempt to reserve the chosen one.
          const regRef = db.collection('usernames').doc(normalizedUsername);
          const regSnap = await tx.get(regRef);
          if (regSnap.exists) {
            const ownerUid = regSnap.data()?.uid;
            if (ownerUid === uid) {
              // Registry already points to us (partial prior submit). No-op
              // reservation; we still (re)write users.username below for repair.
              usernameToWrite = normalizedUsername;
            } else {
              // Taken by someone else → reject, NO auto suffix.
              throw new HttpsError(
                'already-exists',
                'Ce pseudo est déjà pris',
                { field: 'username' }
              );
            }
          } else {
            // Free → reserve it.
            tx.set(regRef, { uid, createdAt: FieldValue.serverTimestamp() });
            usernameToWrite = normalizedUsername;
          }
        }

        // ── Write the user doc (DOB + optional username). Never undefined. ──
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

        // Return the effective handle for the response (existing wins).
        return (typeof existingUsername === 'string' && existingUsername.length > 0)
          ? existingUsername
          : usernameToWrite;
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
