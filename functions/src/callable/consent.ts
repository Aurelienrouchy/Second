/**
 * Consent & age-gate callable functions
 * Firebase Functions v7 - using onCall
 *
 * recordSignupConsent: persists the signup-time legal consents (CGU + politique
 * de confidentialité, et marketing si opt-in) plus la date de naissance de
 * l'utilisateur. L'âge est validé côté serveur (>= 16 pour s'inscrire).
 *
 * SECURITY: les documents de consentement (users/{uid}/consents/{autoId}) sont
 * écrits exclusivement par cette fonction via l'Admin SDK. Les règles Firestore
 * interdisent toute écriture client (allow write: if false).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { validateChosenUsername } from './username';
import { ageFromIsoDate, MIN_AGE_REGISTER, parseCivilIsoDate } from '../shared/age';
import { hasAccountClosure } from '../shared/eligibility';
import signupConsentPolicy from '../shared/signupConsentPolicy.json';
import { readEligibilityEvidence, sellerActivityHash, sellerActivityReceiptDto } from '../utils/eligibility';
import { prepareSellerActivityDeclaration, sellerActivityCommandHash, sellerActivityOperationRef } from '../utils/sellerActivityDeclaration';
import { readMarketingConsentReceipt } from '../utils/notifications';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';
export { MIN_AGE_REGISTER } from '../shared/age';

/**
 * Shared naming contract (backend <-> app). Do not drift without updating both.
 */
export const POLICY_VERSION = '2026-05-31';

type ConsentType = 'terms' | 'privacy_policy' | 'marketing';

interface RecordSignupConsentInput {
  dateOfBirth: string; // ISO "YYYY-MM-DD"
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  marketingOptIn: boolean;
  policyVersion: string;
  sellerActivityDeclaration?: { kind: 'personal'; statementVersion: string; personalDeclarationAccepted: true;
    expectedVersion: string; requestId: string; expectedUid: string };
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

