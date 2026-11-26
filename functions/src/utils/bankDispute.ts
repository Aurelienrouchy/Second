import { HttpsError } from 'firebase-functions/v2/https';
import {Timestamp} from 'firebase-admin/firestore';

export const BANK_DISPUTE_OUTCOMES = new Set(['won', 'lost', 'warning_closed']);
const own = (data: any, key: string) => data != null && Object.prototype.hasOwnProperty.call(data, key);
const disputeId = (value: unknown): value is string => typeof value === 'string' && /^du_[A-Za-z0-9_]{1,190}$/.test(value);
function nativeClosureTime(value: unknown): boolean {
  const milliseconds = value instanceof Timestamp ? value.toMillis() : value instanceof Date ? value.getTime() : NaN;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds <= Date.now();
}
/** H allocations and independent refunds invalidate the original gross bank
 * debit/credit formula. A bank-only settled chargeback is not itself a second
 * refund; preserve those genuine historical effects on replay. */
export function bankRefundOverlapRequiresReview(data: FirebaseFirestore.DocumentData): boolean {
  return own(data, 'bankRefundReconciliation') || own(data, 'convenienceReturnFinancialReservation') ||
    own(data, 'refundAllocationState') || own(data, 'refundAgreementContext') ||
    own(data, 'purchaseRefundCaseDisposition') || own(data.refund, 'allocation') || data.refund?.fundsAppliedAt != null ||
    data.refund?.legacyApplied === true ||
    (data.status === 'refunded' || data.refundedAt != null || ['stripe', 'wallet'].includes(data.refundedVia)) && data.refundedVia !== 'chargeback';
}
export function nativeBankLossLedgerRecorded(bank: any): boolean {
  return bank?.ledgerReconciledAt instanceof Timestamp && bank.ledgerReconciledAt.toMillis() > 0 && bank.ledgerReconciledAt.toMillis() <= Date.now();
}

/** A matched Stripe closure clears this guard only when no local reconciliation
 * remains required. Commercial dismissal is not proof of bank settlement. Malformed/new states and unqualified legacy
 * identifiers stay blocked until reconciled by the server.
 */
export function hasActiveBankDispute(data: FirebaseFirestore.DocumentData): boolean {
  // No closure/status/legacy caller can clear this separate, source-specific
  // obligation. A future differential reconciliation needs its own authority.
  if (own(data, 'bankRefundReconciliation')) return true;
  const bank = data.bankDispute;
  if (own(data, 'bankDispute')) {
    return !bank || typeof bank !== 'object' || Array.isArray(bank) || !disputeId(bank.id) ||
      own(data, 'disputeId') && data.disputeId !== bank.id ||
      own(bank, 'reconciliationRequired') && bank.reconciliationRequired !== false ||
      bank.state !== 'closed' || !nativeClosureTime(bank.closedAt) || !BANK_DISPUTE_OUTCOMES.has(bank.outcome) ||
      bank.outcome === 'lost' && !nativeBankLossLedgerRecorded(bank);
  }
  const legacyIdentity = own(data, 'disputeId') || own(data, 'disputeClosedAt') || own(data, 'disputeOutcome');
  const legacyHold = own(data, 'disputeFreezeCents') &&
    (!Number.isSafeInteger(data.disputeFreezeCents) || data.disputeFreezeCents < 0 || data.disputeFreezeCents > 0);
  return (legacyIdentity || legacyHold) &&
    !(disputeId(data.disputeId) && nativeClosureTime(data.disputeClosedAt) && BANK_DISPUTE_OUTCOMES.has(data.disputeOutcome) && data.disputeOutcome !== 'lost');
}

export function assertNoActiveBankDispute(data: FirebaseFirestore.DocumentData): void {
  if (hasActiveBankDispute(data)) {
    throw new HttpsError('failed-precondition',
      'Le dossier bancaire ou son rapprochement financier n’est pas résolu. Ce recours est suspendu.');
  }
}

export function positiveCents(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Used only to qualify a legacy closure without replacing commercial fields. */
export function hasCommercialDispute(data: FirebaseFirestore.DocumentData): boolean {
  if (data.status === 'return_requested') return true;
  if (data.disputed !== true && data.status !== 'disputed') return false;
  if (data.bankDispute) return data.bankDispute.commercialDisputedBeforeOpen === true;
  return !data.disputeId || !!data.buyerReport || !!data.returnEscalatedAt;
}

/** The aggregate escrow buckets may contain other sales. Only transaction-linked
 * movements qualify this sale's held/released funds. Legacy pre-delivery credit
 * may still be pending; a delivered/released sale never debits another sale's
 * pending bucket when its own movement evidence is missing.
 */
export async function bankDisputeSaleFunds(
  tx: FirebaseFirestore.Transaction,
  walletRef: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  transactionId: string
): Promise<{ pendingCents: number; heldCents: number; releasedCents: number }> {
  const snap = await tx.get(walletRef.collection('ledger').where('transactionId', '==', transactionId));
  const entries = snap.docs.map(d => d.data());
  const sum = (type: string, description?: string) => entries.reduce((total, entry) => total +
    (entry.type === type && (!description || entry.description === description) ? positiveCents(entry.amount) : 0), 0);
  const gross = positiveCents(data.sellerCreditedCents);
  const originalDebt = typeof data.sellerDebtRepaidCents === 'number' ? positiveCents(data.sellerDebtRepaidCents)
    : sum('debt_repayment', 'Vente — régularisation du solde dû');
  const net = Math.min(gross, typeof data.sellerPendingCreditCents === 'number' ? positiveCents(data.sellerPendingCreditCents) : Math.max(0, gross - originalDebt));
  const released = Math.min(net, typeof data.sellerReleasedCents === 'number' ? positiveCents(data.sellerReleasedCents) : sum('funds_released'));
  const held = Math.min(net, Math.max(released,
    typeof data.sellerHeldCreditCents === 'number' ? positiveCents(data.sellerHeldCreditCents) : sum('funds_held')));
  const status = data.bankDispute?.statusBeforeOpen ?? data.statusBeforeDispute ?? data.refund?.originalStatus ?? data.status;
  const preDelivery = ['paid', 'label_created', 'shipped', 'delivery_failed', 'lost', 'refund_in_progress'].includes(status) &&
    !data.fundsReleaseAt && !data.deliveredAt && !data.fundsReleasedAt && held === 0 && released === 0;
  return {
    pendingCents: preDelivery ? Math.max(0, net - held) : 0,
    heldCents: Math.max(0, held - released),
    releasedCents: Math.max(0, released - sum('debt_repayment', 'Fonds libérés — régularisation du solde dû') - positiveCents(data.refund?.freezeCents)),
  };
}
