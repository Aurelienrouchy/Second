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
import { Timestamp } from 'firebase-admin/firestore';
import { db, FieldValue } from '../config/firebase';
import { getOrCreateSellerWallet } from '../callable/wallet';
import { getStripe } from '../config/stripe';
import type { ShipEngineClient, ShipEngineLabel } from '../config/shipEngine';
import { captureServerEvent } from '../lib/analytics';

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
 * F39: any outstanding `sellerDebt` is regularised FIRST — the credit pays down
 * the debt before the remainder is added to pendingBalance — so future sales
 * automatically clear the debt (as promised in the wallet copy).
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

/**
 * E6 / F133(c) — Platform revenue accounting. Writes the platform's GROSS revenue
 * for ONE successful purchase transaction into `platform_ledger`, so net margin
 * per transaction is computable (revenue − processor fees − shipping cost).
 *
 * Idempotent by DETERMINISTIC doc id (`service_fee_revenue_${transactionId}`):
 * a replayed PI.succeeded (handled defensively by the webhook's stripe_events
 * dedup + per-handler status guards) writes the same id, so a `set` is a no-op
 * overwrite — exactly one revenue entry per transaction.
 *
 * Entries written (best-effort; a ledger failure must NEVER block the webhook —
 * the payment is already committed):
 *   - `service_fee_revenue`: serviceFee (+ tax if collected) + shippingCost
 *     collected from the buyer. Records `processorFees` (Stripe fee on the
 *     charge, read from the balance_transaction) when resolvable, leaving net
 *     margin = serviceFee − processorFees − shippingCostVariance computable.
 *   - `tax_collected` (only when taxTotal > 0): the TPS/TVQ remittance register
 *     entry. Activation is a fondateur fiscal decision (see utils/fees.ts).
 *
 * All amounts in DOLLARS (consistent with the transaction fields).
 *
 * @param chargeId Stripe charge id (paymentIntent.latest_charge) to resolve the
 *                 processor fee from its balance_transaction. Optional.
 */
