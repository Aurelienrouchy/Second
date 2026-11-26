/** Private support records. A receipt proves recording, never recovery, permission or money movement. */
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { DocumentReference, FieldValue, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { auth, db } from '../config/firebase';
import { civilDateAfterDays, parseCivilIsoDate, quebecCivilDate } from '../shared/age';
import { ELIGIBILITY_REASON_MESSAGES, PUBLICATION_ELIGIBILITY_POLICY_VERSION, type EligibilityReason } from '../shared/eligibility';
import { qualifiedCashAgreement } from './cashMeetup';
import { readSwapHoldSource } from './swapHeldFunds';
import { readWithdrawalTimingSource } from './payoutRecovery';
import {projectSupportConfidential} from './supportConfidentiality';
import {assertPrivateAccountSession} from './privateAccountSession';

export const SUPPORT_KINDS = ['commercial_late', 'access_interruption', 'personal_data_access', 'personal_data_correction', 'automated_decision_review',
  'account_reconciliation', 'restriction_circumvention', 'representation_review', 'payment_account_review', 'activity_compliance_review', 'swap_hold_assistance', 'withdrawal_timing_assistance'] as const;
export const ACCOUNT_SUPPORT_KINDS = ['account_reconciliation', 'restriction_circumvention', 'representation_review', 'payment_account_review', 'activity_compliance_review'] as const;
const LEGACY_SUPPORT_KINDS = ['commercial_late', 'access_interruption', 'personal_data_access', 'personal_data_correction', 'automated_decision_review'] as const;
/** V1 readers explicitly opt into the account-case extension. A future/unknown
 * kind never silently becomes parseable by an older client. */
export function supportKindReadable(kind: unknown, accountCases: boolean, extendedCases = false, withdrawalCases = false, accountReviewV2 = false): boolean {
  return (LEGACY_SUPPORT_KINDS as readonly unknown[]).includes(kind) ||
    accountCases && !['payment_account_review', 'activity_compliance_review'].includes(kind as string) && (ACCOUNT_SUPPORT_KINDS as readonly unknown[]).includes(kind) ||
    accountReviewV2 && ['payment_account_review', 'activity_compliance_review'].includes(kind as string) ||
    extendedCases && kind === 'swap_hold_assistance' || withdrawalCases && kind === 'withdrawal_timing_assistance';
}
export const ACCOUNT_REVIEW_FINDINGS = ['unresolved', 'no_link_established', 'link_requires_manual_action',
  'representation_not_verified', 'representation_requires_manual_verification'] as const;
export const MEETUP_SUPPORT_REASONS = ['article_refused', 'disagreement_after_declaration', 'safety_or_pressure'] as const;
export const SUPPORT_COLLECTION = 'support_requests';
export const SUPPORT_OPTIONS = { region: 'northamerica-northeast1', memory: '512MiB' as const };
export function supportObject(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) {
    throw new HttpsError('invalid-argument', 'Paramètres invalides.');
  }
  return value as Record<string, any>;
}
export function supportText(value: unknown, label: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpsError('invalid-argument', `${label} requis ou invalide.`);
  return value.trim();
}
export function supportId(value: unknown, label = 'Identifiant'): string {
  const id = supportText(value, label, 128);
  if (id.includes('/') || id === '.' || id === '..' || /^__.*__$/.test(id)) throw new HttpsError('invalid-argument', `${label} invalide.`);
  return id;
}
/** Firebase account identities are exact; document/text IDs keep their own
 * existing parser. Never trim spaces or normalize a UID into another account. */
export function isSupportAccountUid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/') &&
    value !== '.' && value !== '..' && !/^__.*__$/.test(value);
}
export function supportAccountUid(value: unknown, label = 'Identifiant du compte'): string {
  if (!isSupportAccountUid(value)) throw new HttpsError('invalid-argument', `${label} invalide.`);
  return value;
}
export function supportRequestId(value: unknown): string {
  const id = supportId(value, 'Identifiant de commande');
  if (id.length < 16) throw new HttpsError('invalid-argument', 'Identifiant de commande trop court.');
  return id;
}
function canonical(value: any): any {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Timestamp) return { seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  throw new HttpsError('failed-precondition', 'Source non qualifiée.');
}
export const supportHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const VectorType = FieldValue.vector([]).constructor;
/** Native SOURCE identity is distinct from the primitive command fingerprint.
 * References are SDK-observed identities, never interpreted as dates or read.
 * All source values are tagged so a map cannot imitate a native value. */
export function supportSourceHash(value: unknown): string {
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  let copiedBytes = 0;
  const fail = (): never => { throw new HttpsError('failed-precondition', 'Source native non qualifiée.'); };
  const consume = (bytes: number) => { copiedBytes += bytes; if (copiedBytes > 2_000_000) fail(); };
  const numberCopy = (item: number) => Number.isFinite(item) ? Object.is(item, -0) ? '-0' : item : String(item);
  function copy(item: any, depth: number): any {
    if (depth > 32 || ++nodes > 20_000) return fail();
    consume(48);
    if (item === null) return ['null'];
    if (typeof item === 'string') { consume(Buffer.byteLength(item, 'utf8')); return ['string', item]; }
    if (typeof item === 'boolean') return ['boolean', item];
    if (typeof item === 'number') return ['number', numberCopy(item)];
    if (item instanceof DocumentReference) {
      const projectId = (item.firestore as FirebaseFirestore.Firestore & { readonly projectId: string }).projectId;
      const databaseId = item.firestore.databaseId;
      if (!projectId || !databaseId || !item.path) return fail();
      consume(Buffer.byteLength(projectId + databaseId + item.path, 'utf8'));
      return ['document_reference', projectId, databaseId, item.path, 'sdk_observed_reference'];
    }
    if (item instanceof Timestamp) return ['timestamp', item.seconds, item.nanoseconds];
    if (item instanceof Date) return Number.isFinite(item.getTime()) ? ['date', item.toISOString()] : fail();
    if (item instanceof GeoPoint) return ['geo_point', item.latitude, item.longitude];
    if (item instanceof Uint8Array) { consume(Math.ceil(item.byteLength / 3) * 4); return ['bytes', Buffer.from(item).toString('base64')]; }
    if (item instanceof VectorType) {
      const values = (item as { toArray(): number[] }).toArray();
      if (values.length > 2048 || values.some(n => typeof n !== 'number')) return fail();
      consume(values.length * 24);
      return ['vector', values.map(numberCopy)];
    }
    if (!item || typeof item !== 'object' || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) || ancestors.has(item)) return fail();
    ancestors.add(item);
    const result = Array.isArray(item) ? ['array', item.map(child => copy(child, depth + 1))] :
      ['map', Object.keys(item).sort().map(k => { consume(Buffer.byteLength(k, 'utf8')); return [k, copy(item[k], depth + 1)]; })];
    ancestors.delete(item);
    return result;
  }
  const serialized = JSON.stringify(copy(value, 0));
  if (Buffer.byteLength(serialized, 'utf8') > 2_000_000) return fail();
  return createHash('sha256').update(serialized).digest('hex');
}
export function supportUid(request: any): string {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise.');
  if (request.data?.expectedUid !== request.auth.uid) throw new HttpsError('permission-denied', 'La session a changé.');
  return request.auth.uid;
}
/** Resolve the current Auth role, never a formerly issued client's claim. */
export async function supportCurrentAdminClaim(uid: string): Promise<boolean> {
  const user = await auth.getUser(uid);
  if (user.disabled) throw new HttpsError('permission-denied', 'Compte administratif indisponible.');
  return user.customClaims?.admin === true;
}
/** The ACTOR presents a session: qualify its native auth_time against the
 * current Auth cutoff. Target assignment checks intentionally use the helper
 * above, since no session is presented on behalf of the assigned account.
 * An absent cutoff does not invent a revocation date; malformed native dates
 * or session times never qualify an administrative reader/instruction. */
