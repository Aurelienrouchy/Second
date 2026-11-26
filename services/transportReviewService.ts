import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { LabelDepositDeadlineSource, LabelDepositReviewCapability, TransportCapture, TransportHistoricalReference, TransportInquiryEntry, TransportOperatorCommand, TransportReview,
  TransportReviewAttempt, TransportReviewCommand, TransportReviewDecision, TransportReviewObservation, TransportReviewPreview,
  TransportReviewReceipt, TransportReviewScope, TransportReviews, TransportReviewSource, TransportReviewSourceView } from '@/types/transportReview';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const reviewId = (v: unknown): v is string => typeof v === 'string' && /^case_[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const iso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const date = (v: unknown) => v === null || iso(v);
const text = (v: unknown, max: number, trim = false): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && (!trim || v === v.trim());
const revision = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}:\d{1,9}$/.test(v) && Number.isSafeInteger(Number(v.split(':')[0])) && Number(v.split(':')[0]) <= 253402300799 && Number(v.split(':')[1]) < 1_000_000_000;
const effects = ['financialEffectAuthorized', 'inventoryReleaseAuthorized'];
const noEffects = (v: Record<string, unknown>) => effects.every(k => v[k] === false);
const deadlineCapability = (v: unknown): v is LabelDepositReviewCapability => v === 'label_deposit_deadline_v1';
const failure = () => new Error('Les sources du dossier de transport doivent être relues. Aucune action financière n’est autorisée.');
function cursor(v: unknown): v is string {
  if (typeof v !== 'string' || !v.startsWith('case_') || v.includes('/')) return false;
  try {return encodeURIComponent(v).replace(/%[a-fA-F0-9]{2}/g, '_').length <= 1500;} catch {return false;}
}
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (object(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function depositDeadline(v: unknown, transactionId: string): v is LabelDepositDeadlineSource {
  if (!object(v) || !exact(v, ['protocol', 'transactionId', 'deadlineQualification', 'policyVersion', 'policyHash', 'startsAt', 'expiresAt', 'deadlineReached', 'deadlineSourceHash',
    'labelQualification', 'labelId', 'labelSourceHash', 'carrierScanQualification', 'observedStatusCode', 'providerObservedAt', 'providerEventAt', 'depositDeclaration',
    'declarationManifestComplete', 'declarationManifestHash', 'currentOrderStatus', 'resolutionPaths', 'physicalDepositVerified', 'absenceOfDepositVerified', 'terminalLossVerified',
    'financialEffectAuthorized', 'inventoryReleaseAuthorized', 'labelVoidAuthorized', 'sourceHash']) || v.protocol !== 'label_deposit_deadline_source_v1' || v.transactionId !== transactionId ||
    !['native_accepted_window', 'unknown'].includes(String(v.deadlineQualification)) || typeof v.deadlineReached !== 'boolean' ||
    (v.deadlineQualification === 'native_accepted_window' ? !text(v.policyVersion, 200) || !hash(v.policyHash) || !iso(v.startsAt) || !iso(v.expiresAt) || Date.parse(v.expiresAt) <= Date.parse(v.startsAt) || !hash(v.deadlineSourceHash) :
      [v.policyVersion, v.policyHash, v.startsAt, v.expiresAt, v.deadlineSourceHash].some(x => x !== null) || v.deadlineReached !== false) ||
    !['native_current_label', 'unknown'].includes(String(v.labelQualification)) || (v.labelQualification === 'native_current_label' ? !id(v.labelId) || !hash(v.labelSourceHash) : v.labelId !== null || v.labelSourceHash !== null) ||
    !['carrier_scan_recorded', 'no_acceptance_scan_recorded', 'unknown'].includes(String(v.carrierScanQualification)) ||
    !(v.observedStatusCode === null || typeof v.observedStatusCode === 'string' && /^[A-Z_]{1,64}$/.test(v.observedStatusCode)) || !date(v.providerObservedAt) || !date(v.providerEventAt) ||
    (v.carrierScanQualification === 'carrier_scan_recorded' && !['AC', 'IT', 'DE', 'EX', 'AT', 'SP'].includes(String(v.observedStatusCode))) ||
    (v.carrierScanQualification === 'no_acceptance_scan_recorded' && v.observedStatusCode !== 'NY') ||
    !['sender_handover_declared', 'not_recorded', 'unknown'].includes(String(v.depositDeclaration)) || typeof v.declarationManifestComplete !== 'boolean' ||
    (v.depositDeclaration === 'not_recorded' && !v.declarationManifestComplete) || (v.depositDeclaration === 'unknown' && v.declarationManifestComplete) ||
    !hash(v.declarationManifestHash) || !hash(v.sourceHash) || !(v.currentOrderStatus === null || typeof v.currentOrderStatus === 'string') ||
    ['physicalDepositVerified', 'absenceOfDepositVerified', 'terminalLossVerified', 'financialEffectAuthorized', 'inventoryReleaseAuthorized', 'labelVoidAuthorized'].some(k => v[k] !== false)) return false;
  const paths: LabelDepositDeadlineSource['resolutionPaths'] = [
    {kind: 'participant_parcel_investigation', context: {kind: 'order', id: transactionId}, contributionEndpoint: 'submitReport', capability: 'product_review_v1', parcelCapability: 'product_review_parcel_v1', recourseEndpoint: 'reportTransactionProblem', recourseCapability: 'product_parcel_report_v1', explicitParticipantStatementRequired: true, automaticComplaintCreated: false, permissionGranted: false},
    {kind: 'native_bilateral_refund_agreement', transactionId, endpoint: 'adminRefundTransaction', capability: 'purchase_refund_v1', sourceMode: 'purchase_refund_source_observe', bothNativeAcceptancesRequired: true, separateOperatorDecisionRequired: true, permissionGranted: false},
    {kind: 'label_lifecycle_review', context: {transactionId, leg: 'forward'}, endpoint: 'checkTrackingStatus', capability: 'label_lifecycle_v1', sourceMode: 'label_lifecycle_source_observe', buyerRefundAuthorized: false, permissionGranted: false},
  ];
  return same(v.resolutionPaths, paths);
}
export const transportReviewCommandHash = (v: TransportReviewCommand) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(v)));
function source(v: unknown): v is TransportReviewSource {
  return object(v) && exact(v, ['orderRevision', 'sourceHash', 'financialSourceHash', 'reviewId', 'reviewRevision', 'reviewHash']) && revision(v.orderRevision) && hash(v.sourceHash) && hash(v.financialSourceHash) &&
    (v.reviewId === null ? v.reviewRevision === null && v.reviewHash === null : reviewId(v.reviewId) && revision(v.reviewRevision) && hash(v.reviewHash));
}
function historical(v: unknown): v is TransportHistoricalReference | null {
  return v === null || object(v) && exact(v, ['orderRevision', 'sourceHash', 'financialSourceHash', 'reviewId', 'reviewRevision', 'reviewHash']) &&
    (v.orderRevision === null || revision(v.orderRevision)) && (v.sourceHash === null || hash(v.sourceHash)) && (v.financialSourceHash === null || hash(v.financialSourceHash)) &&
    (v.reviewId === null || reviewId(v.reviewId)) && (v.reviewRevision === null || revision(v.reviewRevision)) && (v.reviewHash === null || hash(v.reviewHash));
}
function capture(v: unknown): v is TransportCapture | null {
  return v === null || object(v) && exact(v, ['captureId', 'displayHash', 'sourceHash', 'readVersion']) && typeof v.captureId === 'string' &&
    /^tracking_[a-f0-9]{64}$/.test(v.captureId) && hash(v.displayHash) && hash(v.sourceHash) && integer(v.readVersion);
}
const sourceKeys = ['protocol', 'transactionId', 'reference', 'capture', 'captureQualification', 'currentCapture', 'observedStatusCode', 'observedAt', 'occurredAt', 'shippedAt',
  'estimatedDelivery', 'transportContext', 'etaInformationalOnly', 'elapsedTimeProvesLoss', 'releaseQualification', 'correction', 'correctionResolution', 'otherGuards',
  'correctionResolvable', 'parcelPossessionVerified', ...effects];
