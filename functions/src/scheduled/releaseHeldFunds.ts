/**
 * Scheduled held-funds release + 7-day dispute window contract
 * Firebase Functions v2 - using onSchedule, region northamerica-northeast1
 *
 * THREE-BUCKET FUNDS MODEL (seller wallet, collection `wallets`)
 * ------------------------------------------------------------------
 *   pendingBalance — sale paid, NOT yet delivered (escrow, in transit)
 *   heldBalance    — delivered, inside the 7-day buyer-dispute window
 *   balance        — withdrawable (dispute window elapsed, no claim)
 *
 * Lifecycle of seller funds for one purchase:
 *   1. PI.succeeded / payWithWallet  -> pendingBalance += payout
 *   2. DELIVERED (tracking)          -> pendingBalance -= payout
 *                                       heldBalance    += payout
 *                                       transaction.fundsReleaseAt = deliveredAt + 7d
 *   3. fundsReleaseAt <= now & no dispute (THIS JOB)
 *                                    -> heldBalance -= payout
 *                                       balance     += payout
 *                                       transaction.fundsReleasedAt = now
 *
 * The DELIVERED transition (step 2) is owned by the shipping/state-machine
 * chantier (trackingCheck.ts + checkTrackingStatus + manual). This module
 * EXPOSES the reusable `applyDeliveredHeldFunds` helper that those sites must
 * call instead of the old "pendingBalance -> balance" move, so the contract
 * lives in one place. Until those sites are migrated, this scheduled job is a
 * no-op for transactions that have no `fundsReleaseAt` (they release on
 * delivery the old way), and becomes active the moment delivery starts setting
 * the held-funds fields.
 *
 * New wallet fields:  heldBalance, sellerDebt  (server-only, see rules chantier)
 * New transaction fields: fundsReleaseAt, fundsReleasedAt, disputed
 *
 * Ledger types introduced here: 'funds_released'.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { sendPushNotification } from '../utils/notifications';
import { logAutomatedDecision } from '../callable/automatedDecisions';
import { captureServerEvent } from '../lib/analytics';

/** Buyer-dispute window after delivery before seller funds become withdrawable. */
export const DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Process at most this many transactions per run to bound execution time. */
const MAX_TRANSACTIONS_PER_RUN = 200;

/**
 * Transaction statuses that BLOCK the release of held funds. If a transaction
 * is in any of these, the dispute window is on hold and funds stay in
 * heldBalance until the dispute is resolved (charge.dispute.closed handler).
 */
const DISPUTE_BLOCKING_STATUSES = new Set([
  'disputed',
  'delivery_failed',
  'lost',
  'refunded',
]);

/**
 * REUSABLE CONTRACT — call this from the DELIVERED transition.
 *
 * Moves a seller payout from `pendingBalance` to `heldBalance` and stamps the
 * transaction with `fundsReleaseAt = deliveredAt + 7 days`. MUST be called
 * inside a runTransaction; the caller is responsible for having already read
 * the wallet/transaction snapshots and for the transaction status update
 * (status -> 'delivered', deliveredAt).
 *
 * @param tx              active Firestore transaction
 * @param sellerWalletRef seller wallet doc ref (collection `wallets`)
 * @param sellerWalletData snapshot data of the seller wallet (for balanceAfter)
 * @param transactionRef  the transaction doc ref
 * @param transactionId   the transaction id (for ledger linkage)
 * @param sellerPayoutCents seller payout in CENTS
 * @param deliveredAtMs   delivery time in epoch ms (used to compute the window)
 */
