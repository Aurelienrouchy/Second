/**
 * Scheduled sweep of pending shipping labels (P1: atomicity payment<->label)
 * Firebase Functions v2 - onSchedule, region northamerica-northeast1
 *
 * PROBLEM SOLVED
 * --------------
 * When a purchase is paid but the ShipEngine label could not be created
 * (ShipEngine down, transient 5xx, expired/fallback rateId), the payment flow
 * sets `labelCreationPending = true`, leaves the transaction in `status: 'paid'`,
 * and — under the deferred-credit model — does NOT credit the seller. Without a
 * sweep these orders are frozen forever: buyer charged, no label, no shipment.
 *
 * WHAT THIS JOB DOES (every hour)
 * -------------------------------
 * For each transaction with `labelCreationPending === true` and `status: 'paid'`:
 *   1. Re-rate a FRESH ShipEngine rate (origin = seller address, destination =
 *      buyer shippingAddress, parcel = article metadata) — never reuse the old
 *      possibly-stale/fallback rateId.
 *   2. Retry `createLabel` on the fresh rate. On success: ATOMICALLY credit the
 *      seller (pendingBalance), reconcile the real label cost, persist label
 *      fields, clear the flag and mark `shipped`.
 *   3. Increment `labelAttempts`. After N = MAX_ATTEMPTS failures: REFUND the
 *      buyer (idempotent plain platform-charge refund + wallet re-credit for
 *      wallet portions), debit the seller pendingBalance IF they were credited
 *      (they normally weren't — deferred), release the article (isSold = false),
 *      cancel the transaction and notify the buyer. A definitive failure writes
 *      a `failed_operations` dead-letter doc (collection owned by the dead-letter
 *      chantier).
 *
 * All wallet/ledger amounts are CENTS. transaction cost fields are DOLLARS.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import {
  getShipEngine,
  ShipEngineAddress,
  ShipEngineRate,
} from '../config/shipEngine';
import { resolveSellerOriginAddress } from '../callable/payments';
import { creditSellerForSale, reconcileShippingCost } from '../utils/labelFulfillment';
import { issueTransactionRefund } from '../utils/refund';
import { sendPushNotification } from '../utils/notifications';
import { logAutomatedDecision } from '../callable/automatedDecisions';

/** Process at most this many transactions per run to bound execution time. */
const MAX_TRANSACTIONS_PER_RUN = 50;

/** Number of label-creation attempts before giving up and refunding the buyer. */
const MAX_ATTEMPTS = 4;

/**
 * Re-rate a fresh ShipEngine rate for a pending-label transaction.
 * Returns the chosen rate (cheapest home-delivery rate) or null if no rate /
 * no usable origin/destination/parcel could be resolved.
 */
