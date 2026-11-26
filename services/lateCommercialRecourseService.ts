import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual, productReviewHash } from '@/services/productReviewService';
import { isCommercialClaimReviewReference } from '@/services/commercialClaimReviewService';
import { COMMERCIAL_CLAIM_REVIEW_CAPABILITY, type CommercialClaimReviewReference } from '@/types/commercialClaimReview';
import { LATE_COMMERCIAL_CAPABILITY, type LateCommercialLink, type LateCommercialReference,
  type LateCommercialLinkSource, type LateCommercialSupportView, type LateCommercialTopic, type LateCommercialFinancialSituation,
  type LateCommercialFinancialBasis, type LateCommercialPreview, type LateCommercialAttempt, type LateCommercialCommand,
  type LateCommercialReceipt, type LateCommercialEntry, type LateCommercialHistory, type LateCommercialNoticeReference,
  type CommercialClaimReexaminationPreview } from '@/types/lateCommercialRecourse';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && !!v && v.length <= 200 && v.trim() === v && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const nativeId = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(v);
const effects = ['financialEffectAuthorized', 'fundsRecovered', 'faultEstablished', 'defectVerified', 'legalDeadlineExtended', 'inventoryPermissionGranted'];
const noEffects = (v: Record<string, unknown>) => effects.every(key => v[key] === false);
const unknown = () => new Error('Les sources exactes de cette demande tardive doivent être relues. Aucun défaut, remboursement ou délai supplémentaire n’est confirmé.');
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const nullableDate = (v: unknown) => v === null || iso(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === 'string' && !!v && v.trim() === v && v.length <= 4000;
const decisions = ['admit_examination', 'retain_review', 'refuse_admission'];
const utf8Bytes = (v: string) => Array.from(v).reduce((n, c) => n + (c.codePointAt(0)! <= 0x7f ? 1 : c.codePointAt(0)! <= 0x7ff ? 2 : c.codePointAt(0)! <= 0xffff ? 3 : 4), 0);
const documentId = (v: unknown): v is string => typeof v === 'string' && !!v && utf8Bytes(v) <= 1500 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
export function isLateCommercialReference(v: unknown): v is LateCommercialReference {
  return record(v) && exact(v, ['capability', 'admissionId', 'contentHash']) && v.capability === LATE_COMMERCIAL_CAPABILITY && nativeId(v.admissionId, 'lc') && hash(v.contentHash);
}
export function isLateCommercialLink(v: unknown): v is LateCommercialLink {
  if (!record(v)) return false;
  const material = Object.hasOwn(v, 'materialCapability'), parcel = Object.hasOwn(v, 'parcelCapability');
  return exact(v, ['protocol', 'transactionId', 'caseId', 'topic', 'contributionId', 'contributionHash', 'sourceHash',
    ...(material ? ['materialCapability'] : []), ...(parcel ? ['parcelCapability'] : [])]) &&
    v.protocol === 'late_commercial_support_link_v1' && id(v.transactionId) && nativeId(v.caseId, 'pr') && nativeId(v.contributionId, 'pc') &&
    hash(v.contributionHash) && hash(v.sourceHash) && (v.topic === 'authenticity' || v.topic === 'nonconformity' && material) &&
    (!material || v.materialCapability === 'product_review_material_v1') && (!parcel || v.parcelCapability === 'product_review_parcel_v1');
}
export function isLateCommercialSupportView(v: unknown, transactionId: string | null): v is LateCommercialSupportView {
  return record(v) && exact(v, ['link', 'qualification', 'admissionGranted', 'financialEffectAuthorized']) && v.admissionGranted === false &&
    v.financialEffectAuthorized === false && (v.qualification === 'unknown' ? v.link === null : v.qualification === 'native_support_link' &&
      isLateCommercialLink(v.link) && v.link.transactionId === transactionId);
}
export function isLateCommercialFinancialSituation(v: unknown): v is LateCommercialFinancialSituation {
  return record(v) && exact(v, ['releaseQualification', 'releasedAt', 'releasedAmountCents', 'currency', 'amountBasis', 'currentHeldAmountCents',
    'currentAvailableAmountCents', 'withdrawalAttribution', 'bankReceiptVerified']) && nullableDate(v.releasedAt) &&
    (v.currency === 'CAD' || v.currency === null) && v.amountBasis === 'historical_release_movement' && v.currentHeldAmountCents === null &&
    v.currentAvailableAmountCents === null && v.withdrawalAttribution === 'unknown' && v.bankReceiptVerified === false &&
    (v.releaseQualification === 'native_release_movement' ? iso(v.releasedAt) && count(v.releasedAmountCents) && v.currency === 'CAD' :
      v.releaseQualification === 'unknown' && v.releasedAmountCents === null);
}
export function isLateCommercialFinancialBasis(v: unknown, expected: LateCommercialReference): v is LateCommercialFinancialBasis {
  return record(v) && exact(v, ['reference', 'sourceHash', 'initialReceivedAtMs', 'financialSituation']) && isLateCommercialReference(v.reference) &&
    productReviewEqual(v.reference, expected) && hash(v.sourceHash) && count(v.initialReceivedAtMs) && v.initialReceivedAtMs > 0 &&
    v.initialReceivedAtMs <= Date.now() && isLateCommercialFinancialSituation(v.financialSituation);
}
function command(v: unknown): v is LateCommercialCommand {
  return record(v) && exact(v, ['transactionId', 'supportRequestId', 'sourceHash', 'currentAdmission', 'decision', 'reason', 'partyMessage', 'acknowledged', ...('claimReexamination' in v ? ['claimReexamination'] : [])]) &&
    id(v.transactionId) && ('claimReexamination' in v ? v.supportRequestId === null && isCommercialClaimReviewReference(v.claimReexamination) : /^support_[a-f0-9]{64}$/.test(String(v.supportRequestId))) && hash(v.sourceHash) &&
    (v.currentAdmission === null || isLateCommercialReference(v.currentAdmission)) && decisions.includes(String(v.decision)) && text(v.reason) && text(v.partyMessage) && v.acknowledged === true;
}
export function isLateCommercialAttempt(v: unknown, uid: string): v is LateCommercialAttempt {
  return record(v) && exact(v, ['version', 'uid', 'requestId', 'command']) && v.version === 1 && v.uid === uid &&
    typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && command(v.command);
}
function entry(v: unknown, scope: 'own' | 'admin', claimReview = false): v is LateCommercialEntry {
  return record(v) && exact(v, ['reference', 'decision', 'partyMessage', ...(scope === 'admin' ? ['reason'] : []), 'supportRequestId', 'caseId',
    'topic', 'contributionReference', 'initialReceivedAt', 'recordedAt', 'historicalOnly', ...('claimReexamination' in v ? ['claimReexamination', 'originalDisputeId'] : []), ...effects]) && isLateCommercialReference(v.reference) &&
    decisions.includes(String(v.decision)) && text(v.partyMessage) && (scope !== 'admin' || text(v.reason)) && ('claimReexamination' in v ? claimReview && v.supportRequestId === null && isCommercialClaimReviewReference(v.claimReexamination) && nativeId(v.originalDisputeId, 'problem') : id(v.supportRequestId)) && nativeId(v.caseId, 'pr') &&
    ['authenticity', 'nonconformity'].includes(String(v.topic)) && record(v.contributionReference) && exact(v.contributionReference, ['id', 'contentHash']) &&
    nativeId(v.contributionReference.id, 'pc') && hash(v.contributionReference.contentHash) && iso(v.initialReceivedAt) && iso(v.recordedAt) &&
    Date.parse(v.initialReceivedAt) <= Date.parse(v.recordedAt) && v.historicalOnly === true && noEffects(v);
}
export function isLateCommercialNoticeReference(v: unknown): v is LateCommercialNoticeReference {
  return record(v) && exact(v, ['admissionId', 'contentHash', 'notificationId']) && nativeId(v.admissionId, 'lc') && hash(v.contentHash) && nativeId(v.notificationId, 'operational');
}
export const hasLateCommercialNotice = (v: unknown) => record(v) && ['lateCommercialCapability', 'lateCommercialAdmissionId', 'lateCommercialAdmissionHash'].some(key => Object.hasOwn(v, key));
/** A derived push ID is only a candidate; the server qualifies this UID's
 * permanent notice receipt before any navigation. Centre rows use their real ID. */
export async function lateCommercialNotificationContext(data: unknown, uid: string, assertCurrent: () => void, notificationId?: string) {
  assertCurrent();
  if (!record(data) || !hasLateCommercialNotice(data) || data.ownerId !== uid || data.lateCommercialCapability !== LATE_COMMERCIAL_CAPABILITY ||
    !id(data.transactionId) || data.contextKind !== 'order' || data.contextId !== data.transactionId || !nativeId(data.productReviewCaseId, 'pr') ||
    !nativeId(data.lateCommercialAdmissionId, 'lc') || !hash(data.lateCommercialAdmissionHash)) throw unknown();
  const expectedCase = `pr_${await productReviewHash(['order', data.transactionId])}`; assertCurrent();
  if (data.productReviewCaseId !== expectedCase) throw unknown();
  const candidateId = notificationId ?? `operational_${await productReviewHash([`late_commercial_recourse_v1:${data.lateCommercialAdmissionId}`, uid])}`; assertCurrent();
  const noticeReference = {admissionId: data.lateCommercialAdmissionId, contentHash: data.lateCommercialAdmissionHash, notificationId: candidateId};
  if (!isLateCommercialNoticeReference(noticeReference)) throw unknown();
  const page = await LateCommercialRecourseService.history(uid, data.transactionId, 'own', null, assertCurrent, noticeReference); assertCurrent();
  if (!page.notice || page.notice.entry.caseId !== expectedCase) throw unknown();
  return {transactionId: data.transactionId, noticeReference};
}
async function call(uid: string, payload: Record<string, unknown>, assertContext: () => void, privateRead = false): Promise<unknown> {
  const session = captureTradeSession(uid), assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
  assertCurrent();
  if (privateRead) {
    const user = auth.currentUser; if (!user || user.uid !== uid) throw unknown();
    const token = await user.getIdTokenResult(true); assertCurrent(); const now = Math.floor(Date.now() / 1000), time = token.claims.auth_time;
    if (auth.currentUser !== user || token.claims.admin !== true || typeof time !== 'number' || !Number.isSafeInteger(time) || time <= 0 || time > now || now - time > 300) throw new Error('Confirmez votre identité opérateur avant cette lecture privée.');
  }
  const result = await httpsCallable<unknown, unknown>(functions, 'reportTransactionProblem')({expectedUid: uid, capability: LATE_COMMERCIAL_CAPABILITY, ...payload});
  assertCurrent(); return result.data;
}
export const LateCommercialRecourseService = {
  async previewReexamination(uid: string, transactionId: string, reference: CommercialClaimReviewReference, assertCurrent: () => void): Promise<CommercialClaimReexaminationPreview> {
    if (!id(transactionId) || !isCommercialClaimReviewReference(reference)) throw unknown();
    const value = await call(uid, {mode: 'preview', transactionId, claimReviewCapability: COMMERCIAL_CLAIM_REVIEW_CAPABILITY, claimReexamination: reference}, assertCurrent, true);
    if (!record(value) || !exact(value, ['protocol', 'actorId', 'transactionId', 'originalDisputeId', 'claimReexamination', 'sourceHash', 'source', 'currentAdmission', 'currentAdmissionQualification', 'options', ...effects]) || value.protocol !== 'commercial_claim_reexamination_preview_v1' || value.actorId !== uid || value.transactionId !== transactionId || !nativeId(value.originalDisputeId, 'problem') || !isCommercialClaimReviewReference(value.claimReexamination) || !productReviewEqual(value.claimReexamination, reference) || !hash(value.sourceHash) || !noEffects(value) || !(value.currentAdmission === null || isLateCommercialReference(value.currentAdmission)) || !['unrecorded', 'native_admission', 'unknown'].includes(String(value.currentAdmissionQualification)) || (value.currentAdmissionQualification === 'unrecorded' ? value.currentAdmission !== null : value.currentAdmissionQualification === 'native_admission' && value.currentAdmission === null) || !Array.isArray(value.options) || value.options.some(option => !decisions.includes(String(option))) || new Set(value.options).size !== value.options.length || value.currentAdmissionQualification === 'unknown' && value.options.length > 0) throw unknown();
    const s = value.source;
    if (!record(s) || !exact(s, ['protocol', 'transactionId', 'claimId', 'buyerId', 'sellerId', 'claimRevision', 'claimHash', 'claimSnapshot', 'originClaim', 'reviewVersion', 'reviewHash', 'caseVersion', 'caseHash', 'membersHash', 'materialCapability', 'parcelCapability', 'orderSemanticHash', 'reexamination', 'withdrawal', 'link', 'ledgerCoverage', 'ledgerHash', 'ledgerHashBasis', 'financialSituation', 'initialReceivedAtMs']) || s.protocol !== 'commercial_claim_reexamination_basis_v1' || s.transactionId !== transactionId || s.claimId !== value.originalDisputeId || !id(s.buyerId) || !id(s.sellerId) || s.buyerId === s.sellerId || typeof s.claimRevision !== 'string' || !/^\d+:\d+$/.test(s.claimRevision) || !['claimHash', 'reviewHash', 'caseHash', 'membersHash', 'orderSemanticHash', 'ledgerHash'].every(key => hash(s[key])) || !record(s.claimSnapshot) || !record(s.originClaim) || !count(s.reviewVersion) || !(s.caseVersion === null || count(s.caseVersion)) || s.materialCapability !== 'product_review_material_v1' || s.parcelCapability !== 'product_review_parcel_v1' || !isCommercialClaimReviewReference(s.reexamination) || !productReviewEqual(s.reexamination, reference) || !isCommercialClaimReviewReference(s.withdrawal) || !isLateCommercialLink(s.link) || s.link.transactionId !== transactionId || s.link.materialCapability !== s.materialCapability || s.link.parcelCapability !== s.parcelCapability || !['bounded_complete', 'unknown'].includes(String(s.ledgerCoverage)) || s.ledgerHashBasis !== 'attributed_release_movements' || !isLateCommercialFinancialSituation(s.financialSituation) || !count(s.initialReceivedAtMs) || s.initialReceivedAtMs < 1 || s.initialReceivedAtMs > Date.now()) throw unknown();
    const caseId = `pr_${await productReviewHash(['order', transactionId])}`; assertCurrent(); if (s.link.caseId !== caseId) throw unknown();
    return value as unknown as CommercialClaimReexaminationPreview;
  },
  async source(uid: string, transactionId: string, contributionId: string, topic: LateCommercialTopic, assertCurrent: () => void,
    material = false, parcel = false): Promise<LateCommercialLinkSource> {
    if (!id(transactionId) || !nativeId(contributionId, 'pc') || topic === 'nonconformity' && !material) throw unknown();
    const expectedCase = `pr_${await productReviewHash(['order', transactionId])}`; assertCurrent();
    const v = await call(uid, {mode: 'source_observe', transactionId, contributionId, topic,
      ...(material ? {materialCapability: 'product_review_material_v1'} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {})}, assertCurrent);
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'link', 'newAdmissionAllowed', ...effects]) || v.protocol !== 'late_commercial_link_source_v1' ||
      v.actorId !== uid || !isLateCommercialLink(v.link) || v.link.transactionId !== transactionId || v.link.caseId !== expectedCase ||
      v.link.contributionId !== contributionId || v.link.topic !== topic || (v.link.materialCapability !== undefined) !== material ||
      (v.link.parcelCapability !== undefined) !== parcel || v.newAdmissionAllowed !== false || !noEffects(v)) throw unknown();
    return v as unknown as LateCommercialLinkSource;
  },
  async preview(uid: string, supportRequestId: string, assertCurrent: () => void): Promise<LateCommercialPreview> {
    if (!id(supportRequestId)) throw unknown();
    const v = await call(uid, {mode: 'preview', supportRequestId}, assertCurrent);
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'transactionId', 'supportRequestId', 'sourceHash', 'source', 'currentAdmission',
      'currentAdmissionQualification', 'ticket', 'contributionReferences', 'options', ...effects]) || v.protocol !== 'late_commercial_preview_v1' ||
      v.actorId !== uid || !id(v.transactionId) || v.supportRequestId !== supportRequestId || !hash(v.sourceHash) || !noEffects(v) ||
      !record(v.source) || !exact(v.source, ['protocol', 'transactionId', 'supportRequestId', 'buyerId', 'sellerId', 'ticketRevision', 'ticketSourceHash', 'ticketVersion',
        'initialReceivedAtMs', 'clockOriginSupportRequestId', 'discoveryDeclaredAt', 'link', 'caseVersion', 'caseHash', 'membersHash', 'ledgerCoverage',
        'ledgerHash', 'ledgerHashBasis', 'financialSituation', 'orderSemanticHash']) || v.source.protocol !== 'late_commercial_source_v1' ||
      v.source.transactionId !== v.transactionId || v.source.supportRequestId !== supportRequestId || !id(v.source.buyerId) || !id(v.source.sellerId) || v.source.buyerId === v.source.sellerId ||
      typeof v.source.ticketRevision !== 'string' || !/^\d+:\d+$/.test(v.source.ticketRevision) || !hash(v.source.ticketSourceHash) || !count(v.source.ticketVersion) || v.source.ticketVersion < 1 ||
      !count(v.source.initialReceivedAtMs) || v.source.initialReceivedAtMs < 1 || v.source.initialReceivedAtMs > Date.now() || !id(v.source.clockOriginSupportRequestId) ||
      !nullableDate(v.source.discoveryDeclaredAt) || !isLateCommercialLink(v.source.link) || v.source.link.transactionId !== v.transactionId ||
      !(v.source.caseVersion === null || count(v.source.caseVersion)) || !['caseHash', 'membersHash', 'ledgerHash', 'orderSemanticHash'].every(key => hash((v.source as Record<string, unknown>)[key])) ||
      !['bounded_complete', 'unknown'].includes(String(v.source.ledgerCoverage)) || v.source.ledgerHashBasis !== 'attributed_release_movements' ||
      !isLateCommercialFinancialSituation(v.source.financialSituation) || !(v.currentAdmission === null || isLateCommercialReference(v.currentAdmission)) ||
      !['unrecorded', 'native_admission', 'unknown'].includes(String(v.currentAdmissionQualification)) ||
      (v.currentAdmissionQualification === 'unrecorded' ? v.currentAdmission !== null : v.currentAdmissionQualification === 'native_admission' && v.currentAdmission === null) ||
      !record(v.ticket) || !exact(v.ticket, ['version', 'narrative', 'latestClarification', 'discoveredAt']) || v.ticket.version !== v.source.ticketVersion ||
      !text(v.ticket.narrative) || !(v.ticket.latestClarification === null || text(v.ticket.latestClarification)) || v.ticket.discoveredAt !== v.source.discoveryDeclaredAt ||
      !Array.isArray(v.contributionReferences) || v.contributionReferences.length > 100 || !v.contributionReferences.every(row => record(row) && exact(row, ['id', 'contentHash', 'qualification']) &&
        nativeId(row.id, 'pc') && (row.qualification === 'native_contribution' ? hash(row.contentHash) : row.qualification === 'unknown' && (row.contentHash === null || hash(row.contentHash)))) ||
      !Array.isArray(v.options) || v.options.some(option => !decisions.includes(String(option))) || new Set(v.options).size !== v.options.length ||
      v.currentAdmissionQualification === 'unknown' && v.options.length > 0) throw unknown();
    const source = v.source.link;
    if (source.caseId !== `pr_${await productReviewHash(['order', v.transactionId])}` || !v.contributionReferences.some(row =>
      record(row) && row.id === source.contributionId && row.contentHash === source.contributionHash && row.qualification === 'native_contribution')) throw unknown();
    assertCurrent(); return v as unknown as LateCommercialPreview;
  },
  async command(attempt: LateCommercialAttempt, action: 'execute' | 'observe' | 'neutralize', assertCurrent: () => void): Promise<LateCommercialReceipt> {
    if (!isLateCommercialAttempt(attempt, attempt.uid)) throw unknown();
    const payloadHash = await productReviewHash(attempt.command); assertCurrent();
    const v = await call(attempt.uid, {mode: 'command', requestId: attempt.requestId, action, command: attempt.command,
      ...(attempt.command.claimReexamination ? {claimReviewCapability: COMMERCIAL_CLAIM_REVIEW_CAPABILITY} : {})}, assertCurrent);
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'command', 'payloadHash', 'state', 'reason', 'reference', 'disputeId', 'recordedAt', ...effects]) ||
      v.protocol !== 'late_commercial_command_v1' || v.actorId !== attempt.uid || v.requestId !== attempt.requestId || !productReviewEqual(v.command, attempt.command) ||
      v.payloadHash !== payloadHash || !['unrecorded', 'committed', 'not_executed'].includes(String(v.state)) || !noEffects(v)) throw unknown();
    if (v.state === 'unrecorded' ? v.reason !== null || v.reference !== null || v.disputeId !== null || v.recordedAt !== null :
      !iso(v.recordedAt) || v.state === 'not_executed' && (!text(v.reason) || v.reference !== null || v.disputeId !== null) ||
      v.state === 'committed' && (v.reason !== null || !isLateCommercialReference(v.reference) ||
        (attempt.command.decision === 'admit_examination' ? !nativeId(v.disputeId, attempt.command.claimReexamination ? 'problem' : 'late') : v.disputeId !== null))) throw unknown();
    if (v.state === 'committed' && isLateCommercialReference(v.reference) && v.reference.admissionId !== `lc_${await productReviewHash([attempt.uid, attempt.requestId])}`) throw unknown();
    assertCurrent(); return v as unknown as LateCommercialReceipt;
  },
  async history(uid: string, transactionId: string, scope: 'own' | 'admin', cursor: {lastId: string} | null,
    assertCurrent: () => void, noticeReference?: LateCommercialNoticeReference, claimReview = false): Promise<LateCommercialHistory> {
    if (!id(transactionId) || cursor && !documentId(cursor.lastId) || noticeReference && (scope !== 'own' || !isLateCommercialNoticeReference(noticeReference))) throw unknown();
    const v = await call(uid, {mode: 'history_observe', transactionId, scope, ...(cursor ? {cursor} : {}), ...(noticeReference ? {noticeReference} : {}), ...(claimReview ? {claimReviewCapability: COMMERCIAL_CLAIM_REVIEW_CAPABILITY} : {})}, assertCurrent, claimReview && scope === 'admin');
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'scope', 'transactionId', 'items', 'nextCursor', 'coverage', ...(noticeReference ? ['notice'] : []), ...effects]) ||
      v.protocol !== 'late_commercial_history_v1' || v.actorId !== uid || v.scope !== scope || v.transactionId !== transactionId || !noEffects(v) ||
      !Array.isArray(v.items) || v.items.length > 20 || !v.items.every(row => record(row) && (row.qualification === 'native_admission' ? exact(row, ['qualification', 'entry']) && entry(row.entry, scope, claimReview) :
        row.qualification === 'unknown' && exact(row, ['qualification', 'entryId', 'entry']) && documentId(row.entryId) && row.entry === null)) ||
      !(v.nextCursor === null || record(v.nextCursor) && exact(v.nextCursor, ['lastId']) && documentId(v.nextCursor.lastId)) ||
      !record(v.coverage) || !exact(v.coverage, ['inspected', 'limit', 'hasMore', 'exhaustiveHistoryVerified']) || !count(v.coverage.inspected) || v.coverage.inspected > 20 || v.coverage.inspected < v.items.length ||
      v.coverage.limit !== 20 || typeof v.coverage.hasMore !== 'boolean' || v.coverage.hasMore !== (v.nextCursor !== null) || v.coverage.exhaustiveHistoryVerified !== false) throw unknown();
    const rows = v.items as LateCommercialHistory['items'], ids = rows.map(row => row.qualification === 'native_admission' ? row.entry.reference.admissionId : row.entryId);
    if (new Set(ids).size !== ids.length || ids.some((value, index) => index > 0 && value <= ids[index - 1] || !!cursor && value <= cursor.lastId) ||
      record(v.nextCursor) && (v.coverage.inspected !== 20 || cursor && String(v.nextCursor.lastId) <= cursor.lastId || ids.some(id => id > String((v.nextCursor as Record<string, unknown>).lastId)))) throw unknown();
    if (noticeReference && (!record(v.notice) || !exact(v.notice, ['qualification', 'notificationId', 'entry']) || v.notice.qualification !== 'native_owner_notice' ||
      v.notice.notificationId !== noticeReference.notificationId || !entry(v.notice.entry, 'own') || v.notice.entry.reference.admissionId !== noticeReference.admissionId ||
      v.notice.entry.reference.contentHash !== noticeReference.contentHash)) throw unknown();
    assertCurrent(); return v as unknown as LateCommercialHistory;
  },
};
