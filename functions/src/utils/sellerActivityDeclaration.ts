import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { accountSecurityQualifiedProjection, hasAccountSecurityBarrier } from '../shared/accountSecurity';
import { ELIGIBILITY_POLICY_VERSION, SELLER_ACTIVITY_STATEMENT_VERSION, SELLER_ACTIVITY_STATEMENTS,
  QUEBEC_RESIDENCE_DECLARATION_VERSION, QUEBEC_RESIDENCE_STATEMENT, eligibilityVersion, type EligibilityEvidence } from '../shared/eligibility';
import { ELIGIBILITY_COLLECTIONS, SELLER_ACTIVITY_RECEIPT_PROTOCOL, readSellerActivitySource, sellerActivityHash } from './eligibility';

export const SELLER_ACTIVITY_COMMAND_KEYS = ['kind', 'statementVersion', 'personalDeclarationAccepted', 'expectedVersion', 'requestId', 'quebecResidenceDeclaration', 'expectedUid'];
export const sellerActivityCommandHash = (data: Record<string, unknown>) => createHash('sha256').update(JSON.stringify([
  JSON.stringify(Object.fromEntries(Object.keys(data).sort().map(k => [k, data[k]])))])).digest('hex');
export function sellerActivityOperationRef(uid: string, requestId: unknown) {
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 128 || requestId.includes('/') || ['.', '..'].includes(requestId.trim())) {
    throw new HttpsError('invalid-argument', 'Identifiant de déclaration invalide.');
  }
  return db.collection(ELIGIBILITY_COLLECTIONS.audit).doc(createHash('sha256').update(JSON.stringify([uid, requestId.trim()])).digest('hex'));
}
export function nextEligibilityProfile(profile: any, patch: Record<string, unknown>) {
  const version = Number.isSafeInteger(profile?.version) && profile.version >= 0 ? profile.version : 0;
  const next = { ...(profile ?? {}), ...patch, version: version + 1, policyVersion: ELIGIBILITY_POLICY_VERSION, updatedAt: FieldValue.serverTimestamp() };
  return profile && Object.prototype.hasOwnProperty.call(profile, 'accountSecurityBarrier') && !hasAccountSecurityBarrier(profile) &&
    next.accountSecurityBarrier === profile.accountSecurityBarrier && next.accountSecurityRecovery === profile.accountSecurityRecovery
    ? accountSecurityQualifiedProjection(next) : next;
}
/** Read/prepare only. The caller commits this immutable event and its profile
 * together with its other writes, after every transaction read has finished. */
export async function prepareSellerActivityDeclaration(tx: FirebaseFirestore.Transaction, uid: string, data: Record<string, any>,
  evidence: EligibilityEvidence, context: { signupConsent?: Record<string, unknown> } = {}) {
  if (Object.keys(data).some(k => !SELLER_ACTIVITY_COMMAND_KEYS.includes(k))) throw new HttpsError('invalid-argument', 'Paramètres de déclaration invalides.');
  const ref = sellerActivityOperationRef(uid, data.requestId), residence = data.quebecResidenceDeclaration;
  if (('expectedUid' in data || residence != null) && data.expectedUid !== uid) throw new HttpsError('permission-denied', 'Le compte connecté a changé.', { reason: 'swap_session_changed' });
  if (!['personal', 'professional'].includes(data.kind) || data.statementVersion !== SELLER_ACTIVITY_STATEMENT_VERSION ||
      data.kind === 'personal' && data.personalDeclarationAccepted !== true ||
      data.personalDeclarationAccepted != null && typeof data.personalDeclarationAccepted !== 'boolean' ||
      data.kind === 'professional' && data.personalDeclarationAccepted === true) throw new HttpsError('invalid-argument', 'Déclaration d’activité et version valides requises.');
  if (residence != null && (typeof residence !== 'object' || Array.isArray(residence) ||
      Object.keys(residence).some(k => !['version', 'country', 'province', 'accepted'].includes(k)) ||
      residence.version !== QUEBEC_RESIDENCE_DECLARATION_VERSION || residence.country !== 'CA' || residence.province !== 'QC' ||
      typeof residence.accepted !== 'boolean')) throw new HttpsError('invalid-argument', 'Une déclaration explicite de résidence au Québec est requise.');
  if (!evidence.user) throw new HttpsError('failed-precondition', 'Complétez votre inscription avant cette déclaration.');
  if (typeof data.expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(data.expectedVersion)) throw new HttpsError('invalid-argument', 'Version attendue requise.');
  if (eligibilityVersion(evidence) !== data.expectedVersion) throw new HttpsError('aborted', 'Vos renseignements ont changé. Actualisez-les avant de poursuivre.', { reason: 'eligibility_version_changed' });
  const recordedAt = Timestamp.now(), previous = await readSellerActivitySource(tx, evidence);
  const declarationVersion = (Number.isSafeInteger(evidence.profile?.version) && evidence.profile!.version >= 0 ? evidence.profile!.version : 0) + 1;
  const activity = { kind: data.kind, statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION,
    statement: SELLER_ACTIVITY_STATEMENTS[data.kind as keyof typeof SELLER_ACTIVITY_STATEMENTS], ownerId: uid, actorUid: uid, accepted: true,
    personalDeclarationAccepted: data.personalDeclarationAccepted ?? null, recordedAt, recordedAtMs: recordedAt.toMillis(), declarationVersion,
    legalEffectiveDate: null, legallyVerified: false };
  const body = { protocol: SELLER_ACTIVITY_RECEIPT_PROTOCOL, action: 'declare_activity', inputHash: sellerActivityCommandHash(data),
    actorUid: uid, ownerId: uid, requestId: data.requestId.trim(), command: data, statement: activity.statement, statementVersion: activity.statementVersion,
    accepted: true, resultingDeclaration: activity, previous: { qualification: previous.qualification, reference: previous.reference, hash: previous.hash },
    policyVersion: ELIGIBILITY_POLICY_VERSION, recordedAt, createdAt: recordedAt, legalEffectiveDate: null, legallyVerified: false, ...context };
  const event = { ...body, receiptHash: sellerActivityHash(body) };
  const profile = nextEligibilityProfile(evidence.profile, { activityDeclaration: { ...activity, receiptId: ref.id, receiptHash: event.receiptHash },
    ...(residence ? { quebecResidenceDeclaration: { version: QUEBEC_RESIDENCE_DECLARATION_VERSION, country: 'CA', province: 'QC',
      accepted: residence.accepted, statement: QUEBEC_RESIDENCE_STATEMENT, ownerId: uid, actorUid: uid, source: 'owner_declaration',
      residenceVerified: false, recordedAt, recordedAtMs: recordedAt.toMillis() } } : {}) });
  profile.updatedAt = recordedAt;
  return { ref, event, profile };
}
