/**
 * Shared payout-failure recovery (F36/F99).
 *
 * Single source of truth for reverting a FAILED Stripe payout, reused by BOTH:
 *   - the payout.failed webhook (handlePayoutFailed), and
 *   - the reconciliation replay (reconcileWithdrawals -> retryFailedOperations)
 *     when that webhook is lost.
 *
 * Two effects, both idempotent:
 *   1. WALLET RE-CREDIT: a payout to the seller's bank failed, but the wallet was
 *      already debited at walletWithdraw time. Re-credit the withdrawn amount to
 *      `balance` and mark the withdrawal_requests doc 'failed'. Idempotent via the
 *      request status (only acts while it is still 'processing').
 *   2. TRANSFER REVERSAL: walletWithdraw moved the funds platform->connected with
 *      a transfer BEFORE the payout. A failed payout leaves those funds stranded
 *      on the Custom account, so the next withdrawal would double-finance. Reverse
 *      the transfer (idempotent key `rev_${transferId}`); dead-letter on failure.
 *
 * All amounts are CENTS.
 */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { writeFailedOperation } from './failedOperations';
import { getStripe } from '../config/stripe';

type StripeClient = ReturnType<typeof getStripe>;

export interface RevertFailedPayoutInput {
  withdrawalRequestId: string;
  /** Stripe payout id (for bookkeeping on the request doc). */
  payoutId?: string | null;
  /** Failure reason persisted on the request doc. */
  failureReason?: string | null;
  /** Caller's userId fallback (webhook metadata) when the doc lacks one. */
  ownerIdFallback?: string | null;
}

export interface RevertFailedPayoutResult {
  /** true if this call re-credited the wallet (false = already-failed no-op). */
  reCredited: boolean;
  /** the transfer id read off the request doc (reversed best-effort). */
  transferId: string | null;
}

/**
 * Re-credit the wallet for a failed payout and reverse the underlying transfer.
 * Idempotent: re-credits only while the withdrawal_requests doc is 'processing'.
 * The transfer reversal uses a deterministic key so re-driving it is safe.
 */
export async function revertFailedPayout(
  input: RevertFailedPayoutInput,
  stripe: StripeClient
): Promise<RevertFailedPayoutResult> {
  const { withdrawalRequestId } = input;
  const requestRef = db.collection('withdrawal_requests').doc(withdrawalRequestId);

  let reCredited = false;
  let transferId: string | null = null;

  await db.runTransaction(async (tx) => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists) {
      logger.warn('[revertFailedPayout] withdrawal request not found', {
        withdrawalRequestId,
        payoutId: input.payoutId,
      });
      return;
    }

    const request = requestSnap.data()!;
    transferId =
      typeof request.stripeTransferId === 'string' ? request.stripeTransferId : null;

    // Idempotence: only act on a request still in flight. A request already
    // 'failed'/'completed'/'reverted' has already been reconciled.
    if (request.status !== 'processing') {
      logger.info('[revertFailedPayout] request not processing — skipping re-credit', {
        withdrawalRequestId,
        currentStatus: request.status,
      });
      return;
    }

    const amount = request.amount; // CENTS
    const ownerId = request.userId || input.ownerIdFallback || null;

    if (typeof amount === 'number' && amount > 0 && ownerId) {
      const walletRef = db.collection('wallets').doc(ownerId);
      const walletSnap = await tx.get(walletRef);
      if (walletSnap.exists) {
        const walletData = walletSnap.data()!;
        tx.update(walletRef, {
          balance: FieldValue.increment(amount),
          updatedAt: FieldValue.serverTimestamp(),
        });
        const ledgerRef = walletRef.collection('ledger').doc();
        tx.set(ledgerRef, {
          type: 'withdrawal_failed',
          amount,
          balanceAfter: (walletData.balance || 0) + amount,
          description: 'Retrait échoué — fonds restitués',
          withdrawalRequestId,
          createdAt: FieldValue.serverTimestamp(),
        });
        reCredited = true;
      } else {
        logger.warn('[revertFailedPayout] wallet not found — cannot re-credit', {
          withdrawalRequestId,
          ownerId,
        });
      }
    }

    tx.update(requestRef, {
      status: 'failed',
      failedAt: FieldValue.serverTimestamp(),
      stripePayoutId: input.payoutId ?? request.stripePayoutId ?? null,
      failureReason: input.failureReason ?? request.failureReason ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  // Reverse the platform->connected transfer so the funds do not stay stranded
  // on the Custom account (which would double-finance the next withdrawal). This
  // runs OUTSIDE the runTransaction (Stripe network) and is idempotent via the
  // deterministic key. Best-effort: a failure is dead-lettered, never thrown.
  if (transferId && stripe) {
    try {
      await stripe.transfers.createReversal(
        transferId,
        {},
        { idempotencyKey: `rev_${transferId}` }
      );
      logger.info('[revertFailedPayout] transfer reversed', {
        withdrawalRequestId,
        transferId,
      });
    } catch (reversalErr) {
      logger.error('CRITICAL [revertFailedPayout] transfer reversal failed', {
        withdrawalRequestId,
        transferId,
        error: reversalErr instanceof Error ? reversalErr.message : reversalErr,
      });
      await writeFailedOperation({
        type: 'transfer_reversal_failed',
        refId: withdrawalRequestId,
        payload: {
          transferId,
          withdrawalRequestId,
        },
        error: reversalErr,
      });
    }
  } else if (!transferId) {
    logger.warn('[revertFailedPayout] no stripeTransferId on request — cannot reverse transfer', {
      withdrawalRequestId,
      payoutId: input.payoutId,
    });
  }

  return { reCredited, transferId };
}