async function refreshRateForTransaction(
  txData: FirebaseFirestore.DocumentData,
  transactionId: string
): Promise<ShipEngineRate | null> {
  const shipEngine = getShipEngine();
  if (!shipEngine) {
    logger.warn('[sweepPendingLabels] ShipEngine not configured — cannot re-rate', {
      transactionId,
    });
    return null;
  }

  const articleId = txData.articleId;
  if (!articleId) {
    logger.warn('[sweepPendingLabels] missing articleId — cannot re-rate', { transactionId });
    return null;
  }

  const articleSnap = await db.collection('articles').doc(articleId).get();
  if (!articleSnap.exists) {
    logger.warn('[sweepPendingLabels] article not found — cannot re-rate', {
      transactionId,
      articleId,
    });
    return null;
  }
  const articleData = articleSnap.data()!;

  const sellerSnap = await db.collection('users').doc(txData.sellerId).get();
  if (!sellerSnap.exists) {
    logger.warn('[sweepPendingLabels] seller not found — cannot re-rate', {
      transactionId,
      sellerId: txData.sellerId,
    });
    return null;
  }
  const sellerData = sellerSnap.data()!;

  const origin = resolveSellerOriginAddress(sellerData, articleData);
  if (!origin) {
    logger.warn('[sweepPendingLabels] no usable seller origin address — cannot re-rate', {
      transactionId,
    });
    return null;
  }

  const shippingAddress = txData.shippingAddress || {};
  const destPostal = (shippingAddress.postalCode || '').toString().trim();
  if (destPostal.length === 0) {
    logger.warn('[sweepPendingLabels] missing buyer postal code — cannot re-rate', {
      transactionId,
    });
    return null;
  }
  const destination: ShipEngineAddress = {
    name: shippingAddress.name || 'Acheteur',
    addressLine1: shippingAddress.street || origin.addressLine1,
    cityLocality: shippingAddress.city || origin.cityLocality,
    stateProvince: shippingAddress.province || origin.stateProvince,
    postalCode: destPostal,
    countryCode: 'CA',
    phone: shippingAddress.phone || origin.phone,
  };

  const parcelWeight = parseFloat(articleData.weight) || 0.5;
  const dims = articleData.dimensions || {};
  const parcel = {
    weight: { value: parcelWeight, unit: 'kilogram' as const },
    dimensions: {
      length: parseFloat(dims.length) || 30,
      width: parseFloat(dims.width) || 25,
      height: parseFloat(dims.height) || 10,
      unit: 'centimeter' as const,
    },
  };

  let rates: ShipEngineRate[];
  try {
    rates = await shipEngine.getRates(origin, destination, parcel);
  } catch (err) {
    logger.error('[sweepPendingLabels] getRates failed', {
      transactionId,
      error: err instanceof Error ? err.message : err,
    });
    return null;
  }

  if (!rates || rates.length === 0) {
    logger.warn('[sweepPendingLabels] no rates returned — cannot re-rate', { transactionId });
    return null;
  }

  // Cheapest home-delivery rate (server-authoritative selection).
  const sorted = [...rates].sort(
    (a, b) => a.shippingAmount.amount - b.shippingAmount.amount
  );
  return sorted[0];
}

/**
 * Definitive failure path: refund the buyer (idempotent), release the article,
 * debit the seller IF they were credited, mark the transaction refunded, notify
 * the buyer.
 *
 * REUSES the shared issueTransactionRefund core (single source of truth for the
 * reverse_transfer / sellerDebt reconciliation + dead-lettering on Stripe
 * failure with the deterministic key). The article IS re-listed (the parcel was
 * never shipped, the item still exists). After the core succeeds we additionally
 * clear the label-pending bookkeeping (cancelReason / labelCreationPending) that
 * is specific to this flow and not owned by the generic refund core.
 */