export function applyDeliveredHeldFunds(
  tx: FirebaseFirestore.Transaction,
  sellerWalletRef: FirebaseFirestore.DocumentReference,
  sellerWalletData: FirebaseFirestore.DocumentData,
  transactionRef: FirebaseFirestore.DocumentReference,
  transactionId: string,
  sellerPayoutCents: number,
  deliveredAtMs: number
): void {
  // Move pending -> held (delivered, inside dispute window)
  tx.update(sellerWalletRef, {
    pendingBalance: FieldValue.increment(-sellerPayoutCents),
    heldBalance: FieldValue.increment(sellerPayoutCents),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const ledgerRef = sellerWalletRef.collection('ledger').doc();
  tx.set(ledgerRef, {
    type: 'funds_held',
    amount: sellerPayoutCents,
    balanceAfter: (sellerWalletData.heldBalance || 0) + sellerPayoutCents,
    description: 'Vente livrée — fonds en attente (fenêtre de litige 7 jours)',
    transactionId,
    createdAt: FieldValue.serverTimestamp(),
    status: 'held',
  });

  // Stamp the release deadline on the transaction.
  const releaseAt = Timestamp.fromMillis(deliveredAtMs + DISPUTE_WINDOW_MS);
  tx.update(transactionRef, {
    fundsReleaseAt: releaseAt,
  });
}

export const releaseHeldFunds = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
  },
  async () => {
    const now = Timestamp.now();
    let released = 0;
    let skipped = 0;
    let errors = 0;

    // Paginate by fundsReleaseAt ascending; only past-due, delivered txs.
    // Composite index required: (status ASC, fundsReleaseAt ASC).
    let lastReleaseAt: Timestamp | null = null;
    let keepGoing = true;

    while (keepGoing) {
      let query = db
        .collection('transactions')
        .where('status', '==', 'delivered')
        .where('fundsReleaseAt', '<=', now)
        .orderBy('fundsReleaseAt', 'asc')
        .limit(MAX_TRANSACTIONS_PER_RUN);

      if (lastReleaseAt) {
        query = query.startAfter(lastReleaseAt);
      }

      const snap = await query.get();

      if (snap.empty) {
        break;
      }

      for (const doc of snap.docs) {
        const data = doc.data();
        const transactionId = doc.id;
        lastReleaseAt = (data.fundsReleaseAt as Timestamp) ?? lastReleaseAt;

        // Defense-in-depth: never release a disputed/lost/refunded transaction.
        if (data.disputed === true || DISPUTE_BLOCKING_STATUSES.has(data.status)) {
          skipped++;
          continue;
        }

        const sellerId = data.sellerId;
        const sellerPayout = data.sellerPayout ?? data.amount;

        if (!sellerId || typeof sellerPayout !== 'number') {
          logger.warn('[releaseHeldFunds] missing sellerId/payout — skipping', {
            transactionId,
          });
          skipped++;
          continue;
        }

        const sellerPayoutCents = Math.round(sellerPayout * 100);
        const sellerWalletRef = db.collection('wallets').doc(sellerId);

        try {
          const moved = await db.runTransaction(async (tx) => {
            const txSnap = await tx.get(doc.ref);
            if (!txSnap.exists) return false;
            const tdata = txSnap.data()!;

            // Re-check invariants inside the transaction (status may have
            // changed between query and commit — e.g. a dispute was opened).
            if (tdata.status !== 'delivered') return false;
            if (tdata.disputed === true) return false;
            if (tdata.fundsReleasedAt) return false; // idempotence

            const walletSnap = await tx.get(sellerWalletRef);
            if (!walletSnap.exists) {
              logger.warn('[releaseHeldFunds] seller wallet not found — skipping', {
                transactionId,
                sellerId,
              });
              return false;
            }
            const walletData = walletSnap.data()!;

            // Move from heldBalance to balance, capped so heldBalance never
            // goes negative (defensive — should equal sellerPayoutCents).
            const heldNow = walletData.heldBalance || 0;
            const moveCents = Math.min(sellerPayoutCents, heldNow);

            // F39: regularise any outstanding sellerDebt FIRST. The released
            // amount pays down the debt before the remainder lands in the
            // withdrawable balance (debt repayment has priority on future funds).
            const sellerDebt = walletData.sellerDebt || 0;
            const debtRepayment = Math.min(sellerDebt, moveCents);
            const toBalance = moveCents - debtRepayment;

            const walletUpdate: Record<string, any> = {
              heldBalance: FieldValue.increment(-moveCents),
              updatedAt: FieldValue.serverTimestamp(),
            };
            if (toBalance > 0) walletUpdate.balance = FieldValue.increment(toBalance);
            if (debtRepayment > 0) walletUpdate.sellerDebt = FieldValue.increment(-debtRepayment);
            tx.update(sellerWalletRef, walletUpdate);

            if (debtRepayment > 0) {
              const debtLedgerRef = sellerWalletRef.collection('ledger').doc();
              tx.set(debtLedgerRef, {
                type: 'debt_repayment',
                amount: debtRepayment,
                balanceAfter: sellerDebt - debtRepayment,
                description: 'Fonds libérés — régularisation du solde dû',
                transactionId,
                createdAt: FieldValue.serverTimestamp(),
              });
            }

            const ledgerRef = sellerWalletRef.collection('ledger').doc();
            tx.set(ledgerRef, {
              type: 'funds_released',
              amount: moveCents,
              balanceAfter: (walletData.balance || 0) + toBalance,
              description:
                debtRepayment > 0
                  ? 'Fenêtre de litige écoulée — fonds disponibles (après régularisation)'
                  : 'Fenêtre de litige écoulée — fonds disponibles',
              transactionId,
              createdAt: FieldValue.serverTimestamp(),
            });

            // Stamp completedAt alongside status:'completed' to match every
            // other writer of this transition (webhooks/payments/reconcile/
            // swaps). reviews.ts anchors its 60-day review window on
            // completedAt, so this is the "reviewable" marker for the
            // delivered -> completed transition once 'completed' is added to
            // the reviews terminalStatuses (be-reviews-callable).
            tx.update(doc.ref, {
              status: 'completed',
              completedAt: FieldValue.serverTimestamp(),
              fundsReleasedAt: FieldValue.serverTimestamp(),
            });

            return true;
          });

          if (moved) {
            released++;

            // Loi 25 art. 12.1 — journal the AUTOMATED decision (best-effort,
            // never throws, never rolls back the money move above).
            await logAutomatedDecision({
              transactionId,
              userId: sellerId,
              decisionType: 'funds_released',
              criteria: {
                status: 'delivered',
                disputed: false,
                fundsReleaseAt:
                  data.fundsReleaseAt instanceof Timestamp
                    ? data.fundsReleaseAt.toDate().toISOString()
                    : null,
                disputeWindowDays: 7,
              },
              result: 'Fonds libérés au vendeur (fenêtre de litige écoulée)',
            });

            // Best-effort notification to the seller. ENRICHED for Loi 25
            // transparency: states the decision was AUTOMATIC and that it can
            // be contested (right to human review).
            try {
              await sendPushNotification(
                sellerId,
                'Fonds libérés automatiquement',
                'Vos fonds ont été libérés automatiquement : la livraison a été confirmée et le délai de réclamation (7 jours) est écoulé. Si vous contestez cette décision, vous pouvez nous le signaler.',
                { transactionId },
                'funds_released'
              );
            } catch (notifErr) {
              logger.warn('[releaseHeldFunds] seller notification failed', {
                transactionId,
                error: notifErr instanceof Error ? notifErr.message : notifErr,
              });
            }
          } else {
            skipped++;
          }
        } catch (err) {
          errors++;
          logger.error('[releaseHeldFunds] error releasing funds', {
            transactionId,
            error: err instanceof Error ? err.message : err,
          });
        }
      }

      keepGoing = snap.size === MAX_TRANSACTIONS_PER_RUN;
    }

    // Second sweep: swap cash top-ups held after reception (same 7-day window).
    const swapStats = await releaseSwapTopUpHeldFunds(now);

    logger.info('[releaseHeldFunds] run complete', {
      released,
      skipped,
      errors,
      swapReleased: swapStats.released,
      swapSkipped: swapStats.skipped,
      swapErrors: swapStats.errors,
    });
  }
);

