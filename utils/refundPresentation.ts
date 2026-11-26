import type { IssueRefundResult, Transaction } from '@/types/transaction';
import { formatPrice } from '@/utils/formatPrice';

export const RESPONSE_UNCONFIRMED_MESSAGE = 'Impossible de confirmer le résultat. Actualisez le suivi de la commande avant de renvoyer une demande.';

export function getPaymentBlockReason(tx: Transaction | null, userId: string): 'not_found' | 'forbidden' | 'financial_obligation' | 'already_processed' | null {
  if (!tx) return 'not_found';
  if (tx.buyerId !== userId) return 'forbidden';
  if (hasUnsettledRefund(tx) || hasBankObligation(tx)) return 'financial_obligation';
  return tx.status === 'pending_payment' ? null : 'already_processed';
}

export function isRefundConfirmed(result: IssueRefundResult): boolean {
  return result.success === true && result.status === 'succeeded' && validIdentity(result.intentId) &&
    result.outstandingCardCents === 0 && result.localReconciliationRequired === false && result.bankWaiting === false && result.actionRequired === false;
}

function validIdentity(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }

export function hasUnsettledRefund(tx: Transaction): boolean {
  if (tx.refundBlocked || tx.refundLegacyReconciliationRequired) return true;
  const refund = tx.refund;
  if (!refund) return tx.status === 'refund_in_progress' || tx.status === 'refund_action_required';
  return !validIdentity(refund.intentId) || refund.state !== 'succeeded' || !refund.fundsAppliedAt || refund.outstandingCardCents !== 0 ||
    refund.legacyReconciliationRequired === true || (refund.localOutstandingWalletCents ?? 0) > 0 ||
    (refund.localOutstandingSellerCents ?? 0) > 0 || (refund.duplicateCardSettlementCents ?? 0) > 0;
}

export function hasBankObligation(tx: Transaction): boolean {
  const bank = tx.bankDispute;
  const outcomes = ['won', 'lost', 'warning_closed'];
  if (bank != null) return !validIdentity(bank.id) || bank.state !== 'closed' || !bank.closedAt ||
    !bank.outcome || !outcomes.includes(bank.outcome) || bank.reconciliationRequired === true || !!bank.conflictingDisputeId;
  const legacyIdentity = validIdentity(tx.disputeId);
  const legacyHold = typeof tx.disputeFreezeCents === 'number' && Number.isSafeInteger(tx.disputeFreezeCents) && tx.disputeFreezeCents > 0;
  return (legacyIdentity || legacyHold) && !(tx.disputeClosedAt && tx.disputeOutcome && outcomes.includes(tx.disputeOutcome));
}

export function canRetryRefund(tx: Transaction): boolean {
  if (hasPurchaseRefundContext(tx)) return false;
  const refund = tx.refund;
  return !!refund && validIdentity(refund.intentId) && validIdentity(refund.paymentIntentId) && validIdentity(refund.stripeRefundId) &&
    (refund.state === 'failed' || refund.state === 'canceled') &&
    (refund.providerStatus === 'failed' || refund.providerStatus === 'canceled') && !refund.bankWaiting &&
    !hasBankObligation(tx) && !tx.refundLegacyReconciliationRequired && !refund.legacyReconciliationRequired &&
    validCents(refund.cardAmountCents) && refund.cardAmountCents > 0 &&
    validCents(refund.outstandingCardCents) && refund.outstandingCardCents > 0 &&
    !(validCents(refund.duplicateCardSettlementCents) && refund.duplicateCardSettlementCents > 0);
}

function validCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
const money = (cents: number) => formatPrice(cents / 100);

function evidenceRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
/** This routes H obligations to their native repair reader, never grants a repair permission. */
export function hasPurchaseRefundContext(tx: Transaction): boolean {
  const raw = evidenceRecord(tx), refund = evidenceRecord(tx.refund);
  return !!raw && (['refundAllocationState', 'refundAgreementContext', 'purchaseRefundCaseDisposition'].some(k => Object.prototype.hasOwnProperty.call(raw, k)) || refund?.allocation != null);
}
function evidenceTime(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  const stamp = evidenceRecord(value);
  if (!stamp || typeof stamp.toDate !== 'function' || typeof stamp.seconds !== 'number' || !Number.isSafeInteger(stamp.seconds) ||
    typeof stamp.nanoseconds !== 'number' || !Number.isInteger(stamp.nanoseconds) || stamp.nanoseconds < 0 || stamp.nanoseconds >= 1_000_000_000) return false;
  try {
    const date: unknown = stamp.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) &&
      date.getTime() === new Date(stamp.seconds * 1000 + stamp.nanoseconds / 1_000_000).getTime();
  } catch { return false; }
}

