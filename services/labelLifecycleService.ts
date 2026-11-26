import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewDocumentId, productReviewEqual, productReviewHash } from '@/services/productReviewService';
import type { LabelLifecycleAction, LabelLifecycleAttempt, LabelLifecycleCommand, LabelLifecycleContext, LabelLifecycleCursor,
  LabelLifecycleEntry, LabelLifecycleHistory, LabelLifecycleObservation, LabelLifecyclePreview, LabelLifecycleQueue, LabelLifecycleReceipt,
  LabelLifecycleReplacement, LabelLifecycleScope, LabelLifecycleSource, LabelProviderObservation, LabelLifecycleNoticeReference, LabelLifecycleNotificationContext } from '@/types/labelLifecycle';

export const LABEL_LIFECYCLE_ACTIONS: readonly LabelLifecycleAction[] = ['request_review', 'stop_use', 'maintain_review', 'observe_provider', 'void_label', 'replacement_quote', 'accept_replacement', 'purchase_replacement', 'adopt_replacement'];
export const LABEL_LIFECYCLE_ADMIN_ACTIONS: readonly LabelLifecycleAction[] = ['maintain_review', 'stop_use', 'observe_provider', 'void_label', 'replacement_quote', 'purchase_replacement', 'adopt_replacement'];
export const LABEL_LIFECYCLE_OWN_ACTIONS: readonly LabelLifecycleAction[] = ['request_review', 'stop_use', 'observe_provider', 'accept_replacement'];
export function labelLifecycleActionAvailable(preview: LabelLifecyclePreview, action: LabelLifecycleAction): boolean {
  const keys = {request_review: 'canRequestReviewNow', stop_use: 'canStopUseNow', maintain_review: 'canMaintainReviewNow', observe_provider: 'canObserveProviderNow', void_label: 'canPrepareVoidCommandNow', replacement_quote: 'canPrepareReplacementQuoteNow', accept_replacement: 'canAcceptReplacementNow', purchase_replacement: 'canPreparePurchaseCommandNow', adopt_replacement: 'canPrepareAdoptionCommandNow'} as const;
  return preview.options.includes(action) && preview.actionAvailability[keys[action]] === true;
}
const EFFECTS = ['shippingPermissionGranted', 'inventoryReleaseAuthorized', 'buyerFinancialEffectAuthorized', 'carrierRefundSettled', 'carrierPossessionVerified', 'interceptionGuaranteed'] as const;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const none = (v: Record<string, unknown>) => EFFECTS.every(k => v[k] === false);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const nativeId = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(v);
const text = (v: unknown, max = 4000): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const canonicalText = (v: unknown, max = 4000): v is string => text(v, max) && v === v.trim();
const nullableText = (v: unknown, max = 4000) => v === null || typeof v === 'string' && v.length <= max;
const count = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const ms = (v: unknown): v is number => count(v, Date.now());
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v && Date.parse(v) <= Date.now();
const revision = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}:\d{1,9}$/.test(v) && Number.isSafeInteger(Number(v.split(':')[0])) && Number(v.split(':')[0]) <= 253402300799 && Number(v.split(':')[1]) < 1_000_000_000;
const providerId = (v: unknown): v is string => typeof v === 'string' && /^se-[a-zA-Z0-9-]+$/.test(v);
const failure = () => new Error('Le suivi de cette étiquette doit être relu. Le document, le transport et les règlements restent distincts.');
export const isLabelLifecycleContext = (v: unknown): v is LabelLifecycleContext => object(v) && exact(v, ['transactionId', 'leg']) && canonicalText(v.transactionId, 128) && productReviewDocumentId(v.transactionId) && ['forward', 'return'].includes(String(v.leg));
function reference(v: unknown) {return object(v) && exact(v, ['id', 'contentHash']) && nativeId(v.id, 'le') && hash(v.contentHash);}
function command(v: unknown, c: LabelLifecycleContext): v is LabelLifecycleCommand {
  if (!object(v) || !exact(v, ['transactionId', 'leg', 'scope', 'sourceHash', 'sourceRevision', 'caseVersion', 'action', 'message', 'privateNote', 'quoteReference', 'platformAuthorization', 'acknowledged']) || !productReviewEqual({transactionId: v.transactionId, leg: v.leg}, c) || !['own', 'admin'].includes(String(v.scope)) || !hash(v.sourceHash) || !revision(v.sourceRevision) || !count(v.caseVersion) || !(v.scope === 'admin' ? LABEL_LIFECYCLE_ADMIN_ACTIONS : LABEL_LIFECYCLE_OWN_ACTIONS).includes(v.action as LabelLifecycleAction) || !canonicalText(v.message) || v.acknowledged !== true) return false;
  const action = v.action as LabelLifecycleAction;
  if (v.scope === 'admin' ? !canonicalText(v.privateNote) : v.privateNote !== null) return false;
  if (['accept_replacement', 'purchase_replacement', 'adopt_replacement'].includes(action) ? !reference(v.quoteReference) : v.quoteReference !== null) return false;
  if (!['purchase_replacement', 'adopt_replacement'].includes(action)) return v.platformAuthorization === null;
  const p = v.platformAuthorization;
  return object(p) && exact(p, ['approved', 'payer', 'currency', 'amountCents', 'authorityReference', 'cause']) && p.approved === true && p.payer === 'platform' && p.currency === 'CAD' && count(p.amountCents) && canonicalText(p.authorityReference, 1000) && canonicalText(p.cause, 2000);
}
export function isLabelLifecycleAttempt(v: unknown, uid: string): v is LabelLifecycleAttempt {
  return object(v) && exact(v, ['version', 'uid', 'requestId', 'context', 'command']) && v.version === 1 && v.uid === uid && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && isLabelLifecycleContext(v.context) && command(v.command, v.context);
}
function identity(v: unknown, c: LabelLifecycleContext) {
  return object(v) && exact(v, ['labelId', 'direction', 'shipmentId', 'carrierId', 'carrierCode', 'serviceCode', 'rateId', 'trackingNumber', 'outboundLabelId', 'providerCreatedAtMs']) && v.direction === c.leg && ['labelId', 'shipmentId', 'carrierId', 'rateId'].every(k => providerId(v[k])) && typeof v.carrierCode === 'string' && /^[a-z0-9_-]{1,100}$/.test(v.carrierCode) && typeof v.serviceCode === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v.serviceCode) && (v.trackingNumber === null || text(v.trackingNumber, 200)) && (c.leg === 'return' ? providerId(v.outboundLabelId) : v.outboundLabelId === null) && (v.providerCreatedAtMs === null || ms(v.providerCreatedAtMs));
}
async function source(v: unknown, c: LabelLifecycleContext): Promise<boolean> {
  if (!object(v) || !exact(v, ['protocol', 'transactionId', 'leg', 'caseId', 'sourceHash', 'sourceRevision', 'semanticSourceHash', 'caseVersion', 'qualification', 'identity', 'reconciliation', 'routeSourceHash', 'purchasePolicyHash', 'stopUse', 'latestInstructionId', 'currentLabelId', ...EFFECTS]) || v.protocol !== 'label_lifecycle_source_v1' || v.transactionId !== c.transactionId || v.leg !== c.leg || v.caseId !== `ll_${await productReviewHash([c.transactionId, c.leg])}` || !hash(v.sourceHash) || !hash(v.semanticSourceHash) || !revision(v.sourceRevision) || !(v.caseVersion === null || count(v.caseVersion)) || !['native_saved_label', 'native_purchase_reconciliation', 'unknown'].includes(String(v.qualification)) || !none(v)) return false;
  if (v.qualification === 'unknown' ? v.identity !== null : !identity(v.identity, c)) return false;
  const r = v.reconciliation;
  return object(r) && exact(r, ['labelPurchaseRequired', 'returnRequired', 'purchaseState']) && typeof r.labelPurchaseRequired === 'boolean' && typeof r.returnRequired === 'boolean' && nullableText(r.purchaseState, 300) && (v.routeSourceHash === null || hash(v.routeSourceHash)) && (v.purchasePolicyHash === null || hash(v.purchasePolicyHash)) && typeof v.stopUse === 'boolean' && (v.latestInstructionId === null || nativeId(v.latestInstructionId, 'le')) && (v.currentLabelId === null || providerId(v.currentLabelId)) && (v.identity === null || object(v.identity) && v.currentLabelId === v.identity.labelId);
}
function replacement(v: unknown, s: LabelLifecycleSource): v is LabelLifecycleReplacement {
  if (!object(v) || !exact(v, ['qualification', 'quote', 'bothParticipantsAccepted', 'platformFundingGuaranteed']) || v.platformFundingGuaranteed !== false || typeof v.bothParticipantsAccepted !== 'boolean') return false;
  if (v.qualification === 'unknown') return v.quote === null && !v.bothParticipantsAccepted;
  const q = v.quote;
  return v.qualification === 'native_current_quote' && object(q) && exact(q, ['id', 'contentHash', 'costCents', 'currency', 'rateId', 'shipmentId', 'routeSourceHash', 'purchasePolicyHash', 'oldLabelId', 'originalBuyerTotalCents', 'additionalBuyerChargeCents', 'platformAuthorizationRequired', 'platformFundingGuaranteed']) && nativeId(q.id, 'le') && hash(q.contentHash) && count(q.costCents) && q.currency === 'CAD' && providerId(q.rateId) && providerId(q.shipmentId) && hash(q.routeSourceHash) && q.routeSourceHash === s.routeSourceHash && hash(q.purchasePolicyHash) && q.purchasePolicyHash === s.purchasePolicyHash && providerId(q.oldLabelId) && q.oldLabelId === s.currentLabelId && count(q.originalBuyerTotalCents) && q.additionalBuyerChargeCents === 0 && q.platformAuthorizationRequired === true && q.platformFundingGuaranteed === false;
}
function currentUse(v: unknown) {
  if (!object(v) || !exact(v, ['qualification', 'canUseCurrentLabelNow', 'documentCurrentlyAvailable', 'nativeGuardsAllowUse', 'providerCurrentAvailability', 'lastRecordedDocumentObservation']) || !['unknown', 'blocked', 'native_current_sources'].includes(String(v.qualification)) || v.canUseCurrentLabelNow !== false || v.documentCurrentlyAvailable !== false || typeof v.nativeGuardsAllowUse !== 'boolean' || v.providerCurrentAvailability !== 'unknown' || v.nativeGuardsAllowUse !== (v.qualification === 'native_current_sources')) return false;
  const recorded = v.lastRecordedDocumentObservation;
  if (v.qualification === 'unknown') return recorded === null;
  return object(recorded) && exact(recorded, ['entryId', 'contentHash', 'labelId', 'observedAt', 'documentState', 'providerVoided']) && nativeId(recorded.entryId, 'le') && hash(recorded.contentHash) && providerId(recorded.labelId) && iso(recorded.observedAt) && recorded.documentState === 'available' && recorded.providerVoided === false;
}
function currentInstruction(v: unknown, scope: LabelLifecycleScope, s: LabelLifecycleSource) {
  if (!object(v) || !exact(v, ['qualification', 'instruction']) || !['unrecorded', 'unknown', 'native_current_instruction', 'historical_sources_changed'].includes(String(v.qualification))) return false;
  if (v.qualification === 'unrecorded' || v.qualification === 'unknown') return v.instruction === null;
  const i = v.instruction;
  return object(i) && exact(i, ['protocol', 'entryId', 'contentHash', 'action', 'scopeAtRecording', 'message', 'privateNote', 'recordedAt', 'appliesToCurrentSources', ...EFFECTS]) && i.protocol === 'label_lifecycle_current_instruction_v1' && nativeId(i.entryId, 'le') && i.entryId === s.latestInstructionId && hash(i.contentHash) && ['stop_use', 'maintain_review', 'void_label', 'adopt_replacement'].includes(String(i.action)) && ['own', 'admin'].includes(String(i.scopeAtRecording)) && text(i.message) && (scope === 'own' ? i.privateNote === null : i.scopeAtRecording === 'admin' ? text(i.privateNote) : i.privateNote === null) && iso(i.recordedAt) && i.appliesToCurrentSources === (v.qualification === 'native_current_instruction') && none(i);
}
function availability(v: unknown, scope: LabelLifecycleScope, r: LabelLifecycleReplacement) {
  const booleans = ['canRequestReviewNow', 'canStopUseNow', 'canMaintainReviewNow', 'canObserveProviderNow', 'canPrepareVoidCommandNow', 'canPrepareReplacementQuoteNow', 'canAcceptReplacementNow', 'canPreparePurchaseCommandNow', 'canPrepareAdoptionCommandNow', 'recentReauthenticationRequiredForProviderEffect', 'pendingProviderOperationRequiresReconciliation'];
  if (!object(v) || !exact(v, ['protocol', 'preparationOnly', ...booleans, 'platformCostCentsForPurchase', 'platformCostCentsForAdoption', 'platformAuthorizationStillRequired', 'providerApprovalGuaranteed', ...EFFECTS]) || v.protocol !== 'label_lifecycle_action_availability_v1' || v.preparationOnly !== true || !booleans.every(k => typeof v[k] === 'boolean') || ![v.platformCostCentsForPurchase, v.platformCostCentsForAdoption].every(c => c === null || count(c)) || v.platformAuthorizationStillRequired !== true || v.providerApprovalGuaranteed !== false || !none(v)) return false;
  if (scope === 'admin' ? v.canAcceptReplacementNow || v.canRequestReviewNow : ['canMaintainReviewNow', 'canPrepareVoidCommandNow', 'canPrepareReplacementQuoteNow', 'canPreparePurchaseCommandNow', 'canPrepareAdoptionCommandNow', 'recentReauthenticationRequiredForProviderEffect'].some(k => v[k])) return false;
  return (!v.canAcceptReplacementNow || r.qualification === 'native_current_quote') && (!v.canPreparePurchaseCommandNow || r.quote && r.bothParticipantsAccepted && v.platformCostCentsForPurchase === r.quote.costCents) && (!v.canPrepareAdoptionCommandNow || r.quote && r.bothParticipantsAccepted && count(v.platformCostCentsForAdoption));
}
function noticeReference(v: unknown): v is LabelLifecycleNoticeReference {return object(v) && exact(v, ['entryId', 'noticeState']) && nativeId(v.entryId, 'le') && ['intent_reserved', 'entry_recorded'].includes(String(v.noticeState));}
function notice(v: unknown, expected: LabelLifecycleNoticeReference | null) {
  if (expected === null) return v === null;
  if (!object(v) || !exact(v, ['entryId', 'noticeState', 'qualification', 'entry', 'currentInstructionVerified', ...EFFECTS]) || v.entryId !== expected.entryId || v.noticeState !== expected.noticeState || !['native_entry_recorded', 'native_intent_reserved', 'unknown'].includes(String(v.qualification)) || v.currentInstructionVerified !== false || !none(v)) return false;
  return v.qualification === 'unknown' ? v.entry === null : object(v.entry) && exact(v.entry, ['action', 'message', 'recordedAt']) && LABEL_LIFECYCLE_ACTIONS.includes(v.entry.action as LabelLifecycleAction) && text(v.entry.message) && iso(v.entry.recordedAt);
}
function provider(v: unknown): v is LabelProviderObservation {
  return object(v) && exact(v, ['protocol', 'labelId', 'identityQualified', 'requestedAtMs', 'observedAtMs', 'source', 'documentState', 'documentUrl', 'providerStatus', 'providerVoided', 'providerCreatedAtMs', 'trackingNumber', 'refundStatus', 'providerRefundStatus', 'costCents', 'currency', 'effectiveRefundCents', 'remainingCostCents', 'settledBillingProof', 'reason']) && v.protocol === 'shipengine_label_lifecycle_observation_v1' && providerId(v.labelId) && typeof v.identityQualified === 'boolean' && ms(v.requestedAtMs) && ms(v.observedAtMs) && v.requestedAtMs <= v.observedAtMs && v.source === 'exact_label_get' && ['available', 'voided', 'unknown'].includes(String(v.documentState)) && v.documentUrl === null && nullableText(v.providerStatus, 300) && (v.providerVoided === null || typeof v.providerVoided === 'boolean') && (v.providerCreatedAtMs === null || ms(v.providerCreatedAtMs)) && nullableText(v.trackingNumber, 200) && (v.refundStatus === null || ['request_scheduled', 'pending', 'approved', 'rejected', 'excluded'].includes(String(v.refundStatus))) && nullableText(v.providerRefundStatus, 300) && (v.costCents === null || count(v.costCents)) && (v.currency === null || v.currency === 'CAD') && v.effectiveRefundCents === null && v.remainingCostCents === null && v.settledBillingProof === null && nullableText(v.reason);
}
function entry(v: unknown, id: string, scope: LabelLifecycleScope): v is LabelLifecycleEntry {
  if (!object(v) || !exact(v, ['protocol', 'contentHash', 'action', 'message', 'privateNote', 'recordedAt', 'providerObservation', 'voidResponse', 'carrierRefund', 'replacementExpense', 'replacementQuote', 'sourceCurrentlyMatches', ...EFFECTS]) || v.protocol !== 'label_lifecycle_entry_view_v1' || !hash(v.contentHash) || !LABEL_LIFECYCLE_ACTIONS.includes(v.action as LabelLifecycleAction) || !text(v.message) || !iso(v.recordedAt) || !none(v) || typeof v.sourceCurrentlyMatches !== 'boolean' || (scope === 'own' ? v.privateNote !== null : !nullableText(v.privateNote)) || (v.providerObservation !== null && !provider(v.providerObservation))) return false;
  if (v.voidResponse !== null) {const r = v.voidResponse; if (!object(r) || !exact(r, ['approved', 'outcome', 'message', 'reasonCode', 'source']) || !(r.approved === null || typeof r.approved === 'boolean') || !['approved', 'refused', 'unknown'].includes(String(r.outcome)) || r.approved !== (r.outcome === 'approved' ? true : r.outcome === 'refused' ? false : null) || !nullableText(r.message) || !nullableText(r.reasonCode, 300) || r.source !== 'exact_label_void_put') return false;}
  const f = v.carrierRefund;
  if (!object(f) || !exact(f, ['state', 'labelId', 'platformVoidRequestRecorded', 'voidApproved', 'providerStatus', 'reasonCode', 'reasonMessage', 'costCents', 'currency', 'effectiveRefundCents', 'remainingCostCents', 'settledBillingProof']) || !['requested', 'pending', 'approved', 'refused', 'excluded', 'unknown'].includes(String(f.state)) || !(f.labelId === null || providerId(f.labelId)) || typeof f.platformVoidRequestRecorded !== 'boolean' || !(f.voidApproved === null || typeof f.voidApproved === 'boolean') || !nullableText(f.providerStatus, 300) || !nullableText(f.reasonCode, 300) || !nullableText(f.reasonMessage) || !(f.costCents === null || count(f.costCents)) || !(f.currency === null || f.currency === 'CAD') || f.effectiveRefundCents !== null || f.remainingCostCents !== null || f.settledBillingProof !== null) return false;
  const expense = v.replacementExpense;
  if (expense !== null && (!object(expense) || !exact(expense, ['labelId', 'costCents', 'currency', 'fundingAuthorizationRecorded', 'matchesAuthorizedCost', 'buyerChargeAuthorized', 'settledBillingProof']) || !providerId(expense.labelId) || !count(expense.costCents) || expense.currency !== 'CAD' || typeof expense.fundingAuthorizationRecorded !== 'boolean' || typeof expense.matchesAuthorizedCost !== 'boolean' || expense.buyerChargeAuthorized !== false || expense.settledBillingProof !== null)) return false;
  const q = v.replacementQuote;
  return q === null || object(q) && exact(q, ['id', 'contentHash', 'costCents', 'currency', 'rateId', 'routeSourceHash', 'purchasePolicyHash', 'labelReplacedId', 'additionalBuyerChargeCents', 'platformFundingGuaranteed']) && q.id === id && q.contentHash === v.contentHash && count(q.costCents) && q.currency === 'CAD' && providerId(q.rateId) && hash(q.routeSourceHash) && hash(q.purchasePolicyHash) && providerId(q.labelReplacedId) && q.additionalBuyerChargeCents === null && q.platformFundingGuaranteed === false;
}
function cursor(v: unknown): v is LabelLifecycleCursor | null {return v === null || object(v) && exact(v, ['lastId']) && productReviewDocumentId(v.lastId);}
function coverage(v: unknown): v is LabelLifecycleHistory['coverage'] {return object(v) && exact(v, ['inspected', 'limit', 'hasMore', 'exhaustiveHistoryVerified']) && count(v.inspected, 20) && v.limit === 20 && typeof v.hasMore === 'boolean' && v.exhaustiveHistoryVerified === false && (!v.hasMore || v.inspected === 20);}
function guard(uid: string, assertContext: () => void) {const session = captureTradeSession(uid); assertContext(); return () => {assertTradeSessionCurrent(session); assertContext();};}
async function rpc(uid: string, mode: string, input: Record<string, unknown>, assertContext: () => void) {const current = guard(uid, assertContext); const response = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({capability: 'label_lifecycle_v1', expectedUid: uid, mode, ...input}); current(); return response.data;}