export async function supportCurrentAdminSession(request: any): Promise<boolean> {
  supportUid(request);
  return (await assertPrivateAccountSession(request)).currentAdminClaim;
}
export async function supportAdmin(tx: FirebaseFirestore.Transaction, uid: string, currentAdminClaim: boolean) {
  const privateUser = (await tx.get(db.collection('users').doc(uid))).data();
  if (privateUser && Object.prototype.hasOwnProperty.call(privateUser, 'isActive') && privateUser.isActive !== true ||
      privateUser && Object.prototype.hasOwnProperty.call(privateUser, 'isAdmin') && privateUser.isAdmin !== true ||
      (!currentAdminClaim && privateUser?.isAdmin !== true)) {
    throw new HttpsError('permission-denied', 'Accès administrateur requis.');
  }
}
export function supportVersion(data: any): number {
  if (!Number.isSafeInteger(data?.version) || data.version < 1) throw new HttpsError('failed-precondition', 'Dossier historique non qualifié.');
  return data.version;
}
export function supportRevision(snapshot: FirebaseFirestore.DocumentSnapshot): string | null {
  return snapshot.updateTime ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : null;
}
/** Exact native release receipt and its immutable explanation. Shared by the
 * owner reader and human-review intake; a row alone never proves a Troc effect. */
export async function readNativeSwapFundReleaseLog(tx: FirebaseFirestore.Transaction, uid: string, swapId: string) {
  const swapRef = db.collection('swaps').doc(swapId), swap = (await tx.get(swapRef)).data();
  if (!swap || swap.initiatorId !== uid && swap.receiverId !== uid) {
    throw new HttpsError('permission-denied', 'Cette lecture est réservée aux participants de l’échange.');
  }
  const base = {ok: true as const, protocol: 'swap_fund_release_log_v1' as const, ownerId: uid, swapId,
    sourceKind: 'swap' as const, coverage: 'recorded_entries_only' as const,
    absenceOfDecisionVerified: false as const, financialExecutionCoverageVerified: false as const, completeHistory: false as const};
  const noEntry = (journalState: 'not_recorded' | 'unqualified') => ({...base, journalState, entry: null});
  const receiptSnap = await tx.get(swapRef.collection('topup_release').doc('committed')), receipt = receiptSnap.data();
  if (!receiptSnap.exists) return noEntry('not_recorded');
  const nativeId = (value: unknown): value is string => typeof value === 'string' && !!value && !value.includes('/') &&
    value !== '.' && value !== '..' && Buffer.byteLength(value, 'utf8') <= 1500;
  const timestamp = (value: unknown): value is Timestamp => value instanceof Timestamp && value.toMillis() > 0 && value.toMillis() <= Date.now() + 60_000;
  if (!receipt || receipt.protocol !== 'swap_topup_release_v1' || receipt.swapId !== swapId ||
      receipt.initiatorId !== swap.initiatorId || receipt.receiverId !== swap.receiverId ||
      !nativeId(receipt.initiatorId) || !nativeId(receipt.receiverId) || receipt.initiatorId === receipt.receiverId ||
      ![receipt.initiatorId, receipt.receiverId].includes(receipt.payerId) ||
      ![receipt.initiatorId, receipt.receiverId].includes(receipt.payeeId) || receipt.payerId === receipt.payeeId ||
      !Number.isSafeInteger(receipt.amountCents) || receipt.amountCents <= 0 || receipt.currency !== 'CAD' ||
      !nativeId(receipt.creditLedgerId) || !nativeId(receipt.heldLedgerId) ||
      !timestamp(receipt.sourceVersion) || !timestamp(receipt.recordedAt) || receipt.sourceVersion.toMillis() > receipt.recordedAt.toMillis()) {
    return noEntry('unqualified');
  }
  // Old valid release receipts stay historical. No synthetic explanation or
  // today's deadline is attached to their already completed financial effect.
  if (!Object.prototype.hasOwnProperty.call(receipt, 'decisionId')) return noEntry('not_recorded');
  const identity = createHash('sha256').update(JSON.stringify([swapId, receipt.payeeId, receipt.amountCents,
    receipt.creditLedgerId, receipt.heldLedgerId, 'CAD'])).digest('hex');
  const decisionId = `swap_funds_released_${identity}`;
  if (receipt.decisionId !== decisionId || receipt.decisionProtocol !== 'swap_funds_released_v1' ||
      receipt.releaseLedgerId !== `swap_release_${identity}`) return noEntry('unqualified');
  const snapshot = await tx.get(db.collection('automatic_decisions_log').doc(decisionId)), data = snapshot.data(), criteria = data?.criteria;
  const isoMs = (value: unknown): number | null => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed >= 0 && new Date(parsed).toISOString() === value ? parsed : null;
  };
  const heldAt = isoMs(criteria?.heldAt), deadline = isoMs(criteria?.initialDeadlineAt), receptions = isoMs(criteria?.bothReceptionsAt);
  if (!data || !supportRevision(snapshot) || data.protocol !== 'swap_funds_released_v1' || data.sourceKind !== 'swap' ||
      data.transactionId !== null || data.swapId !== swapId || data.decisionType !== 'funds_released' || data.automated !== true ||
      data.userId !== receipt.payeeId || data.initiatorId !== receipt.initiatorId || data.receiverId !== receipt.receiverId ||
      data.buyerId !== null || data.sellerId !== null || !timestamp(data.executedAt) || !data.executedAt.isEqual(receipt.recordedAt) ||
      criteria?.status !== 'completed' || criteria.disputed !== false && criteria.disputed !== null ||
      criteria.releasedCents !== receipt.amountCents || criteria.currency !== 'CAD' ||
      criteria.swapSourceRevision !== `${receipt.sourceVersion.seconds}:${receipt.sourceVersion.nanoseconds}` ||
      heldAt === null || deadline === null || receptions === null || heldAt < receptions || deadline < heldAt || deadline > receipt.recordedAt.toMillis() ||
      data.result !== 'Libération interne du complément du Troc enregistrée après l’échéance de réclamation.') return noEntry('unqualified');
  let sourceHash: string;
  try { sourceHash = supportSourceHash(data); } catch { return noEntry('unqualified'); }
  return {...base, journalState: 'recorded' as const, entry: {
    id: snapshot.id, revision: supportRevision(snapshot)!, sourceHash,
    protocol: 'swap_funds_released_v1' as const, sourceKind: 'swap' as const, swapId, transactionId: null,
    decisionType: 'funds_released' as const,
    criteria: {status: 'completed' as const, disputed: criteria.disputed as false | null, heldAt: criteria.heldAt as string,
      initialDeadlineAt: criteria.initialDeadlineAt as string, bothReceptionsAt: criteria.bothReceptionsAt as string,
      releasedCents: receipt.amountCents as number, currency: 'CAD' as const, swapSourceRevision: criteria.swapSourceRevision as string},
    result: data.result as string, executedAt: data.executedAt.toDate().toISOString(),
    internalReleaseRecorded: true as const, externalPayoutVerified: false as const,
  }};
}