/** Additional producer fields survive the mapper; validate their unknown values locally. */
function readBankSettlement(tx: Transaction): {cardCents: number; walletCents: number | null; walletNeedsReview: boolean} | null {
  const raw = evidenceRecord(tx)!;
  const r = evidenceRecord(tx.refund);
  const bank = evidenceRecord(tx.bankDispute);
  if (!r || !bank || !validIdentity(r.intentId) || !validIdentity(bank.id) || bank.conflictingDisputeId ||
    !validIdentity(tx.stripePaymentIntentId) || r.paymentIntentId !== tx.stripePaymentIntentId || r.currency !== 'cad' ||
    ('currency' in bank && bank.currency !== 'cad') || ('currency' in raw && raw.currency !== 'cad') ||
    (validIdentity(tx.disputeId) && tx.disputeId !== bank.id) ||
    bank.state !== 'closed' || bank.outcome !== 'lost' || !evidenceTime(bank.closedAt) || !evidenceTime(bank.ledgerReconciledAt) ||
    !validCents(r.capturedCardCents) || r.capturedCardCents <= 0 || bank.amountCents !== r.capturedCardCents ||
    (tx.capturedCardCents !== undefined && tx.capturedCardCents !== r.capturedCardCents) ||
    !validCents(r.cardAmountCents) || r.cardAmountCents > r.capturedCardCents) return null;

  // The bank commit proves settlement before (or without) provider retrieval.
  // A projected record is a separate, later proof path, never a guessed prefix.
  const prefix = tx.refundedVia === 'chargeback' && evidenceTime(r.bankSettlementAt) &&
    validCents(tx.capturedCardCents) && tx.capturedCardCents === r.capturedCardCents;
  const projected = r.cardSatisfiedVia === 'chargeback' && r.outstandingCardCents === 0;
  if (!prefix && !projected) return null;

  const originalWallet = raw.walletAmountUsed;
  const mixed = raw.paidVia === 'mixed' || raw.paidVia === 'wallet_and_card';
  const knownWallet = mixed && validIdentity(tx.buyerId) && validCents(originalWallet) && originalWallet > 0 &&
    validCents(r.walletAmountCents) && r.walletAmountCents <= originalWallet;
  const remaining = r.localOutstandingWalletCents;
  const contradictoryRemaining = remaining !== null && remaining !== undefined &&
    (!validCents(remaining) || !validCents(r.walletAmountCents) || remaining > r.walletAmountCents);
  const walletSettled = knownWallet && !contradictoryRemaining && (prefix || remaining === 0);
  const walletNeedsReview = contradictoryRemaining ||
    ((validCents(originalWallet) && originalWallet > 0) || (validCents(r.walletAmountCents) && r.walletAmountCents > 0)) && !knownWallet;
  return {cardCents: r.capturedCardCents, walletCents: walletSettled ? originalWallet : null, walletNeedsReview};
}

export interface RefundPresentation {
  title: string;
  message: string;
  lines: string[];
  confirmed: boolean;
  tone: 'success' | 'warning' | 'danger';
}

export function refundResultPresentation(result: IssueRefundResult): RefundPresentation {
  const confirmed = isRefundConfirmed(result);
  const titles: Record<IssueRefundResult['status'], string> = {
    pending: result.bankWaiting ? 'En attente de la décision bancaire' : 'Remboursement en cours',
    requires_action: 'Remboursement à compléter', unknown: 'Remboursement à vérifier',
    succeeded: confirmed ? 'Remboursement confirmé' : 'Remboursement à vérifier',
    failed: 'Remboursement non confirmé', canceled: 'Remboursement non confirmé',
    reconciliation_required: 'Remboursement à vérifier',
  };
  return { title: Object.prototype.hasOwnProperty.call(titles, result.status) ? titles[result.status] : 'Remboursement à vérifier',
    message: confirmed ? 'Le remboursement de cette commande est confirmé.' : typeof result.message === 'string' && result.message ? result.message : 'Le dossier reste ouvert. Contactez notre équipe.',
    lines: [], confirmed, tone: confirmed ? 'success' : result.actionRequired ? 'danger' : 'warning' };
}