/**
 * Release swap cash top-up funds that have cleared the 7-day post-reception
 * window. EXACTLY mirrors the purchase release above: moves the payee's
 * complement from heldBalance to withdrawable balance and stamps topUpReleasedAt
 * on the swap (the idempotence + "no more auto-refund" marker also read by
 * openSwapDispute).
 *
 * Query: swaps where status == 'completed' AND topUpFundsReleaseAt <= now.
 * Composite index required: swaps (status ASC, topUpFundsReleaseAt ASC).
 *
 * A swap moved to 'disputed' (openSwapDispute) is excluded by the status filter,
 * so funds in the window are never released out from under an open dispute. The
 * inner transaction re-checks status + topUpReleasedAt for full idempotence.
 */
async function releaseSwapTopUpHeldFunds(
  now: Timestamp
): Promise<{ released: number; skipped: number; errors: number }> {
  let released = 0;
  let skipped = 0;
  let errors = 0;

  let lastReleaseAt: Timestamp | null = null;
  let keepGoing = true;

  while (keepGoing) {
    let query = db
      .collection('swaps')
      .where('status', '==', 'completed')
      .where('topUpFundsReleaseAt', '<=', now)
      .orderBy('topUpFundsReleaseAt', 'asc')
      .limit(MAX_TRANSACTIONS_PER_RUN);

    if (lastReleaseAt) {
      query = query.startAfter(lastReleaseAt);
    }

    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const data = doc.data();
      const swapId = doc.id;
      lastReleaseAt = (data.topUpFundsReleaseAt as Timestamp) ?? lastReleaseAt;

      // Idempotence / guard: nothing to do if already released, never held, or
      // no top-up at all.
      if (data.topUpReleasedAt || !data.topUpFundsHeldAt || data.cashTopUp == null) {
        skipped++;
        continue;
      }

      const topUp = data.cashTopUp;
      const payeeId: string | undefined =
        topUp.payerId === data.initiatorId ? data.receiverId : data.initiatorId;
      const payoutCents = typeof topUp.amount === 'number' ? Math.round(topUp.amount) : 0;

      if (!payeeId || payoutCents <= 0) {
        logger.warn('[releaseHeldFunds] swap top-up missing payee/amount — skipping', { swapId });
        skipped++;
        continue;
      }

      const payeeWalletRef = db.collection('wallets').doc(payeeId);

      try {
        const moved = await db.runTransaction(async (tx) => {
          const swapSnap = await tx.get(doc.ref);
          if (!swapSnap.exists) return false;
          const sdata = swapSnap.data()!;

          // Re-check invariants inside the transaction (a dispute may have been
          // opened between the query and the commit).
          if (sdata.status !== 'completed') return false;
          if (!sdata.topUpFundsHeldAt) return false;
          if (sdata.topUpReleasedAt) return false; // idempotence

          const walletSnap = await tx.get(payeeWalletRef);
          if (!walletSnap.exists) {
            logger.warn('[releaseHeldFunds] swap payee wallet not found — skipping', {
              swapId,
              payeeId,
            });
            return false;
          }
          const walletData = walletSnap.data()!;

          // Move heldBalance -> balance, capped so heldBalance never goes
          // negative (defensive — should equal payoutCents).
          const heldNow = walletData.heldBalance || 0;
          const moveCents = Math.min(payoutCents, heldNow);

          if (moveCents > 0) {
            tx.update(payeeWalletRef, {
              heldBalance: FieldValue.increment(-moveCents),
              balance: FieldValue.increment(moveCents),
              updatedAt: FieldValue.serverTimestamp(),
            });

            const ledgerRef = payeeWalletRef.collection('ledger').doc();
            tx.set(ledgerRef, {
              type: 'funds_released',
              amount: moveCents,
              balanceAfter: (walletData.balance || 0) + moveCents,
              description: 'Complément d\'échange — fenêtre de litige écoulée, fonds disponibles',
              swapId,
              createdAt: FieldValue.serverTimestamp(),
            });
          }

          tx.update(doc.ref, {
            topUpReleasedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          return true;
        });

        if (moved) {
          released++;
        } else {
          skipped++;
        }
      } catch (err) {
        errors++;
        logger.error('[releaseHeldFunds] error releasing swap top-up funds', {
          swapId,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    keepGoing = snap.size === MAX_TRANSACTIONS_PER_RUN;
  }

  return { released, skipped, errors };
}