function sourceView(v: unknown, transactionId: string, extra: string[] = [], deadline = false): v is TransportReviewSourceView {
  if (!object(v) || !exact(v, [...sourceKeys, ...extra, ...(deadline ? ['labelDepositDeadline', 'deadlineContextQualification'] : [])]) ||
    (deadline && (!depositDeadline(v.labelDepositDeadline, transactionId) || !['same_deadline_and_label', 'changed_or_unknown', 'not_selected'].includes(String(v.deadlineContextQualification)))) || v.protocol !== 'transport_review_source_v1' || v.transactionId !== transactionId || !source(v.reference) ||
    !capture(v.capture) || !['native_capture', 'absent', 'historical_unknown'].includes(String(v.captureQualification)) ||
    (v.captureQualification === 'native_capture' ? v.capture === null : v.capture !== null) || typeof v.currentCapture !== 'boolean' || v.currentCapture && v.captureQualification !== 'native_capture' ||
    (v.observedStatusCode !== null && (typeof v.observedStatusCode !== 'string' || !/^[A-Z_]{1,64}$/.test(v.observedStatusCode))) ||
    !date(v.observedAt) || !date(v.occurredAt) || !date(v.shippedAt) || (v.estimatedDelivery !== null && (typeof v.estimatedDelivery !== 'string' || v.estimatedDelivery.length > 100)) ||
    typeof v.transportContext !== 'boolean' || v.etaInformationalOnly !== true || v.elapsedTimeProvesLoss !== false ||
    !['native_release_recorded', 'native_held_deadline_recorded', 'historical_unknown'].includes(String(v.releaseQualification)) ||
    typeof v.correctionResolvable !== 'boolean' || !Array.isArray(v.otherGuards) || new Set(v.otherGuards).size !== v.otherGuards.length ||
    !v.otherGuards.every(k => ['bank_case', 'risk_review', 'return_to_sender', 'return_request', 'refund', 'tracking_review', 'case_set_unknown', 'open_disputes'].includes(String(k))) ||
    v.parcelPossessionVerified !== false || !noEffects(v)) return false;
  const c = v.correction;
  if (c !== null && (!object(c) || !exact(c, ['correctionId', 'detectedAt', 'originalDeliveryAt', 'originalFundsReleaseAt', 'originalFundsReleasedAt', 'currentFundsReleaseAt', 'currentFundsReleasedAt']) ||
    !hash(c.correctionId) || !['detectedAt', 'originalDeliveryAt', 'originalFundsReleaseAt', 'originalFundsReleasedAt', 'currentFundsReleaseAt', 'currentFundsReleasedAt'].every(k => date(c[k])))) return false;
  const r = v.correctionResolution;
  if (!object(r) || !exact(r, ['state', 'correctionId', 'resolutionQualified', 'ownCorrectionBlocksProgress', 'action', 'decidedAt', 'effectiveFundsReleaseAt', 'effectiveProtectionEndsAt', 'protectionQualification', 'source', 'otherGuardsRetained', ...effects]) ||
    !['absent', 'resolved_current', 'review_required'].includes(String(r.state)) || r.correctionId !== null && !hash(r.correctionId) ||
    typeof r.resolutionQualified !== 'boolean' || typeof r.ownCorrectionBlocksProgress !== 'boolean' || !source(r.source) || !same(r.source, v.reference) ||
    r.otherGuardsRetained !== true || !noEffects(r) || !date(r.effectiveFundsReleaseAt) || !date(r.effectiveProtectionEndsAt) ||
    !['native_policy_window', 'historical_deadline', 'released_history', 'unknown'].includes(String(r.protectionQualification))) return false;
  if (r.state !== 'resolved_current' ? r.protectionQualification !== 'unknown' || r.effectiveFundsReleaseAt !== null || r.effectiveProtectionEndsAt !== null :
    r.protectionQualification === 'native_policy_window' ? !iso(r.effectiveFundsReleaseAt) || !iso(r.effectiveProtectionEndsAt) :
    r.protectionQualification === 'historical_deadline' ? !iso(r.effectiveFundsReleaseAt) || r.effectiveProtectionEndsAt !== null :
    r.protectionQualification !== 'released_history' || r.effectiveFundsReleaseAt !== null || r.effectiveProtectionEndsAt !== null) return false;
  return r.state === 'resolved_current' ? r.resolutionQualified && !r.ownCorrectionBlocksProgress && hash(r.correctionId) && c !== null && object(c) && r.correctionId === c.correctionId &&
    v.correctionResolvable && ['continue_held_release', 'retain_released_history'].includes(String(r.action)) && iso(r.decidedAt) :
    r.resolutionQualified === false && r.ownCorrectionBlocksProgress === (r.state === 'review_required') && r.action === null && r.decidedAt === null;
}
function entry(v: unknown, recorded = false): v is TransportInquiryEntry {
  return object(v) && exact(v, ['kind', 'source', 'summary', 'reference', 'occurredAt', 'nextFollowUpAt', ...(recorded ? ['recordedBy', 'recordedAt', 'sourceExamined', 'sourceDeclared', 'independentlyVerified'] : [])]) &&
    ['evidence', 'carrier_contact', 'participant_contact', 'follow_up', 'assessment'].includes(String(v.kind)) &&
    ['operator_observation', 'participant_statement', 'carrier_statement', 'document_reference'].includes(String(v.source)) && text(v.summary, 2000, true) &&
    (v.reference === null || text(v.reference, 500, true)) && date(v.occurredAt) && date(v.nextFollowUpAt) && (!recorded || id(v.recordedBy) && date(v.recordedAt) && historical(v.sourceExamined) && v.sourceDeclared === true && v.independentlyVerified === false);
}
function decision(v: unknown): v is TransportReviewDecision | null {
  return v === null || object(v) && exact(v, ['finding', 'outcome', 'reason', 'ownerMessage', 'recordedBy', 'recordedAt', 'sourceExamined', 'financialEffectAuthorized', 'otherGuardsRetained']) &&
    (v.finding === null || ['continue_held_release', 'retain_released_history', 'incident_resolved', 'financial_review_required'].includes(String(v.finding))) &&
    (v.outcome === null || ['review_completed', 'signal_not_established', 'further_action_required'].includes(String(v.outcome))) && text(v.reason, 2000, true) && text(v.ownerMessage, 2000, true) &&
    id(v.recordedBy) && date(v.recordedAt) && historical(v.sourceExamined) && v.financialEffectAuthorized === false && v.otherGuardsRetained === true;
}
const reviewKeys = ['protocol', 'reviewId', 'transactionId', 'kind', 'version', 'state', 'inquiryState', 'origin', 'initialSource', 'entries', 'closure', 'resolution',
  'createdAt', 'updatedAt', 'parcelPossessionVerified', 'terminalLossVerified', ...effects];
