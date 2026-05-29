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

            tx.update(sellerWalletRef, {
              heldBalance: FieldValue.increment(-moveCents),
              balance: FieldValue.increment(moveCents),
              updatedAt: FieldValue.serverTimestamp(),
            });

            const ledgerRef = sellerWalletRef.collection('ledger').doc();
            tx.set(ledgerRef, {
              type: 'funds_released',
              amount: moveCents,
              balanceAfter: (walletData.balance || 0) + moveCents,
              description: 'Fenêtre de litige écoulée — fonds disponibles',
              transactionId,
              createdAt: FieldValue.serverTimestamp(),
            });

            tx.update(doc.ref, {
              status: 'completed',
              fundsReleasedAt: FieldValue.serverTimestamp(),
            });

            return true;
          });

          if (moved) {
            released++;
            // Best-effort notification to the seller.
            try {
              await sendPushNotification(
                sellerId,
                'Fonds disponibles',
                'La fenêtre de litige est terminée. Vos fonds sont maintenant disponibles au retrait.',
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

    logger.info('[releaseHeldFunds] run complete', { released, skipped, errors });
  }
);
