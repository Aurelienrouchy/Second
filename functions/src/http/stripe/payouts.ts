import { withFinancialRecoveryScope } from "../../utils/financialRecoveryInterlock";
/**
 * Webhook Stripe — Virement vers le compte connecté du vendeur.
 *
 * Éclaté depuis functions/src/http/webhooks.ts (2972 lignes). Le dispatcher
 * et la vérification de signature restent dans webhooks.ts.
 */
import * as logger from 'firebase-functions/logger';
import { getStripe } from '../../config/stripe';
import { observeWithdrawalPayout, revertFailedPayout } from '../../utils/payoutRecovery';
import { captureServerEvent } from '../../lib/analytics';

/**
 * A Stripe payout to the seller's bank failed (e.g. invalid bank account).
 * The wallet was already debited at walletWithdraw time, so we must re-credit
 * the withdrawn amount AND reverse the platform->connected transfer (otherwise
 * the funds stay stranded on the Custom account and the next withdrawal would
 * double-finance). Both effects live in the shared revertFailedPayout helper so
 * the reconciliation replay (lost webhook) can re-drive the EXACT same logic.
 *
 * The payout is matched to its withdrawal_requests doc via metadata.
 * withdrawalRequestId (set by walletWithdraw inside the debit transaction).
 * Idempotent via the withdrawal request status.
 */

export async function handlePayoutFailed(payout: any): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/payouts.handlePayoutFailed"}, async () => {
  const withdrawalRequestId = payout.metadata?.withdrawalRequestId;
  const userId = payout.metadata?.firebaseUserId;

  if (typeof withdrawalRequestId !== 'string' || !withdrawalRequestId) {
    logger.warn('Stripe webhook: payout.failed missing withdrawalRequestId metadata', {
      payoutId: payout.id,
    });
    return;
  }

  const outcome = await revertFailedPayout(
    {
      withdrawalRequestId,
      payoutId: payout.id,
      failureReason: 'provider_failed_payout',
      ownerIdFallback: typeof userId === 'string' ? userId : null,
      payoutProof: payout,
    },
    getStripe()
  );

  if (outcome.recoveryState === 'not_failed') return;
  logger.warn('Stripe webhook: payout.failed — withdrawal recovery outcome', {
    withdrawalRequestId,
    payoutId: payout.id,
    recoveryState: outcome.recoveryState, reCredited: outcome.reCredited,
  });

  // Analytics (§12): distinct_id = seller. $insert_id dedups a payout.failed +
  // payout.canceled pair for the same request.
  if (outcome.ownerId && ['recovered', 'awaiting_return'].includes(outcome.recoveryState)) {
    await captureServerEvent(outcome.ownerId, 'withdrawal_failed', {
      withdrawal_id: withdrawalRequestId,
      amount_cents: typeof payout.amount === 'number' ? payout.amount : 0,
      failure_code: 'provider_failed_payout',
      $insert_id: `withdrawal_failed_${withdrawalRequestId}`,
    });
  }

    });
  }

// =============================================================================
// HANDLER: payout.canceled (F42)
// =============================================================================

/**
 * A Stripe payout was canceled before reaching the bank. Identical financial
 * treatment to payout.failed: re-credit the wallet (debited at walletWithdraw
 * time) AND reverse the platform->connected transfer. revertFailedPayout is
 * idempotent via the withdrawal_requests status, so this is safe even if
 * payout.failed and payout.canceled both arrive for the same request.
 */

/**
 * A Stripe payout was canceled before reaching the bank. Identical financial
 * treatment to payout.failed: re-credit the wallet (debited at walletWithdraw
 * time) AND reverse the platform->connected transfer. revertFailedPayout is
 * idempotent via the withdrawal_requests status, so this is safe even if
 * payout.failed and payout.canceled both arrive for the same request.
 */

export async function handlePayoutCanceled(payout: any): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/payouts.handlePayoutCanceled"}, async () => {
  const withdrawalRequestId = payout.metadata?.withdrawalRequestId;
  const userId = payout.metadata?.firebaseUserId;

  if (typeof withdrawalRequestId !== 'string' || !withdrawalRequestId) {
    logger.warn('Stripe webhook: payout.canceled missing withdrawalRequestId metadata', {
      payoutId: payout.id,
    });
    return;
  }

  const outcome = await revertFailedPayout(
    {
      withdrawalRequestId,
      payoutId: payout.id,
      failureReason: 'payout canceled',
      ownerIdFallback: typeof userId === 'string' ? userId : null,
      payoutProof: payout,
    },
    getStripe()
  );

  if (outcome.recoveryState === 'not_failed') return;
  logger.warn('Stripe webhook: payout.canceled — withdrawal recovery outcome', {
    withdrawalRequestId,
    payoutId: payout.id,
    recoveryState: outcome.recoveryState, reCredited: outcome.reCredited,
  });

  // Analytics (§12): a canceled payout never reached the bank — treat as failed.
  if (outcome.ownerId && ['recovered', 'awaiting_return'].includes(outcome.recoveryState)) {
    await captureServerEvent(outcome.ownerId, 'withdrawal_failed', {
      withdrawal_id: withdrawalRequestId,
      amount_cents: typeof payout.amount === 'number' ? payout.amount : 0,
      failure_code: 'payout_canceled',
      $insert_id: `withdrawal_failed_${withdrawalRequestId}`,
    });
  }

    });
  }

// =============================================================================
// HANDLER: payout.paid
// =============================================================================

/** A signed paid event triggers a current provider observation. The exact
 * account, payout, transfer and native debit authorize bookkeeping; the event
 * itself cannot adopt another payout or overwrite a later failed outcome. */
export async function handlePayoutPaid(payout: any): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/payouts.handlePayoutPaid"}, async () => {
  const withdrawalRequestId = payout.metadata?.withdrawalRequestId;
  if (typeof withdrawalRequestId !== 'string' || !withdrawalRequestId) {
    logger.warn('Stripe webhook: payout.paid missing withdrawalRequestId metadata', { payoutId: payout.id });
    return;
  }
  const outcome = await observeWithdrawalPayout(withdrawalRequestId, getStripe(), typeof payout.id === 'string' ? payout.id : null);
  logger.info('Stripe webhook: withdrawal current outcome', { withdrawalRequestId, payoutId: outcome.payoutId,
    state: outcome.state, completedNow: outcome.completedNow });
  if (outcome.state === 'paid' && outcome.completedNow && outcome.ownerId) {
    await captureServerEvent(outcome.ownerId, 'withdrawal_paid', {
      withdrawal_id: withdrawalRequestId, amount_cents: outcome.amountCents!, days_to_payout: outcome.daysToPayout,
      $insert_id: `withdrawal_paid_${withdrawalRequestId}`,
    });
  }

    });
  }
