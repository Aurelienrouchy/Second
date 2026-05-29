/**
 * Return-leg refund handler (B2 anti-fraud guarantee).
 *
 * Single source of truth for the money-movement triggered when a RETURN parcel
 * (created by callable/recourse.ts:requestReturn) is confirmed DELIVERED back to
 * the SELLER by the carrier. This is the anti-fraud guarantee: a return is NEVER
 * refunded on the buyer's word — only once the carrier confirms the seller has
 * physically received the item back.
 *
 * Reuses the shared issueTransactionRefund core with:
 *   - cardRefundAmountCents       — partial card refund of `total - returnLabelCost`
 *   - buyerWalletRefundOverrideCents — wallet portion of the same reduced refund
 *   - relistArticle: false        — the seller has the item back; an admin/seller
 *                                   re-lists it manually (we do not auto-relist).
 * The buyer bears the return label cost (refund = total - returnLabelCost); the
 * seller is debited exactly their `sellerCreditedCents` (shortfall -> sellerDebt),
 * which the refund core handles.
 *
 * IDEMPOTENT: a no-op if the transaction is already `refunded`; the Stripe call
 * is keyed on a deterministic idempotency key so a replayed DELIVERED signal
 * never double-refunds. Safe to call from BOTH the poller and the webhook.
 *
 * All wallet/ledger amounts are CENTS. Transaction cost fields are DOLLARS.
 */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { issueTransactionRefund } from './refund';
import { sendPushNotification } from './notifications';

export interface ReturnRefundResult {
  /** Whether a refund was issued (or already had been). */
  refunded: boolean;
  /** True when the transaction was already refunded before this call. */
  alreadyRefunded?: boolean;
}

/**
 * Process the carrier-confirmed reception of a RETURN parcel.
 *
 * Refunds the buyer `total - returnLabelCost`, debits the seller their payout,
 * marks the transaction `refunded` and stamps `returnDeliveredAt`. Status-guarded
 * (only acts on `return_requested`) and idempotent.
 *
 * @param transactionId the transaction doc id
 * @param source        short tag for structured logs ('poller' | 'webhook')
 * @returns whether a refund was issued
 */
export async function processReturnDelivered(
  transactionId: string,
  source: string
): Promise<ReturnRefundResult> {
  const txRef = db.collection('transactions').doc(transactionId);
  const preSnap = await txRef.get();
  if (!preSnap.exists) {
    return { refunded: false };
  }
  const preData = preSnap.data()!;

  // Idempotence: already refunded — nothing to do.
  if (preData.status === 'refunded') {
    return { refunded: false, alreadyRefunded: true };
  }

  // Status guard: only a transaction whose return is in progress can be refunded
  // by the return-leg signal. Any other status is a no-op (defends against a
  // stray DELIVERED scan matching the return tracking number after resolution).
  if (preData.status !== 'return_requested') {
    return { refunded: false };
  }

  // Compute the buyer refund: total paid MINUS the return label cost the buyer
  // bears. Clamp to >= 0 in case label cost somehow exceeds the total.
  const totalAmountCents = Math.round((preData.totalAmount || 0) * 100);
  const returnLabelCostCents = Math.round((preData.returnLabelCost || 0) * 100);
  const buyerRefundCents = Math.max(0, totalAmountCents - returnLabelCostCents);

  // Split the buyer refund across the card portion (Stripe partial refund) and
  // the wallet portion. Card portion charged = total - walletAmountUsed (mixed)
  // or full total (pure card). Refund card first, then the wallet remainder.
  const paidVia = preData.paidVia;
  const isMixedCharge = paidVia === 'wallet_and_card' || paidVia === 'mixed';
  const walletAmountUsedCents =
    typeof preData.walletAmountUsed === 'number' ? preData.walletAmountUsed : 0;
  const cardPortionCents = preData.stripePaymentIntentId
    ? isMixedCharge
      ? Math.max(0, totalAmountCents - walletAmountUsedCents)
      : totalAmountCents
    : 0;

  const cardRefundCents = Math.min(buyerRefundCents, cardPortionCents);
  const walletRefundCents = buyerRefundCents - cardRefundCents;

  let result;
  try {
    result = await issueTransactionRefund(transactionId, preData, {
      reason: `buyer_return_refund_${preData.returnReason || 'return'}`,
      // Deterministic per logical refund so a replayed DELIVERED signal no-ops.
      idempotencyKey: `rf_return_${transactionId}`,
      // Seller has the item back; do NOT auto-relist (manual decision).
      relistArticle: false,
      // Buyer bears the return label cost: refund total - returnLabelCost.
      cardRefundAmountCents: cardRefundCents,
      buyerWalletRefundOverrideCents: walletRefundCents,
      source: `returnRefund_${source}`,
    });
  } catch (error: unknown) {
    // issueTransactionRefund dead-letters Stripe failures for retry and throws;
    // we surface the error so the caller logs domain context and (webhook) 500s
    // for a ShipEngine retry. The transaction is NOT mutated on failure.
    logger.error('[processReturnDelivered] return refund failed', {
      transactionId,
      source,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }

  // Stamp the return-delivered marker (idempotent merge — issueTransactionRefund
  // already set status -> 'refunded' atomically; this only adds the timestamp).
  await txRef
    .update({ returnDeliveredAt: FieldValue.serverTimestamp() })
    .catch((err) =>
      logger.warn('[processReturnDelivered] returnDeliveredAt stamp failed', {
        transactionId,
        error: err instanceof Error ? err.message : err,
      })
    );

  if (result.alreadyRefunded) {
    return { refunded: false, alreadyRefunded: true };
  }

  // Best-effort notifications to both parties.
  const articleTitle = preData.articleTitle || 'votre commande';
  const payload = { transactionId, articleId: preData.articleId || '' };
  if (preData.buyerId) {
    sendPushNotification(
      preData.buyerId,
      'Retour reçu — remboursement effectué',
      `Le vendeur a reçu le retour de "${articleTitle}". Vous avez été remboursé (hors frais de retour).`,
      payload,
      'order_refunded'
    ).catch((err) =>
      logger.warn('[processReturnDelivered] buyer notification failed', {
        transactionId,
        error: err instanceof Error ? err.message : err,
      })
    );
  }
  if (preData.sellerId) {
    sendPushNotification(
      preData.sellerId,
      'Retour reçu',
      `Vous avez reçu le retour de "${articleTitle}". L'acheteur a été remboursé.`,
      payload,
      'order_refunded'
    ).catch((err) =>
      logger.warn('[processReturnDelivered] seller notification failed', {
        transactionId,
        error: err instanceof Error ? err.message : err,
      })
    );
  }

  logger.warn('[processReturnDelivered] return-leg refund completed', {
    transactionId,
    source,
    buyerRefundCents,
    cardRefundCents,
    walletRefundCents,
    returnLabelCostCents,
  });

  return { refunded: true };
}
