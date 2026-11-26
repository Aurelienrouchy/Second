import { FinancialRecoveryBlocked } from "../utils/financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
/**
 * Scheduled reconciliation jobs — catch silent money divergences (P1 ops)
 * Firebase Functions v2 - onSchedule, region northamerica-northeast1
 *
 * Three independent passes, each DETECTION-ONLY (no auto-mutation of money):
 * they emit a `CRITICAL` log line per divergence so a log-based alert can page a
 * human, and dead-letter the actionable ones into `failed_operations` so
 * retryFailedOperations can re-drive them. Detection-only is deliberate:
 * auto-"fixing" a divergence we don't fully understand risks compounding the
 * loss. Webhooks remain the primary path; these jobs are the safety net.
 *
 *  1. reconcilePayments     — transactions stuck in pending_payment / paid whose
 *                             Stripe PaymentIntent actually succeeded/refunded
 *                             (webhook lost) → re-drive via dead-letter / log.
 *  2. reconcileWithdrawals  — withdrawal_requests stuck 'processing' long after
 *                             creation whose Stripe payout already paid/failed
 *                             (payout webhook lost) → reconcile from Stripe.
 *  3. reconcileBalances     — wallet invariant checks (no negative bucket,
 *                             no negative debt, processing-withdrawal sanity).
 *
 * Runs every 6 hours (spaced safety net; webhooks handle the happy path).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { writeFailedOperation, writeAdminAlert } from '../utils/failedOperations';
import { observeWithdrawalPayout } from '../utils/payoutRecovery';
import { observePurchaseRefund, reconcileCanceledPurchase, observeArchivedPurchaseRefunds } from '../utils/refund';
import {observePurchaseRefundRepairs} from '../utils/refundRepair';
import { recordCheckoutReconciliation } from '../utils/paymentCheckoutReconciliation';
import { nativeTime, nativeUnknownStripeConfirmation } from '../utils/stripeCheckoutProof';
import { reconcileFraudReviews } from '../utils/fraudReviewReconciliation';
import { inspectWalletInvariants } from '../utils/walletInvariantScan';

/** Only inspect transactions older than this (let webhooks land first). */
const PAYMENT_STALE_MS = 30 * 60 * 1000; // 30 min

/** Only inspect withdrawals stuck 'processing' longer than this. */
const WITHDRAWAL_STALE_MS = 60 * 60 * 1000; // 1 hour

/** Bound the docs each pass pulls per run. */
const MAX_PER_RUN = 200;

/** Process Stripe-bound work in small concurrent lots. */
const LOT_SIZE = 10;

/** Pending operator dossiers remain in place: rotate the bounded payment scan
 * so they cannot permanently hide later payments. Reuses status/createdAt ASC. */
async function paymentPage(status: 'pending_payment' | 'paid', cutoff: Date) {
  const cursorRef = db.collection('job_locks').doc(`reconcilePayments_${status}_cursor`);
  const cursor = (await cursorRef.get()).data();
  const query = db.collection('transactions').where('status', '==', status).where('createdAt', '<', cutoff)
    .orderBy('createdAt', 'asc').orderBy('__name__', 'asc').limit(MAX_PER_RUN);
  const valid = nativeTime(cursor?.createdAt) && typeof cursor?.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(cursor.id);
  let snapshot = await (valid ? query.startAfter(cursor!.createdAt, cursor!.id) : query).get();
  if (snapshot.empty && valid) snapshot = await query.get();
  return {snapshot, cursorRef};
}

/** F75: page size when scanning ALL wallets for invariant breaches. */
const WALLET_PAGE_SIZE = 500;

/** F75: hard ceiling so the wallet scan can never run unbounded. */
const BALANCE_SCAN_HARD_CAP = 100_000;

type StripeClient = ReturnType<typeof getStripe>;

// =============================================================================
// 1. reconcilePayments — recover lost payment_intent webhooks
// =============================================================================

/**
 * For a transaction whose Stripe PaymentIntent shows succeeded/refunded but
 * whose Firestore status never advanced (lost webhook), log CRITICAL and
 * dead-letter so the discrepancy is visible and (where safe) auto-handled.
 *
 * We do NOT directly mutate the transaction here — the canonical PI.succeeded /
 * charge.refunded handlers own those state machines (credit seller, label,
 * etc.). Re-driving them blindly from a reconciler would duplicate logic and
 * risk double-credits. Instead we surface the divergence; the lost-webhook can
 * also be replayed from the Stripe dashboard.
 */