async function refundPendingLabelTransaction(
  txRef: FirebaseFirestore.DocumentReference,
  txData: FirebaseFirestore.DocumentData,
  transactionId: string
): Promise<void> {
  // Pre-check the precondition before touching Stripe: only a still-paid,
  // still-pending-label transaction should be given up. A concurrent run may
  // have advanced it (label created -> label_created/shipped) in the meantime.
  const preSnap = await txRef.get();
  const preData = preSnap.exists ? preSnap.data()! : null;
  if (!preData || preData.status !== 'paid' || preData.labelCreationPending !== true) {
    logger.info('[sweepPendingLabels] label give-up skipped — tx no longer paid+pending', {
      transactionId,
      status: preData?.status,
    });
    return;
  }

  try {
    // Shared core: idempotent Stripe refund (reverse_transfer for destination
    // charges) keyed rf_label_${txId}, then atomic wallet reconciliation
    // (re-credit buyer wallet portion, debit seller exactly sellerCreditedCents
    // — normally 0 for a never-credited pending-label tx — shortfall -> debt),
    // re-list the article, set status -> 'refunded'. On Stripe failure the core
    // dead-letters (type stripe_refund_failed) and throws.
    await issueTransactionRefund(transactionId, preData, {
      reason: 'label_creation_failed',
      idempotencyKey: `rf_label_${transactionId}`,
      // Parcel never shipped — the item still exists, so re-list it (default).
      relistArticle: true,
      source: 'sweepPendingLabels_giveup',
    });
  } catch (refundErr) {
    // The core already dead-lettered the Stripe failure with the same
    // deterministic key; leave the tx 'paid' + labelCreationPending so a later
    // run / retryFailedOperations re-drives the refund idempotently rather than
    // cancelling without refunding the buyer. Just log domain context.
    logger.error('CRITICAL [sweepPendingLabels] Stripe refund failed (label give-up)', {
      transactionId,
      paymentIntentId: preData.stripePaymentIntentId,
      error: refundErr instanceof Error ? refundErr.message : refundErr,
    });
    return;
  }

  // Stamp the label-pending bookkeeping the generic core does not own. Best-effort
  // merge — the core already set status='refunded' atomically; this only clears
  // the pending flag and records the give-up reason for the audit trail.
  await txRef
    .update({
      cancelReason: 'label_creation_failed',
      labelCreationPending: false,
    })
    .catch((err) =>
      logger.warn('[sweepPendingLabels] failed to clear labelCreationPending after refund', {
        transactionId,
        error: err instanceof Error ? err.message : err,
      })
    );

  logger.warn('[sweepPendingLabels] transaction refunded after max label attempts', {
    transactionId,
  });

  // Loi 25 art. 12.1 — journal the AUTOMATED refund decision (best-effort,
  // never affects the refund already committed by the core).
  await logAutomatedDecision({
    transactionId,
    userId: typeof txData.buyerId === 'string' ? txData.buyerId : '',
    decisionType: 'label_refund',
    criteria: {
      status: 'paid',
      labelCreationPending: true,
      maxAttempts: MAX_ATTEMPTS,
      cancelReason: 'label_creation_failed',
    },
    result: 'Commande annulée et remboursée (étiquette d\'expédition impossible à générer)',
  });

  // Notify buyer (best-effort). ENRICHED for Loi 25 transparency: states the
  // decision was AUTOMATIC and that it can be contested (right to human review).
  if (txData.buyerId) {
    const articleTitle = txData.articleTitle || 'votre article';
    sendPushNotification(
      txData.buyerId,
      'Commande annulée et remboursée automatiquement',
      `Nous n'avons pas pu générer l'étiquette d'expédition pour ${articleTitle}. Votre commande a été annulée et remboursée automatiquement. Si vous contestez cette décision, vous pouvez nous le signaler.`,
      { transactionId, articleId: txData.articleId || '' },
      'order_cancelled'
    ).catch((err) => {
      logger.warn('[sweepPendingLabels] failed to notify buyer of label give-up', {
        transactionId,
        error: err instanceof Error ? err.message : err,
      });
    });
  }
}

