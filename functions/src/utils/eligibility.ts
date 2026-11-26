import { db, FieldValue } from '../config/firebase';
import { evaluateEligibility, evaluatePublicationEligibility, evaluateCurrentSellerEligibility, eligibilityVersion, ELIGIBILITY_SCOPES, SELLER_ACTIVITY_STATEMENTS,
  SELLER_ACTIVITY_STATEMENT_VERSION, ELIGIBILITY_POLICY_VERSION, dateOfBirthCopy, dateOfBirthHasReference, hasPersistedDateOfBirth,
  evaluateSwapLaunch, QUEBEC_RESIDENCE_DECLARATION_VERSION, QUEBEC_RESIDENCE_STATEMENT, type EligibilityEvidence, type EligibilityScope } from '../shared/eligibility';
import { quebecCivilDate } from '../shared/age';
import { HttpsError } from 'firebase-functions/v2/https';
import { hasAccountClosure } from '../shared/eligibility';
import { hasUnavailableAccountStanding } from '../shared/accountStanding';
import { hasAccountSecurityBarrier } from '../shared/accountSecurity';
import { qualifyAccountSecurityProfile } from './accountSecurityIdentity';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { assertNewBusinessAdmission } from './businessAdmission';

export const ELIGIBILITY_COLLECTIONS = { profiles: 'eligibility_profiles', requests: 'eligibility_requests', audit: 'eligibility_audit' } as const;
export const SELLER_ACTIVITY_RECEIPT_PROTOCOL = 'seller_activity_declaration_v1';
const activityNativeTime = (value: unknown): value is Timestamp => value instanceof Timestamp && value.toMillis() > 0 && value.toMillis() <= Date.now();
export const sellerActivityHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
const activityId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
// Request keys follow the historical callable identifier() contract, which
// permits spaces/Unicode and stores the trimmed key. They are hashed into a
// Firestore audit ID; they are not UID/document-reference identifiers.
const activityRequestId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  value === value.trim() && !value.includes('/') && value !== '.' && value !== '..';
const activityInputHash = (command: Record<string, unknown>) => createHash('sha256').update(JSON.stringify([
  JSON.stringify(Object.fromEntries(Object.keys(command).sort().map(key => [key, command[key]])))])).digest('hex');
const declarationFields = (value: any) => ({kind: value?.kind ?? null, statementVersion: value?.statementVersion ?? null,
  statement: value?.statement ?? null, ownerId: value?.ownerId ?? null, actorUid: value?.actorUid ?? null,
  accepted: value?.accepted ?? null, personalDeclarationAccepted: value?.personalDeclarationAccepted ?? null,
  recordedAt: value?.recordedAt ?? null, recordedAtMs: value?.recordedAtMs ?? null, declarationVersion: value?.declarationVersion ?? null,
  legalEffectiveDate: null, legallyVerified: false});
/** An incomplete old audit is evidence of that event only. Today's profile
 * never supplies its missing statement, acceptance or resulting declaration. */