async function reconcileOnePayment(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  stripe: StripeClient
): Promise<boolean> {
  const transactionId = doc.id;
  const data = doc.data();
  const paymentIntentId = data.stripePaymentIntentId;

  if (!paymentIntentId && (data.walletCheckoutOutcome === 'unknown' || data.walletCheckoutOutcome === 'creating')) {
    await writeAdminAlert({ kind: 'checkout_outcome_unknown', severity: 'critical', refId: transactionId,
      message: 'Résultat du paiement à vérifier avant toute restitution du porte-monnaie.',
      context: { transactionId, checkoutAttemptId: data.walletCheckoutAttemptId ?? null } });
    return true;
  }

  if (typeof paymentIntentId !== 'string' || !paymentIntentId || !stripe) {
    return false;
  }

  let piStatus: string | undefined;
  let amountReceived = 0;
  let amountRefunded = 0;
  let amountCaptured = 0;
  let observedPaymentIntent: unknown;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    });
    piStatus = pi.status;
    observedPaymentIntent = pi;
    amountReceived = pi.amount_received ?? pi.amount ?? 0;
    const charge = (pi as any).latest_charge;
    if (charge && typeof charge === 'object') {
      amountRefunded = typeof charge.amount_refunded === 'number' ? charge.amount_refunded : 0;
      amountCaptured =
        typeof charge.amount_captured === 'number'
          ? charge.amount_captured
          : typeof charge.amount === 'number'
            ? charge.amount
            : 0;
    }
  } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
    logger.warn('[reconcilePayments] PI retrieve failed — skipping', {
      transactionId,
      paymentIntentId,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }

  const status = data.status;

  // Authorization is neither captured payment nor an unpaid cancellation.
  // Keep a bounded, deterministic operator dossier instead of silently waiting
  // for a capture operation this purchase rail does not implement.
  if (piStatus === 'requires_capture' && status === 'pending_payment') {
    await recordCheckoutReconciliation(transactionId, observedPaymentIntent, data,
      'authorization_unsettled', 'reconcilePayments');
    return true;
  }

  if (piStatus === 'processing' && status === 'pending_payment') {
    const intent = (await db.collection('stripe_checkout_intents').doc(transactionId).get()).data();
    const authorization = intent?.authorizedAt;
    const authorizedAtMs = nativeTime(authorization) ? authorization instanceof Date ? authorization.getTime() : authorization.toMillis() : null;
    // Internal review threshold only, never a universal provider timeout or
    // permission to cancel/refund a processing payment. Recent confirms wait.
    if (authorizedAtMs !== null && Date.now() - authorizedAtMs < PAYMENT_STALE_MS) return false;
    await recordCheckoutReconciliation(transactionId, observedPaymentIntent, data, 'processing_unsettled', 'reconcilePayments',
      authorizedAtMs === null ? 'processing_age_unqualified' : undefined);
    return true;
  }

  if (['requires_payment_method', 'requires_confirmation'].includes(piStatus ?? '') && status === 'pending_payment') {
    const intent = (await db.collection('stripe_checkout_intents').doc(transactionId).get()).data();
    const existingMixedUncertainty = typeof data.walletAmountUsed === 'number' && data.walletAmountUsed > 0 &&
      (['confirming', 'unknown'].includes(intent?.state) || ['creating', 'unknown'].includes(data.walletCheckoutOutcome));
    const nativeConfirmUnknown = nativeUnknownStripeConfirmation(transactionId, data, intent, observedPaymentIntent);
    if (existingMixedUncertainty || nativeConfirmUnknown) {
      const authorization = intent?.authorizedAt;
      const authorizedAtMs = nativeTime(authorization) ? authorization instanceof Date ? authorization.getTime() : authorization.toMillis() : null;
      if (authorizedAtMs !== null && Date.now() - authorizedAtMs < PAYMENT_STALE_MS) return false;
      // A present unconfirmed PI is NOT proof that the earlier confirm request
      // cannot still execute. Preserve the exact reserved debit and version;
      // operator observation grants neither a second confirm nor restitution.
      await recordCheckoutReconciliation(transactionId, observedPaymentIntent, data,
        'confirmation_outcome_unknown', 'reconcilePayments', authorizedAtMs === null ? 'confirmation_age_unqualified' : undefined);
      return true;
    }
  }

  // Case A: PI succeeded but the transaction is still awaiting payment. The
  // PI.succeeded webhook was lost. This is a real divergence: the buyer paid but
  // the seller was never credited / no label / article maybe still listed.
  if (piStatus === 'succeeded' && status === 'pending_payment') {
    logger.error('CRITICAL [reconcilePayments] paid PI but transaction still pending_payment (lost webhook)', {
      transactionId,
      paymentIntentId,
      amountReceived,
    });
    await writeFailedOperation({
      type: 'amount_mismatch', // generic money-divergence bucket; manual review
      refId: transactionId,
      payload: {
        kind: 'lost_pi_succeeded_webhook',
        paymentIntentId,
        amountReceived,
        firestoreStatus: status,
      },
      error: 'PaymentIntent succeeded but transaction never advanced past pending_payment',
    });
    return true;
  }

  // Case B1: terminal cancellation neutralizes the card, but restitution still
  // requires the attributed intent, parties, exact debit and local receipt.
  if (piStatus === 'canceled' && status === 'pending_payment') {
    const result = await reconcileCanceledPurchase(transactionId, observedPaymentIntent);
    if (!result.committed) await recordCheckoutReconciliation(transactionId, observedPaymentIntent, data,
      'cancellation_unsettled', 'reconcilePayments', result.reason);
    return true;
  }

  // Case B2 (F76): Stripe shows the charge was REFUNDED (fully) but our
  // transaction is still 'paid' and never recorded a refund — the charge.refunded
  // webhook was lost. The seller may have been credited for a refunded sale.
  // Surface + dead-letter so the discrepancy is visible (the canonical
  // handleChargeRefunded owns the state machine; we do not mutate money here).
  // Only flag a FULL refund (amount_refunded >= amount_captured) to avoid
  // mislabeling a deliberate partial refund.
  if (
    piStatus === 'succeeded' &&
    status === 'paid' &&
    data.stripeRefundId == null &&
    amountRefunded > 0 &&
    amountCaptured > 0 &&
    amountRefunded >= amountCaptured
  ) {
    logger.error('CRITICAL [reconcilePayments] charge fully refunded on Stripe but tx still paid (lost webhook)', {
      transactionId,
      paymentIntentId,
      amountRefunded,
      amountCaptured,
    });
    await writeFailedOperation({
      type: 'amount_mismatch', // generic money-divergence bucket; manual review
      refId: transactionId,
      payload: {
        kind: 'lost_charge_refunded_webhook',
        paymentIntentId,
        amountRefunded,
        amountCaptured,
        firestoreStatus: status,
        autoRefund: false,
      },
      error: 'Charge refunded on Stripe but transaction never marked refunded',
    });
    return true;
  }

  return false;
}

