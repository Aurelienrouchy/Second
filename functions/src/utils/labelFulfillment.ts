/**
 * Shared label-fulfillment helpers (P1: atomic payment<->label + reconciliation)
 *
 * Single source of truth for:
 *  - crediting the seller's wallet pendingBalance for a sale (escrow), used by
 *    BOTH the Stripe webhook and payWithWallet AND the sweepPendingLabels retry
 *    job, so the credit happens exactly once and only AFTER the shipping label
 *    is successfully created.
 *  - reconciling the real ShipEngine label cost (shipment_cost + insurance_cost)
 *    against the estimated shippingCost billed to the buyer, persisting the
 *    delta on the transaction and writing a platform ledger entry + a CRITICAL
 *    log on a large mismatch.
 *
 * All amounts in the wallet/ledger are CENTS. The transaction `shippingCost` /
 * `actualShippingCost` fields are in DOLLARS (consistent with createTransaction).
 */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getOrCreateSellerWallet } from '../callable/wallet';
import type { ShipEngineLabel } from '../config/shipEngine';

/**
 * Threshold (in DOLLARS) above which a difference between the real label cost
 * and the estimated shippingCost billed to the buyer is treated as a critical
 * anomaly (logged at error level + recorded for accounting follow-up).
 */
export const SHIPPING_COST_MISMATCH_THRESHOLD = 2;

/**
 * Credits the seller's wallet `pendingBalance` for a delivered-pending sale and
 * persists `sellerCreditedCents` on the transaction. MUST be called inside a
 * runTransaction. Idempotent: if `sellerCreditedCents` is already set on the
 * transaction, this is a no-op (the seller was already credited).
 *
 * The caller is responsible for the transaction status update (e.g. -> 'shipped')
 * and for having read the transaction snapshot used to produce `txData`.
 *
 * @returns true if the seller was credited by this call, false if skipped
 *          (already credited / invalid payout).
 */
export async function creditSellerForSale(
  tx: FirebaseFirestore.Transaction,
  transactionRef: FirebaseFirestore.DocumentReference,
  txData: FirebaseFirestore.DocumentData,
  transactionId: string
): Promise<boolean> {
  // Idempotence: never credit twice for the same sale.
  if (typeof txData.sellerCreditedCents === 'number') {
    return false;
  }

  const sellerId = txData.sellerId;
  const sellerPayout = txData.sellerPayout ?? txData.amount;
  const sellerPayoutCents =
    typeof sellerPayout === 'number' ? Math.round(sellerPayout * 100) : 0;

  if (!sellerId || sellerPayoutCents <= 0) {
    logger.warn('[creditSellerForSale] missing sellerId/payout — not crediting', {
      transactionId,
      sellerId,
      sellerPayoutCents,
    });
    return false;
  }

  const {
    walletRef: sellerWalletRef,
    walletData: sellerWalletData,
    isNew: sellerWalletIsNew,
  } = await getOrCreateSellerWallet(tx, sellerId);

  // F39: recover any outstanding sellerDebt FIRST (the wallet copy promises
  // "vos prochaines ventes seront affectées à cette régularisation en priorité").
  // The credit pays down the debt before the remainder lands in pendingBalance.
  const sellerDebt = sellerWalletData.sellerDebt || 0;
  const debtRepayment = Math.min(sellerDebt, sellerPayoutCents);
  const toPending = sellerPayoutCents - debtRepayment;

  const walletUpdate: Record<string, any> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (debtRepayment > 0) walletUpdate.sellerDebt = FieldValue.increment(-debtRepayment);
  if (sellerWalletIsNew) {
    walletUpdate.pendingBalance = toPending;
  } else if (toPending > 0) {
    walletUpdate.pendingBalance = FieldValue.increment(toPending);
  }
  tx.update(sellerWalletRef, walletUpdate);

  if (debtRepayment > 0) {
    const debtLedgerRef = sellerWalletRef.collection('ledger').doc();
    tx.set(debtLedgerRef, {
      type: 'debt_repayment',
      amount: debtRepayment,
      balanceAfter: sellerDebt - debtRepayment,
      description: 'Vente — régularisation du solde dû',
      transactionId,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  if (toPending > 0) {
    const sellerLedgerRef = sellerWalletRef.collection('ledger').doc();
    tx.set(sellerLedgerRef, {
      type: 'sale_credit',
      amount: toPending,
      balanceAfter: (sellerWalletData.pendingBalance || 0) + toPending,
      description: 'Vente — fonds en attente de livraison',
      transactionId,
      createdAt: FieldValue.serverTimestamp(),
      status: 'pending',
    });
  }

  // Persist the EXACT amount credited so a later refund/dispute debits precisely
  // this figure (and records any shortfall as sellerDebt rather than masking it).
  tx.update(transactionRef, {
    sellerCreditedCents: sellerPayoutCents,
  });

  return true;
}

/**
 * Reconciles the real label cost against the estimated shippingCost billed to
 * the buyer. Persists `actualShippingCost` (dollars), `shippingCostDelta`
 * (actual - estimated, dollars) and `insuranceCost` on the transaction (these
 * fields are added to the `update` object so the CALLER commits them alongside
 * its other writes — this function does NOT call the network or Firestore for
 * the transaction itself).
 *
 * On a delta above SHIPPING_COST_MISMATCH_THRESHOLD it writes a
 * `platform_ledger` entry (best-effort, outside any transaction) and logs at
 * error level. Small deltas are absorbed by the buyer-protection fee.
 *
 * @param update mutable object the caller will pass to tx.update / .update()
 * @returns the computed delta in dollars (actual - estimated)
 */
export function reconcileShippingCost(
  label: ShipEngineLabel,
  estimatedShippingCost: number,
  transactionId: string,
  update: Record<string, any>
): number {
  const actual = (label.shipmentCost || 0) + (label.insuranceCost || 0);
  const estimated = typeof estimatedShippingCost === 'number' ? estimatedShippingCost : 0;
  const delta = Math.round((actual - estimated) * 100) / 100;

  update.actualShippingCost = actual;
  update.shippingCostDelta = delta;
  update.insuranceCost = label.insuranceCost || 0;
  update.shippingReconciledAt = FieldValue.serverTimestamp();

  logger.info('[reconcileShippingCost] label cost reconciled', {
    transactionId,
    estimated,
    actual,
    delta,
  });

  if (Math.abs(delta) > SHIPPING_COST_MISMATCH_THRESHOLD) {
    logger.error('CRITICAL shipping cost mismatch', {
      transactionId,
      estimated,
      actual,
      delta,
      threshold: SHIPPING_COST_MISMATCH_THRESHOLD,
    });

    // Best-effort platform ledger entry for accounting follow-up. Fire-and-forget:
    // a failure here must never block label fulfillment.
    db.collection('platform_ledger')
      .add({
        type: 'shipping_cost_variance',
        transactionId,
        estimatedShippingCost: estimated,
        actualShippingCost: actual,
        delta,
        currency: 'cad',
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch((err) => {
        logger.error('[reconcileShippingCost] failed to write platform_ledger entry', {
          transactionId,
          error: err instanceof Error ? err.message : err,
        });
      });
  }

  return delta;
}