export function decisionView(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const data = snapshot.data();
  if (!data) return null;
  if (data.decisionType === 'admission_refused') return admissionDecisionView(snapshot);
  const view = { id: snapshot.id, revision: supportRevision(snapshot), sourceHash: supportSourceHash(data),
    transactionId: typeof data.transactionId === 'string' ? data.transactionId : null,
    decisionType: typeof data.decisionType === 'string' ? data.decisionType : null,
    criteria: canonical(data.criteria ?? {}), result: typeof data.result === 'string' ? data.result : '',
    executedAt: data.executedAt instanceof Timestamp ? data.executedAt.toDate().toISOString() : null,
    financialExecutionVerified: false };
  if (data.protocol !== 'purchase_automatic_refund_v1') return view;
  if (data.sourceKind !== 'purchase' || data.automated !== true || !['reservation', 'local_settlement'].includes(data.phase) ||
      !['transaction_expired', 'label_refund'].includes(data.decisionType) || typeof data.refundIntentId !== 'string' ||
      !data.refundIntentId || !(data.executedAt instanceof Timestamp) ||
      data.financialOutcome?.localSettlementRecorded !== (data.phase === 'local_settlement') ||
      data.financialOutcome?.refundState !== (data.phase === 'local_settlement' ? 'succeeded' : 'requested') ||
      data.financialOutcome?.bankArrivalVerified !== false) throw new HttpsError('failed-precondition', 'Journal automatique non qualifié.');
  const outcome = data.financialOutcome;
  return {...view, protocol: 'purchase_automatic_refund_v1', sourceKind: 'purchase', automated: true,
    phase: data.phase, refundIntentId: data.refundIntentId,
    financialOutcome: {refundState: outcome.refundState, providerStatus: outcome.providerStatus ?? null,
      cardAmountCents: outcome.cardAmountCents, walletAmountCents: outcome.walletAmountCents, sellerDebitCents: outcome.sellerDebitCents,
      reservedSellerCents: outcome.reservedSellerCents, localSettlementRecorded: outcome.localSettlementRecorded, bankArrivalVerified: false}};
}
/** Admission logs never become transaction-party records. Only this explicit
 * projection is transported; private criteria added to a source cannot leak. */