// =============================================================================
// 2. reconcileWithdrawals — recover lost payout webhooks
// =============================================================================

/** Observe the current payout with exact local/provider witnesses. Paid updates
 * bookkeeping; failed/canceled enter the shared, qualified return-of-funds
 * recovery. Unknown or contradictory evidence retains the reservation. */
async function reconcileOneWithdrawal(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  stripe: StripeClient
): Promise<boolean> {
  if (!stripe) return false;
  const observed = await observeWithdrawalPayout(doc.id, stripe);
  if (observed.state === 'paid') return observed.completedNow;
  return observed.state !== 'pending';
}

/** Continue observing completed payouts: paid can later become failed. Rotate
 * bounded pages so old paid/operator cases cannot hide later withdrawals. */
async function withdrawalPage(status: 'processing' | 'completed' | 'failed', cutoff: Date) {
  const cursorRef = db.collection('job_locks').doc(`reconcileWithdrawals_${status}_cursor`);
  const cursor = (await cursorRef.get()).data();
  const query = db.collection('withdrawal_requests').where('status', '==', status).where('createdAt', '<', cutoff)
    .orderBy('createdAt', 'asc').orderBy('__name__', 'asc').limit(MAX_PER_RUN);
  const valid = nativeTime(cursor?.createdAt) && typeof cursor?.id === 'string' && !cursor.id.includes('/');
  let snapshot = await (valid ? query.startAfter(cursor!.createdAt, cursor!.id) : query).get();
  if (snapshot.empty && valid) snapshot = await query.get();
  return { snapshot, cursorRef };
}

// =============================================================================
// 3. reconcileBalances — wallet invariant checks
// =============================================================================