export function sellerActivityReceiptDto(id: string, value: any, ownerId: string) {
  const unknown = {protocol: SELLER_ACTIVITY_RECEIPT_PROTOCOL, qualification: 'historical_incomplete' as const,
    id, ownerId, actorUid: value?.actorUid === ownerId ? ownerId : null, requestId: null, inputHash: null,
    receiptHash: null, command: null, statement: null, statementVersion: null, accepted: null,
    resultingDeclaration: null, previous: null, recordedAt: activityNativeTime(value?.createdAt) ? value.createdAt.toDate().toISOString() : null,
    legalEffectiveDate: null, legallyVerified: false};
  if (!value || value.protocol !== SELLER_ACTIVITY_RECEIPT_PROTOCOL || value.action !== 'declare_activity' || value.ownerId !== ownerId ||
      value.actorUid !== ownerId || !activityRequestId(value.requestId) || !/^[a-f0-9]{64}$/.test(value.inputHash ?? '') ||
      id !== createHash('sha256').update(JSON.stringify([ownerId, value.requestId])).digest('hex') ||
      !value.command || typeof value.command !== 'object' || Array.isArray(value.command) ||
      Object.keys(value.command).some(key => !['kind','statementVersion','personalDeclarationAccepted','expectedVersion','requestId','quebecResidenceDeclaration','expectedUid'].includes(key)) ||
      typeof value.command.requestId !== 'string' || value.command.requestId.trim() !== value.requestId || value.inputHash !== activityInputHash(value.command) ||
      value.command.kind !== value.resultingDeclaration?.kind || value.command.statementVersion !== value.statementVersion ||
      value.command.expectedUid != null && value.command.expectedUid !== ownerId ||
      !['personal','professional'].includes(value.resultingDeclaration?.kind) ||
      typeof value.statementVersion !== 'string' || !value.statementVersion.trim() || value.statementVersion.length > 128 ||
      typeof value.statement !== 'string' || !value.statement.trim() || value.statement.length > 2000 ||
      value.accepted !== true || value.resultingDeclaration.ownerId !== ownerId || value.resultingDeclaration.actorUid !== ownerId ||
      value.resultingDeclaration.statement !== value.statement || value.resultingDeclaration.statementVersion !== value.statementVersion ||
      value.resultingDeclaration.accepted !== true || !Number.isSafeInteger(value.resultingDeclaration.declarationVersion) || value.resultingDeclaration.declarationVersion < 1 ||
      value.resultingDeclaration.legalEffectiveDate !== null || value.resultingDeclaration.legallyVerified !== false ||
      !activityNativeTime(value.recordedAt) || !activityNativeTime(value.createdAt) || !value.recordedAt.isEqual(value.createdAt) ||
      !activityNativeTime(value.resultingDeclaration.recordedAt) || !value.recordedAt.isEqual(value.resultingDeclaration.recordedAt) ||
      value.resultingDeclaration.recordedAtMs !== value.recordedAt.toMillis() || value.legalEffectiveDate !== null || value.legallyVerified !== false) return unknown;
  const {receiptHash, ...body} = value;
  if (!/^[a-f0-9]{64}$/.test(receiptHash ?? '') || sellerActivityHash(body) !== receiptHash) return unknown;
  const declaration = declarationFields(value.resultingDeclaration);
  if (declaration.kind === 'personal' ? value.command.personalDeclarationAccepted !== true || declaration.personalDeclarationAccepted !== true
    : value.command.personalDeclarationAccepted === true || declaration.personalDeclarationAccepted !== (value.command.personalDeclarationAccepted ?? null)) return unknown;
  return {protocol: SELLER_ACTIVITY_RECEIPT_PROTOCOL, qualification: 'native_original' as const, id, ownerId, actorUid: ownerId,
    requestId: value.requestId as string, inputHash: value.inputHash as string, receiptHash: receiptHash as string,
    command: value.command as Record<string, unknown>, statement: value.statement as string, statementVersion: value.statementVersion as string,
    accepted: true, resultingDeclaration: {...declaration, recordedAt: value.recordedAt.toDate().toISOString()},
    previous: value.previous ? {qualification: typeof value.previous.qualification === 'string' ? value.previous.qualification : 'unknown',
      reference: [ELIGIBILITY_COLLECTIONS.audit,ELIGIBILITY_COLLECTIONS.profiles].includes(value.previous.reference?.collection) && activityId(value.previous.reference?.id)
        ? {collection: value.previous.reference.collection as string, id: value.previous.reference.id as string} : null,
      hash: /^[a-f0-9]{64}$/.test(value.previous.hash ?? '') ? value.previous.hash as string : null} : null,
    recordedAt: value.recordedAt.toDate().toISOString(), legalEffectiveDate: null, legallyVerified: false};
}
/** Minimal current observation. Legacy profile facts can be captured NOW, but
 * cannot be relabelled as an original historical receipt. No DOB/profile hash. */