export function admissionDecisionView(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const data = snapshot.data();
  const publicationPolicy = data?.policyVersion === PUBLICATION_ELIGIBILITY_POLICY_VERSION;
  const publication = publicationPolicy && data?.scope === 'sell' &&
    ['createArticle', 'updateArticle', 'relistArticle'].includes(data?.operation);
  const reasons = ['age_missing', 'age_invalid', 'underage', 'activity_missing', 'activity_version_required', 'professional_declared',
    'review_required', 'account_closing', 'account_security_contained', 'account_unavailable', 'quebec_residence_declaration_required'];
  if (!data || data.protocol !== 'admission_refused_v1' || data.decisionType !== 'admission_refused' ||
      data.transactionId !== null || typeof data.ownerId !== 'string' || !data.ownerId || data.userId !== data.ownerId ||
      !['acceptMeetupOffer', 'proposeMultiSwap', 'acceptSwap', 'createArticle', 'updateArticle', 'relistArticle'].includes(data.operation) || !['buy', 'sell', 'swap'].includes(data.scope) ||
      (['proposeMultiSwap', 'acceptSwap'].includes(data.operation)) !== (data.scope === 'swap') ||
      ['createArticle', 'updateArticle', 'relistArticle'].includes(data.operation) && data.scope !== 'sell' || typeof data.policyVersion !== 'string' || !data.policyVersion ||
      !Array.isArray(data.reasons) || !data.reasons.length || data.reasons.length > reasons.length ||
      new Set(data.reasons).size !== data.reasons.length || data.reasons.some((reason: unknown) => !reasons.includes(reason as string)) ||
      !Array.isArray(data.messages) || data.messages.length !== data.reasons.length ||
      data.messages.some((message: unknown) => typeof message !== 'string' || !message || message.length > 1000) ||
      !(data.executedAt instanceof Timestamp) || data.executedAt.toMillis() < 1 || data.executedAt.toMillis() > Date.now() + 60_000 ||
      data.automated !== true || data.financialEffect !== 'none' || data.admissionGranted !== false ||
      !data.criteria || data.criteria.minimumAge !== 18 || data.criteria.ageSource !== 'declared_profile' || data.criteria.ageVerified !== false ||
      !['missing', 'invalid', 'under18', 'adult_declared'].includes(data.criteria.ageCondition) ||
      !['not_required', 'personal'].includes(data.criteria.activityRequirement) ||
      !['not_applied', 'quebec_owner_declaration'].includes(data.criteria.residenceRequirement) ||
      data.criteria.residenceVerified !== false || data.criteria.restrictionDetailsDisclosed !== false) {
    throw new HttpsError('failed-precondition', 'Source du refus automatique non qualifiée.');
  }
  const expectedMessages = data.reasons.map((reason: string) => reason === 'account_unavailable' ? 'Votre compte ne peut pas créer une nouvelle opération.'
    : reason === 'quebec_residence_declaration_required' ? 'Les nouveaux Trocs demandent une déclaration de résidence au Québec.'
      : ELIGIBILITY_REASON_MESSAGES[reason as EligibilityReason]);
  if (data.messages.some((message: string, index: number) => message !== expectedMessages[index])) {
    throw new HttpsError('failed-precondition', 'Critères du refus automatique non qualifiés.');
  }
  const ageReasons = data.reasons.filter((reason: string) => ['age_missing', 'age_invalid', 'underage'].includes(reason));
  const ageCondition = ageReasons[0] === 'age_missing' ? 'missing' : ageReasons[0] === 'age_invalid' ? 'invalid'
    : ageReasons[0] === 'underage' ? 'under18' : 'adult_declared';
  if (ageReasons.length > 1 || data.criteria.ageCondition !== ageCondition ||
      publicationPolicy && !publication ||
      data.criteria.activityRequirement !== (publication || data.scope === 'buy' ? 'not_required' : 'personal') ||
      publication && (data.criteria.sellerRestriction !== 'no_declared_professionals' ||
        data.reasons.some((reason: string) => ['activity_missing', 'activity_version_required'].includes(reason))) ||
      !publication && Object.prototype.hasOwnProperty.call(data.criteria, 'sellerRestriction') ||
      data.criteria.residenceRequirement !== (data.scope === 'swap' ? 'quebec_owner_declaration' : 'not_applied') ||
      data.scope === 'buy' && data.reasons.some((reason: string) => ['activity_missing', 'activity_version_required', 'professional_declared'].includes(reason)) ||
      data.scope !== 'swap' && data.reasons.includes('quebec_residence_declaration_required')) {
    throw new HttpsError('failed-precondition', 'Critères contradictoires du refus automatique.');
  }
  const context = data.sourceContext;
  let sourceContext: Record<string, unknown>;
  if (data.operation === 'acceptMeetupOffer' && context?.kind === 'meetup_offer' && /^[a-f0-9]{64}$/.test(context.offerSourceHash)) {
    sourceContext = { kind: 'meetup_offer', chatId: supportId(context.chatId), messageId: supportId(context.messageId),
      articleId: supportId(context.articleId), offerSourceHash: context.offerSourceHash };
  } else if (data.operation === 'proposeMultiSwap' && context?.kind === 'swap_proposal' && /^[a-f0-9]{64}$/.test(context.agreementSourceHash) &&
      Array.isArray(context.ownArticleIds) && context.ownArticleIds.length > 0 && context.ownArticleIds.length <= 20) {
    const ownArticleIds = context.ownArticleIds.map((value: unknown) => supportId(value));
    if (new Set(ownArticleIds).size !== ownArticleIds.length) throw new HttpsError('failed-precondition', 'Source du refus automatique non qualifiée.');
    sourceContext = { kind: 'swap_proposal', agreementSourceHash: context.agreementSourceHash, ownArticleIds };
  } else if (data.operation === 'acceptSwap' && context?.kind === 'swap' && /^[a-f0-9]{64}$/.test(context.agreementSourceHash)) {
    sourceContext = { kind: 'swap', swapId: supportId(context.swapId), agreementSourceHash: context.agreementSourceHash };
  } else if (data.operation === 'createArticle' && context?.kind === 'article_publication' &&
      typeof context.articleId === 'string' && /^[a-f0-9]{20}$/.test(context.articleId) &&
      typeof context.publicationRequestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(context.publicationRequestId) &&
      typeof context.inputHash === 'string' && /^[a-f0-9]{64}$/.test(context.inputHash) &&
      context.articleId === createHash('sha256').update(`${data.ownerId}:${context.publicationRequestId}`).digest('hex').slice(0, 20)) {
    sourceContext = { kind: 'article_publication', articleId: context.articleId,
      publicationRequestId: context.publicationRequestId, inputHash: context.inputHash };
  } else if (data.operation === 'updateArticle' && context?.kind === 'article_edit' &&
      typeof context.articleRevision === 'string' && /^[a-f0-9]{64}$/.test(context.articleRevision) &&
      typeof context.inputHash === 'string' && /^[a-f0-9]{64}$/.test(context.inputHash)) {
    sourceContext = { kind: 'article_edit', articleId: supportId(context.articleId),
      articleRevision: context.articleRevision, inputHash: context.inputHash };
  } else if (data.operation === 'relistArticle' && context?.kind === 'article_relist' &&
      typeof context.articleRevision === 'string' && /^[a-f0-9]{64}$/.test(context.articleRevision) &&
      typeof context.requestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(context.requestId) &&
      typeof context.inputHash === 'string' && /^[a-f0-9]{64}$/.test(context.inputHash)) {
    sourceContext = { kind: 'article_relist', articleId: supportId(context.articleId), articleRevision: context.articleRevision,
      requestId: context.requestId, inputHash: context.inputHash };
  } else throw new HttpsError('failed-precondition', 'Contexte du refus automatique non qualifié.');
  return { protocol: 'admission_refused_v1' as const, id: snapshot.id, revision: supportRevision(snapshot), sourceHash: supportSourceHash(data),
    transactionId: null, decisionType: 'admission_refused' as const, ownerId: data.ownerId, userId: data.userId,
    operation: data.operation, scope: data.scope, policyVersion: data.policyVersion, reasons: [...data.reasons], messages: [...data.messages],
    criteria: { minimumAge: 18, ageSource: 'declared_profile', ageVerified: false, ageCondition: data.criteria.ageCondition,
      activityRequirement: data.criteria.activityRequirement, residenceRequirement: data.criteria.residenceRequirement,
      ...(publication ? { sellerRestriction: data.criteria.sellerRestriction } : {}),
      residenceVerified: false, restrictionDetailsDisclosed: false }, sourceContext,
    result: 'Nouvel engagement refusé automatiquement. Les engagements et recours existants restent distincts.',
    executedAt: data.executedAt.toDate().toISOString(), automated: true, financialExecutionVerified: false,
    financialEffect: 'none', admissionGranted: false };
}
export function supportOwnerView(id: string, data: any, nowMs = Date.now(), lateTransport = false, returnToSender = false) {
  const civilNow = quebecCivilDate(new Date(nowMs));
  const overdue = !!data.statutoryDueDate && !!civilNow && civilNow > data.statutoryDueDate && !data.ownerResponse;
  return projectSupportConfidential({ protocol: 'support_request_v1' as const, id, ownerId: data.ownerId, kind: data.kind, status: data.status,
    version: supportVersion(data), narrative: data.narrative, receivedAt: new Date(data.receivedAtMs).toISOString(),
    receivedAtMs: data.receivedAtMs, receivedCivilDate: data.receivedCivilDate, statutoryDueDate: data.statutoryDueDate ?? null,
    recordedAt: new Date(data.recordedAtMs).toISOString(), clockOriginSupportRequestId: data.clockOriginSupportRequestId ?? id,
    deadlineBasis: 'application_initial_receipt', earliestExternalReceiptVerified: false,
    deadlineState: data.statutoryDueDate ? data.ownerResponse ? 'response_recorded' : overdue ? 'overdue' : 'pending' : 'not_applicable',
    silenceEffect: data.statutoryDueDate ? 'refusal_not_permission' : null,
    deadlineExtended: false, discoveredAt: data.discoveredAt ?? null, interruptionAt: data.interruptionAt ?? null,
    declaredDatesVerified: false, priorSupportRequestId: data.priorSupportRequestId ?? null, transactionId: data.transactionId ?? null,
    ...((ACCOUNT_SUPPORT_KINDS as readonly unknown[]).includes(data.kind) ? {
      relatedAccountIds: data.relatedAccountIds ?? [], representation: data.representation ?? null,
      relatedAccountsDeclaredOnly: true, relatedAccountExistenceVerified: false, accountRelationshipVerified: false,
      representationAuthorityVerified: false, otherAccountAccessGranted: false, paymentAuthorityGranted: false,
      ...(data.accountReview?.protocol === 'support_account_review_v2' ? {accountReview: supportAccountReviewOwnerView(data.accountReview)} : {}) } : {}),
    ...(data.kind === 'swap_hold_assistance' ? { swapId: supportId(data.swapId),
      swapHoldContext: supportSwapHoldContextView(data.swapHoldContext) } : {}),
    ...(data.kind === 'automated_decision_review' && data.decision?.protocol === 'swap_funds_released_v1' &&
      data.decision?.sourceKind === 'swap' ? {swapId: supportId(data.swapId)} : {}),
    ...(data.kind === 'withdrawal_timing_assistance' ? { withdrawalRequestId: supportId(data.withdrawalRequestId),
      withdrawalTimingContext: supportWithdrawalTimingContextView(data.withdrawalTimingContext) } : {}),
    decision: data.decision ?? null, meetupReason: data.meetupReason ?? null, evidence: data.evidence ?? [], ownerMessage: data.ownerMessage ?? null,
    ...(lateTransport ? { lateTransport: data.lateTransport == null ? null : supportLateTransportReference(data.lateTransport),
      transportInstruction: supportTransportInstructionView(data.transportInstruction) } : {}),
    ...(returnToSender ? { returnToSender: data.returnToSender == null ? null : supportReturnToSenderReference(data.returnToSender) } : {}),
    ownerResponse: data.ownerResponse ?? null, latestClarification: data.latestClarification ?? null,
    withdrawnAt: data.withdrawnAtMs ? new Date(data.withdrawnAtMs).toISOString() : null,
    updatedAt: new Date(data.updatedAtMs).toISOString(), financialEffect: 'none' as const,
    admissionVerified: false, accountRecoveryGranted: false, rightsRestored: false, humanExaminationVerified: false,
    responseCompletenessVerified: false, notificationDeliveryVerified: false }, data);
}
function supportSwapHoldContextView(value: any) {
  if (!value || value.protocol !== 'support_swap_hold_context_v1' || !['initiator', 'receiver'].includes(value.participantRole) ||
      typeof value.sourceRevision !== 'string' || !/^\d+:\d+$/.test(value.sourceRevision) ||
      typeof value.recordedAt !== 'string' || !Number.isSafeInteger(Date.parse(value.recordedAt)) ||
      value.declaredIssueSource !== 'owner_narrative' || value.financialExecutionVerified !== false ||
      value.holdReleased !== false || value.physicalReceiptVerified !== false) {
    throw new HttpsError('failed-precondition', 'Contexte natif de l’assistance Troc non qualifié.');
  }
  return { protocol: 'support_swap_hold_context_v1', swapId: supportId(value.swapId), participantRole: value.participantRole,
    sourceRevision: value.sourceRevision, recordedAt: value.recordedAt, declaredIssueSource: 'owner_narrative',
    financialExecutionVerified: false, holdReleased: false, physicalReceiptVerified: false };
}
/** A support reader examines the native hold; the mutator's private plan and
 * releaseReady flag never escape or become a permission from a human response. */