/**
 * Invariant checks on wallet docs (no ledger replay — that is fragile across the
 * mixed-semantics ledger types). A breach is a structural bug, logged CRITICAL.
 */
async function checkWalletInvariants(
  doc: FirebaseFirestore.QueryDocumentSnapshot
): Promise<boolean> {
  const observed = inspectWalletInvariants(doc.data());
  if (observed.requiresReview) {
    // Unknown or malformed values remain unknown. Never log arbitrary stored
    // values, convert them to zero, or infer that an absence of negatives is a
    // reconciliation with a ledger or provider statement.
    const context = { walletId: doc.id, ...observed };
    if (observed.alertSeverity === 'critical') logger.error('CRITICAL [reconcileBalances] wallet invariant breach', context);
    else logger.warn('[reconcileBalances] required wallet source not recorded', context);
    // Keep the operator-only alert contract; this scan has no repair route.
    await writeAdminAlert({
      kind: 'wallet_invariant_breach',
      severity: observed.alertSeverity!,
      refId: doc.id,
      message: observed.invariantQualification === 'breach_observed'
        ? 'Montant négatif observé dans un porte-monnaie — audit requis, aucun ajustement automatique.'
        : observed.alertSeverity === 'critical'
          ? 'Données de porte-monnaie invalides — audit requis, aucun ajustement automatique.'
          : 'Source obligatoire du porte-monnaie non consignée — à qualifier, aucun solde ni rapprochement confirmé.',
      context,
    });
    return true;
  }
  if (observed.notRecordedFields.length) logger.debug('[reconcileBalances] optional wallet buckets not recorded', {walletId:doc.id,...observed});
  return false;
}

// =============================================================================
// SCHEDULED ENTRY POINT
// =============================================================================

