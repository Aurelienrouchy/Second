/**
 * Shared transaction-refund core.
 *
 * Single source of truth for the money-movement of a refund, extracted from
 * the original inline logic of `adminRefundTransaction` so that BOTH the
 * admin refund and the buyer-facing auto-refunds (requestRefund, return-leg
 * refund) reuse the EXACT same reverse_transfer / sellerDebt reconciliation.
 *
 * Two stages, in this order (Stripe MUST run outside the Firestore tx):
 *   1. Stripe refund of the card portion OUTSIDE the runTransaction, with a
 *      deterministic idempotency key so re-invocations never double-refund.
 *      Under the single-rail model EVERY charge is a platform charge (no
 *      transfer_data at capture), so the refund is a plain refunds.create on the
 *      platform PaymentIntent — there is NO transfer to reverse and NO
 *      application fee to claw back. The seller is debited in stage 2 via the
 *      wallet cascade (the seller was only ever credited in the wallet ledger,
 *      not on a connected account).
 *   2. Atomic Firestore reconciliation: re-credit any wallet portion to the
 *      buyer, debit the seller EXACTLY what was credited
 *      (pendingBalance -> heldBalance -> balance, shortfall -> sellerDebt),
 *      optionally re-list the article, mark the transaction 'refunded'.
 *
 * IMPORTANT: callers own the AUTHORIZATION and STATUS-PRECONDITION checks
 * (admin guard / buyer ownership / allowed statuses). This helper only owns
 * idempotence + money movement, and is safe to call repeatedly.
 *
 * All wallet/ledger amounts are CENTS. Transaction cost fields are DOLLARS.
 */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { writeFailedOperation } from './failedOperations';

export interface IssueRefundOptions {
  /** Free-text reason persisted on the transaction (truncated to 300 chars). */
  reason?: string;
  /**
   * Deterministic Stripe idempotency key. MUST be stable per logical refund so
   * retries never double-refund (e.g. `rf_admin_<txId>`, `rf_buyer_<txId>`).
   */
  idempotencyKey: string;
  /**
   * Whether to put the article back on sale. Admin disputes re-list by default
   * (article still exists); a lost/failed-parcel auto-refund must NOT re-list
   * (the item is gone). Defaults to true to preserve prior admin behaviour.
   */
  relistArticle?: boolean;
  /**
   * Extra cents to debit from the seller ON TOP of `sellerCreditedCents`
   * (e.g. a return label cost ruled against the seller). Defaults to 0.
   * The buyer credit is NOT affected by this — it only changes the seller debit.
   */
  extraSellerDebitCents?: number;
  /**
   * Override the buyer card/wallet refund and instead refund a specific amount
   * (in cents) of the wallet portion — reserved for the return-leg refund where
   * the buyer bears the return label cost. When omitted, the full paid amount
   * is refunded (card via Stripe, wallet portion re-credited). NOT used by B1.
   */
  buyerWalletRefundOverrideCents?: number;
  /**
   * Partial Stripe (card-portion) refund amount in CENTS. When provided (>= 0),
   * the Stripe refund is created with this exact `amount` instead of refunding
   * the full card portion — reserved for the return-leg refund (B2) where the
   * buyer bears the return label cost and is refunded `total - returnLabelCost`.
   * Capped server-side to never exceed the card portion actually charged. When
   * omitted, the full card portion is refunded (prior admin behaviour). A value
   * of 0 means "no card refund" (e.g. the label cost exceeds the card portion,
   * so the whole buyer refund comes out of the wallet portion).
   */
  cardRefundAmountCents?: number;
  /** Short tag for structured logs. */
  source?: string;
}

export interface IssueRefundResult {
  success: boolean;
  alreadyRefunded?: boolean;
}

/**
 * Execute a full refund for a transaction. Idempotent: a no-op (returning
 * `{ success: true, alreadyRefunded: true }`) if the transaction is already
 * `refunded`. The caller must have validated authorization and the status
 * precondition BEFORE calling this.
 *
 * @param transactionId the transaction doc id
 * @param preData       the already-read transaction data (used for the Stripe
 *                      call; the Firestore stage re-reads under the lock)
 * @param opts          refund options (idempotencyKey is required)
 */
