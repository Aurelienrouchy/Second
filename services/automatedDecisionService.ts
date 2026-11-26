import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { AutomatedDecisionEntry, AutomatedDecisionLogPage, OwnerAdmissionDecision, OwnerAdmissionRefusalsPage, PurchaseAutomaticRefundDecision } from '@/types/automatedDecision';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const date = (v: unknown) => v === null || typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const opaqueId = (v: unknown): v is string => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 200 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const nativeRevision = (v: unknown) => {
  if (typeof v !== 'string' || !/^\d+:\d+$/.test(v)) return false;
  const [seconds, nanos] = v.split(':').map(Number);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 253402300799 && Number.isSafeInteger(nanos) && nanos >= 0 && nanos < 1_000_000_000;
};
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const reasons = ['age_missing', 'age_invalid', 'underage', 'activity_missing', 'activity_version_required', 'professional_declared',
  'review_required', 'account_closing', 'account_security_contained', 'account_unavailable', 'quebec_residence_declaration_required'];
/** Reservations and local settlements stay distinct; neither certifies arrival at the bank. */
export function isPurchaseAutomaticRefundDecision(v: unknown): v is PurchaseAutomaticRefundDecision {
  if (!object(v) || !exact(v, ['id', 'revision', 'sourceHash', 'transactionId', 'decisionType', 'criteria', 'result', 'executedAt',
    'financialExecutionVerified', 'protocol', 'sourceKind', 'automated', 'phase', 'refundIntentId', 'financialOutcome']) ||
    v.protocol !== 'purchase_automatic_refund_v1' || v.sourceKind !== 'purchase' || v.automated !== true ||
    !id(v.id) || !nativeRevision(v.revision) || !hash(v.sourceHash) || !id(v.transactionId) || !object(v.criteria) || typeof v.result !== 'string' ||
    v.financialExecutionVerified !== false || v.executedAt === null || !date(v.executedAt) ||
    !['reservation', 'local_settlement'].includes(String(v.phase)) || !id(v.refundIntentId) ||
    !['transaction_expired', 'label_refund'].includes(String(v.decisionType)) || !object(v.financialOutcome)) return false;
  const outcome = v.financialOutcome, settled = v.phase === 'local_settlement';
  const cents = (value: unknown) => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  return exact(outcome, ['refundState', 'providerStatus', 'cardAmountCents', 'walletAmountCents', 'sellerDebitCents', 'reservedSellerCents', 'localSettlementRecorded', 'bankArrivalVerified']) &&
    outcome.refundState === (settled ? 'succeeded' : 'requested') && outcome.localSettlementRecorded === settled && outcome.bankArrivalVerified === false &&
    (outcome.providerStatus === null || typeof outcome.providerStatus === 'string' && outcome.providerStatus.length > 0 && outcome.providerStatus.length <= 200) &&
    (!settled ? outcome.providerStatus === null : outcome.providerStatus === null || outcome.providerStatus === 'succeeded') &&
    ['cardAmountCents', 'walletAmountCents', 'sellerDebitCents'].every(field => cents(outcome[field])) &&
    typeof outcome.reservedSellerCents === 'number' && Number.isSafeInteger(outcome.reservedSellerCents) && outcome.reservedSellerCents >= 0 &&
    (!settled || outcome.reservedSellerCents === 0) && v.executedAt !== null && date(v.executedAt);
}
export function isAutomatedDecisionEntry(e: unknown, transactionId: string): e is AutomatedDecisionEntry {
  return object(e) && id(e.id) && typeof e.revision === 'string' && nativeRevision(e.revision) && hash(e.sourceHash) && e.transactionId === transactionId &&
    (e.decisionType === null || typeof e.decisionType === 'string') && object(e.criteria) && typeof e.result === 'string' &&
    date(e.executedAt) && e.financialExecutionVerified === false &&
    (e.protocol === undefined || e.protocol === 'purchase_automatic_refund_v1' && isPurchaseAutomaticRefundDecision(e));
}
export function purchaseAutomaticRefundExplanation(entry: unknown): string | null {
  if (!isPurchaseAutomaticRefundDecision(entry)) return null;
  return entry.phase === 'reservation' ? 'Demande de remboursement enregistrée : le règlement local n’est pas confirmé. Aucun crédit bancaire n’est attesté.'
    : 'Le règlement local du remboursement est enregistré. La réception bancaire demeure non attestée.';
}
/** The owner-only refusal projection contains no raw date of birth or private restriction notes. */
export function isOwnerAdmissionDecision(v: unknown, uid: string): v is OwnerAdmissionDecision {
  if (!object(v) || !exact(v, ['protocol', 'id', 'revision', 'sourceHash', 'transactionId', 'decisionType', 'ownerId', 'userId', 'operation', 'scope', 'policyVersion',
    'reasons', 'messages', 'criteria', 'sourceContext', 'result', 'executedAt', 'automated', 'financialExecutionVerified', 'financialEffect', 'admissionGranted']) ||
    v.protocol !== 'admission_refused_v1' || !opaqueId(v.id) || !(v.revision === null || nativeRevision(v.revision)) || !hash(v.sourceHash) || v.transactionId !== null ||
    v.decisionType !== 'admission_refused' || v.ownerId !== uid || v.userId !== uid || !['acceptMeetupOffer', 'proposeMultiSwap', 'acceptSwap', 'createArticle', 'updateArticle', 'relistArticle'].includes(String(v.operation)) ||
    !['buy', 'sell', 'swap'].includes(String(v.scope)) || (['createArticle', 'updateArticle', 'relistArticle'].includes(String(v.operation)) ? v.scope !== 'sell' : (v.operation !== 'acceptMeetupOffer') !== (v.scope === 'swap')) ||
    typeof v.policyVersion !== 'string' || !v.policyVersion || v.policyVersion.length > 200 ||
    !Array.isArray(v.reasons) || !v.reasons.length || v.reasons.length > reasons.length || new Set(v.reasons).size !== v.reasons.length || !v.reasons.every(r => reasons.includes(r)) ||
    !Array.isArray(v.messages) || v.messages.length !== v.reasons.length || !v.messages.every(m => typeof m === 'string' && !!m && m.length <= 1000) ||
    typeof v.result !== 'string' || !v.result || v.result.length > 4000 || v.executedAt === null || !date(v.executedAt) ||
    v.automated !== true || v.financialExecutionVerified !== false || v.financialEffect !== 'none' || v.admissionGranted !== false || !object(v.criteria) ||
    v.criteria.minimumAge !== 18 || v.criteria.ageSource !== 'declared_profile' || v.criteria.ageVerified !== false ||
    !['missing', 'invalid', 'under18', 'adult_declared'].includes(String(v.criteria.ageCondition)) ||
    v.criteria.residenceRequirement !== (v.scope === 'swap' ? 'quebec_owner_declaration' : 'not_applied') ||
    v.criteria.residenceVerified !== false || v.criteria.restrictionDetailsDisclosed !== false || !object(v.sourceContext)) return false;
  const criteriaKeys = ['minimumAge', 'ageSource', 'ageVerified', 'ageCondition', 'activityRequirement', 'residenceRequirement', 'residenceVerified', 'restrictionDetailsDisclosed'];
  const historicalCriteria = v.policyVersion !== '2026-10-26.v1' && exact(v.criteria, criteriaKeys) &&
    v.criteria.activityRequirement === (v.scope === 'buy' ? 'not_required' : 'personal');
  const listingCriteria = ['createArticle', 'updateArticle', 'relistArticle'].includes(String(v.operation)) && v.scope === 'sell' &&
    v.policyVersion === '2026-10-26.v1' && exact(v.criteria, [...criteriaKeys, 'sellerRestriction']) &&
    v.criteria.activityRequirement === 'not_required' && v.criteria.sellerRestriction === 'no_declared_professionals' &&
    !v.reasons.some(reason => ['activity_missing', 'activity_version_required', 'quebec_residence_declaration_required'].includes(String(reason)));
  if (!historicalCriteria && !listingCriteria) return false;
  const ageReasons = v.reasons.filter(reason => ['age_missing', 'age_invalid', 'underage'].includes(reason));
  if (ageReasons.length > 1 || v.criteria.ageCondition !== (ageReasons[0] === 'age_missing' ? 'missing' :
    ageReasons[0] === 'age_invalid' ? 'invalid' : ageReasons[0] === 'underage' ? 'under18' : 'adult_declared')) return false;
  const c = v.sourceContext;
  if (v.operation === 'acceptMeetupOffer') return exact(c, ['kind', 'chatId', 'messageId', 'articleId', 'offerSourceHash']) && c.kind === 'meetup_offer' &&
    opaqueId(c.chatId) && opaqueId(c.messageId) && opaqueId(c.articleId) && hash(c.offerSourceHash);
  if (v.operation === 'proposeMultiSwap') return exact(c, ['kind', 'agreementSourceHash', 'ownArticleIds']) && c.kind === 'swap_proposal' && hash(c.agreementSourceHash) &&
    Array.isArray(c.ownArticleIds) && c.ownArticleIds.length > 0 && c.ownArticleIds.length <= 20 && c.ownArticleIds.every(opaqueId) && new Set(c.ownArticleIds).size === c.ownArticleIds.length;
  if (v.operation === 'createArticle') return exact(c, ['kind', 'articleId', 'publicationRequestId', 'inputHash']) && c.kind === 'article_publication' &&
    typeof c.articleId === 'string' && /^[a-f0-9]{20}$/.test(c.articleId) && typeof c.publicationRequestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(c.publicationRequestId) && hash(c.inputHash);
  if (v.operation === 'updateArticle') return exact(c, ['kind', 'articleId', 'articleRevision', 'inputHash']) && c.kind === 'article_edit' &&
    opaqueId(c.articleId) && c.articleId.length <= 128 && hash(c.articleRevision) && hash(c.inputHash);
  if (v.operation === 'relistArticle') return exact(c, ['kind', 'articleId', 'articleRevision', 'requestId', 'inputHash']) && c.kind === 'article_relist' &&
    opaqueId(c.articleId) && c.articleId.length <= 128 && hash(c.articleRevision) && typeof c.requestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(c.requestId) && hash(c.inputHash);
  return exact(c, ['kind', 'swapId', 'agreementSourceHash']) && c.kind === 'swap' && opaqueId(c.swapId) && hash(c.agreementSourceHash);
}
export const AutomatedDecisionService = {
  async ownerRefusals(uid: string, selection: {decisionId?: string; cursor?: string}, assertContext: () => void): Promise<OwnerAdmissionRefusalsPage> {
    const session = captureTradeSession(uid); assertContext();
    if (selection.decisionId !== undefined && !opaqueId(selection.decisionId) || selection.cursor !== undefined && !opaqueId(selection.cursor) ||
      selection.decisionId !== undefined && selection.cursor !== undefined) throw new Error('Référence privée de refus inaccessible.');
    const result = await httpsCallable<unknown, unknown>(functions, 'getAutomatedDecisionLog')({expectedUid: uid, operation: 'owner_admission_refusals', ...selection});
    assertTradeSessionCurrent(session); assertContext(); const v = result.data;
    if (!object(v) || !exact(v, ['ok', 'protocol', 'ownerId', 'entries', 'hasMore', 'cursor', 'unknownEntries', 'inspectedCount', 'coverage',
      'absenceOfDecisionVerified', 'completeHistory', 'financialExecutionCoverageVerified', 'admissionGranted']) || v.ok !== true ||
      v.protocol !== 'owner_admission_refusals_v1' || v.ownerId !== uid || !Array.isArray(v.entries) || v.entries.length > 20 ||
      !v.entries.every(e => isOwnerAdmissionDecision(e, uid)) || new Set(v.entries.map(e => e.id)).size !== v.entries.length ||
      !Number.isSafeInteger(v.unknownEntries) || typeof v.unknownEntries !== 'number' || v.unknownEntries < 0 ||
      !Number.isSafeInteger(v.inspectedCount) || typeof v.inspectedCount !== 'number' || v.inspectedCount < 0 || v.inspectedCount > 20 ||
      v.entries.length + v.unknownEntries !== v.inspectedCount || typeof v.hasMore !== 'boolean' ||
      (v.hasMore ? !opaqueId(v.cursor) || v.inspectedCount !== 20 || v.cursor === selection.cursor : v.cursor !== null) ||
      selection.decisionId !== undefined && (v.hasMore || v.entries.length !== 1 || v.unknownEntries !== 0 || v.entries[0]?.id !== selection.decisionId) ||
      v.coverage !== 'recorded_entries_only' || v.absenceOfDecisionVerified !== false || v.completeHistory !== false ||
      v.financialExecutionCoverageVerified !== false || v.admissionGranted !== false) {
      throw new Error('Les sources de ces refus ne peuvent pas être confirmées. Aucune absence de décision n’est déduite.');
    }
    return v as unknown as OwnerAdmissionRefusalsPage;
  },
  async list(uid: string, transactionId: string, cursor: string | undefined, assertContext: () => void): Promise<AutomatedDecisionLogPage> {
    const session = captureTradeSession(uid); assertContext();
    if (!id(transactionId) || cursor !== undefined && !id(cursor)) throw new Error('Journal privé inaccessible.');
    const result = await httpsCallable<unknown, unknown>(functions, 'getAutomatedDecisionLog')({expectedUid: uid, transactionId, ...(cursor ? {cursor} : {})});
    assertTradeSessionCurrent(session); assertContext(); const v = result.data;
    if (!object(v) || v.ok !== true || v.protocol !== 'automated_decision_log_v1' || v.ownerId !== uid || v.transactionId !== transactionId ||
      !Array.isArray(v.entries) || v.entries.length > 50 || v.count !== v.entries.length || typeof v.hasMore !== 'boolean' ||
      (v.hasMore ? !id(v.cursor) || !object(v.entries.at(-1)) || v.entries.at(-1)?.id !== v.cursor : v.cursor !== null) ||
      v.coverage !== 'recorded_entries_only' || v.financialExecutionCoverageVerified !== false || v.absenceOfDecisionVerified !== false || v.completeHistory !== false ||
      !v.entries.every(e => isAutomatedDecisionEntry(e, transactionId)) || new Set(v.entries.map(e => object(e) ? e.id : null)).size !== v.entries.length) {
      throw new Error('Les sources exactes de ce journal ne peuvent pas être confirmées. Aucune absence de décision n’est déduite.');
    }
    return v as unknown as AutomatedDecisionLogPage;
  },
};