export const reconcileFinances = onSchedule(
  {
    schedule: 'every 6 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: ['STRIPE_SECRET_KEY'],
  },
  async () => {
    return withFinancialRecoveryScope({operation: "scheduled/reconcile.reconcileFinances"}, async () => {
    const now = Date.now();
    const stripe = getStripe();

    // Risk dossiers have a separate finite, leased scan and never move money.
    try { await reconcileFraudReviews(); }
    catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error; logger.error('Fraud review reconciliation scan failed', {error: String(error)}); }

    let paymentDivergences = 0;
    let withdrawalDivergences = 0;
    let balanceBreaches = 0;

    // A successful card refund can fail days later. Rotate a bounded page by
    // document identity; historical successful rows age out after 31 days.
    try {
      const cursorRef = db.collection('job_locks').doc('purchaseRefundWatch_cursor');
      const cursor = (await cursorRef.get()).data()?.lastId;
      const base = db.collection('transactions').where('refund.watch', '==', true).orderBy('__name__').limit(100);
      let watched = await (typeof cursor === 'string' && cursor ? base.startAfter(cursor) : base).get();
      if (watched.empty && cursor) watched = await base.get();
      for (let i = 0; i < watched.size; i += LOT_SIZE) {
        await Promise.allSettled(watched.docs.slice(i, i + LOT_SIZE).map(async doc => {
          const refund = doc.data().refund;
          await observePurchaseRefundRepairs(doc.id);
          const archivedStillWatched = await observeArchivedPurchaseRefunds(doc.id);
          if (typeof refund.stripeRefundId === 'string' && refund.stripeRefundId) {
            // Verify once more before retiring a successful historical row:
            // a failure may have occurred before the deadline but its event was lost.
            await observePurchaseRefund(doc.id, refund.stripeRefundId);
            await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
              const current = (await tx.get(doc.ref)).data()?.refund;
              if (!archivedStillWatched && current?.state === 'succeeded' && typeof current.watchUntilMs === 'number' && current.watchUntilMs < now) { await recoveryCommit({refs: [(doc.ref).path]}); tx.update(doc.ref, { 'refund.watch': false }); }
            });
          } else if (!archivedStillWatched && refund?.allocation && refund.state === 'succeeded') await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
            const current = (await tx.get(doc.ref)).data()?.refund;
            if (current?.intentId === refund.intentId && current.state === 'succeeded' && current.cardAmountCents === 0 &&
                !(typeof current.watchHistoryUntilMs === 'number' && current.watchHistoryUntilMs > now)) { await recoveryCommit({refs: [(doc.ref).path]}); tx.update(doc.ref, {'refund.watch': false}); }
          });
        }));
      }
      if (watched.size) await cursorRef.set({ lastId: watched.docs[watched.size - 1].id }, { merge: true });
    } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      logger.error('Purchase refund current-proof scan failed', { error: String(error) });
    }

    // -------------------------------------------------------------------------
    // 1. reconcilePayments — scan BOTH stale 'pending_payment' (lost PI.succeeded)
    //    AND stale 'paid' (F76: charge fully refunded on Stripe but tx still
    //    'paid' = lost charge.refunded webhook). reconcileOnePayment dispatches on
    //    the tx status internally.
    // -------------------------------------------------------------------------
    try {
      const cutoff = new Date(now - PAYMENT_STALE_MS);
      const pages = await Promise.all([paymentPage('pending_payment', cutoff), paymentPage('paid', cutoff)]);
      const docs = pages.flatMap(page => page.snapshot.docs);

      for (let i = 0; i < docs.length; i += LOT_SIZE) {
        const lot = docs.slice(i, i + LOT_SIZE);
        const results = await Promise.allSettled(
          lot.map((doc) => reconcileOnePayment(doc, stripe))
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) paymentDivergences++;
        }
      }
      await Promise.all(pages.map(async ({snapshot, cursorRef}) => {
        const last = snapshot.docs.at(-1);
        if (last) await cursorRef.set({id: last.id, createdAt: last.data().createdAt, updatedAt: FieldValue.serverTimestamp()});
      }));
    } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
      logger.error('[reconcileFinances] reconcilePayments pass failed', {
        error: err instanceof Error ? err.message : err,
      });
    }

    // -------------------------------------------------------------------------
    // 2. reconcileWithdrawals
    // -------------------------------------------------------------------------
    try {
      const cutoff = new Date(now - WITHDRAWAL_STALE_MS);
      for (const status of ['processing', 'completed', 'failed'] as const) {
        const { snapshot: snap, cursorRef } = await withdrawalPage(status, cutoff);
        for (let i = 0; i < snap.docs.length; i += LOT_SIZE) {
          const lot = snap.docs.slice(i, i + LOT_SIZE);
        const results = await Promise.allSettled(
          lot.map((doc) => reconcileOneWithdrawal(doc, stripe))
        );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) withdrawalDivergences++;
          }
        }
        const last = snap.docs[snap.docs.length - 1];
        if (last && nativeTime(last.data().createdAt)) await cursorRef.set({ createdAt: last.data().createdAt, id: last.id,
          updatedAt: FieldValue.serverTimestamp() });
      }
    } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
      logger.error('[reconcileFinances] reconcileWithdrawals pass failed', {
        error: err instanceof Error ? err.message : err,
      });
    }

    // -------------------------------------------------------------------------
    // 3. reconcileBalances (invariant checks)
    // F75: paginate over ALL wallets (cursor on __name__) instead of only the
    // first MAX_PER_RUN — a 200-doc cap silently skipped every wallet beyond the
    // first page, so a breach on wallet #201 was never detected. The scan is
    // read-only + cheap; a global hard cap guards against a runaway loop.
    // -------------------------------------------------------------------------
    try {
      let lastId: string | null = null;
      let scanned = 0;
      while (scanned < BALANCE_SCAN_HARD_CAP) {
        let q = db.collection('wallets').orderBy('__name__').limit(WALLET_PAGE_SIZE);
        if (lastId) q = q.startAfter(lastId);
        const snap = await q.get();
        if (snap.empty) break;
        for (const doc of snap.docs) {
          if (await checkWalletInvariants(doc)) balanceBreaches++;
        }
        scanned += snap.size;
        lastId = snap.docs[snap.docs.length - 1].id;
        if (snap.size < WALLET_PAGE_SIZE) break;
      }
      if (scanned >= BALANCE_SCAN_HARD_CAP) {
        logger.warn('[reconcileBalances] hit BALANCE_SCAN_HARD_CAP — not all wallets scanned', {
          scanned,
        });
      }
    } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
      logger.error('[reconcileFinances] reconcileBalances pass failed', {
        error: err instanceof Error ? err.message : err,
      });
    }

    logger.info('[reconcileFinances] run complete', {
      paymentDivergences,
      withdrawalDivergences,
      balanceBreaches,
      balanceScan: {scope:'native_bucket_structure_only',ledgerReconciled:false,providerReconciled:false},
    });

    });
  }
);