export async function readSupportSwapHoldSource(tx: FirebaseFirestore.Transaction, swapId: string, ownerId: string) {
  const snap = await tx.get(db.collection('swaps').doc(supportId(swapId))), data = snap.data();
  if (!data || data.initiatorId === data.receiverId || ![data.initiatorId, data.receiverId].includes(ownerId)) return null;
  const now = Timestamp.now(), qualified = await readSwapHoldSource(tx, snap.id, data, now);
  return { protocol: 'support_swap_hold_source_v1', swapId: snap.id, swapRevision: supportRevision(snap),
    swapSourceHash: supportSourceHash(data), observedAt: now.toDate().toISOString(), source: qualified.source,
    financialEffectAuthorized: false, holdReleaseAuthorized: false, physicalReceiptVerified: false };
}
function supportWithdrawalTimingContextView(value: any) {
  if (!value || value.protocol !== 'support_withdrawal_timing_context_v1' ||
      typeof value.sourceRevision !== 'string' || !/^\d+:\d+$/.test(value.sourceRevision) ||
      typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash) ||
      !['qualified', 'unknown'].includes(value.sourceQualification) || typeof value.recordedAt !== 'string' ||
      !Number.isSafeInteger(Date.parse(value.recordedAt)) || value.declaredIssueSource !== 'owner_narrative' ||
      value.bankReceiptVerified !== false || value.financialEffectAuthorized !== false) {
    throw new HttpsError('failed-precondition', 'Contexte de l’assistance retrait non qualifié.');
  }
  return { protocol: 'support_withdrawal_timing_context_v1', withdrawalRequestId: supportId(value.withdrawalRequestId),
    sourceRevision: value.sourceRevision, sourceHash: value.sourceHash, sourceQualification: value.sourceQualification,
    recordedAt: value.recordedAt, declaredIssueSource: 'owner_narrative', bankReceiptVerified: false, financialEffectAuthorized: false };
}
export async function readSupportWithdrawalTimingSource(tx: FirebaseFirestore.Transaction, withdrawalRequestId: string, ownerId: string) {
  return readWithdrawalTimingSource(tx, supportId(withdrawalRequestId), ownerId);
}
/** Older receipts remain immutable. Some were recorded while the account
 * extension mistakenly added its fields to every kind; transport only removes
 * those extension keys from OLD-kind snapshots, preserving every other value. */
export function supportOwnerSnapshotView(snapshot: any, lateTransport = false, returnToSender = false, currentSource: any = snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return snapshot;
  const view = { ...snapshot };
  if (!(ACCOUNT_SUPPORT_KINDS as readonly unknown[]).includes(snapshot.kind)) {
    for (const key of ['relatedAccountIds', 'representation', 'relatedAccountsDeclaredOnly', 'relatedAccountExistenceVerified',
      'accountRelationshipVerified', 'representationAuthorityVerified', 'otherAccountAccessGranted', 'paymentAuthorityGranted']) delete view[key];
  }
  if (!lateTransport) { delete view.lateTransport; delete view.transportInstruction; }
  if (!returnToSender) {
    delete view.returnToSender;
    if (view.transportInstruction?.source?.kind === 'return_to_sender_report') delete view.transportInstruction;
  }
  if (view.accountReview?.protocol === 'support_account_review_v2' && view.accountReview.finding !== 'representation_authority_confirmed') {
    view.accountReview = {...view.accountReview, obligations: []};
  }
  return projectSupportConfidential(view, currentSource);
}
export function supportAdminView(id: string, data: any, lateTransport = false, returnToSender = false) {
  return projectSupportConfidential({ ...supportOwnerView(id, data, Date.now(), lateTransport, returnToSender), assignedAdminId: data.assignedAdminId ?? null, internalNote: data.internalNote ?? null,
    ...((ACCOUNT_SUPPORT_KINDS as readonly unknown[]).includes(data.kind) ? { accountReview: supportAccountReviewAdminView(data.accountReview) } : {}) }, data);
}
/** Explicit private DTO: native closure evidence stays native in storage. */
export function supportAccountReviewAdminView(review: any) {
  if (review == null || review.protocol !== 'support_account_review_v2') return review ?? null;
  const basis = review.postClosureBasis;
  if (basis == null) return {...review, postClosureBasis: null};
  const event = basis.lateEvent;
  if (basis.protocol !== 'exceptional_post_closure_servicing_v1' || basis.qualified !== true || basis.authState !== 'native_user_absent' ||
      !isSupportAccountUid(basis.ownerId) || basis.ownerId !== review.subjectUid || !/^[a-f0-9]{64}$/.test(basis.creditHash ?? '') ||
      !(event?.recordedAt instanceof Timestamp) || event.recordedAt.toMillis() <= 0 || event.recordedAt.toMillis() > Date.now() ||
      !['stripe_bank_dispute', 'seconde_compensation'].includes(event.source)) {
    throw new HttpsError('failed-precondition', 'La base native du suivi après clôture doit être rapprochée.');
  }
  const lateEvent = event.source === 'stripe_bank_dispute'
    ? {source: event.source, transactionId: supportId(event.transactionId), disputeId: supportId(event.disputeId),
      kind: supportText(event.kind, 'Événement financier tardif', 128), recordedAt: event.recordedAt.toDate().toISOString()}
    : {source: event.source, caseId: supportId(event.caseId), recordedAt: event.recordedAt.toDate().toISOString()};
  if (event.source === 'stripe_bank_dispute' && !/^[a-f0-9]{64}$/.test(basis.orderHash ?? '') ||
      event.source === 'seconde_compensation' && !/^exception_[a-f0-9]{64}$/.test(event.caseId ?? '')) {
    throw new HttpsError('failed-precondition', 'Source native de crédit tardif non qualifiée.');
  }
  return {...review, postClosureBasis: {protocol: basis.protocol, qualified: true, authState: basis.authState,
    ownerId: basis.ownerId, lateEvent, creditHash: basis.creditHash,
    ...(event.source === 'stripe_bank_dispute' ? {orderHash: basis.orderHash} : {})}};
}
/** Communicated reasons only. Private evidence, source hashes, representative
 * identity documents and other accounts' facts never enter the owner DTO. */
export function supportAccountReviewOwnerView(review: any) {
  if (review?.protocol !== 'support_account_review_v2') return null;
  const confirmedRepresentation = review.finding === 'representation_authority_confirmed' && review.representationAuthorityVerified === true &&
    review.authorityScope === 'selected_existing_obligations_only' && review.identityDocumentsReviewed === true && review.authorityDocumentsReviewed === true;
  return {protocol: review.protocol, finding: review.finding, ownerMessage: review.ownerMessage,
    recourse: review.recourse, reviewDueAt: review.reviewDueAt, recordedAt: review.recordedAt,
    // An administrator's selection does not prove the reporter already knew
    // another account's obligation IDs. Do not reveal them on a refusal.
    obligations: confirmedRepresentation && Array.isArray(review.obligations)
      ? review.obligations.map((item: any) => ({kind: item.kind, id: item.id})) : [],
    humanReviewRecorded: true, otherAccountAccessGranted: false, paymentAuthorityGranted: false,
    providerRestrictionOverridden: false, accountsMerged: false, fundsMoved: false};
}
export function supportLateTransportReference(value: unknown) {
  const source = supportObject(value, ['kind', 'transactionId', 'incidentId', 'incidentRevision', 'incidentHash', 'financialSourceHash', 'orderRevision']);
  if (source.kind !== 'late_transport_incident' || !/^late_[a-f0-9]{64}$/.test(source.incidentId ?? '') ||
      !['incidentRevision', 'orderRevision'].every(key => typeof source[key] === 'string' && /^\d+:\d+$/.test(source[key])) ||
      !['incidentHash', 'financialSourceHash'].every(key => typeof source[key] === 'string' && /^[a-f0-9]{64}$/.test(source[key]))) {
    throw new HttpsError('invalid-argument', 'Référence exacte de l’incident et de la source financière requise.');
  }
  return { kind: 'late_transport_incident', transactionId: supportId(source.transactionId), incidentId: source.incidentId as string,
    incidentRevision: source.incidentRevision as string, incidentHash: source.incidentHash as string,
    financialSourceHash: source.financialSourceHash as string, orderRevision: source.orderRevision as string };
}
export function supportReturnToSenderReference(value: unknown) {
  const source = supportObject(value, ['kind', 'transactionId', 'caseId', 'caseRevision', 'caseHash', 'financialSourceHash', 'orderRevision']);
  if (source.kind !== 'return_to_sender_report' || !/^rts_[a-f0-9]{64}$/.test(source.caseId ?? '') ||
      !['caseRevision', 'orderRevision'].every(key => typeof source[key] === 'string' && /^\d+:\d+$/.test(source[key])) ||
      !['caseHash', 'financialSourceHash'].every(key => typeof source[key] === 'string' && /^[a-f0-9]{64}$/.test(source[key]))) {
    throw new HttpsError('invalid-argument', 'Référence exacte du signalement et des sources examinées requise.');
  }
  return { kind: 'return_to_sender_report', transactionId: supportId(source.transactionId), caseId: source.caseId as string,
    caseRevision: source.caseRevision as string, caseHash: source.caseHash as string,
    financialSourceHash: source.financialSourceHash as string, orderRevision: source.orderRevision as string };
}
/** Explicit owner allowlist: an instruction record certifies no physical act,
 * banking receipt, financial permission, or exhaustive human examination. */
