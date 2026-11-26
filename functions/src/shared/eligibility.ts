/** Server policy foundations. No declaration is a legal/identity verification.
 * Purchase/publication/provider guards consume these foundations in03B. */
import { createHash } from 'node:crypto';
import { DocumentReference, FieldValue, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { ageAtCivilDate, MIN_AGE_BUY, MIN_AGE_SELL, quebecCivilDate } from './age';
import { normalizeCanadianAddress } from './canadianAddress';
import { hasAccountSecurityBarrier } from './accountSecurity';
import { hasUnavailableAccountStanding } from './accountStanding';
import {legacyDeletionInProgress} from '../utils/phase1LegacyFence';
import {hasAccountErasureFence} from '../utils/accountErasureContract';
import sellerActivityPolicy from './sellerActivityPolicy.json';

export const ELIGIBILITY_POLICY_VERSION = '2026-10-10.v1';
export const PUBLICATION_ELIGIBILITY_POLICY_VERSION = '2026-10-26.v1';
export const SELLER_ACTIVITY_STATEMENT_VERSION = sellerActivityPolicy.version;
export const SWAP_LAUNCH_POLICY_VERSION = '2026-10-17.v1';
export const QUEBEC_RESIDENCE_DECLARATION_VERSION = '2026-10-17.v1';
export const QUEBEC_RESIDENCE_STATEMENT = 'Je déclare résider au Québec, au Canada. Cette déclaration ne constitue pas une vérification de résidence.';
export const SELLER_ACTIVITY_STATEMENTS = sellerActivityPolicy.statements;
export const ELIGIBILITY_SCOPES = ['buy', 'sell', 'new_paid_shipping'] as const;
export type EligibilityScope = typeof ELIGIBILITY_SCOPES[number];
export type EligibilityReason = 'age_missing' | 'age_invalid' | 'underage' | 'activity_missing' | 'activity_version_required'
  | 'professional_declared' | 'review_required' | 'seller_qc_missing' | 'account_closing' | 'account_security_contained' | 'account_unavailable';
export interface EligibilityEvidence {
  ownerId?: string;
  user: FirebaseFirestore.DocumentData | null;
  profile: FirebaseFirestore.DocumentData | null;
  /** Public snapshot revision only for ambiguous reference-containing DOB data. */
  nativeSourceDocumentVersion?: { seconds: number; nanoseconds: number } | null;
}
/** Server producer observation only. A fresh operation must still re-check the
 * provider and bind its own full origin/destination/quote in03B3. */
export function hasObservedQuebecEvidence(evidence: EligibilityEvidence): boolean {
  const proof = evidence.profile?.sellerQuebecEvidence, address = normalizeCanadianAddress(proof?.address);
  return !!proof && proof.schemaVersion === 1 && proof.ownerId === evidence.ownerId && typeof evidence.ownerId === 'string' &&
    proof.status === 'observed' && proof.source === 'stripe_account_observed' && proof.residenceVerified === false &&
    typeof proof.accountId === 'string' && proof.accountId === evidence.user?.stripeAccountId &&
    proof.providerDateOfBirth === evidence.user?.dateOfBirth && proof.profileDateOfBirth === evidence.user?.dateOfBirth &&
    typeof evidence.user?.dateOfBirth === 'string' && ageAtCivilDate(evidence.user.dateOfBirth, quebecCivilDate()) !== null &&
    proof.country === 'CA' && proof.province === 'QC' && address?.country === 'CA' && address.province === 'QC' &&
    Number.isSafeInteger(proof.observedAtMs) && proof.observedAtMs >= 0;
}
export interface EligibilityDecision {
  scope: EligibilityScope; allowed: boolean; status: 'allowed' | 'incomplete' | 'blocked' | 'review_required';
  reasons: EligibilityReason[]; messages: string[]; policyVersion: string; civilDate: string | null;
  // This is the foundations policy, not a checkout/provider operation permission.
  evaluationStage: 'foundations';
}
export const ELIGIBILITY_REASON_MESSAGES: Record<EligibilityReason, string> = {
  age_missing: 'Votre date de naissance doit être renseignée avant un nouvel achat ou une nouvelle vente.',
  age_invalid: 'La date enregistrée doit être examinée. Vous pouvez demander une correction.',
  underage: 'Vous devez avoir 18 ans pour acheter ou vendre. Le catalogue et vos commandes existantes restent accessibles.',
  activity_missing: 'Complétez votre déclaration de vente avant de proposer une nouvelle vente.',
  activity_version_required: 'La version de votre déclaration de vente doit être renouvelée.',
  professional_declared: 'Les nouvelles ventes sont réservées aux particuliers au lancement. Vos commandes et fonds existants restent accessibles.',
  review_required: 'Vos nouvelles opérations dans ce périmètre nécessitent un examen. Vos commandes et fonds existants restent accessibles.',
  seller_qc_missing: 'Les renseignements du vendeur doivent être complétés pour une nouvelle vente avec expédition au Québec.',
  account_closing: 'Votre compte est fermé aux nouvelles opérations. Vos commandes, recours et fonds existants restent accessibles tant que la suppression n’est pas finalisée.',
  account_security_contained: 'Votre compte est sécurisé contre de nouvelles opérations. Contactez notre équipe pour rétablir les opérations ; vos commandes et recours existants restent consultables.',
  account_unavailable: 'Votre compte ne peut pas créer une nouvelle opération.',
};
/** Private permanent barrier, including malformed/unknown closure states. */
export function hasAccountClosure(profile: FirebaseFirestore.DocumentData | null | undefined): boolean {
  return hasAccountErasureFence(profile) || legacyDeletionInProgress(profile) || profile != null && profile.accountClosure != null;
}
/** Existing malformed data is still a rectifiable source. Missing initial data
 * remains exclusively in the signup/legal-consent flow. No ambiguous coercion. */
export function hasPersistedDateOfBirth(user: FirebaseFirestore.DocumentData | null | undefined): boolean {
  return user?.dateOfBirth != null && user.dateOfBirth !== '';
}
export interface DateOfBirthCopy { type: string; value: unknown; context?: 'sdk_observed_reference' }
// The installed Admin facade does not export VectorValue. Its public factory
// supplies the same SDK constructor without inspecting a vector's internals.
const VectorType = FieldValue.vector([]).constructor;
const copyNumber = (value: number) => Number.isFinite(value) ? Object.is(value, -0) ? '-0' : value : String(value);
/** Private typed copy of actual persisted Firestore values. Native classes are
 * recognized before maps; references never enumerate their SDK/connection graph.
 * Identity includes project/database/path, timestamp sub-ms precision and bytes.
 * Impossible JS cycles/classes fail explicitly rather than aliasing sources. */
function copyDateOfBirth(value: any, exactIdentity: boolean, references?: { found: boolean }): DateOfBirthCopy {
  if (value == null || value === '') return { type: 'missing', value: null };
  const ancestors = new WeakSet<object>();
  let deepest = 0;
  function copy(item: any, depth: number): DateOfBirthCopy {
    if (depth > 32) throw new Error('Date-of-birth source exceeds supported Firestore nesting.');
    deepest = Math.max(deepest, depth);
    if (item === null) return { type: 'null', value: null };
    if (typeof item === 'string' || typeof item === 'boolean') return { type: typeof item, value: item };
    if (typeof item === 'number') return { type: 'number', value: copyNumber(item) };
    if (item instanceof DocumentReference) {
      if (references) references.found = true;
      return { type: 'document_reference',
        value: `projects/${(item.firestore as FirebaseFirestore.Firestore & { readonly projectId: string }).projectId}/databases/${item.firestore.databaseId}/documents/${item.path}`,
        context: 'sdk_observed_reference' };
    }
    if (item instanceof Timestamp) {
      // Owner DTO remains V1 ISO; only the internal fingerprint/comparison uses
      // exact seconds/nanoseconds. Display rounding is never source equality.
      return { type: 'timestamp', value: exactIdentity ? [item.seconds, item.nanoseconds] : item.toDate().toISOString() };
    }
    if (item instanceof Date) return { type: 'date', value: item.toISOString() };
    if (item instanceof GeoPoint) return { type: 'geo_point', value: { latitude: item.latitude, longitude: item.longitude } };
    if (item instanceof Uint8Array) return { type: 'bytes', value: Buffer.from(item).toString('base64') };
    if (item instanceof VectorType) return { type: 'vector', value: (item as { toArray(): number[] }).toArray().map(copyNumber) };
    if (typeof item !== 'object' || !item || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) {
      throw new Error('Date-of-birth source is not a supported persisted Firestore value.');
    }
    if (ancestors.has(item)) throw new Error('Date-of-birth source has an invalid cycle.');
    ancestors.add(item);
    const result = Array.isArray(item) ? { type: 'array', value: item.map(child => copy(child, depth + 1)) } :
      { type: 'object', value: Object.fromEntries(Object.keys(item).sort().map(k => [k, copy(item[k], depth + 1)])) };
    ancestors.delete(item);
    return result;
  }
  const result = copy(value, 0);
  // Type wrappers double map depth. Compact deep ordinary data losslessly so a
  // source within Firestore's depth limit can also be stored in its request copy.
  return deepest > 7 ? { type: 'serialized_' + result.type, value: JSON.stringify(result) } : result;
}
export function dateOfBirthCopy(value: unknown): DateOfBirthCopy { return copyDateOfBirth(value, false); }
export function dateOfBirthIdentity(value: unknown): DateOfBirthCopy { return copyDateOfBirth(value, true); }
export function dateOfBirthHasReference(value: unknown): boolean {
  const references = { found: false }; copyDateOfBirth(value, true, references); return references.found;
}
export function eligibilityVersion(evidence: EligibilityEvidence): string {
  return createHash('sha256').update(JSON.stringify({ policy: ELIGIBILITY_POLICY_VERSION,
    dateOfBirth: dateOfBirthIdentity(evidence.user?.dateOfBirth), dateOfBirthVersion: evidence.user?.dateOfBirthVersion ?? 0,
    ...(dateOfBirthHasReference(evidence.user?.dateOfBirth) ? { nativeSourceDocumentVersion: evidence.nativeSourceDocumentVersion ?? 'not_verified' } : {}),
    profileVersion: evidence.profile?.version ?? 0 })).digest('hex');
}
function evaluateFoundations(evidence: EligibilityEvidence, scope: EligibilityScope, now: Date, publication: boolean): EligibilityDecision {
  const civilDate = quebecCivilDate(now), dob = evidence.user?.dateOfBirth;
  const age = ageAtCivilDate(dob, civilDate);
  const reasons: EligibilityReason[] = [];
  if (hasAccountClosure(evidence.profile)) reasons.push('account_closing');
  if (hasAccountSecurityBarrier(evidence.profile)) reasons.push('account_security_contained');
  if (dob == null || dob === '') reasons.push('age_missing');
  else if (age === null) reasons.push('age_invalid');
  else if (age < (scope === 'buy' ? MIN_AGE_BUY : MIN_AGE_SELL)) reasons.push('underage');
  const profile = evidence.profile;
  if (publication) {
    if (!evidence.user || hasUnavailableAccountStanding(evidence.user)) reasons.push('account_unavailable');
    // Publication never supplies or renews an activity declaration. An already
    // declared professional remains outside the private-seller launch, even if
    // that historical declaration is incomplete or has an obsolete statement.
    if (profile?.activityDeclaration?.kind === 'professional') reasons.push('professional_declared');
  } else if (scope !== 'buy') {
    const declaration = profile?.activityDeclaration;
    if (!declaration || !['personal', 'professional'].includes(declaration.kind) || !declaration.recordedAt || !declaration.actorUid) reasons.push('activity_missing');
    else {
      if (declaration.kind === 'professional') reasons.push('professional_declared');
      if (declaration.statementVersion !== SELLER_ACTIVITY_STATEMENT_VERSION || declaration.statement !== SELLER_ACTIVITY_STATEMENTS[declaration.kind as keyof typeof SELLER_ACTIVITY_STATEMENTS] ||
          !Number.isSafeInteger(declaration.declarationVersion) || declaration.declarationVersion < 1 ||
          !Number.isSafeInteger(profile?.version) || profile!.version < declaration.declarationVersion) reasons.push('activity_version_required');
    }
  }
  // Both open requests and active operator signals remain independent. An owner
  // declaration cannot clear either; one resolved request cannot clear another.
  const active = profile?.activeReviews ?? {};
  const signals = profile?.signals ?? {};
  const malformedControls = [active, signals].some(group => !group || typeof group !== 'object' || Array.isArray(group) ||
    Object.values(group).some((item: any) => !item || typeof item !== 'object' || typeof item.active !== 'boolean' ||
      !(ELIGIBILITY_SCOPES as readonly unknown[]).includes(item.scope)));
  const affects = (item: any) => item?.active === true && (item.scope === scope || (scope === 'new_paid_shipping' && item.scope === 'sell'));
  if (malformedControls || Object.values(active).some(affects) || Object.values(signals).some(affects)) reasons.push('review_required');
  if (scope === 'new_paid_shipping' && !hasObservedQuebecEvidence(evidence)) reasons.push('seller_qc_missing');
  const allowed = reasons.length === 0;
  const status = allowed ? 'allowed' : reasons.includes('review_required') ? 'review_required'
    : reasons.some(r => ['underage', 'professional_declared', 'account_closing', 'account_security_contained', 'account_unavailable'].includes(r)) ? 'blocked' : 'incomplete';
  return { scope, allowed, status, reasons, messages: reasons.map(r => ELIGIBILITY_REASON_MESSAGES[r]),
    policyVersion: publication ? PUBLICATION_ELIGIBILITY_POLICY_VERSION : ELIGIBILITY_POLICY_VERSION, civilDate, evaluationStage: 'foundations' };
}

export function evaluateEligibility(evidence: EligibilityEvidence, scope: EligibilityScope, now = new Date()): EligibilityDecision {
  return evaluateFoundations(evidence, scope, now, false);
}
/** Listing publication/edit/relisting is distinct from accepting a sale or a
 * Troc. No activity declaration, statement version or receipt is required here.
 * This decision grants neither a commercial agreement nor a payment effect. */
export function evaluatePublicationEligibility(evidence: EligibilityEvidence, now = new Date()): EligibilityDecision {
  return evaluateFoundations(evidence, 'sell', now, true);
}

/** Current paid-sale admission follows the simplified private-member policy.
 * An absent historical activity questionnaire is never reconstructed as a
 * declaration. Shipping still requires the native Stripe Quebec observation. */
export function evaluateCurrentSellerEligibility(evidence:EligibilityEvidence,scope:'sell'|'new_paid_shipping',now=new Date()):EligibilityDecision {
  return evaluateFoundations(evidence,scope,now,true);
}

/** Launch restriction for NEW Trocs only; never used for committed servicing.
 * A provider address is deliberately not a residence declaration. */
export function evaluateSwapLaunch(evidence: EligibilityEvidence, now = new Date()) {
  const foundation = evaluateEligibility(evidence, 'sell', now);
  const reasons: string[] = [...foundation.reasons];
  if (!evidence.user || hasUnavailableAccountStanding(evidence.user)) reasons.push('account_unavailable');
  if (evidence.profile?.activityDeclaration?.actorUid !== evidence.ownerId && !reasons.includes('activity_missing')) reasons.push('activity_missing');
  const proof = evidence.profile?.quebecResidenceDeclaration;
  if (!proof || proof.version !== QUEBEC_RESIDENCE_DECLARATION_VERSION || proof.ownerId !== evidence.ownerId ||
      proof.actorUid !== evidence.ownerId || proof.source !== 'owner_declaration' || proof.accepted !== true ||
      proof.country !== 'CA' || proof.province !== 'QC' || proof.statement !== QUEBEC_RESIDENCE_STATEMENT ||
      proof.residenceVerified !== false || !proof.recordedAt || !Number.isSafeInteger(proof.recordedAtMs) || proof.recordedAtMs < 0) {
    reasons.push('quebec_residence_declaration_required');
  }
  const messages = reasons.map(reason => reason === 'quebec_residence_declaration_required'
    ? 'Les nouveaux Trocs sont réservés aux particuliers de 18 ans ou plus qui déclarent résider au Québec.'
    : reason === 'account_unavailable' ? 'Votre compte ne peut pas créer un nouveau Troc.'
      : ELIGIBILITY_REASON_MESSAGES[reason as EligibilityReason]);
  return { policyVersion: SWAP_LAUNCH_POLICY_VERSION, allowed: reasons.length === 0, reasons, messages,
    civilDate: foundation.civilDate, residenceVerified: false as const };
}

/** Private owner reasons never become a DTO/error for the other participant. */
export function counterpartEligibilityRefusal(scope: EligibilityScope) {
  return { scope, reason: 'counterparty_unavailable' as const,
    message: 'Cette offre ne peut pas être poursuivie pour le moment. Vous pouvez contacter notre équipe.' };
}