export async function recordTransactionRevenue(params: {
  transactionId: string;
  sellerId: string;
  serviceFee: number;
  shippingCost: number;
  taxTotal: number;
  chargeId?: string | null;
}): Promise<void> {
  const { transactionId, sellerId, serviceFee, shippingCost, taxTotal, chargeId } = params;

  // Best-effort processor fee from the Stripe balance_transaction (frais Stripe
  // payés par la plateforme). A failure here only omits the fee — gross revenue
  // is still recorded so the entry is never lost.
  let processorFees: number | null = null;
  try {
    if (chargeId) {
      const stripe = getStripe();
      if (stripe) {
        const charge = await stripe.charges.retrieve(chargeId, {
          expand: ['balance_transaction'],
        });
        const bt = (charge as any)?.balance_transaction;
        if (bt && typeof bt.fee === 'number') {
          processorFees = Math.round(bt.fee) / 100; // cents → dollars
        }
      }
    }
  } catch (err) {
    logger.warn('[recordTransactionRevenue] could not resolve processor fee', {
      transactionId,
      chargeId,
      error: err instanceof Error ? err.message : err,
    });
  }

  try {
    const revenueRef = db.collection('platform_ledger').doc(`service_fee_revenue_${transactionId}`);
    const revenue: Record<string, any> = {
      type: 'service_fee_revenue',
      transactionId,
      sellerId,
      serviceFee: serviceFee || 0,
      taxCollected: taxTotal || 0,
      shippingCostCollected: shippingCost || 0,
      grossRevenue: Math.round(((serviceFee || 0) + (taxTotal || 0) + (shippingCost || 0)) * 100) / 100,
      currency: 'cad',
      createdAt: FieldValue.serverTimestamp(),
    };
    if (processorFees !== null) {
      revenue.processorFees = processorFees;
      // Net of processor fees + shipping cost the platform must pay the carrier.
      revenue.netMargin = Math.round(
        ((serviceFee || 0) - processorFees - (shippingCost || 0)) * 100
      ) / 100;
    }
    await revenueRef.set(revenue);

    // Tax remittance register (only when actually collected — TAX_ENABLED=true).
    if (taxTotal && taxTotal > 0) {
      const taxRef = db.collection('platform_ledger').doc(`tax_collected_${transactionId}`);
      await taxRef.set({
        type: 'tax_collected',
        transactionId,
        taxTotal,
        currency: 'cad',
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    logger.info('[recordTransactionRevenue] platform revenue recorded', {
      transactionId,
      serviceFee,
      taxTotal,
      shippingCost,
      processorFees,
    });
  } catch (err) {
    logger.error('[recordTransactionRevenue] failed to write platform_ledger revenue entry', {
      transactionId,
      error: err instanceof Error ? err.message : err,
    });
  }
}

/**
 * F5/F82 — Idempotent, double-spend-safe shipping label creation.
 *
 * PROBLEM
 * -------
 * `shipEngine.createLabel(rateId)` is a PAID external call that is NOT idempotent
 * (ShipEngine bills a new label every time). The previous flow called it OUTSIDE
 * any guard, then persisted `shipEngineLabelId` in a follow-up transaction. If
 * the webhook timed out (or a concurrent sweep run / Stripe retry re-entered)
 * between the external call and the persist, a SECOND paid label was created.
 *
 * SOLUTION — three phases:
 *   1. RESERVE (atomic): only proceed if no `shipEngineLabelId` is already set AND
 *      no fresh `labelReservationAt` lock is held (TTL'd so a crashed run cannot
 *      wedge the tx forever). Claims the reservation. Returns 'skip' otherwise.
 *   2. CREATE (external): call ShipEngine ONCE. Only reachable when WE hold the
 *      reservation, so two concurrent runners can never both reach this line.
 *   3. COMMIT (atomic): re-read under the lock; if a label was somehow already
 *      persisted, no-op (idempotent). Otherwise credit the seller, persist the
 *      label fields, clear the reservation, mark 'label_created'. On any failure
 *      after RESERVE, the reservation is cleared so a later run can retry.
 *
 * @param applyExtraUpdate optional hook to merge extra fields into the commit
 *        update (e.g. shipEngineRateId on the sweep retry). Receives the label.
 * @returns 'created' (label made + committed), 'skip' (already labelled / locked),
 *          or 'failed' (external/commit error — reservation cleared, retry later).
 */
export async function createLabelIdempotent(params: {
  transactionRef: FirebaseFirestore.DocumentReference;
  transactionId: string;
  rateId: string;
  shipEngine: ShipEngineClient;
  estimatedShippingCost: number;
  reservationTtlMs?: number;
  applyExtraUpdate?: (label: ShipEngineLabel, update: Record<string, any>) => void;
}): Promise<'created' | 'skip' | 'failed'> {
  const {
    transactionRef,
    transactionId,
    rateId,
    shipEngine,
    estimatedShippingCost,
  } = params;
  const reservationTtlMs = params.reservationTtlMs ?? 5 * 60 * 1000; // 5 min

  // ---- Phase 1: RESERVE (atomic) ----
  const reserved = await db.runTransaction(async (tx) => {
    const snap = await tx.get(transactionRef);
    const data = snap.data();
    if (!data) return false;

    // Already labelled / advanced — nothing to do.
    if (
      data.shipEngineLabelId ||
      data.status === 'label_created' ||
      data.status === 'shipped' ||
      data.status === 'delivered'
    ) {
      return false;
    }

    // Another runner holds a FRESH reservation — back off (it is creating the
    // label right now). An expired reservation (crashed run) is reclaimable.
    const reservedAtMs =
      data.labelReservationAt instanceof Timestamp ? data.labelReservationAt.toMillis() : 0;
    if (reservedAtMs > 0 && Date.now() - reservedAtMs < reservationTtlMs) {
      return false;
    }

    tx.update(transactionRef, {
      labelReservationAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (!reserved) {
    logger.info('[createLabelIdempotent] reservation not acquired — skipping', { transactionId });
    return 'skip';
  }

  // ---- Phase 2: CREATE (external, exactly once — we hold the reservation) ----
  let label: ShipEngineLabel;
  try {
    label = await shipEngine.createLabel(rateId);
  } catch (labelError) {
    // Clear the reservation so a later run can retry the (paid) creation.
    await transactionRef
      .update({ labelReservationAt: FieldValue.delete() })
      .catch(() => undefined);
    logger.error('[createLabelIdempotent] createLabel failed — reservation cleared', {
      transactionId,
      error: labelError instanceof Error ? labelError.message : labelError,
    });
    return 'failed';
  }

  // ---- Phase 3: COMMIT (atomic) ----
  let labelSellerId: string | null = null;
  let labelService = '';
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(transactionRef);
      const data = snap.data();
      if (!data) return;
      // Idempotence: a concurrent path persisted the label first — no-op.
      if (
        data.shipEngineLabelId ||
        data.status === 'label_created' ||
        data.status === 'shipped' ||
        data.status === 'delivered'
      ) {
        return;
      }

      labelSellerId = typeof data.sellerId === 'string' ? data.sellerId : null;
      labelService =
        typeof data.shipEngineServiceCode === 'string'
          ? data.shipEngineServiceCode
          : typeof data.serviceCode === 'string'
            ? data.serviceCode
            : '';

      await creditSellerForSale(tx, transactionRef, data, transactionId);

      const update: Record<string, any> = {
        trackingNumber: label.trackingNumber,
        shippingLabelUrl: label.labelDownload.href,
        trackingUrl: label.trackingUrl,
        carrierCode: label.carrierCode,
        trackingStatus: 'LABEL_CREATED',
        shipEngineLabelId: label.labelId,
        status: 'label_created',
        labelCreatedAt: FieldValue.serverTimestamp(),
        labelCreationPending: false,
        labelReservationAt: FieldValue.delete(),
      };
      reconcileShippingCost(label, estimatedShippingCost, transactionId, update);
      if (params.applyExtraUpdate) params.applyExtraUpdate(label, update);
      tx.update(transactionRef, update);
    });
  } catch (commitErr) {
    // The label EXISTS on ShipEngine but we failed to persist it. Do NOT clear
    // the reservation blindly — clearing it would let a later run create a SECOND
    // paid label. Persist the label id best-effort so the next run's reservation
    // guard sees it and skips re-creation; surface the divergence.
    logger.error('CRITICAL [createLabelIdempotent] label created but commit failed', {
      transactionId,
      shipEngineLabelId: label.labelId,
      error: commitErr instanceof Error ? commitErr.message : commitErr,
    });
    await transactionRef
      .update({
        shipEngineLabelId: label.labelId,
        trackingNumber: label.trackingNumber,
        labelReservationAt: FieldValue.delete(),
      })
      .catch(() => undefined);
    return 'failed';
  }

  return 'created';
}
