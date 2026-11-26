import AsyncStorage from '@/utils/environmentStorage';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { AdminProductFinancialReference } from '@/types/adminProductFinancial';
import { isAdminProductFinancialReference } from '@/services/adminProductFinancialSource';
import { productReviewEqual } from '@/services/productReviewService';
import type { PurchaseRefundAllocation } from '@/types/purchaseRefund';
import { isPurchaseRefundAllocation } from '@/utils/purchaseRefundContract';

export interface DisputeResolutionAttempt {
  version: 1;
  adminUid: string;
  transactionId: string;
  disputeId: string;
  requestId: string;
  note: string;
  previewId?: string;
  expectedSourceHash?: string;
  previewMonetaryContext?: 'settled_refund' | 'new_instruction';
  expectedSettledRefundIntentId?: string | null;
  productReview?: AdminProductFinancialReference;
  allocation?: PurchaseRefundAllocation;
}
export interface DisputeResolutionReceipt {
  protocol: 'commercial_dispute_resolution_v1';
  success: true;
  decisionCommitted: true;
  transactionId: string;
  expectedDisputeId: string;
  requestId: string;
  decisionId: string;
  actorUid: string;
  outcome: 'dismissed';
  note: string;
  restored: string;
  currentOrderStatus: string;
  releasedCents: number;
  disputesClosed: number;
  disputeIds: string[];
  orderResolutionCommitted: boolean;
  remainingOpenDisputeIds: string[];
  remainingDisputesOpen: number;
  retainedObligations: string[];
  resolvedAt: string;
  replay: boolean;
  notificationCommitted: boolean;
  notificationDelivery: 'in_app_committed' | 'historical_unqualified';
  deviceDeliveryVerified: false;
  readingVerified: false;
  financialSettlementRetained: boolean;
  settledRefundIntentId: string | null;
  settlementQualification: 'native' | 'historical_unqualified';
  productReview?: AdminProductFinancialReference;
  allocation?: PurchaseRefundAllocation;
}
export interface DisputeNonExecutionReceipt {
  protocol: 'commercial_dispute_resolution_v1';
  transactionId: string;
  expectedDisputeId: string;
  requestId: string;
  decisionId: string;
  actorUid: string;
  note: string;
  outcome: 'not_executed';
  success: false;
  decisionCommitted: false;
  effectsCommitted: false;
  intentionNeutralized: true;
  lateRequestBlocked: true;
  nonExecutionQualified: true;
  nonExecutionReason: 'target_already_closed' | 'source_changed' | 'intention_neutralized_before_effects' | 'allocation_sources_unqualified';
  sourceExamined?: false;
  observedSourceHash?: string | null;
  terminal: true;
  neutralizedAt: string;
  replay: boolean;
  retryPermissionGranted: false;
  productReview?: AdminProductFinancialReference;
  allocation?: PurchaseRefundAllocation;
}
export interface DisputeUnrecordedReceipt {
  protocol: 'commercial_dispute_resolution_v1'; outcome: 'unrecorded'; transactionId: string; expectedDisputeId: string;
  requestId: string; decisionId: string; payloadHash: string; actorUid: string; note: string; previewId: string | null; sourceHash: string | null;
  decisionCommitted: false; effectsCommitted: false; intentionNeutralized: false; lateRequestBlocked: false; retryPermissionGranted: false;
  moneyMoved: false; releasedCents: 0; disputesClosed: 0; disputeIds: []; orderResolutionCommitted: false; notificationCommitted: false;
  productReview?: AdminProductFinancialReference;
  allocation?: PurchaseRefundAllocation;
}
export type DisputeResolutionOutcome = DisputeResolutionReceipt | DisputeNonExecutionReceipt | DisputeUnrecordedReceipt;