export function supportTransportInstructionView(value: any) {
  if (value == null) return null;
  if (value.protocol !== 'support_transport_instruction_v1' || !['return', 'retain', 'regularisation_review'].includes(value.type) ||
      value.financialEffect !== 'none' || value.recipientReceiptVerified !== false || value.bankReceiptVerified !== false ||
      value.inventoryReleaseAuthorized !== false || value.humanExaminationVerified !== false ||
      typeof value.recordedAt !== 'string' || !Number.isSafeInteger(Date.parse(value.recordedAt)) ||
      Date.parse(value.recordedAt) < 0 || Date.parse(value.recordedAt) > Date.now()) {
    throw new HttpsError('failed-precondition', 'Instruction documentaire non qualifiée.');
  }
  return { protocol: value.protocol, type: value.type, reason: supportText(value.reason, 'Motivation'),
    ownerMessage: supportText(value.ownerMessage, 'Instruction communiquée'), source: value.source?.kind === 'return_to_sender_report'
      ? supportReturnToSenderReference(value.source) : supportLateTransportReference(value.source),
    recordedBy: supportAccountUid(value.recordedBy), recordedAt: value.recordedAt, requestId: supportRequestId(value.requestId),
    financialEffect: 'none', recipientReceiptVerified: false, bankReceiptVerified: false,
    inventoryReleaseAuthorized: false, humanExaminationVerified: false };
}
export function declaredSupportAccounts(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 5) throw new HttpsError('invalid-argument', 'Un à cinq identifiants de comptes déclarés requis.');
  const ids = value.map(item => {
    // Account UIDs are native identities, not presentation text. In particular
    // surrounding spaces and distinct Unicode sequences must not be adopted
    // as another account by supportId's text trimming.
    if (!isSupportAccountUid(item)) {
      throw new HttpsError('invalid-argument', 'Identifiant exact du compte déclaré invalide.');
    }
    return item;
  });
  if (new Set(ids).size !== ids.length) throw new HttpsError('invalid-argument', 'Compte déclaré en double.');
  return ids;
}
export function declaredSupportRepresentation(value: unknown) {
  const item = supportObject(value, ['reason', 'relationship', 'authorityStatement']);
  if (!['death', 'incapacity'].includes(item.reason)) throw new HttpsError('invalid-argument', 'Motif de représentation invalide.');
  return { reason: item.reason, relationship: supportText(item.relationship, 'Lien déclaré', 300),
    authorityStatement: supportText(item.authorityStatement, 'Qualité ou pouvoir déclaré', 2000),
    source: 'reporter_declaration', deathOrIncapacityVerified: false, authorityVerified: false };
}
/** Admin-only caller must establish current authority before invoking this.
 * Two private documents per declared account; no Auth lookup, bank, contracts,
 * identity search or comparison infers a relation from this native capture. */
export async function readSupportAccountSources(tx: FirebaseFirestore.Transaction, record: any) {
  if (!(ACCOUNT_SUPPORT_KINDS as readonly unknown[]).includes(record.kind)) return [];
  const ids = declaredSupportAccounts(record.relatedAccountIds);
  const docs = await tx.getAll(...ids.flatMap(id => [db.collection('users').doc(id), db.collection('eligibility_profiles').doc(id)]));
  return ids.map((declaredAccountId, index) => {
    const user = docs[index * 2], profile = docs[index * 2 + 1], userData = user.data() ?? null, profileData = profile.data() ?? null;
    const closure = profileData?.accountClosure;
    return { protocol: 'support_account_source_v1', declaredAccountId,
      userRevision: supportRevision(user), eligibilityRevision: supportRevision(profile),
      sourceHash: supportSourceHash({ declaredAccountId, user: userData, eligibility: profileData }),
      userDocumentState: user.exists ? 'present' : 'absent', eligibilityDocumentState: profile.exists ? 'present' : 'absent',
      activeFieldState: userData?.isActive === true ? 'active_recorded' : userData?.isActive === false ? 'inactive_recorded' : 'unknown',
      closureRecordState: !profile.exists ? 'source_absent' : closure == null ? 'absent' : closure?.schemaVersion === 1 ? 'recorded' : 'historical_unknown',
      accountExistenceVerified: false, accountRelationshipVerified: false, representationAuthorityVerified: false,
      restrictionCircumventionEstablished: false, otherAccountAccessGranted: false, paymentAuthorityGranted: false,
      sameNameOrBirthOrBankProvesRelationship: false };
  });
}
export function supportDueDate(kind: string, civilDate: string): string | null {
  // P-39.1 art. 32: initial server receipt date remains unchanged by clarification/withdrawal/linking.
  return ['personal_data_access', 'personal_data_correction'].includes(kind) ? civilDateAfterDays(civilDate, 30) : null;
}

export const SUPPORT_DEADLINE_QUEUE_OPERATION = 'deadline_queue';
const SUPPORT_DEADLINE_PAGE_SIZE = 30;
export type SupportDeadlineLane = 'dated' | 'unknown' | 'bank';
export type SupportDeadlineCursor = { protocol: 'support_deadline_cursor_v1'; actorId: string;
  lane: SupportDeadlineLane; id: string; statutoryDueDate: string | null };
const deadlineDocumentId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  Buffer.byteLength(value, 'utf8') <= 1500 && !value.includes('/') && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
export function supportDeadlineCursor(value: unknown, actorId: string, lane: SupportDeadlineLane): SupportDeadlineCursor | null {
  if (value == null) return null;
  const item = supportObject(value, ['protocol', 'actorId', 'lane', 'id', 'statutoryDueDate']);
  if (Object.keys(item).length !== 5 || item.protocol !== 'support_deadline_cursor_v1' || item.actorId !== actorId ||
      item.lane !== lane || !deadlineDocumentId(item.id) ||
      (lane !== 'dated' ? item.statutoryDueDate !== null : typeof item.statutoryDueDate !== 'string' ||
        item.statutoryDueDate < '0001-01-01' || item.statutoryDueDate > '9999-12-31' || item.statutoryDueDate.length > 1500)) {
    throw new HttpsError('invalid-argument', 'Curseur de suivi des échéances invalide.');
  }
  return item as SupportDeadlineCursor;
}
/** Metadata only: no narrative, private response, evidence or account source.
 * Missing or inconsistent native clocks remain unknown. A withdrawal is not a
 * response and never resets the original application's receipt clock. */