export async function readSellerActivitySource(tx: FirebaseFirestore.Transaction, evidence: EligibilityEvidence) {
  const ownerId = evidence.ownerId!, activity = evidence.profile?.activityDeclaration;
  const minimal = {kind: ['personal','professional'].includes(activity?.kind) ? activity!.kind as string : null,
    statementVersion: typeof activity?.statementVersion === 'string' ? activity.statementVersion : null,
    declarationVersion: Number.isSafeInteger(activity?.declarationVersion) ? activity!.declarationVersion as number : null,
    recordedAt: activityNativeTime(activity?.recordedAt) ? activity!.recordedAt as Timestamp : null};
  if (/^[a-f0-9]{64}$/.test(activity?.receiptId ?? '')) {
    const original = (await tx.get(db.collection(ELIGIBILITY_COLLECTIONS.audit).doc(activity.receiptId))).data();
    const receipt = sellerActivityReceiptDto(activity.receiptId, original, ownerId);
    if (receipt.qualification === 'native_original' && receipt.receiptHash === activity.receiptHash &&
        sellerActivityHash(declarationFields(activity)) === sellerActivityHash(declarationFields(original!.resultingDeclaration))) {
      return {...minimal, qualification: 'native_original', reference: {collection: ELIGIBILITY_COLLECTIONS.audit, id: activity.receiptId as string},
        hash: receipt.receiptHash, legalEffectiveDate: null, legallyVerified: false};
    }
  }
  if (activity && (Object.prototype.hasOwnProperty.call(activity,'receiptId') || Object.prototype.hasOwnProperty.call(activity,'receiptHash'))) {
    return {...minimal,qualification:'native_source_unqualified',reference:null,hash:null,legalEffectiveDate:null,legallyVerified:false};
  }
  return {...minimal, qualification: activity ? 'current_profile_observed_history_unknown' : 'missing',
    reference: activity ? {collection: ELIGIBILITY_COLLECTIONS.profiles, id: ownerId} : null,
    hash: activity ? sellerActivityHash(minimal) : null, legalEffectiveDate: null, legallyVerified: false};
}
type ActivityAgreement = {kind: 'purchase'|'swap'; id: string; phase: 'shipping_reservation'|'cash_agreement'|'proposal'|'acceptance'; sourceHash?: string|null};
/** Read phase only: caller persists this witness WITH the new agreement.
 * Admission is an observed launch policy, never a legal/tax attestation. */
