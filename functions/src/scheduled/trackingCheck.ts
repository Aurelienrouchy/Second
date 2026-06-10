/**
 * Scheduled tracking check (safety-net poller)
 * Firebase Functions v2 - onSchedule, region northamerica-northeast1
 *
 * The PRIMARY tracking path is now the ShipEngine webhook (http/shipEngineWebhook.ts).
 * This poller is a SPACED-OUT safety net: it runs every 12 hours and reconciles
 * any parcel whose webhook was missed, by polling ShipEngine directly.
 *
 * For each SHIPPING transaction in `label_created` or `shipped`:
 *   - DELIVERED  -> applyTrackingOutcome moves pendingBalance -> heldBalance and
 *                   stamps fundsReleaseAt = +7d (held-funds contract); status
 *                   becomes 'delivered' (release handled by releaseHeldFunds).
 *   - FAILURE    -> status 'delivery_failed', funds frozen, both parties notified
 *                   (refund resolved by the admin refund callable).
 *   - TRANSIT/IN_TRANSIT (first real carrier scan) -> label_created becomes
 *                   'shipped' (decouples label printing from actual shipment).
 *
 * It also nudges sellers whose label_created parcel has had NO carrier scan for
 * LABEL_STALE_DAYS (printed a label but never dropped it off).
 *
 * Pagination: orderBy('createdAt','asc') + startAfter cursor, looping until the
 * collection is exhausted, with a per-call ShipEngine throttle to respect rate
 * limits. Uses the existing composite index (status ASC, createdAt ASC).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { getShipEngine, ShipEngineClient } from '../config/shipEngine';
import { sendPushNotification } from '../utils/notifications';
import { applyTrackingOutcome } from '../utils/trackingTransition';
import { processReturnDelivered } from '../utils/returnRefund';

/** Page size per Firestore query. */
const PAGE_SIZE = 200;

/** Hard cap on parcels processed per run (across all statuses) to bound time. */
const MAX_TRANSACTIONS_PER_RUN = 600;

/**
 * F79: a GUARANTEED budget reserved for the return leg (return_requested), so a
 * large backlog of forward parcels (label_created/shipped) can never starve the
 * money-critical returns (a return DELIVERED scan triggers the buyer refund).
 * Returns are polled FIRST, up to this cap; the remainder of MAX_TRANSACTIONS_PER_RUN
 * goes to the forward legs.
 */
const RETURN_LEG_RESERVED_BUDGET = 200;

/** Statuses for the forward (buyer-bound) leg, polled after returns. */
const FORWARD_STATUSES = ['label_created', 'shipped'] as const;

/** Throttle between ShipEngine tracking calls (ms) to respect rate limits. */
const SHIPENGINE_THROTTLE_MS = 150;