export function supportDeadlineItem(snapshot: FirebaseFirestore.DocumentSnapshot, nowMs = Date.now()) {
  const data = snapshot.data();
  if (!data || !['personal_data_access', 'personal_data_correction'].includes(data.kind)) return null;
  const receivedAtMs = Number.isSafeInteger(data.receivedAtMs) && data.receivedAtMs > 0 && data.receivedAtMs <= nowMs
    ? data.receivedAtMs as number : null;
  const receivedCivilDate = parseCivilIsoDate(data.receivedCivilDate) ? data.receivedCivilDate as string : null;
  const recordedDueDate = parseCivilIsoDate(data.statutoryDueDate) ? data.statutoryDueDate as string : null;
  const civilNow = quebecCivilDate(new Date(nowMs));
  const qualified = data.schemaVersion === 1 &&
    receivedAtMs !== null && receivedCivilDate !== null && civilNow !== null &&
    quebecCivilDate(new Date(receivedAtMs)) === receivedCivilDate && recordedDueDate !== null &&
    supportDueDate(data.kind, receivedCivilDate) === recordedDueDate;
  return { id: snapshot.id,
    kind: data.kind as 'personal_data_access' | 'personal_data_correction',
    status: ['submitted', 'needs_information', 'withdrawn', 'answered'].includes(data.status) ? data.status as string : null,
    version: Number.isSafeInteger(data.version) && data.version > 0 ? data.version as number : null,
    assignedAdminId: isSupportAccountUid(data.assignedAdminId) ? data.assignedAdminId : null,
    sourceRevision: supportRevision(snapshot),
    clock: { qualification: qualified ? 'native_application_receipt' as const : 'unknown' as const,
      receivedAt: receivedAtMs === null ? null : new Date(receivedAtMs).toISOString(), receivedCivilDate,
      statutoryDueDate: qualified ? recordedDueDate : null, recordedDueDate,
      state: qualified ? recordedDueDate! < civilNow! ? 'overdue' as const : recordedDueDate === civilNow ? 'due_today' as const : 'pending' as const : 'unknown' as const,
      reason: qualified ? null : 'native_clock_missing_or_incoherent' as const,
      clockOriginSupportRequestId: deadlineDocumentId(data.clockOriginSupportRequestId) ? data.clockOriginSupportRequestId : null,
      basis: 'application_initial_receipt' as const, earliestExternalReceiptVerified: false, deadlineExtended: false },
    responseRecorded: data.ownerResponse != null, responseCompletenessVerified: false };
}
/** An alert concerns the original native clock, never the latest ticket edit. */
type DeadlineAlertSource = {id: string; kind: string; clock: {state: string; qualification: string; receivedAt: string|null;
  receivedCivilDate: string|null; statutoryDueDate: string|null; recordedDueDate: string|null; providerDueAt?: string|null}};
export function supportDeadlineAlertId(item: DeadlineAlertSource) {
  if (item.clock.state === 'not_actionable' || item.clock.state === 'pending' && item.kind !== 'bank_dispute') return null;
  return 'deadline_' + supportHash({id: item.id, kind: item.kind, receivedAt: item.clock.receivedAt,
    receivedCivilDate: item.clock.receivedCivilDate, qualification: item.clock.qualification,
    statutoryDueDate: item.clock.statutoryDueDate, recordedDueDate: item.clock.recordedDueDate,
    providerDueAt: item.clock.providerDueAt ?? null, state: item.clock.state});
}
export function deadlineAlertView(item: DeadlineAlertSource, raw: any) {
  if (!raw) return null;
  if (raw.protocol !== 'support_deadline_alert_v1' || raw.alertId !== supportDeadlineAlertId(item) || raw.supportRequestId !== item.id ||
      raw.clockState !== item.clock.state || raw.clockQualification !== item.clock.qualification ||
      !Number.isSafeInteger(raw.firstObservedAtMs) || raw.firstObservedAtMs < 1 || raw.firstObservedAtMs > Date.now() ||
      !Number.isSafeInteger(raw.observedAtMs) || raw.observedAtMs < raw.firstObservedAtMs || raw.observedAtMs > Date.now() ||
      !raw.recipientScan || typeof raw.recipientScan.cycleId !== 'string' || !raw.recipientScan.cycleId ||
      typeof raw.recipientScan.completed !== 'boolean' || typeof raw.recipientScan.awaitingAdmin !== 'boolean' ||
      !Number.isSafeInteger(raw.recipientScan.noticesPrepared) || raw.recipientScan.noticesPrepared < 0 ||
      !Number.isSafeInteger(raw.recipientScan.inspected) || raw.recipientScan.inspected < raw.recipientScan.noticesPrepared) {
    throw new HttpsError('failed-precondition', 'Alerte native d’échéance à rapprocher.');
  }
  return {protocol: raw.protocol, alertId: raw.alertId, clockState: raw.clockState, clockQualification: raw.clockQualification,
    firstObservedAt: new Date(raw.firstObservedAtMs).toISOString(), observedAt: new Date(raw.observedAtMs).toISOString(),
    adminNoticeScanCompleted: raw.recipientScan.completed, awaitingAdmin: raw.recipientScan.awaitingAdmin === true, inAppNoticesPrepared: raw.recipientScan.noticesPrepared,
    deviceDeliveryVerified: false, readingVerified: false, responseCompletenessVerified: false, deadlineExtended: false};
}
/** A native ordered page, not a sort of the 30 most recent support requests.
 * The all-ID lane deliberately also sees absent ordering fields. Filtered or
 * empty pages still advance through their last INSPECTED source. */
export async function readSupportDeadlinePage(tx: FirebaseFirestore.Transaction, actorId: string,
  lane: SupportDeadlineLane, after: SupportDeadlineCursor | null, nowMs = Date.now()) {
  const collection = lane === 'bank' ? 'bank_dispute_cases' : SUPPORT_COLLECTION;
  let query: FirebaseFirestore.Query = db.collection(collection);
  if (lane === 'dated') {
    query = query.where('statutoryDueDate', '>=', '0001-01-01').where('statutoryDueDate', '<=', '9999-12-31')
      .orderBy('statutoryDueDate', 'asc').orderBy('__name__', 'asc');
    if (after) query = query.startAfter(after.statutoryDueDate, after.id);
  } else {
    query = query.orderBy('__name__', 'asc');
    if (after) query = query.startAfter(after.id);
  }
  const source = await tx.get(query.limit(SUPPORT_DEADLINE_PAGE_SIZE + 1));
  const rows = source.docs.slice(0, SUPPORT_DEADLINE_PAGE_SIZE), hasMore = source.size > SUPPORT_DEADLINE_PAGE_SIZE;
  const items = lane === 'bank' ? await Promise.all(rows.map(row => import('./supportBankDeadline').then(module => module.readSupportBankDeadlineItem(tx, row, nowMs))))
    : rows.map(row => supportDeadlineItem(row, nowMs)).filter((item): item is NonNullable<typeof item> => item !== null &&
      (lane === 'dated' ? item.clock.qualification === 'native_application_receipt' : item.clock.qualification === 'unknown'));
  const enriched = [];
  for (const item of items) {
    const alertId = supportDeadlineAlertId(item), alert = alertId
      ? (await tx.get(db.collection(collection).doc(item.id).collection('deadline_alerts').doc(alertId))).data() : null;
    enriched.push({...item, deadlineAlert: deadlineAlertView(item, alert)});
  }
  const last = rows.at(-1);
  return { protocol: 'support_deadline_queue_v1' as const, actorId, scope: 'admin' as const, operation: SUPPORT_DEADLINE_QUEUE_OPERATION,
    lane, observedAt: new Date(nowMs).toISOString(), civilDate: quebecCivilDate(new Date(nowMs)), items: enriched,
    page: { inspected: rows.length, returned: items.length, excluded: rows.length - items.length, limit: SUPPORT_DEADLINE_PAGE_SIZE,
      hasMore, cursor: hasMore && last ? { protocol: 'support_deadline_cursor_v1' as const, actorId, lane,
        id: last.id, statutoryDueDate: lane === 'dated' ? last.data().statutoryDueDate as string : null } : null,
      completeScan: after === null && !hasMore },
    coverage: { population: lane === 'bank' ? 'recorded_bank_dispute_cases' as const : lane === 'dated' ? 'all_privacy_requests_with_indexed_due_date' as const : 'all_support_documents' as const,
      order: lane === 'dated' ? 'statutoryDueDate_asc_id_asc' as const : 'id_asc' as const,
      globalCoverage: false, snapshotConsistentAcrossPages: false },
    financialEffect: 'none' as const, deadlineExtended: false, humanAvailabilityVerified: false };
}
export function supportDeclaredDate(value: unknown, nowMs: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value || Date.parse(value) > nowMs) {
    throw new HttpsError('invalid-argument', 'Date déclarée réelle, non future, au format ISO UTC requise.');
  }
  return value;
}
/** Read-only private capture. A native statement is neither an outside payment
 * nor physical presence/handover, bilateral consent or proof of fault. */