export async function captureSellerActivityAdmission(tx: FirebaseFirestore.Transaction, owners: string[], scope: EligibilityScope|'swap',
  agreement: ActivityAgreement, capturedAt = Timestamp.now()) {
  const parties = [];
  for (const ownerId of [...new Set(owners)]) {
    const evidence = await readEligibilityEvidence(tx, ownerId), decision = scope === 'swap' ? evaluateSwapLaunch(evidence) :
      agreement.kind === 'purchase' && scope !== 'buy' ? evaluateCurrentSellerEligibility(evidence, scope) : evaluateEligibility(evidence, scope);
    if (!decision.allowed || !evidence.user || hasUnavailableAccountStanding(evidence.user)) throw new HttpsError('failed-precondition',
      'Le statut déclaré doit être complété avant un nouvel accord.', {reason: 'seller_activity_admission_required'});
    const activity = await readSellerActivitySource(tx, evidence);
    if (activity.qualification === 'native_source_unqualified') throw new HttpsError('failed-precondition',
      'La déclaration enregistrée doit être rapprochée avant un nouvel accord.', {reason:'seller_activity_source_unqualified'});
    parties.push({ownerId, activity, admission: {scope, allowed: true, policyVersion: decision.policyVersion}});
  }
  const body = {protocol: 'seller_activity_admission_capture_v1', agreement: {...agreement, sourceHash: agreement.sourceHash ?? null},
    parties, capturedAt, legalEffectiveDate: null, legallyVerified: false};
  return {...body, captureHash: sellerActivityHash(body)};
}
/** Only native captures bound to the listed agreement/parties are disclosed. */
export function sellerActivityAdmissionDto(value: any, kind: 'purchase'|'swap', id: string, ownerId: string, phase?: ActivityAgreement['phase'], participants?: string[], agreementSourceHash?: string) {
  const unknown = {qualification: 'historical_incomplete', protocol: 'seller_activity_admission_capture_v1',
    agreement: {kind, id}, capturedAt: null, parties: [], captureHash: null, legalEffectiveDate: null, legallyVerified: false};
  if (!value || value.protocol !== 'seller_activity_admission_capture_v1' || value.agreement?.kind !== kind || value.agreement.id !== id ||
      !['shipping_reservation','cash_agreement','proposal','acceptance'].includes(value.agreement.phase) || phase != null && value.agreement.phase !== phase ||
      (kind==='purchase' ? !['shipping_reservation','cash_agreement'].includes(value.agreement.phase) : !['proposal','acceptance'].includes(value.agreement.phase)) ||
      !activityNativeTime(value.capturedAt) || !Array.isArray(value.parties) || value.parties.length < 1 || value.parties.length > 2 ||
      (kind==='purchase' ? value.parties.length!==1 : value.parties.length!==2) ||
      participants && (value.parties.length!==participants.length || value.parties.some((p:any)=>!participants.includes(p?.ownerId))) ||
      agreementSourceHash != null && value.agreement.sourceHash!==agreementSourceHash ||
      !value.parties.some((party: any) => party?.ownerId === ownerId) || new Set(value.parties.map((p: any) => p?.ownerId)).size !== value.parties.length ||
      value.parties.some((p: any) => !activityId(p?.ownerId) || p?.admission?.allowed !== true || typeof p?.admission?.policyVersion !== 'string' ||
        !['sell','new_paid_shipping','swap'].includes(p.admission.scope) || !p.activity || p.activity.kind !== 'personal') ||
      value.legalEffectiveDate !== null || value.legallyVerified !== false) return unknown;
  const {captureHash, ...body} = value;
  if (!/^[a-f0-9]{64}$/.test(captureHash ?? '') || sellerActivityHash(body) !== captureHash) return unknown;
  return {qualification: 'native_capture', protocol: value.protocol as string,
    agreement: {kind, id, phase: value.agreement.phase as string, sourceHash: typeof value.agreement.sourceHash === 'string' ? value.agreement.sourceHash : null},
    capturedAt: value.capturedAt.toDate().toISOString(), captureHash: captureHash as string,
    parties: value.parties.filter((p: any) => p.ownerId === ownerId).map((p: any) => ({ownerId: p.ownerId as string,
      activity: {kind: 'personal', statementVersion: typeof p.activity.statementVersion === 'string' ? p.activity.statementVersion : null,
        declarationVersion: Number.isSafeInteger(p.activity.declarationVersion) ? p.activity.declarationVersion as number : null,
        recordedAt: activityNativeTime(p.activity.recordedAt) ? p.activity.recordedAt.toDate().toISOString() : null,
        qualification: typeof p.activity.qualification === 'string' ? p.activity.qualification : 'unknown',
        reference: p.activity.reference && [ELIGIBILITY_COLLECTIONS.audit,ELIGIBILITY_COLLECTIONS.profiles].includes(p.activity.reference.collection) && activityId(p.activity.reference.id)
          ? {collection: p.activity.reference.collection as string, id: p.activity.reference.id as string} : null,
        hash: /^[a-f0-9]{64}$/.test(p.activity.hash ?? '') ? p.activity.hash as string : null, legalEffectiveDate: null, legallyVerified: false},
      admission: {scope: p.admission.scope as string, allowed: true, policyVersion: p.admission.policyVersion as string}})),
    legalEffectiveDate: null, legallyVerified: false};
}
export async function readSellerActivityHistory(tx: FirebaseFirestore.Transaction, ownerId: string, cursor: string|null) {
  let query = db.collection(ELIGIBILITY_COLLECTIONS.audit).where('ownerId','==',ownerId).orderBy('__name__').limit(21);
  if (cursor) query = query.startAfter(cursor);
  const page = await tx.get(query), rows = page.docs.slice(0,20), hasMore = page.size > 20;
  return {items: rows.filter(d => d.data().action === 'declare_activity').map(d => sellerActivityReceiptDto(d.id,d.data(),ownerId)),
    cursor: hasMore ? rows.at(-1)!.id : null, hasMore, coverage: 'owner_audit_page'};
}
export async function readSellerActivitySales(tx: FirebaseFirestore.Transaction, ownerId: string, cursor: string|null) {
  let query = db.collection('transactions').where('sellerId','==',ownerId).orderBy('__name__').limit(21);
  if (cursor) query = query.startAfter(cursor);
  const page = await tx.get(query), rows = page.docs.slice(0,20), hasMore = page.size > 20;
  return {items: rows.map(doc => {const sale = doc.data(); return {id:doc.id, status:typeof sale.status === 'string' ? sale.status : null,
    deliveryType:sale.deliveryType === 'meetup'||sale.deliveryType === 'shipping' ? sale.deliveryType : null, createdAt:timestampIso(sale.createdAt),
    sellerActivityAdmission:sellerActivityAdmissionDto(sale.sellerActivityAdmission,'purchase',doc.id,ownerId)};}),
    cursor:hasMore ? rows.at(-1)!.id : null, hasMore};
}
export async function readSellerActivitySwaps(tx: FirebaseFirestore.Transaction, ownerId: string, initiatedCursor: string|null, receivedCursor: string|null) {
  const read = async (side: 'initiator'|'receiver', cursor: string|null) => {
    let query = db.collection('swaps').where(side+'Id','==',ownerId).orderBy('__name__').limit(21);
    if (cursor) query = query.startAfter(cursor);
    const page = await tx.get(query), rows = page.docs.slice(0,20), hasMore = page.size > 20;
    return {items: rows.filter(doc => {const v=doc.data();return v[side+'Id']===ownerId && activityId(v.initiatorId) && activityId(v.receiverId) && v.initiatorId!==v.receiverId;}).map(doc => {
      const swap=doc.data();return {id:doc.id,status:typeof swap.status==='string'?swap.status:null,createdAt:timestampIso(swap.createdAt),
        acceptedAt:activityNativeTime(swap.acceptedAt)?swap.acceptedAt.toDate().toISOString():null,
        proposal:sellerActivityAdmissionDto(swap.sellerActivityAdmissions?.proposal,'swap',doc.id,ownerId,'proposal',[swap.initiatorId,swap.receiverId],swap.exchangeAgreement?.sourceHash),
        acceptance:sellerActivityAdmissionDto(swap.sellerActivityAdmissions?.acceptance,'swap',doc.id,ownerId,'acceptance',[swap.initiatorId,swap.receiverId],swap.exchangeAgreement?.sourceHash)};}),
      cursor:hasMore?rows.at(-1)!.id:null,hasMore};
  };
  return {initiated:await read('initiator',initiatedCursor),received:await read('receiver',receivedCursor)};
}
/** Read all authoritative evidence inside the caller's transaction, before writes. */
export async function readEligibilityEvidence(tx: FirebaseFirestore.Transaction, uid: string): Promise<EligibilityEvidence> {
  const user = await tx.get(db.collection('users').doc(uid));
  const profile = await tx.get(db.collection(ELIGIBILITY_COLLECTIONS.profiles).doc(uid));
  const data = user.data() ?? null, revision = user.updateTime;
  return { ownerId: uid, user: data, profile: await qualifyAccountSecurityProfile(profile.data(), tx, uid) ?? null,
    nativeSourceDocumentVersion: dateOfBirthHasReference(data?.dateOfBirth) && revision ?
      { seconds: revision.seconds, nanoseconds: revision.nanoseconds } : null };
}
/** Same private document as closure/security acquisition, read before writes.
 * Commercially paused accounts may service funds. Security containment still
 * blocks a NEW debit/destination; actual committed-effect recovery is separate. */