/** A label_created parcel with no carrier scan after this many days nudges the seller. */
const LABEL_STALE_DAYS = 3;
const LABEL_STALE_MS = LABEL_STALE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Statuses whose parcels we poll (all reuse the SAME composite index
 * status ASC, createdAt ASC):
 *   - return_requested: reverse leg (seller-bound), polled FIRST with a reserved
 *     budget (F79), via returnTrackingNumber.
 *   - label_created / shipped: forward leg (buyer-bound), polled via trackingNumber.
 */

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const checkShippedTracking = onSchedule(
  {
    schedule: 'every 12 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['SHIPENGINE_API_KEY', 'STRIPE_SECRET_KEY'],
  },
  async () => {
    const shipEngine = getShipEngine();
    if (!shipEngine) {
      logger.warn('[checkShippedTracking] ShipEngine not configured, skipping');
      return;
    }

    let deliveredCount = 0;
    let shippedCount = 0;
    let failedCount = 0;
    let staleNudged = 0;
    let returnRefundedCount = 0;
    let errorCount = 0;
    let processed = 0;

    const now = Date.now();

    // F79: poll the RETURN leg FIRST with a reserved budget so a forward-parcel
    // backlog can never starve returns (a return DELIVERED scan refunds the
    // buyer). Returns get up to RETURN_LEG_RESERVED_BUDGET; the forward legs get
    // the remainder of MAX_TRANSACTIONS_PER_RUN. Each phase has its own cap so the
    // total still respects MAX_TRANSACTIONS_PER_RUN.
    const phases: { statuses: readonly string[]; cap: number }[] = [
      { statuses: ['return_requested'], cap: Math.min(RETURN_LEG_RESERVED_BUDGET, MAX_TRANSACTIONS_PER_RUN) },
      { statuses: FORWARD_STATUSES, cap: MAX_TRANSACTIONS_PER_RUN },
    ];

    for (const phase of phases) {
     for (const status of phase.statuses) {
      let lastCreatedAt: Timestamp | null = null;
      let keepGoing = true;

      while (keepGoing && processed < phase.cap && processed < MAX_TRANSACTIONS_PER_RUN) {
        let query = db
          .collection('transactions')
          .where('status', '==', status)
          .orderBy('createdAt', 'asc')
          .limit(PAGE_SIZE);

        if (lastCreatedAt) {
          query = query.startAfter(lastCreatedAt);
        }

        const snap = await query.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
          if (processed >= phase.cap || processed >= MAX_TRANSACTIONS_PER_RUN) break;

          const data = doc.data();
          const transactionId = doc.id;
          lastCreatedAt = (data.createdAt as Timestamp) ?? lastCreatedAt;
          processed++;

          // ---- RETURN leg: poll returnTrackingNumber; DELIVERED -> refund ----
          if (status === 'return_requested') {
            if (!data.returnTrackingNumber) {
              continue;
            }
            try {
              await sleep(SHIPENGINE_THROTTLE_MS);
              const returnCarrier = data.returnCarrierCode || 'intelcom_ca';
              const tracking = await shipEngine.getTracking(
                returnCarrier,
                data.returnTrackingNumber
              );
              const mappedReturn = ShipEngineClient.mapStatus(tracking.statusCode);

              if (mappedReturn === 'DELIVERED') {
                const r = await processReturnDelivered(transactionId, 'poller');
                if (r.refunded) returnRefundedCount++;
              } else if (data.returnTrackingStatus !== mappedReturn) {
                // Best-effort visibility refresh; no money movement.
                await doc.ref
                  .update({ returnTrackingStatus: mappedReturn })
                  .catch(() => undefined);
              }
            } catch (err) {
              errorCount++;
              logger.error('[checkShippedTracking] error checking return tracking', {
                transactionId,
                returnTrackingNumber: data.returnTrackingNumber,
                error: err instanceof Error ? err.message : err,
              });
            }
            continue;
          }

          // No tracking number yet (label_created may have one already).
          if (!data.trackingNumber) {
            // Nudge sellers who printed a label but never got a carrier scan.
            if (status === 'label_created') {
              await maybeNudgeStaleLabel(doc.ref, data, transactionId, now).then(
                (nudged) => {
                  if (nudged) staleNudged++;
                }
              );
            }
            continue;
          }

          try {
            await sleep(SHIPENGINE_THROTTLE_MS);
            const carrierCode = data.carrierCode || 'intelcom_ca';
            const tracking = await shipEngine.getTracking(carrierCode, data.trackingNumber);
            const mapped = ShipEngineClient.mapStatus(tracking.statusCode);

            const result = await applyTrackingOutcome(transactionId, mapped, 'poller');

            if (result.kind === 'delivered' && result.changed) deliveredCount++;
            else if (result.kind === 'shipped' && result.changed) shippedCount++;
            else if (result.kind === 'failed' && result.changed) failedCount++;

            // Stale-label nudge for label_created parcels still without a scan.
            if (status === 'label_created' && result.kind !== 'shipped') {
              const nudged = await maybeNudgeStaleLabel(doc.ref, data, transactionId, now);
              if (nudged) staleNudged++;
            }
          } catch (err) {
            errorCount++;
            logger.error('[checkShippedTracking] error checking tracking', {
              transactionId,
              trackingNumber: data.trackingNumber,
              error: err instanceof Error ? err.message : err,
            });
          }
        }

        keepGoing = snap.size === PAGE_SIZE;
      }
     }
    }

    logger.info('[checkShippedTracking] run complete', {
      processed,
      shipped: shippedCount,
      delivered: deliveredCount,
      failed: failedCount,
      staleNudged,
      returnRefunded: returnRefundedCount,
      errors: errorCount,
    });
  }
);

/**
 * If a label_created parcel has had no carrier scan for LABEL_STALE_DAYS and we
 * haven't nudged in the last window, send the seller a "drop off your parcel"
 * reminder. Idempotent via `labelStaleNudgedAt`.
 */
async function maybeNudgeStaleLabel(
  ref: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  transactionId: string,
  nowMs: number
): Promise<boolean> {
  const labelAt =
    data.labelCreatedAt instanceof Timestamp
      ? data.labelCreatedAt.toMillis()
      : data.shippedAt instanceof Timestamp
        ? data.shippedAt.toMillis()
        : null;

  if (labelAt === null || nowMs - labelAt < LABEL_STALE_MS) {
    return false;
  }

  // Only nudge once per stale window.
  const lastNudge =
    data.labelStaleNudgedAt instanceof Timestamp ? data.labelStaleNudgedAt.toMillis() : 0;
  if (nowMs - lastNudge < LABEL_STALE_MS) {
    return false;
  }

  try {
    await ref.update({ labelStaleNudgedAt: FieldValue.serverTimestamp() });
    if (data.sellerId) {
      await sendPushNotification(
        data.sellerId,
        'Pensez a expedier votre colis',
        `L'etiquette de "${data.articleTitle || 'votre vente'}" a ete creee mais le transporteur n'a pas encore scanne le colis. Deposez-le rapidement.`,
        { transactionId, articleId: data.articleId || '' },
        'label_stale_reminder'
      );
    }
    return true;
  } catch (err) {
    logger.warn('[checkShippedTracking] stale-label nudge failed', {
      transactionId,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
}