export async function issueTransactionRefund(
  transactionId: string,
  preData: FirebaseFirestore.DocumentData,
  opts: IssueRefundOptions
): Promise<IssueRefundResult> {
  const source = opts.source ?? 'issueTransactionRefund';
  const txRef = db.collection('transactions').doc(transactionId);
  const stripe = getStripe();

  // Idempotence: already refunded — nothing to do.
  if (preData.status === 'refunded') {
    return { success: true, alreadyRefunded: true };
  }

  const paidVia = preData.paidVia;
  const isMixedCharge = paidVia === 'wallet_and_card' || paidVia === 'mixed';

  const extraSellerDebitCents =
    typeof opts.extraSellerDebitCents === 'number' && opts.extraSellerDebitCents > 0
      ? Math.round(opts.extraSellerDebitCents)
      : 0;
  const relistArticle = opts.relistArticle !== false; // default true

  // Card portion actually charged (cents): for a mixed wallet+card charge the
  // card covers `total - walletAmountUsed`; for a pure-card charge it covers the
  // full total. Used only to cap the partial card refund (return-leg, B2).
  const totalAmountCents = Math.round((preData.totalAmount || 0) * 100);
  const walletAmountUsedCents =
    typeof preData.walletAmountUsed === 'number' ? preData.walletAmountUsed : 0;
  const cardPortionCents = isMixedCharge
    ? Math.max(0, totalAmountCents - walletAmountUsedCents)
    : totalAmountCents;

  // Partial card refund (return-leg): refund exactly cardRefundAmountCents,
  // capped to the card portion charged. When omitted -> full card refund.
  const partialCardRefund =
    typeof opts.cardRefundAmountCents === 'number' && opts.cardRefundAmountCents >= 0;
  const cardRefundCents = partialCardRefund
    ? Math.min(Math.round(opts.cardRefundAmountCents!), cardPortionCents)
    : null;

  // --- Stripe refund (card portion) OUTSIDE the Firestore transaction ---
  // Skip the Stripe call entirely when a partial refund resolves to 0 card cents
  // (e.g. label cost >= card portion) — there is nothing to refund on the card.
  if (preData.stripePaymentIntentId && stripe && cardRefundCents !== 0) {
    try {
      await stripe.refunds.create(
        {
          payment_intent: preData.stripePaymentIntentId,
          // Partial card refund (return-leg) sets an explicit amount; otherwise
          // Stripe refunds the full remaining charge.
          ...(cardRefundCents !== null ? { amount: cardRefundCents } : {}),
          // Single-rail model: every charge is a platform charge, so there is
          // never a transfer to reverse nor an application fee to claw back.
          // The seller is debited via the wallet cascade in stage 2.
        },
        { idempotencyKey: opts.idempotencyKey }
      );
      logger.info('[issueTransactionRefund] Stripe refund created', {
        transactionId,
        source,
        paymentIntentId: preData.stripePaymentIntentId,
        amountCents: cardRefundCents,
      });
    } catch (refundErr) {
      logger.error('CRITICAL [issueTransactionRefund] Stripe refund failed', {
        transactionId,
        source,
        paymentIntentId: preData.stripePaymentIntentId,
        error: refundErr instanceof Error ? refundErr.message : refundErr,
      });
      // Dead-letter via the canonical helper so retryFailedOperations re-drives
      // it with the SAME deterministic idempotency key (replay = no-op if the
      // refund actually went through). Never throws.
      await writeFailedOperation({
        type: 'stripe_refund_failed',
        refId: transactionId,
        payload: {
          transactionId,
          paymentIntentId: preData.stripePaymentIntentId,
          idempotencyKey: opts.idempotencyKey,
          isMixedCharge,
          source,
        },
        error: refundErr,
      });
      throw new Error(
        'Stripe refund failed — operation recorded for retry, transaction not modified'
      );
    }
  }

  // --- Atomic Firestore reconciliation ---
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(txRef);
    if (!snap.exists) throw new Error('Transaction not found');
    const data = snap.data()!;

    // Idempotence inside the transaction.
    if (data.status === 'refunded') return;

    const buyerId = data.buyerId;
    const sellerId = data.sellerId;
    const walletAmountUsed = data.walletAmountUsed || 0; // cents
    const hasWalletPortion =
      walletAmountUsed > 0 &&
      (paidVia === 'wallet' || paidVia === 'wallet_and_card' || paidVia === 'mixed');

    // Debit the EXACT amount credited to the seller (0 if never credited),
    // plus any extra (e.g. return label cost ruled against the seller).
    const baseSellerDebit =
      typeof data.sellerCreditedCents === 'number' ? data.sellerCreditedCents : 0;
    const sellerDebitTarget = baseSellerDebit + extraSellerDebitCents;

    // Reads first.
    const buyerWalletRef =
      hasWalletPortion && buyerId ? db.collection('wallets').doc(buyerId) : null;
    const buyerWalletSnap = buyerWalletRef ? await tx.get(buyerWalletRef) : null;

    const sellerWalletRef =
      sellerDebitTarget > 0 && sellerId ? db.collection('wallets').doc(sellerId) : null;
    const sellerWalletSnap = sellerWalletRef ? await tx.get(sellerWalletRef) : null;

    const articleRef = data.articleId
      ? db.collection('articles').doc(data.articleId)
      : null;
    const articleSnap = articleRef ? await tx.get(articleRef) : null;

    // Writes.
    tx.update(txRef, {
      status: 'refunded',
      refundedAt: FieldValue.serverTimestamp(),
      refundedVia: preData.stripePaymentIntentId ? 'stripe' : 'wallet',
      refundReason:
        typeof opts.reason === 'string' ? opts.reason.substring(0, 300) : 'refund',
      disputed: false,
    });

    if (relistArticle && articleRef && articleSnap && articleSnap.exists) {
      tx.update(articleRef, { isSold: false });
    }

    // Re-credit buyer wallet portion (card portion goes back via Stripe).
    if (buyerWalletRef && buyerWalletSnap && buyerWalletSnap.exists) {
      let refundCents =
        paidVia === 'wallet'
          ? Math.round((data.totalAmount || 0) * 100)
          : walletAmountUsed;
      // Return-leg override: the buyer bears part of the cost, so we re-credit
      // a smaller wallet amount. Never exceed what was actually paid via wallet.
      if (
        typeof opts.buyerWalletRefundOverrideCents === 'number' &&
        opts.buyerWalletRefundOverrideCents >= 0
      ) {
        refundCents = Math.min(refundCents, Math.round(opts.buyerWalletRefundOverrideCents));
      }
      if (refundCents > 0) {
        const wd = buyerWalletSnap.data()!;
        tx.update(buyerWalletRef, {
          balance: FieldValue.increment(refundCents),
          updatedAt: FieldValue.serverTimestamp(),
        });
        const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
        tx.set(buyerLedgerRef, {
          type: 'refund_credit',
          amount: refundCents,
          balanceAfter: (wd.balance || 0) + refundCents,
          description: 'Remboursement — retour au porte-monnaie',
          transactionId,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // Debit seller across the three buckets in escrow order; shortfall = debt.
    if (sellerDebitTarget > 0 && sellerWalletRef) {
      if (sellerWalletSnap && sellerWalletSnap.exists) {
        const swd = sellerWalletSnap.data()!;
        const pendingNow = swd.pendingBalance || 0;
        const heldNow = swd.heldBalance || 0;
        const balanceNow = swd.balance || 0;

        const fromPending = Math.min(sellerDebitTarget, pendingNow);
        let remaining = sellerDebitTarget - fromPending;
        const fromHeld = Math.min(remaining, heldNow);
        remaining -= fromHeld;
        const fromBalance = Math.min(remaining, balanceNow);
        const shortfall = remaining - fromBalance;

        const walletUpdate: Record<string, any> = {
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (fromPending > 0) walletUpdate.pendingBalance = FieldValue.increment(-fromPending);
        if (fromHeld > 0) walletUpdate.heldBalance = FieldValue.increment(-fromHeld);
        if (fromBalance > 0) walletUpdate.balance = FieldValue.increment(-fromBalance);
        if (shortfall > 0) walletUpdate.sellerDebt = FieldValue.increment(shortfall);
        tx.update(sellerWalletRef, walletUpdate);

        const debited = fromPending + fromHeld + fromBalance;
        const sellerLedgerRef = sellerWalletRef.collection('ledger').doc();
        tx.set(sellerLedgerRef, {
          type: 'refund_debit',
          amount: debited,
          balanceAfter: balanceNow - fromBalance,
          description:
            shortfall > 0
              ? 'Remboursement — débit vendeur (dette enregistrée)'
              : 'Remboursement — débit vendeur',
          transactionId,
          createdAt: FieldValue.serverTimestamp(),
          ...(shortfall > 0 && { debtRecorded: shortfall }),
        });
      } else {
        // No wallet at all: record full target as debt.
        tx.set(
          sellerWalletRef,
          {
            sellerDebt: FieldValue.increment(sellerDebitTarget),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }
  });

  return { success: true };
}