export async function assertAccountOperationOpen(tx: FirebaseFirestore.Transaction, uid: string, existingFunds = false, newEffect = true, commercialAcquisition = true) {
  if(!existingFunds&&newEffect&&commercialAcquisition)await assertNewBusinessAdmission();
  const user = await tx.get(db.collection('users').doc(uid));
  const profile = await tx.get(db.collection(ELIGIBILITY_COLLECTIONS.profiles).doc(uid));
  // This guard does not parse DOB or impose new eligibility on servicing funds.
  const evidence: EligibilityEvidence = { ownerId: uid, user: user.data() ?? null,
    profile: newEffect ? await qualifyAccountSecurityProfile(profile.data(),tx,uid) ?? null : profile.data() ?? null };
  if (newEffect && hasAccountSecurityBarrier(evidence.profile)) throw accountSecurityClosed();
  if (!evidence.user) throw new HttpsError('not-found', 'Compte introuvable');
  const closure = evidence.profile?.accountClosure;
  const pausedFunds = existingFunds && closure?.schemaVersion === 1 && closure.ownerId === uid && closure.phase === 'paused';
  if ((hasAccountClosure(evidence.profile) && !pausedFunds) || (!existingFunds && hasUnavailableAccountStanding(evidence.user))) {
    throw new HttpsError('failed-precondition', 'Votre compte est fermé aux nouvelles opérations. Contactez notre équipe pour les engagements existants.',
      { reason: 'account_closing', action: 'contactSupport' });
  }
  return evidence;
}
/** Call on a private profile read in the NEW-effect transaction, never on an
 * already engaged receipt/reconciliation or on a historical owner reader. */