const reference = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const key = (uid: string) => `second:dispute-resolution:v1:${encodeURIComponent(uid)}`;
const active = new Set<string>();
const writes = new Map<string, Promise<void>>();
const unknown = () => new Error('La décision doit être relue avec sa référence et sa note d’origine.');
export function validDisputeResolutionAttempt(v: unknown, uid: string): v is DisputeResolutionAttempt {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const a = v as Record<string, unknown>;
  const preview = a.previewId === undefined && a.expectedSourceHash === undefined ||
    typeof a.previewId === 'string' && /^[a-f0-9]{64}$/.test(a.previewId) && typeof a.expectedSourceHash === 'string' && /^[a-f0-9]{64}$/.test(a.expectedSourceHash);
  const monetary = a.previewMonetaryContext === undefined && a.expectedSettledRefundIntentId === undefined ||
    a.previewId !== undefined && (a.previewMonetaryContext === 'new_instruction' && a.expectedSettledRefundIntentId === null ||
      a.previewMonetaryContext === 'settled_refund' && reference(a.expectedSettledRefundIntentId));
  return preview && monetary && Object.keys(a).every(k => ['version', 'adminUid', 'transactionId', 'disputeId', 'requestId', 'note', 'previewId', 'expectedSourceHash',
    'previewMonetaryContext', 'expectedSettledRefundIntentId', 'productReview', 'allocation'].includes(k)) &&
    (!Object.prototype.hasOwnProperty.call(a, 'productReview') || !!a.previewId && isAdminProductFinancialReference(a.productReview)) &&
    (!Object.prototype.hasOwnProperty.call(a, 'allocation') || !!a.previewId && isPurchaseRefundAllocation(a.allocation) && a.allocation.terms.settlementKind === 'retain_remaining' && a.allocation.terms.caseHandling === 'settle_selected_case') &&
    a.version === 1 && a.adminUid === uid && reference(a.transactionId) && reference(a.disputeId) &&
    typeof a.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(a.requestId) &&
    typeof a.note === 'string' && a.note === a.note.trim() && a.note.length >= 1 && a.note.length <= 500;
}
export function matchesDisputeResolutionAttempt(a: DisputeResolutionAttempt, b: DisputeResolutionAttempt): boolean {
  return a.adminUid === b.adminUid && a.transactionId === b.transactionId && a.disputeId === b.disputeId &&
    a.requestId === b.requestId && a.note === b.note && a.previewId === b.previewId && a.expectedSourceHash === b.expectedSourceHash &&
    a.previewMonetaryContext === b.previewMonetaryContext && a.expectedSettledRefundIntentId === b.expectedSettledRefundIntentId && productReviewEqual(a.productReview ?? null, b.productReview ?? null) && productReviewEqual(a.allocation ?? null, b.allocation ?? null);
}
export async function readDisputeResolutionAttempts(uid: string, assertContext: () => void): Promise<DisputeResolutionAttempt[]> {
  const session = captureTradeSession(uid); assertContext();
  const raw = await AsyncStorage.getItem(key(uid));
  assertTradeSessionCurrent(session); assertContext();
  if (raw === null) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw unknown(); }
  // Preserve the first format written during this implementation as well.
  if (validDisputeResolutionAttempt(value, uid)) return [value];
  if (!Array.isArray(value) || !value.every(v => validDisputeResolutionAttempt(v, uid)) ||
      new Set(value.map(a => a.transactionId)).size !== value.length) throw unknown();
  return value;
}
export async function runDisputeResolution<T>(uid: string, transactionId: string, assertContext: () => void, work: () => Promise<T>): Promise<T> {
  const session = captureTradeSession(uid); assertContext();
  if (!reference(transactionId)) throw unknown();
  const slot = JSON.stringify([uid, transactionId]);
  if (active.has(slot)) throw unknown();
  active.add(slot);
  try { assertTradeSessionCurrent(session); return await work(); } finally { active.delete(slot); }
}
async function serialize(uid: string, work: () => Promise<void>): Promise<void> {
  const pending = (writes.get(uid) ?? Promise.resolve()).catch(() => undefined).then(work);
  writes.set(uid, pending);
  try { await pending; } finally { if (writes.get(uid) === pending) writes.delete(uid); }
}
export async function rememberDisputeResolutionAttempt(attempt: DisputeResolutionAttempt, assertContext: () => void): Promise<void> {
  const session = captureTradeSession(attempt.adminUid);
  await serialize(session.uid, async () => {
    assertTradeSessionCurrent(session); assertContext();
    if (!validDisputeResolutionAttempt(attempt, session.uid)) throw unknown();
    const current = await readDisputeResolutionAttempts(session.uid, assertContext);
    const existing = current.find(a => a.transactionId === attempt.transactionId);
    if (existing && !matchesDisputeResolutionAttempt(existing, attempt)) throw unknown();
    assertTradeSessionCurrent(session); assertContext();
    await AsyncStorage.setItem(key(session.uid), JSON.stringify(existing ? current : [...current, attempt]));
    assertTradeSessionCurrent(session); assertContext();
  });
}
/** Local acknowledgement only; this never closes a current dispute. */
export async function acknowledgeDisputeResolution(attempt: DisputeResolutionAttempt, receipt: DisputeResolutionOutcome, assertContext: () => void): Promise<void> {
  const session = captureTradeSession(attempt.adminUid);
  await serialize(session.uid, async () => {
    assertTradeSessionCurrent(session); assertContext();
    const current = await readDisputeResolutionAttempts(session.uid, assertContext);
    const existing = current.find(a => a.transactionId === attempt.transactionId);
    const allocationRefused = receipt.outcome === 'not_executed' && receipt.nonExecutionReason === 'allocation_sources_unqualified' &&
      !!attempt.allocation && isPurchaseRefundAllocation(receipt.allocation) && productReviewEqual(receipt.allocation, attempt.allocation) &&
      receipt.sourceExamined === false && receipt.observedSourceHash === null;
    const terminalQualified = receipt.outcome === 'dismissed'
      ? receipt.decisionCommitted === true && receipt.success === true && receipt.disputeIds.includes(attempt.disputeId) &&
        (attempt.previewMonetaryContext !== 'settled_refund' || receipt.settlementQualification === 'native' &&
          receipt.financialSettlementRetained === true && receipt.settledRefundIntentId === attempt.expectedSettledRefundIntentId &&
          receipt.restored === 'refunded' && receipt.releasedCents === 0)
      : receipt.outcome === 'not_executed' && receipt.success === false && receipt.decisionCommitted === false &&
        receipt.effectsCommitted === false && receipt.intentionNeutralized === true && receipt.lateRequestBlocked === true &&
        receipt.nonExecutionQualified === true && (['target_already_closed', 'source_changed', 'intention_neutralized_before_effects'].includes(receipt.nonExecutionReason) || allocationRefused) &&
        (receipt.nonExecutionReason !== 'intention_neutralized_before_effects' || receipt.sourceExamined === false && receipt.observedSourceHash === null) && receipt.terminal === true &&
        receipt.retryPermissionGranted === false && typeof receipt.neutralizedAt === 'string' && Number.isFinite(Date.parse(receipt.neutralizedAt));
    if (!existing || !matchesDisputeResolutionAttempt(existing, attempt) || !terminalQualified ||
        receipt.transactionId !== attempt.transactionId || receipt.requestId !== attempt.requestId || receipt.actorUid !== attempt.adminUid ||
        receipt.expectedDisputeId !== attempt.disputeId || receipt.note !== attempt.note || !productReviewEqual(receipt.productReview ?? null, attempt.productReview ?? null) ||
        !productReviewEqual(receipt.allocation ?? null, attempt.allocation ?? null)) throw unknown();
    assertTradeSessionCurrent(session); assertContext();
    await AsyncStorage.setItem(key(session.uid), JSON.stringify(current.filter(a => a.transactionId !== attempt.transactionId)));
    assertTradeSessionCurrent(session); assertContext();
  });
}