export const sweepPendingLabels = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['STRIPE_SECRET_KEY', 'SHIPENGINE_API_KEY'],
  },
  async () => {
    let shipped = 0;
    let refunded = 0;
    let retried = 0;
    let errors = 0;

    // Composite index required: (labelCreationPending ASC, status ASC, createdAt ASC).
    const snap = await db
      .collection('transactions')
      .where('labelCreationPending', '==', true)
      .where('status', '==', 'paid')
      .orderBy('createdAt', 'asc')
      .limit(MAX_TRANSACTIONS_PER_RUN)
      .get();

    if (snap.empty) {
      logger.info('[sweepPendingLabels] no pending-label transactions');
      return;
    }

    for (const doc of snap.docs) {
      const txData = doc.data();
      const transactionId = doc.id;
      const txRef = doc.ref;

      try {
        // Re-rate fresh.
        const rate = await refreshRateForTransaction(txData, transactionId);

        if (rate) {
          const shipEngine = getShipEngine();
          if (!shipEngine) {
            errors++;
            continue;
          }
          try {
            const label = await shipEngine.createLabel(rate.rateId);

            // ATOMIC: credit seller, reconcile cost, persist label, mark shipped.
            const ok = await db.runTransaction(async (tx) => {
              const fresh = await tx.get(txRef);
              const fdata = fresh.data();
              if (!fdata) return false;
              if (fdata.status !== 'paid' || fdata.labelCreationPending !== true) {
                return false; // already resolved by another run
              }

              await creditSellerForSale(tx, txRef, fdata, transactionId);

              const update: Record<string, any> = {
                trackingNumber: label.trackingNumber,
                shippingLabelUrl: label.labelDownload.href,
                trackingUrl: label.trackingUrl,
                carrierCode: label.carrierCode,
                trackingStatus: 'LABEL_CREATED',
                shipEngineLabelId: label.labelId,
                shipEngineRateId: rate.rateId,
                // 'label_created', NOT 'shipped' — the first real carrier scan
                // advances it (poller / ShipEngine webhook).
                status: 'label_created',
                labelCreatedAt: FieldValue.serverTimestamp(),
                labelCreationPending: false,
                labelCreationNote: FieldValue.delete(),
              };
              reconcileShippingCost(
                label,
                typeof fdata.shippingCost === 'number' ? fdata.shippingCost : 0,
                transactionId,
                update
              );
              tx.update(txRef, update);
              return true;
            });

            if (ok) {
              shipped++;
              logger.info('[sweepPendingLabels] label created on retry — shipped', {
                transactionId,
                trackingNumber: label.trackingNumber,
              });

              // Notify buyer + system message (best-effort).
              if (txData.chatId) {
                let participants: string[] = [];
                try {
                  const chatSnap = await db.collection('chats').doc(txData.chatId).get();
                  if (chatSnap.exists) {
                    participants = (chatSnap.data()?.participants as string[]) || [];
                  }
                } catch {
                  // ignore lookup failure
                }
                await db
                  .collection('messages')
                  .add({
                    chatId: txData.chatId,
                    senderId: 'system',
                    receiverId: 'system',
                    type: 'system',
                    content: `Etiquette d'expedition generee !\n\nNumero de suivi: ${label.trackingNumber}\n\nLe vendeur peut maintenant expedier l'article.`,
                    participants,
                    timestamp: FieldValue.serverTimestamp(),
                    status: 'sent',
                    isRead: true,
                    shippingLabel: {
                      labelUrl: label.labelDownload.href,
                      trackingNumber: label.trackingNumber,
                      trackingUrl: label.trackingUrl,
                    },
                  })
                  .catch(() => undefined);
              }
            }
            continue;
          } catch (labelErr) {
            logger.error('[sweepPendingLabels] createLabel retry failed', {
              transactionId,
              error: labelErr instanceof Error ? labelErr.message : labelErr,
            });
            // fall through to attempt bookkeeping below
          }
        }

        // Either re-rate failed or createLabel retry failed: bump the attempt
        // counter atomically and refund if we've exhausted MAX_ATTEMPTS.
        const nextAttempts = (typeof txData.labelAttempts === 'number' ? txData.labelAttempts : 0) + 1;

        if (nextAttempts >= MAX_ATTEMPTS) {
          await refundPendingLabelTransaction(txRef, txData, transactionId);
          // refundPendingLabelTransaction may early-return on Stripe failure,
          // leaving the tx still pending; record the attempt regardless.
          await txRef
            .update({
              labelAttempts: nextAttempts,
              lastLabelAttemptAt: FieldValue.serverTimestamp(),
            })
            .catch(() => undefined);
          refunded++;
        } else {
          await txRef.update({
            labelAttempts: nextAttempts,
            lastLabelAttemptAt: FieldValue.serverTimestamp(),
          });
          retried++;
        }
      } catch (err) {
        errors++;
        logger.error('[sweepPendingLabels] error processing transaction', {
          transactionId,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    logger.info('[sweepPendingLabels] run complete', { shipped, refunded, retried, errors });
  }
);