const accountSecurityClosed = () => new HttpsError('failed-precondition',
    'Votre compte est sécurisé contre de nouvelles opérations. Contactez notre équipe pour les rétablir.',
    { reason: 'account_security_contained', action: 'contactSupport', newEffectsBlocked: true });
export async function assertAccountSecurityOpen(profile: FirebaseFirestore.DocumentData | null | undefined,
  tx: FirebaseFirestore.Transaction, expectedUid: string): Promise<void> {
  if (hasAccountSecurityBarrier(await qualifyAccountSecurityProfile(profile,tx,expectedUid))) throw accountSecurityClosed();
}
/** Publication preserves account/business safety while requiring no seller
 * activity declaration. Agreements retain their separate trading admission. */
export async function assertOwnPublicationEligibility(evidence: EligibilityEvidence,
  tx: FirebaseFirestore.Transaction, expectedUid: string): Promise<void> {
  await assertNewBusinessAdmission();
  await assertAccountSecurityOpen(evidence.profile, tx, expectedUid);
  const decision = evaluatePublicationEligibility(evidence);
  if (!decision.allowed) throw new HttpsError('permission-denied', decision.messages[0], {
    reason: 'eligibility_required', scope: 'sell', reasons: decision.reasons, messages: decision.messages,
    policyVersion: decision.policyVersion, actions: ['getMyEligibility', 'requestEligibilityReview'],
  });
}
export function assertRecentAccountAuthentication(token: { auth_time?: unknown }, nowMs = Date.now()) {
  const seconds = token.auth_time;
  if (!Number.isSafeInteger(seconds) || (seconds as number) <= 0 || nowMs - (seconds as number) * 1000 > 5 * 60_000 ||
      (seconds as number) * 1000 - nowMs > 60_000) {
    throw new HttpsError('unauthenticated', 'Confirmez votre identité avant de poursuivre.',
      { reason: 'recent_authentication_required', action: 'reauthenticate' });
  }
}
/** Existing financial servicing is never refused by closure. Read the same
 * barrier before writes so its effects serialize with the final deletion commit. */
export async function readFinancialClosureBarriers(tx: FirebaseFirestore.Transaction, ownerIds: unknown[]) {
  const ids = [...new Set(ownerIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && !id.includes('/')))];
  return ids.length ? tx.getAll(...ids.map(id => db.collection(ELIGIBILITY_COLLECTIONS.profiles).doc(id))) : [];
}
/** One latest private witness, not an automatic recovery or an Auth recreation.
 * A financial event after an earlier completion is a new operator obligation. */