    if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data) ||
        Object.keys(request.data).some(k => !['dateOfBirth', 'acceptedTerms', 'acceptedPrivacy', 'marketingOptIn', 'desiredUsername', 'policyVersion', 'sellerActivityDeclaration'].includes(k))) {
      throw new HttpsError('invalid-argument', 'Paramètres d’inscription invalides.');
    }
    const data = request.data as Partial<RecordSignupConsentInput>;
    const declaration = data.sellerActivityDeclaration;
    if (declaration != null && (typeof declaration !== 'object' || Array.isArray(declaration))) throw new HttpsError('invalid-argument', 'Déclaration d’activité invalide.');
    if (declaration != null && declaration.expectedUid !== uid) throw new HttpsError('permission-denied', 'Le compte connecté a changé.');
    const declarationRef = declaration != null ? sellerActivityOperationRef(uid, declaration.requestId) : null;
    const signupInputHash = sellerActivityHash(data);
    const { dateOfBirth, acceptedTerms, acceptedPrivacy, marketingOptIn, desiredUsername } = data;

    // ── Validation ──
    if (typeof dateOfBirth !== 'string') {
      throw new HttpsError('invalid-argument', 'dateOfBirth is required (format YYYY-MM-DD)');
    }
    const dob = parseCivilIsoDate(dateOfBirth);
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

    const age = ageFromIsoDate(dateOfBirth);
    if (age === null || age < MIN_AGE_REGISTER) {
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

    return withPrivateAccountSession(request, async () => {
      try {
        // ATOMIC: consent write + username reservation in a single transaction.
        // All reads (user doc + username registry) precede all writes, as the
        // Firestore transaction API requires.
        const resolvedUsername = await db.runTransaction(async (tx) => {
          await assertPrivateAccountSession(request, tx);
          const evidence = await readEligibilityEvidence(tx, uid), profile = evidence.profile;
          const priorDeclaration = declarationRef ? (await tx.get(declarationRef)).data() : null;
          if (priorDeclaration) {
            const receipt = sellerActivityReceiptDto(declarationRef!.id, priorDeclaration, uid);
            if (receipt.qualification !== 'native_original' || priorDeclaration.inputHash !== sellerActivityCommandHash(declaration!) ||
                priorDeclaration.signupConsent?.protocol !== 'signup_consent_v1' || priorDeclaration.signupConsent?.inputHash !== signupInputHash) {
              throw new HttpsError('already-exists', 'Cet identifiant a déjà été utilisé pour une autre inscription ou déclaration.');
            }
            // The immutable original receipt wins before current versions/CAS;
            // retry never overwrites a later withdrawal, correction or declaration.
            return priorDeclaration.signupConsent.username as string | null;
          }
          if (hasAccountClosure(profile)) throw new HttpsError('failed-precondition', 'Votre compte est fermé aux nouvelles opérations.',
            { reason: 'account_closing', action: 'contactSupport' });
          const userRef = db.collection('users').doc(uid);
          const userData = evidence.user ?? {};
          const persistedDob = userData.dateOfBirth;
          if (persistedDob != null && persistedDob !== '' && persistedDob !== dateOfBirth) {
            throw new HttpsError('failed-precondition',
              'La date de naissance enregistrée ne peut pas être remplacée à l’inscription. Demandez une correction.',
              { field: 'dateOfBirth', reason: 'date_of_birth_locked', action: 'requestEligibilityReview' });
          }
          const existingUsername =
            typeof userData.username === 'string' && userData.username.length > 0
              ? (userData.username as string)
              : undefined;
          // dateOfBirth is written ONLY by this callable. Its presence means the
          // account already consented on a PRIOR submit → the handle is now an
          // established, immutable choice (not a pre-consent placeholder).
          const alreadyConsented =
            typeof userData.dateOfBirth === 'string' && userData.dateOfBirth.length > 0;
          if (alreadyConsented && declaration != null) throw new HttpsError('failed-precondition', 'Cette inscription est déjà terminée.', { reason: 'signup_already_completed' });
          // Existing completed accounts are outside this prospective signup flow.
          // No new statement, legal proof or preference is inferred for them.
          if (alreadyConsented) return existingUsername ?? null;
          if (!alreadyConsented) {
            if (!declaration || declaration.kind !== 'personal' || declaration.personalDeclarationAccepted !== true) {
              throw new HttpsError('failed-precondition', 'La déclaration personnelle doit être acceptée à l’inscription.', { reason: 'seller_activity_declaration_required' });
            }
            if (data.policyVersion !== signupConsentPolicy.version) throw new HttpsError('failed-precondition', 'Relisez les conditions actuelles avant de poursuivre.', { reason: 'signup_policy_version_changed' });
            if (typeof marketingOptIn !== 'boolean') throw new HttpsError('invalid-argument', 'Le choix marketing doit être explicite.');
          }

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

          const prepared = !alreadyConsented ? await prepareSellerActivityDeclaration(tx, uid, declaration!, evidence, {
            signupConsent: { protocol: 'signup_consent_v1', inputHash: signupInputHash, policyVersion: signupConsentPolicy.version,
              termsVersion: signupConsentPolicy.termsVersion, privacyVersion: signupConsentPolicy.privacyVersion,
              username: usernameToWrite ?? existingUsername ?? null },
          }) : null;
          let profileToWrite: FirebaseFirestore.DocumentData | null = prepared?.profile ?? null;

          // ── Writes (all after the reads above). Never undefined. ──
          if (usernameToWrite) {
            const regRef = db.collection('usernames').doc(usernameToWrite);
            tx.set(regRef, { uid, createdAt: FieldValue.serverTimestamp() });
          }
          if (registryToRelease) {
            tx.delete(db.collection('usernames').doc(registryToRelease));
          }

          const userPayload: Record<string, unknown> = {
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (persistedDob == null || persistedDob === '') {
            userPayload.dateOfBirth = dateOfBirth;
            userPayload.dateOfBirthVersion = 1;
          }
          if (usernameToWrite) {
            userPayload.username = usernameToWrite;
          }
          // Initial consent is created once. Replaying signup must never replace
          // a withdrawal or a later explicit decision from the privacy settings.
          if (!alreadyConsented && !Object.prototype.hasOwnProperty.call(profile ?? {}, 'marketingConsent')) {
            const marketingRef = userRef.collection('consents').doc();
            const proof = { schemaVersion: 1, ownerId: uid, type: 'marketing', granted: wantsMarketing,
              purpose: 'marketing', version: POLICY_VERSION, acceptedAt: FieldValue.serverTimestamp(),
              channel: 'app', source: 'signup', revision: 1 };
            tx.create(marketingRef, proof);
            profileToWrite = { ...(profileToWrite ?? profile ?? {}), marketingConsent: { schemaVersion: 1, ownerId: uid,
              granted: wantsMarketing, purpose: 'marketing', policyVersion: POLICY_VERSION, revision: 1,
              consentId: marketingRef.id, recordedAt: FieldValue.serverTimestamp() } };
            userPayload.preferences = { marketingConsent: wantsMarketing };
          }
          if (profileToWrite) tx.set(db.collection('eligibility_profiles').doc(uid), profileToWrite);
          if (prepared) tx.create(prepared.ref, prepared.event);
          tx.set(userRef, userPayload, { merge: true });

          // ── Append the consent proof docs (auto-id). ──
          const consentsRef = userRef.collection('consents');
          for (const type of consentTypes) {
            tx.set(consentsRef.doc(), {
              type,
              version: prepared ? (type === 'terms' ? signupConsentPolicy.termsVersion : signupConsentPolicy.privacyVersion) : POLICY_VERSION,
              ...(prepared ? { signupPolicyVersion: signupConsentPolicy.version, declarationReceiptId: prepared.ref.id } : {}),
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
          policyVersion: declaration ? signupConsentPolicy.version : POLICY_VERSION,
          marketingRequested: wantsMarketing,
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
    });
  }
);

interface SetMarketingConsentInput {
  enabled: boolean;
  expectedUid: string;
  mode?: 'request' | 'observe';
}

/**
 * setMarketingConsent
 *
 * input  = { expectedUid, enabled, mode?: 'request' } | { expectedUid, mode: 'observe' }
 * output = native marketing_consent_v1 receipt, bound to the current owner.
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
 * - État courant autoritaire dans eligibility_profiles/{uid}, lié à ce nouveau
 *   document append-only. Les préférences client ne peuvent jamais octroyer le
 *   consentement ; elles ne servent qu'à désactiver des catégories.
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

    if (data.expectedUid !== uid) {
      throw new HttpsError('failed-precondition', 'La session a changé. Reprenez ce choix depuis votre compte.',
        { reason: 'account_actor_changed', action: 'refreshSession' });
    }
    if (data.mode !== undefined && data.mode !== 'request' && data.mode !== 'observe') {
      throw new HttpsError('invalid-argument', 'Mode de consentement invalide.');
    }
    return withPrivateAccountSession(request, async () => {
      if (data.mode === 'observe') {
        const receipt = await db.runTransaction(async tx => {
          await assertPrivateAccountSession(request, tx);
          return readMarketingConsentReceipt(tx, uid);
        });
        // No writes, provider calls or account-standing gate on servicing.
        return { ok: true as const, ...receipt, mode: 'observed' as const,
          decisionCommitted: false, requestedEnabled: null, requestReceiptMatched: false };
      }
      if (typeof enabled !== 'boolean') {
        throw new HttpsError('invalid-argument', 'enabled must be a boolean');
      }

      try {
        const userRef = db.collection('users').doc(uid);
        const consentsRef = userRef.collection('consents');
        const consentRef = consentsRef.doc();
        const stateRef = db.collection('eligibility_profiles').doc(uid);
        const revision = await db.runTransaction(async tx => {
          await assertPrivateAccountSession(request, tx);
          const user = (await tx.get(userRef)).data();
          const profile = (await tx.get(stateRef)).data();
          if (!user) throw new HttpsError('not-found', 'Le compte utilisateur est introuvable.');
          if (enabled && hasAccountClosure(profile)) throw new HttpsError('failed-precondition',
            'Le compte est fermé aux nouveaux consentements marketing. Le retrait reste disponible.');
          const prior = profile?.marketingConsent;
          const revision = Number.isSafeInteger(prior?.revision) && prior.revision >= 1 && prior.revision < Number.MAX_SAFE_INTEGER
            ? prior.revision + 1 : 1;
          // (a) Native append-only proof, never rewrite a previous legal event.
          tx.create(consentRef, { schemaVersion: 1, ownerId: uid, type: 'marketing' as ConsentType,
            granted: enabled, purpose: 'marketing', version: POLICY_VERSION, revision,
            acceptedAt: FieldValue.serverTimestamp(), channel: 'app', source: 'privacy_settings' });
          // (b) Server-only current decision and its exact proof are atomic.
          tx.set(stateRef, { marketingConsent: { schemaVersion: 1, ownerId: uid, granted: enabled,
            purpose: 'marketing', policyVersion: POLICY_VERSION, revision, consentId: consentRef.id,
            recordedAt: FieldValue.serverTimestamp() } }, { merge: true });
          // Targeted fields preserve unrelated preferences and essential notices.
          tx.update(userRef, { 'preferences.marketingConsent': enabled,
            'preferences.notifications.priceDrops': enabled, 'preferences.notifications.articleFavorited': enabled,
            'preferences.notifications.swapZoneReminder': enabled, updatedAt: FieldValue.serverTimestamp() });
          return revision;
        });

        logger.info('setMarketingConsent: consent updated', {
          uid,
          granted: enabled,
          policyVersion: POLICY_VERSION,
        });

        // Read the actual committed native proof using the same qualification as
        // push authorization. A newer decision is returned faithfully; it cannot
        // masquerade as the receipt of this requested grant/withdrawal.
        const receipt = await db.runTransaction(async tx => {
          await assertPrivateAccountSession(request, tx);
          return readMarketingConsentReceipt(tx, uid);
        });
        const requestReceiptMatched = receipt.consentRecorded && receipt.ownerId === uid && receipt.enabled === enabled &&
          receipt.consentId === consentRef.id && receipt.consentRevision === revision && receipt.policyVersion === POLICY_VERSION;
        return { ok: requestReceiptMatched, ...receipt, mode: 'received' as const,
          decisionCommitted: true, requestedEnabled: enabled, requestReceiptMatched };
      } catch (error: unknown) {
        if (error instanceof HttpsError) throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('setMarketingConsent failed', { uid, error: message });
        throw new HttpsError('internal', 'Failed to set marketing consent: ' + message);
      }
    });
  }
);