function review(v: unknown, transactionId: string, extra: string[] = [], deadline = false): v is TransportReview {
  if (!object(v) || !exact(v, [...reviewKeys, ...extra]) || v.protocol !== 'transport_review_v1' || !reviewId(v.reviewId) || v.transactionId !== transactionId || !integer(v.version) ||
    !['participant_transit', 'carrier_exception', 'delivery_correction', ...(deadline ? ['label_deposit_deadline'] : [])].includes(String(v.kind)) || !['open', 'closed', 'resolved', 'financial_review_required'].includes(String(v.state)) ||
    !['open', 'closed'].includes(String(v.inquiryState)) || !Array.isArray(v.entries) || v.entries.length > 100 || !v.entries.every(e => entry(e, true)) ||
    !decision(v.closure) || !decision(v.resolution) || !date(v.createdAt) || !date(v.updatedAt) || v.parcelPossessionVerified !== false || v.terminalLossVerified !== false || !noEffects(v)) return false;
  const initial = v.initialSource, o = v.origin;
  if (!object(initial) || !exact(initial, ['reference', 'capture', 'captureQualification']) || !historical(initial.reference) || !capture(initial.capture) ||
    !['native_capture', 'absent', 'historical_unknown'].includes(String(initial.captureQualification)) || (initial.captureQualification === 'native_capture' ? initial.capture === null : initial.capture !== null) || !object(o)) return false;
  return v.kind === 'participant_transit' ? exact(o, ['kind', 'reportedBy', 'narrative', 'reportVerified']) && o.kind === 'participant' && id(o.reportedBy) && text(o.narrative, 4000) && o.reportVerified === false :
    v.kind === 'label_deposit_deadline' ? exact(o, ['kind', 'source', 'reportedBy', 'deadline']) && o.kind === 'system' && o.source === 'accepted_contract_deadline' && o.reportedBy === null &&
      depositDeadline(o.deadline, transactionId) && o.deadline.deadlineQualification === 'native_accepted_window' && o.deadline.labelQualification === 'native_current_label' && o.deadline.deadlineReached :
    exact(o, ['kind', 'provider', 'statusCode', 'trackingSourceHash', 'observationHash', 'occurredAt', 'correctionId', 'disputeId', 'previousReviewId', 'reportedBy']) && o.kind === 'system' && o.provider === 'shipengine' &&
    typeof o.statusCode === 'string' && /^[A-Z_]{1,64}$/.test(o.statusCode) && hash(o.trackingSourceHash) && hash(o.observationHash) && date(o.occurredAt) && (o.correctionId === null || hash(o.correctionId)) &&
    (o.disputeId === null || id(o.disputeId)) && (o.previousReviewId === null || reviewId(o.previousReviewId)) && o.reportedBy === null;
}
export const isTransportReview = (v: unknown, transactionId: string): v is TransportReview => review(v, transactionId);
function command(v: unknown): v is TransportReviewCommand {
  if (!object(v) || !id(v.transactionId) || !source(v.source)) return false;
  const common = ['transactionId', 'source', 'action'];
  if (v.action === 'report_transit') return exact(v, [...common, 'narrative']) && v.source.reviewId === null && text(v.narrative, 4000, true);
  if (!reviewId(v.reviewId) || v.reviewId !== v.source.reviewId || v.previewId !== undefined && (typeof v.previewId !== 'string' || !/^preview_[a-f0-9]{64}$/.test(v.previewId))) return false;
  common.push('reviewId', ...(Object.prototype.hasOwnProperty.call(v, 'previewId') ? ['previewId'] : []));
  if (v.action === 'record_inquiry') return exact(v, [...common, 'entry']) && entry(v.entry);
  if (!text(v.reason, 2000, true) || !text(v.ownerMessage, 2000, true)) return false;
  common.push('reason', 'ownerMessage');
  return v.action === 'resolve_delivery_correction' ? exact(v, common) : v.action === 'close_inquiry' ? exact(v, [...common, 'outcome']) &&
    ['review_completed', 'signal_not_established', 'further_action_required'].includes(String(v.outcome)) : v.action === 'resolve_carrier_exception' && exact(v, [...common, 'finding']) && ['incident_resolved', 'financial_review_required'].includes(String(v.finding));
}
function attempt(v: unknown, uid: string): v is TransportReviewAttempt {
  return object(v) && exact(v, ['version', 'uid', 'requestId', 'command', ...(Object.prototype.hasOwnProperty.call(v, 'capability') ? ['capability'] : [])]) &&
    (!Object.prototype.hasOwnProperty.call(v, 'capability') || deadlineCapability(v.capability)) && v.version === 1 && v.uid === uid && typeof v.requestId === 'string' &&
    /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && command(v.command) && (!v.capability || ['record_inquiry', 'close_inquiry'].includes(v.command.action)) && (v.command.action === 'report_transit' || !!v.command.previewId);
}
async function rpc(uid: string, input: Record<string, unknown>, assertContext: () => void) {
  const session = captureTradeSession(uid); assertContext();
  const value = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({...input, expectedUid: session.uid});
  assertTradeSessionCurrent(session); assertContext(); return value.data;
}
// A raw client marker or copied DTO never qualifies a current resolution. This witness is session/focus bound and immutable by fingerprint.
const witnesses = new WeakMap<TransportReviewObservation, {fingerprint: string; assertCurrent: () => void}>();
export function hasCurrentNativeCorrectionResolution(v: TransportReviewObservation | null | undefined, transactionId: string, correctionId: string | null): boolean {
  if (!v) return false;
  const witness = witnesses.get(v); if (!witness) return false;
  try {witness.assertCurrent(); return witness.fingerprint === JSON.stringify(canonical(v)) && v.transactionId === transactionId &&
    v.correctionResolution.state === 'resolved_current' && v.correctionResolution.resolutionQualified && !v.correctionResolution.ownCorrectionBlocksProgress &&
    correctionId !== null && v.correctionResolution.correctionId === correctionId;} catch {return false;}
}
async function receipt(v: unknown, a: TransportReviewAttempt, assertCurrent: () => void): Promise<TransportReviewReceipt> {
  const payloadHash = await transportReviewCommandHash(a.command); assertCurrent();
  if (!object(v) || !exact(v, ['protocol', 'ownerId', 'requestId', 'transactionId', 'payloadHash', 'state', 'reviewId', 'reviewVersion', 'reason', 'recordedAt', ...effects]) ||
    v.protocol !== 'transport_review_command_v1' || v.ownerId !== a.uid || v.requestId !== a.requestId || v.transactionId !== a.command.transactionId || v.payloadHash !== payloadHash ||
    !['unrecorded', 'committed', 'not_executed'].includes(String(v.state)) || !noEffects(v)) throw failure();
  if (v.state === 'committed' ? !reviewId(v.reviewId) || !integer(v.reviewVersion) || v.reason !== null || !iso(v.recordedAt) || a.command.action !== 'report_transit' && v.reviewId !== a.command.reviewId :
    v.reviewId !== null || v.reviewVersion !== null || (v.state === 'unrecorded' ? v.reason !== null || v.recordedAt !== null : !iso(v.recordedAt) ||
      !['command_neutralized', 'source_changed', 'transport_context_unqualified', 'historical_source_unqualified', 'preview_unqualified', 'inquiry_capacity_requires_review', 'review_already_resolved', 'delivery_correction_source_unqualified', 'carrier_exception_source_unqualified', ...(a.capability ? ['deadline_inquiry_only', 'deadline_source_changed_or_unknown'] : [])].includes(String(v.reason)))) throw failure();
  return v as unknown as TransportReviewReceipt;
}
const journalKey = (uid: string) => `second:transport-review-command:v1:${encodeURIComponent(uid)}`;
const locks = new Set<string>(), writes = new Map<string, Promise<void>>();
async function serialize(uid: string, work: () => Promise<void>) {
  const pending = (writes.get(uid) ?? Promise.resolve()).catch(() => undefined).then(work); writes.set(uid, pending);
  try {await pending;} finally {if (writes.get(uid) === pending) writes.delete(uid);}
}
async function pending(uid: string, assertContext: () => void): Promise<TransportReviewAttempt[]> {
  const session = captureTradeSession(uid); assertContext(); const raw = await AsyncStorage.getItem(journalKey(uid)); assertTradeSessionCurrent(session); assertContext();
  if (raw === null) return []; let v: unknown; try {v = JSON.parse(raw);} catch {throw failure();}
  if (!Array.isArray(v) || !v.every(a => attempt(a, uid)) || new Set(v.map(a => a.command.transactionId)).size !== v.length) throw failure();
  return v;
}
async function commandRpc(a: TransportReviewAttempt, operation: 'execute' | 'observe' | 'neutralize', assertContext: () => void) {
  if (!attempt(a, a.uid)) throw failure(); const session = captureTradeSession(a.uid), assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
  return receipt(await rpc(a.uid, {mode: 'transport_review_command', requestId: a.requestId, operation, command: a.command, ...(a.capability ? {capability: a.capability} : {})}, assertCurrent), a, assertCurrent);
}
async function locked<T>(a: TransportReviewAttempt, assertContext: () => void, work: () => Promise<T>) {
  const session = captureTradeSession(a.uid), key = JSON.stringify([a.uid, a.command.transactionId]); assertContext(); if (!attempt(a, a.uid) || locks.has(key)) throw failure(); locks.add(key);
  try {assertTradeSessionCurrent(session); return await work();} finally {locks.delete(key);}
}
export const TransportReviewService = {
  async source(uid: string, transactionId: string, scope: TransportReviewScope, selected: string | null, assertContext: () => void, capability?: LabelDepositReviewCapability): Promise<TransportReviewObservation> {
    if (!id(transactionId) || !['owner', 'admin'].includes(scope) || selected !== null && !reviewId(selected)) throw failure();
    const session = captureTradeSession(uid), assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    if (capability !== undefined && !deadlineCapability(capability)) throw failure();
    const v = await rpc(uid, {mode: 'transport_review_source_observe', transactionId, scope, reviewId: selected, ...(capability ? {capability} : {})}, assertCurrent);
    if (!sourceView(v, transactionId, ['ownerId', 'review'], !!capability) || !object(v) || v.ownerId !== uid || v.reference.reviewId !== selected ||
      (selected === null ? v.review !== null : !review(v.review, transactionId, [], !!capability) || v.review.reviewId !== selected)) throw failure();
    const result = v as unknown as TransportReviewObservation; witnesses.set(result, {fingerprint: JSON.stringify(canonical(result)), assertCurrent}); return result;
  },
  async list(uid: string, transactionId: string, scope: TransportReviewScope, next: string | null, assertContext: () => void, capability?: LabelDepositReviewCapability): Promise<TransportReviews> {
    if (!id(transactionId) || !['owner', 'admin'].includes(scope) || next !== null && !cursor(next)) throw failure();
    if (capability !== undefined && !deadlineCapability(capability)) throw failure();
    const v = await rpc(uid, {mode: 'transport_reviews_observe', transactionId, scope, ...(next === null ? {} : {cursor: next}), ...(capability ? {capability} : {})}, assertContext);
    if (!object(v) || !exact(v, ['protocol', 'ownerId', 'transactionId', 'source', 'items', 'cursor', ...effects]) || v.protocol !== 'transport_reviews_v1' || v.ownerId !== uid || v.transactionId !== transactionId ||
      !sourceView(v.source, transactionId, [], !!capability) || v.source.reference.reviewId !== null || !Array.isArray(v.items) || v.items.length > 20 ||
      !v.items.every(item => object(item) && (item.qualification === 'native_review' ? review(item, transactionId, ['qualification', 'reviewRevision', 'reviewHash'], !!capability) && revision(item.reviewRevision) && hash(item.reviewHash) :
        exact(item, ['protocol', 'reviewId', 'transactionId', 'qualification', ...effects]) && item.protocol === 'transport_review_v1' && item.transactionId === transactionId && cursor(item.reviewId) && item.qualification === 'historical_unknown' && noEffects(item))) ||
      new Set(v.items.map(item => item.reviewId)).size !== v.items.length || v.cursor !== null && (!cursor(v.cursor) || v.cursor === next ||
        (!!capability && (v.items.length !== 20 || v.cursor !== v.items[v.items.length - 1].reviewId))) || !noEffects(v)) throw failure();
    return v as unknown as TransportReviews;
  },
  async preview(uid: string, intent: TransportOperatorCommand, assertContext: () => void, capability?: LabelDepositReviewCapability): Promise<TransportReviewPreview> {
    if (!command(intent) || Object.prototype.hasOwnProperty.call(intent, 'previewId')) throw failure();
    const expectedHash = await transportReviewCommandHash(intent); assertContext();
    if (capability !== undefined && !deadlineCapability(capability)) throw failure();
    const v = await rpc(uid, {mode: 'transport_review_preview', intent, ...(capability ? {capability} : {})}, assertContext);
    const previewHash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical([uid, intent]))); assertContext();
    if (!object(v) || !exact(v, ['protocol', 'ownerId', 'previewId', 'intentHash', 'source', 'review', ...effects]) || v.protocol !== 'transport_review_preview_v1' || v.ownerId !== uid ||
      v.previewId !== `preview_${previewHash}` || v.intentHash !== expectedHash || !sourceView(v.source, intent.transactionId, [], !!capability) || !same(v.source.reference, intent.source) ||
      !review(v.review, intent.transactionId, [], !!capability) || v.review.reviewId !== intent.reviewId || !noEffects(v)) throw failure();
    return v as unknown as TransportReviewPreview;
  },
  pending, observe: (a: TransportReviewAttempt, assertContext: () => void) => commandRpc(a, 'observe', assertContext),
  async execute(a: TransportReviewAttempt, assertContext: () => void) {
    return locked(a, assertContext, async () => {const session = captureTradeSession(a.uid);
      await serialize(a.uid, async () => {const all = await pending(a.uid, assertContext), prior = all.find(p => p.command.transactionId === a.command.transactionId); if (prior && (!a.capability || !same(prior, a))) throw failure();
        if (prior) return;
        assertTradeSessionCurrent(session); assertContext(); await AsyncStorage.setItem(journalKey(a.uid), JSON.stringify([...all, a])); assertTradeSessionCurrent(session); assertContext();});
      await commandRpc(a, 'execute', assertContext); return commandRpc(a, 'observe', assertContext);});
  },
  async neutralize(a: TransportReviewAttempt, assertContext: () => void) {
    return locked(a, assertContext, async () => {const all = await pending(a.uid, assertContext), prior = all.find(p => p.command.transactionId === a.command.transactionId);
      if (!prior || !same(prior, a)) throw failure(); await commandRpc(a, 'neutralize', assertContext); return commandRpc(a, 'observe', assertContext);});
  },
  async acknowledge(a: TransportReviewAttempt, assertContext: () => void) {
    return locked(a, assertContext, async () => {const session = captureTradeSession(a.uid), result = await commandRpc(a, 'observe', assertContext); if (result.state === 'unrecorded') throw failure();
      await serialize(a.uid, async () => {const all = await pending(a.uid, assertContext), prior = all.find(p => p.command.transactionId === a.command.transactionId); if (!prior || !same(prior, a)) throw failure();
        assertTradeSessionCurrent(session); assertContext(); await AsyncStorage.setItem(journalKey(a.uid), JSON.stringify(all.filter(p => p.command.transactionId !== a.command.transactionId))); assertTradeSessionCurrent(session); assertContext();}); return result;});
  },
};