export const LabelLifecycleService = {
  async observe(uid: string, c: LabelLifecycleContext, scope: LabelLifecycleScope, assertContext: () => void, noticeRef: LabelLifecycleNoticeReference | null = null): Promise<LabelLifecycleObservation> {
    const current = guard(uid, assertContext); if (!isLabelLifecycleContext(c) || noticeRef !== null && !noticeReference(noticeRef)) throw failure();
    const v = await rpc(uid, 'label_lifecycle_source_observe', {...c, scope, ...(noticeRef ? {noticeReference: noticeRef} : {})}, current);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'source', 'replacement', 'currentLabelUse', 'currentInstruction', 'notice', 'readAt', ...EFFECTS]) || v.protocol !== 'label_lifecycle_source_observation_v1' || v.actorId !== uid || v.scope !== scope || !await source(v.source, c) || !replacement(v.replacement, v.source as LabelLifecycleSource) || !currentUse(v.currentLabelUse) || !currentInstruction(v.currentInstruction, scope, v.source as LabelLifecycleSource) || !notice(v.notice, noticeRef) || !iso(v.readAt) || !none(v)) throw failure(); current(); return v as unknown as LabelLifecycleObservation;
  },
  async preview(uid: string, c: LabelLifecycleContext, scope: LabelLifecycleScope, assertContext: () => void): Promise<LabelLifecyclePreview> {
    const current = guard(uid, assertContext); if (!isLabelLifecycleContext(c)) throw failure();
    const v = await rpc(uid, 'label_lifecycle_preview', {...c, scope}, current);
    const options = scope === 'admin' ? LABEL_LIFECYCLE_ADMIN_ACTIONS : LABEL_LIFECYCLE_OWN_ACTIONS;
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'source', 'options', 'replacement', 'currentLabelUse', 'currentInstruction', 'actionAvailability', 'commandPermissionGranted', 'additionalBuyerChargeAuthorized', ...EFFECTS]) || v.protocol !== 'label_lifecycle_preview_v1' || v.actorId !== uid || v.scope !== scope || !await source(v.source, c) || !replacement(v.replacement, v.source as LabelLifecycleSource) || !currentUse(v.currentLabelUse) || !currentInstruction(v.currentInstruction, scope, v.source as LabelLifecycleSource) || !availability(v.actionAvailability, scope, v.replacement as LabelLifecycleReplacement) || !Array.isArray(v.options) || !(v.options.length === 0 || productReviewEqual(v.options, options)) || v.commandPermissionGranted !== false || v.additionalBuyerChargeAuthorized !== false || !none(v)) throw failure(); current(); return v as unknown as LabelLifecyclePreview;
  },
  async command(attempt: LabelLifecycleAttempt, action: 'execute' | 'observe' | 'neutralize' | 'recover', assertContext: () => void): Promise<LabelLifecycleReceipt> {
    const current = guard(attempt.uid, assertContext); if (!isLabelLifecycleAttempt(attempt, attempt.uid)) throw failure();
    const payloadHash = await productReviewHash(attempt.command), caseId = `ll_${await productReviewHash([attempt.context.transactionId, attempt.context.leg])}`, entryId = `le_${await productReviewHash([attempt.uid, attempt.requestId])}`; current();
    const v = await rpc(attempt.uid, 'label_lifecycle_command', {requestId: attempt.requestId, action, command: attempt.command}, current);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'command', 'payloadHash', 'caseId', 'entryId', 'state', 'reason', 'recordedAt', 'providerOperationState', 'caseVersionAtCommit', ...EFFECTS]) || v.protocol !== 'label_lifecycle_command_v1' || v.actorId !== attempt.uid || v.requestId !== attempt.requestId || !productReviewEqual(v.command, attempt.command) || v.payloadHash !== payloadHash || v.caseId !== caseId || !['unrecorded', 'reserved', 'reconciliation_required', 'committed', 'not_executed'].includes(String(v.state)) || !none(v) || !nullableText(v.reason) || !(v.providerOperationState === null || ['reserved', 'requested', 'observation_recorded'].includes(String(v.providerOperationState)))) throw failure();
    if (v.state === 'unrecorded' ? v.entryId !== null || v.reason !== null || v.recordedAt !== null || v.providerOperationState !== null || v.caseVersionAtCommit !== null : !iso(v.recordedAt) || (v.state === 'not_executed' ? v.entryId !== null || !text(v.reason) || v.providerOperationState !== null || v.caseVersionAtCommit !== null : !count(v.caseVersionAtCommit) || v.caseVersionAtCommit <= attempt.command.caseVersion || (v.state === 'committed' ? v.entryId !== entryId || v.reason !== null : v.entryId !== null))) throw failure(); current(); return v as unknown as LabelLifecycleReceipt;
  },
  async history(uid: string, c: LabelLifecycleContext, scope: LabelLifecycleScope, after: LabelLifecycleCursor | null, expected: LabelLifecyclePreview, assertContext: () => void): Promise<LabelLifecycleHistory> {
    const current = guard(uid, assertContext); if (!isLabelLifecycleContext(c) || !cursor(after)) throw failure();
    const v = await rpc(uid, 'label_lifecycle_history_observe', {...c, scope, cursor: after}, current);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'transactionId', 'leg', 'source', 'entries', 'nextCursor', 'coverage', ...EFFECTS]) || v.protocol !== 'label_lifecycle_history_page_v1' || v.actorId !== uid || v.scope !== scope || v.transactionId !== c.transactionId || v.leg !== c.leg || !await source(v.source, c) || !productReviewEqual(v.source, expected.source) || !Array.isArray(v.entries) || v.entries.length > 20 || !coverage(v.coverage) || v.coverage.inspected !== v.entries.length || !cursor(v.nextCursor) || !none(v)) throw failure();
    const ids: string[] = [];
    for (const r of v.entries) {if (!object(r) || !exact(r, ['qualification', 'entryId', 'entry']) || !productReviewDocumentId(r.entryId) || (r.qualification === 'unknown' ? r.entry !== null : r.qualification !== 'native_lifecycle_entry' || !nativeId(r.entryId, 'le') || !entry(r.entry, r.entryId, scope))) throw failure(); ids.push(r.entryId);}
    if (new Set(ids).size !== ids.length || (v.coverage.hasMore ? v.nextCursor?.lastId !== ids.at(-1) || v.nextCursor?.lastId === after?.lastId : v.nextCursor !== null)) throw failure();
    const fresh = await this.preview(uid, c, scope, current); current(); if (!productReviewEqual(fresh, expected)) throw failure(); return v as unknown as LabelLifecycleHistory;
  },
  async queue(uid: string, after: LabelLifecycleCursor | null, assertContext: () => void, stream: LabelLifecycleQueue['stream'] = 'orders'): Promise<LabelLifecycleQueue> {
    const current = guard(uid, assertContext); if (!cursor(after) || !['orders', 'orphan_alerts'].includes(stream)) throw failure(); const v = await rpc(uid, 'label_lifecycle_admin_queue_observe', {cursor: after, stream}, current);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'stream', 'entries', 'nextCursor', 'coverage', ...EFFECTS]) || v.protocol !== 'label_lifecycle_admin_queue_v1' || v.actorId !== uid || v.stream !== stream || !Array.isArray(v.entries) || v.entries.length > (stream === 'orders' ? 40 : 20) || !coverage(v.coverage) || v.entries.length > v.coverage.inspected * (stream === 'orders' ? 2 : 1) || !cursor(v.nextCursor) || !none(v) || (v.coverage.hasMore ? !v.nextCursor || v.nextCursor.lastId === after?.lastId : v.nextCursor !== null)) throw failure();
    const ids: string[] = [];
    for (const r of v.entries) {
      if (!object(r) || !exact(r, ['transactionId', 'leg', 'qualification', 'source', 'orphanAlert']) || !['forward', 'return'].includes(String(r.leg)) || !['unknown', 'native_saved_label', 'native_purchase_reconciliation'].includes(String(r.qualification))) throw failure();
      if (stream === 'orders') {
        if (!productReviewDocumentId(r.transactionId) || r.orphanAlert !== null || (r.source === null ? r.qualification !== 'unknown' : !await source(r.source, {transactionId: r.transactionId, leg: r.leg as LabelLifecycleContext['leg']}) || !object(r.source) || r.source.qualification !== r.qualification)) throw failure(); ids.push(JSON.stringify([r.transactionId, r.leg]));
      } else {
        const a = r.orphanAlert;
        if (r.source !== null || r.qualification !== 'unknown' || r.leg !== 'forward' || !(r.transactionId === null || isLabelLifecycleContext({transactionId: r.transactionId, leg: r.leg})) || !object(a) || !exact(a, ['id', 'sourceRevision', 'sourceHash', 'labelId', 'reason', 'qualification']) || !productReviewDocumentId(a.id) || !revision(a.sourceRevision) || !hash(a.sourceHash) || !(a.labelId === null || providerId(a.labelId)) || !nullableText(a.reason) || a.qualification !== 'native_alert_partial') throw failure(); ids.push(a.id);
      }
    }
    if (new Set(ids).size !== ids.length) throw failure(); current(); return v as unknown as LabelLifecycleQueue;
  },
};