function meetupDeclarationView(transactionId: string, data: FirebaseFirestore.DocumentData, ownerId: string) {
  const partyIds = [data.buyerId, data.sellerId];
  const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/') ? value : null;
  let qualifiedAgreement = false;
  // The existing cash digest handles timestamps/plain data. Never pass it a
  // reference's SDK graph or an unsupported native class while qualifying it.
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  function cashDigestSupported(value: any, depth = 0): boolean {
    if (depth > 32 || ++nodes > 20_000) return false;
    if (value == null || ['string', 'boolean', 'number'].includes(typeof value) || value instanceof Timestamp) return true;
    if (typeof value !== 'object' || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) || ancestors.has(value)) return false;
    ancestors.add(value);
    const supported = (Array.isArray(value) ? value : Object.values(value)).every(child => cashDigestSupported(child, depth + 1));
    ancestors.delete(value);
    return supported;
  }
  if (cashDigestSupported(data.articleSnapshot) && cashDigestSupported(data.meetupSpot)) {
    try { qualifiedAgreement = qualifiedCashAgreement(transactionId, data); } catch { /* malformed native cash facts remain unknown */ }
  }
  const declarationTime = data.meetupCompletedAt instanceof Timestamp ? data.meetupCompletedAt : null;
  const declarationActor = partyIds.includes(data.meetupCompletedBy) ? id(data.meetupCompletedBy) : null;
  const notice = data.meetupCompletionNotice;
  const noticeMetadataQualified = notice?.protocol === 'meetup_phase_notice_v1' && notice.transactionId === transactionId &&
    notice.phase === 'completed' && !!declarationTime && !!declarationActor && notice.declaredBy === declarationActor;
  const originalAbsent = !Object.prototype.hasOwnProperty.call(data, 'meetupCompletedAt') &&
    !Object.prototype.hasOwnProperty.call(data, 'meetupCompletedBy') && !Object.prototype.hasOwnProperty.call(data, 'meetupCompletionNotice') && data.status !== 'meetup_completed';
  const phases: Record<string, string> = { meetup_pending: 'pending', meetup_confirmed: 'confirmed', meetup_completed: 'completion_declared',
    cancelled: 'cancelled', expired: 'expired', disputed: 'disputed' };
  return { protocol: 'meetup_declaration_evidence_v1', transactionId, articleId: id(data.articleId),
    ownerRole: data.buyerId === ownerId ? 'buyer' : 'seller', deliveryType: data.deliveryType === 'meetup' ? 'meetup' : 'historical_unknown',
    agreementQualification: qualifiedAgreement ? 'native_cash_agreement' : 'historical_unknown',
    agreementId: qualifiedAgreement ? data.cashAgreement.agreementId : null,
    phase: typeof data.status === 'string' && Object.prototype.hasOwnProperty.call(phases, data.status) ? phases[data.status] : 'historical_unknown',
    phaseSourceStatus: typeof data.status === 'string' && data.status.length <= 80 ? data.status : null,
    completionState: declarationTime && declarationActor ? 'recorded' : originalAbsent ? 'absent' : 'historical_unknown',
    completionDeclaredAt: declarationTime ? declarationTime.toDate().toISOString() : null,
    completionDeclaredBy: declarationActor, noticeState: noticeMetadataQualified ? 'native_metadata' : notice == null ? 'absent' : 'historical_unknown',
    notificationCommittedVerified: false, deviceDeliveryVerified: false, physicalPresenceVerified: false,
    physicalHandoverVerified: false, outsidePaymentVerified: false, mutualConsentVerified: false, faultEstablished: false,
    capturedAt: new Date().toISOString() };
}
/** References only, never object paths, download URLs, arbitrary uploads or identity documents. */
export async function qualifySupportEvidence(tx: FirebaseFirestore.Transaction, ownerId: string, values: unknown, expectedTransactionId: string | null = null) {
  if (values == null) return [];
  if (!Array.isArray(values) || values.length > 10) throw new HttpsError('invalid-argument', 'Dix références privées au maximum.');
  const refs: { kind: string; id: string; sourceHash: string; revision: string; meetupDeclaration?: ReturnType<typeof meetupDeclarationView> }[] = [];
  for (const value of values) {
    const item = supportObject(value, ['kind', 'id']), id = supportId(item.id);
    const collection = item.kind === 'commercial_dispute' ? 'disputes' : item.kind === 'eligibility_request' ? 'eligibility_requests' : item.kind === 'support_request' ? SUPPORT_COLLECTION : item.kind === 'meetup_declaration' ? 'transactions' : null;
    if (!collection) throw new HttpsError('invalid-argument', 'Référence privée non prise en charge.');
    const snap = await tx.get(db.collection(collection).doc(id)), data = snap.data();
    if (!data || (['disputes', 'transactions'].includes(collection) ? data.buyerId !== ownerId && data.sellerId !== ownerId : data.ownerId !== ownerId)) {
      throw new HttpsError('permission-denied', 'Référence privée non autorisée.');
    }
    if (collection === 'transactions' && (data.buyerId === data.sellerId ||
        typeof data.buyerId !== 'string' || !data.buyerId || typeof data.sellerId !== 'string' || !data.sellerId ||
        (data.deliveryType != null && data.deliveryType !== 'meetup'))) throw new HttpsError('permission-denied', 'Référence de rencontre non autorisée.');
    // For a typed meetup story, the context comes from the private source read
    // in this transaction, never an id submitted beside an unrelated proof.
    if (expectedTransactionId &&
        ((collection === 'transactions' && id !== expectedTransactionId) ||
         (['disputes', SUPPORT_COLLECTION].includes(collection) && data.transactionId !== expectedTransactionId))) {
      throw new HttpsError('permission-denied', 'Cette référence privée ne concerne pas la rencontre exacte.');
    }
    const revision = supportRevision(snap);
    if (!revision) throw new HttpsError('failed-precondition', 'Révision de preuve absente.');
    if (refs.some(ref => ref.kind === item.kind && ref.id === id)) throw new HttpsError('invalid-argument', 'Référence en double.');
    refs.push({ kind: item.kind, id, sourceHash: supportSourceHash(data), revision,
      ...(collection === 'transactions' ? { meetupDeclaration: meetupDeclarationView(id, data, ownerId) } : {}) });
  }
  return refs;
}