/** Uses independent provider and local evidence, never the outer order status alone. */
export function getRefundPresentation(tx: Transaction, perspective: 'buyer' | 'seller' | 'admin'): RefundPresentation | null {
  const r = tx.refund;
  const bankSettlement = readBankSettlement(tx);
  const overlap = bankSettlement !== null && validCents(r?.cardConfirmedCents) && r.cardConfirmedCents > 0;
  const rawRefund = evidenceRecord(r);
  const bank = tx.bankDispute;
  const sameClosedDecision = !!bank && validIdentity(bank.id) && bank.state === 'closed' && evidenceTime(bank.closedAt) &&
    ['won', 'lost', 'warning_closed'].includes(bank.outcome ?? '') && !bank.conflictingDisputeId &&
    (rawRefund?.bankWaitingDisputeId === bank.id || (bankSettlement !== null && rawRefund?.bankWaitingDisputeId == null));
  const bankWaiting = r?.bankWaiting === true && !sameClosedDecision;
  const fundsApplied = evidenceTime(r?.fundsAppliedAt);
  const legacy = tx.refundLegacyReconciliationRequired || r?.legacyReconciliationRequired ||
    (tx.status === 'refunded' && !r?.intentId);
  if (!r && !legacy && !tx.refundBlocked && tx.status !== 'refund_action_required' && tx.status !== 'refund_in_progress') return null;
  const confirmed = !!r?.intentId && r.state === 'succeeded' && fundsApplied &&
    r.outstandingCardCents === 0 && !hasUnsettledRefund(tx) && !legacy && !overlap;
  const late = fundsApplied && !confirmed && (r?.state === 'failed' || r?.state === 'canceled' || r?.state === 'requires_action');
  const allowedStates = ['pending', 'requires_action', 'unknown', 'succeeded', 'failed', 'canceled', 'reconciliation_required'];
  const state = r?.state === 'requested' ? 'pending' : r?.state && allowedStates.includes(r.state) ? r.state : 'reconciliation_required';
  const result = refundResultPresentation({ success: confirmed, status: state,
    intentId: r?.intentId ?? null, refundId: r?.stripeRefundId ?? null,
    outstandingCardCents: validCents(r?.outstandingCardCents) ? r.outstandingCardCents : null,
    localReconciliationRequired: legacy || state === 'reconciliation_required',
    bankWaiting, actionRequired: !confirmed && state !== 'pending', message: '' });
  if (late) result.title = hasPurchaseRefundContext(tx) ? 'Restitution restante à examiner' : 'Remboursement à reprendre';
  const buyer = perspective === 'buyer';
  result.message = confirmed ? (buyer ? 'Le remboursement de cette commande est confirmé.' : 'Le remboursement est confirmé. Le solde de cette vente a été mis à jour.')
    : overlap ? 'Un règlement sur le moyen de paiement d’origine et un règlement bancaire sont constatés. Le dossier reste à rapprocher.'
    : late ? 'Une intervention est à nouveau nécessaire pour le remboursement. Les mouvements de solde déjà enregistrés restent pris en compte.'
    : bankWaiting ? 'Le remboursement attend la décision bancaire. Les fonds restent réservés.'
    : state === 'pending' ? (buyer ? "Votre demande est enregistrée. Le remboursement n'est pas encore confirmé." : 'Une demande de remboursement est en cours. Les fonds concernés restent réservés.')
    : state === 'unknown' ? 'Nous devons vérifier si le remboursement a été effectué. Ne renvoyez pas la demande ; vous pouvez contacter notre équipe.'
    : state === 'failed' || state === 'canceled' ? "Le remboursement n'a pas abouti. Le dossier reste ouvert."
    : state === 'requires_action' ? 'Une intervention est nécessaire pour poursuivre le remboursement. Contactez notre équipe.'
    : 'Le dossier nécessite une vérification avant de confirmer le remboursement complet.';
  if (validCents(r?.cardConfirmedCents) && r.cardConfirmedCents > 0) {
    result.lines.push(`Remboursement sur le moyen de paiement d’origine confirmé : ${money(r.cardConfirmedCents)}.`);
  }
  if (bankSettlement) {
    result.lines.push(`Portion réglée par la banque : ${money(bankSettlement.cardCents)}.`);
  }
  if (!bankSettlement) {
    if (!validCents(r?.outstandingCardCents)) result.lines.push('Montant sur le moyen de paiement à vérifier.');
    else if (r.outstandingCardCents > 0) result.lines.push(`Remboursement sur le moyen de paiement restant à traiter : ${money(r.outstandingCardCents)}.`);
  }
  if (bankSettlement?.walletCents != null) {
    result.lines.push(`${buyer ? 'Restitué dans votre porte-monnaie' : 'Restitué au porte-monnaie de l’acheteur'} : ${money(bankSettlement.walletCents)}.`);
  } else if (bankSettlement?.walletNeedsReview) {
    result.lines.push('Restitution dans le porte-monnaie à vérifier.');
  } else if (validCents(r?.walletAmountCents) && r.walletAmountCents > 0) {
    const outstanding = validCents(r.localOutstandingWalletCents) && r.localOutstandingWalletCents > 0 ? r.localOutstandingWalletCents : null;
    const applied = fundsApplied && outstanding === null;
    result.lines.push(`${applied ? (buyer ? 'Restitué dans votre porte-monnaie' : 'Restitué au porte-monnaie de l’acheteur') : (buyer ? 'Restitution dans votre porte-monnaie en attente' : 'Restitution au porte-monnaie de l’acheteur en attente')} : ${money(outstanding ?? r.walletAmountCents)}.`);
  }
  if (!confirmed && r?.providerStatus === 'succeeded' && r.outstandingCardCents === 0) {
    result.lines.push('La portion sur le moyen de paiement est confirmée. Le traitement du solde lié à cette commande reste à vérifier.');
  }
  return result;
}

export function getFinancialErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error &&
    ['functions/failed-precondition', 'functions/permission-denied', 'functions/invalid-argument', 'functions/not-found'].includes(String(error.code))) {
    if ('message' in error && typeof error.message === 'string') return error.message;
  }
  return RESPONSE_UNCONFIRMED_MESSAGE;
}