/** Notice IDs select a native addressed observation; they never grant transport rights. */
export async function labelLifecycleNotificationContext(data: unknown, uid: string, assertContext: () => void, notificationId?: string): Promise<LabelLifecycleNotificationContext | null> {
  const current = guard(uid, assertContext); if (!object(data) || data.ownerId !== uid || !nativeId(data.labelLifecycleCaseId, 'll')) return null;
  if (Object.prototype.hasOwnProperty.call(data, 'parcelAmendmentCapability') && data.parcelAmendmentCapability !== 'label_parcel_amendment_v1') return null;
  if (Object.prototype.hasOwnProperty.call(data, 'labelRouteAmendmentEntryId') || Object.prototype.hasOwnProperty.call(data, 'labelRouteAmendmentContentHash')) {
    const {labelRouteAmendmentNotificationContext} = await import('@/services/labelRouteAmendmentService'); current();
    return labelRouteAmendmentNotificationContext(data, uid, current, notificationId);
  }
  const c = {transactionId: data.transactionId, leg: data.labelLifecycleLeg}, ref = {entryId: data.labelLifecycleEntryId, noticeState: data.labelLifecycleNoticeState};
  if (!isLabelLifecycleContext(c) || !noticeReference(ref)) return null;
  const expectedCase = `ll_${await productReviewHash([c.transactionId, c.leg])}`; current(); if (data.labelLifecycleCaseId !== expectedCase) return null;
  const native = await LabelLifecycleService.observe(uid, c, 'own', current, ref); current();
  return native.source.caseId === expectedCase && native.notice?.entryId === ref.entryId && native.notice.noticeState === ref.noticeState && ['native_entry_recorded', 'native_intent_reserved'].includes(native.notice.qualification) ? c : null;
}