export function recordFinancialExposureDuringClosure(tx: FirebaseFirestore.Transaction,
  barriers: FirebaseFirestore.DocumentSnapshot[], evidence: { source: 'stripe_bank_dispute'; transactionId: string; disputeId: string; kind: string }) {
  for (const snapshot of barriers) {
    const closure = snapshot.data()?.accountClosure;
    if (!closure || closure.schemaVersion !== 1 || closure.ownerId !== snapshot.id || !['purging', 'complete'].includes(closure.phase)) continue;
    const prior = closure.lateFinancialEvent;
    if (closure.phase === 'purging' && closure.status === 'incomplete' && closure.requiresOperator === true &&
        prior?.source === evidence.source && prior.transactionId === evidence.transactionId && prior.disputeId === evidence.disputeId && prior.kind === evidence.kind) continue;
    tx.update(snapshot.ref, { 'accountClosure.phase': 'purging', 'accountClosure.status': 'incomplete',
      'accountClosure.requiresOperator': true, 'accountClosure.blockers': ['financial_reconciliation_required'],
      'accountClosure.incompleteParts': ['financial_obligation'],
      'accountClosure.lateFinancialEvent': { ...evidence, recordedAt: FieldValue.serverTimestamp() },
      ...(closure.phase === 'complete' ? { 'accountClosure.reopenedAt': FieldValue.serverTimestamp(), 'accountClosure.leaseUntilMs': 0 } : {}) });
  }
}
export function timestampIso(value: any): string | null {
  const date = value instanceof Date ? value : typeof value?.toDate === 'function' ? value.toDate() : null;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
/** Admin still sees its notes/actors, but never raw SDK classes in transport. */
export function adminSignalsDto(signals: any) {
  if (!signals || typeof signals !== 'object' || Array.isArray(signals)) return {};
  const text = (value: unknown) => typeof value === 'string' ? value : null;
  return Object.fromEntries(Object.keys(signals).sort().map(id => {
    const signal = signals[id];
    return [id, { scope: text(signal?.scope), active: typeof signal?.active === 'boolean' ? signal.active : null,
      internalNote: text(signal?.internalNote), actorUid: text(signal?.actorUid), recordedAt: timestampIso(signal?.recordedAt),
      clearedBy: text(signal?.clearedBy), clearedAt: timestampIso(signal?.clearedAt), reviewId: text(signal?.reviewId) }];
  }));
}
/** Allowlist only. The profile contains internal signals/notes and cannot be
 * returned/spread to its owner even though the caller is authenticated. */
export function ownerEligibilityDto(evidence: EligibilityEvidence, now = new Date()) {
  const activity = evidence.profile?.activityDeclaration;
  const residence = evidence.profile?.quebecResidenceDeclaration;
  const closure = evidence.profile?.accountClosure;
  return {
    accountClosure: closure ? { newOperationsBlocked: true, deletionComplete: closure.phase === 'complete',
      status: ['paused', 'complete'].includes(closure.phase) ? closure.phase : 'incomplete',
      action: closure.requiresOperator === true || closure.phase !== 'complete' &&
        (closure.externalErasureReview != null || Array.isArray(closure.blockers) && closure.blockers.includes('privacy_retention_review_required'))
        ? 'contactSupport' : closure.phase === 'complete' ? null :
        closure.phase === 'paused' ? 'resolveExistingObligations' : 'retryOrContactSupport' } : null,
    version: eligibilityVersion(evidence), policyVersion: ELIGIBILITY_POLICY_VERSION,
    statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, statements: SELLER_ACTIVITY_STATEMENTS,
    swapLaunch: evaluateSwapLaunch(evidence, now),
    publication: evaluatePublicationEligibility(evidence, now),
    quebecResidenceStatementVersion: QUEBEC_RESIDENCE_DECLARATION_VERSION,
    quebecResidenceStatement: QUEBEC_RESIDENCE_STATEMENT,
    quebecResidenceDeclaration: residence ? { version: typeof residence.version === 'string' ? residence.version : null,
      accepted: typeof residence.accepted === 'boolean' ? residence.accepted : null,
      ownerId: residence.ownerId === evidence.ownerId ? evidence.ownerId : null,
      country: residence.country === 'CA' ? 'CA' : null, province: residence.province === 'QC' ? 'QC' : null,
      source: residence.source === 'owner_declaration' ? 'owner_declaration' : null,
      recordedAt: timestampIso(residence.recordedAt) ?? (Number.isSafeInteger(residence.recordedAtMs) ? new Date(residence.recordedAtMs).toISOString() : null),
      statement: typeof residence.statement === 'string' ? residence.statement : null, residenceVerified: false,
    } : null,
    dateOfBirth: typeof evidence.user?.dateOfBirth === 'string' ? evidence.user.dateOfBirth : null,
    dateOfBirthCopy: dateOfBirthCopy(evidence.user?.dateOfBirth),
    dateOfBirthSource: hasPersistedDateOfBirth(evidence.user) ? 'declared_profile' : 'missing',
    dateOfBirthVerified: false,
    firstDateOfBirthAction: 'recordSignupConsent', initialDateRequiresTermsAndPrivacy: true,
    activityDeclaration: activity && ['personal', 'professional'].includes(activity.kind) ? {
      kind: activity.kind, statementVersion: typeof activity.statementVersion === 'string' ? activity.statementVersion : null,
      statement: typeof activity.statement === 'string' ? activity.statement : null,
      recordedAt: timestampIso(activity.recordedAt) ?? (Number.isSafeInteger(activity.recordedAtMs) ? new Date(activity.recordedAtMs).toISOString() : null),
      declarationVersion: Number.isSafeInteger(activity.declarationVersion) ? activity.declarationVersion : null,
      legallyVerified: false,
    } : null,
    sellerQuebecEvidence: evidence.profile?.sellerQuebecEvidence ? {
      status: typeof evidence.profile.sellerQuebecEvidence.status === 'string' ? evidence.profile.sellerQuebecEvidence.status : 'review_required',
      source: 'stripe_account_observed', residenceVerified: false,
      observedAtMs: Number.isSafeInteger(evidence.profile.sellerQuebecEvidence.observedAtMs) ? evidence.profile.sellerQuebecEvidence.observedAtMs : null,
    } : null,
    decisions: Object.fromEntries(ELIGIBILITY_SCOPES.map(scope => [scope, scope==='buy'?evaluateEligibility(evidence,scope,now):evaluateCurrentSellerEligibility(evidence,scope,now)])),
  };
}
export function ownerReviewDto(id: string, data: FirebaseFirestore.DocumentData) {
  const civilNow = quebecCivilDate();
  const overdue = data.statutoryDueDate && civilNow && civilNow > data.statutoryDueDate && !['approved', 'rejected'].includes(data.status);
  return { id, kind: data.kind ?? 'unknown', scope: data.scope ?? null, status: data.status ?? 'unknown',
    requestVersion: data.version ?? null, policyVersion: data.policyVersion ?? null,
    reason: data.reason ?? null, proposedDateOfBirth: data.proposedDateOfBirth ?? null,
    originalDateOfBirth: data.kind === 'date_of_birth_correction' && typeof data.originalDateOfBirth === 'string' ? data.originalDateOfBirth : null,
    originalDateOfBirthCopy: data.kind === 'date_of_birth_correction' ? data.originalDateOfBirthCopy ?? dateOfBirthCopy(data.originalDateOfBirth) : null,
    correctedDateOfBirth: data.correctedDateOfBirth ?? null,
    receivedAt: Number.isSafeInteger(data.receivedAtMs) ? new Date(data.receivedAtMs).toISOString() : null,
    receivedCivilDate: data.receivedCivilDate ?? null, statutoryDueDate: data.statutoryDueDate ?? null,
    deadlineState: data.statutoryDueDate ? overdue ? 'overdue' : ['approved', 'rejected'].includes(data.status) ? 'answered' : 'pending' : 'not_applicable',
    silenceEffect: data.kind === 'date_of_birth_correction' ? 'refusal_not_permission' : null,
    ownerResponse: data.ownerResponse ? { text: data.ownerResponse.text ?? null, legalBasis: data.ownerResponse.legalBasis ?? null,
      recourse: data.ownerResponse.recourse ?? null, respondedAt: timestampIso(data.ownerResponse.respondedAt) ??
        (Number.isSafeInteger(data.ownerResponse.respondedAtMs) ? new Date(data.ownerResponse.respondedAtMs).toISOString() : null),
      respondedCivilDate: data.ownerResponse.respondedCivilDate ?? null, recordedAfterDueDate: data.ownerResponse.recordedAfterDueDate === true } : null,
    latestOwnerDetails: data.latestOwnerDetails ?? null,
    ownerDecisionReason: data.ownerDecisionReason ?? null,
    createdAt: timestampIso(data.createdAt), updatedAt: timestampIso(data.updatedAt),
    decidedAt: timestampIso(data.decidedAt) };
}
