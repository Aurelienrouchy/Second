/**
 * Shared tracking-state-machine transitions (P1: decouple shipped/label_created,
 * DELIVERED held-funds contract, FAILURE/lost flow).
 *
 * Single source of truth for advancing a SHIPPING transaction's status from a
 * ShipEngine tracking outcome, used by ALL three tracking entry points so the
 * contract lives in one place:
 *   - the scheduled poller        (scheduled/trackingCheck.ts)
 *   - the manual buyer/seller call (callable/payments.ts checkTrackingStatus)
 *   - the ShipEngine webhook       (http/shipEngineWebhook.ts)
 *
 * STATE MACHINE (shipping leg)
 * ----------------------------
 *   paid ── label bought ──> label_created ── 1st carrier scan ──> shipped
 *        └── shipped ── carrier scan DELIVERED ──> delivered (held-funds window)
 *        └── shipped/label_created ── carrier scan FAILURE/exception ──>
 *                                     delivery_failed (funds NOT released)
 *
 * `label_created` means a label exists but the carrier has not scanned the
 * parcel yet (the seller may have printed but not dropped off). The first real
 * carrier scan (IN_TRANSIT / TRANSIT) advances to `shipped`. This lets the
 * label_created-expiry sweep nudge sellers who never actually ship.
 *
 * DELIVERED applies the held-funds contract (pendingBalance -> heldBalance +
 * fundsReleaseAt = +7d), owned by releaseHeldFunds.applyDeliveredHeldFunds.
 *
 * FAILURE / exception NEVER releases funds: it marks `delivery_failed`, opens
 * the dispute window (so releaseHeldFunds keeps the money frozen) and notifies
 * both parties. Resolution (refund) goes through the admin refund callable.
 *
 * All wallet/ledger amounts are CENTS. Transaction cost fields are DOLLARS.
 */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { applyDeliveredHeldFunds } from '../scheduled/releaseHeldFunds';
import { getOrCreateSellerWallet } from '../callable/wallet';
import { sendPushNotification } from '../utils/notifications';
import { captureServerEvent } from '../lib/analytics';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSince(value: unknown): number {
  if (value && typeof (value as any).toMillis === 'function') {
    return Math.round(((Date.now() - (value as any).toMillis()) / MS_PER_DAY) * 100) / 100;
  }
  return 0;
}

/**
 * Statuses from which a DELIVERED scan may legitimately move funds. A
 * DELIVERED scan on any other status (refunded, disputed, cancelled, already
 * delivered, meetup_*) must be a no-op to avoid double-crediting or driving a
 * wallet negative (P1-21).
 */
export const DELIVERABLE_STATUSES = new Set(['paid', 'shipped', 'label_created']);

/**
 * Statuses that represent "a real carrier scan can advance us to shipped".
 * Only `label_created` (and defensively `paid`) progresses to `shipped`.
 */
const PRESHIP_STATUSES = new Set(['label_created', 'paid']);

/**
 * Internal tracking-status strings produced by ShipEngineClient.mapStatus that
 * count as a real carrier scan (parcel in the network).
 */
const CARRIER_SCANNED = new Set(['TRANSIT', 'IN_TRANSIT']);

/** Internal tracking-status strings that count as a delivery failure/exception. */
const FAILURE_STATUSES = new Set(['FAILURE', 'EXCEPTION']);

export type TrackingTransitionResult =
  | { kind: 'delivered'; changed: boolean }
  | { kind: 'shipped'; changed: boolean }
  | { kind: 'failed'; changed: boolean }
  | { kind: 'tracking_updated'; changed: boolean }
  | { kind: 'noop' };

/**
 * Apply a tracking outcome to one transaction atomically + fire best-effort
 * notifications. Idempotent and status-guarded — safe to call from the poller,
 * the manual callable and the webhook for the same parcel.
 *
 * @param transactionId  the transaction doc id
 * @param mappedStatus   ShipEngineClient.mapStatus(...) output
 *                       (UNKNOWN | TRANSIT | IN_TRANSIT | DELIVERED | FAILURE)
 * @param source         short tag for structured logs
 */
export async function applyTrackingOutcome(
  transactionId: string,
  mappedStatus: string,
  source: string
): Promise<TrackingTransitionResult> {
  const txRef = db.collection('transactions').doc(transactionId);

  // ---- DELIVERED: pendingBalance -> heldBalance + 7-day window ----
  if (mappedStatus === 'DELIVERED') {
    let notify: { buyerId?: string; sellerId?: string; chatId?: string; articleTitle?: string; articleId?: string } | null =
      null;
    let deliveredCarrier = '';
    let deliveredTransitDays = 0;

    const changed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(txRef);
      if (!snap.exists) return false;
      const data = snap.data()!;

      // Status guard (P1-21): only deliverable statuses advance to delivered.
      if (!DELIVERABLE_STATUSES.has(data.status)) {
        return false;
      }

      const sellerId = data.sellerId;
      const sellerPayout = data.sellerPayout ?? data.amount;
      const sellerPayoutCents =
        typeof sellerPayout === 'number' ? Math.round(sellerPayout * 100) : 0;

      // The seller is credited (pendingBalance) at label creation under the
      // deferred-credit model. If for any reason they were never credited
      // (sellerCreditedCents absent) we still mark delivered but cannot move
      // funds that are not there — log and skip the held-funds move.
      const creditedCents =
        typeof data.sellerCreditedCents === 'number' ? data.sellerCreditedCents : 0;

      // ALL reads first (Admin SDK forbids read-after-write in a transaction):
      // read the wallet BEFORE any tx.update, otherwise getOrCreateSellerWallet's
      // tx.get throws READ_AFTER_WRITE_ERROR and the delivery never commits (F1).
      let wallet: { walletRef: FirebaseFirestore.DocumentReference; walletData: FirebaseFirestore.DocumentData } | null =
        null;
      if (sellerId && creditedCents > 0) {
        wallet = await getOrCreateSellerWallet(tx, sellerId);
      }

      tx.update(txRef, {
        trackingStatus: 'DELIVERED',
        status: 'delivered',
        deliveredAt: FieldValue.serverTimestamp(),
      });

      if (wallet) {
        // Move exactly what was credited (creditedCents), not a freshly derived
        // payout, so credit and held-move can never drift.
        applyDeliveredHeldFunds(
          tx,
          wallet.walletRef,
          wallet.walletData,
          txRef,
          transactionId,
          creditedCents,
          Date.now()
        );
      } else {
        logger.warn('[trackingTransition] DELIVERED but seller not credited — no held move', {
          transactionId,
          source,
          sellerId,
          sellerPayoutCents,
        });
      }

      notify = {
        buyerId: data.buyerId,
        sellerId: data.sellerId,
        chatId: data.chatId,
        articleTitle: data.articleTitle || 'votre commande',
        articleId: data.articleId || '',
      };
      deliveredCarrier = typeof data.carrierCode === 'string' ? data.carrierCode : '';
      deliveredTransitDays = daysSince(data.shippedAt);
      return true;
    });

    if (changed && notify) {
      await emitDeliveredSideEffects(transactionId, notify, source);
      // Analytics (§12): order_delivered follows the BUYER.
      const buyerId = (notify as { buyerId?: string }).buyerId;
      if (buyerId) {
        await captureServerEvent(buyerId, 'order_delivered', {
          transaction_id: transactionId,
          carrier: deliveredCarrier,
          transit_days: deliveredTransitDays,
          $insert_id: `order_delivered_${transactionId}`,
        });
      }
    }
    return { kind: 'delivered', changed };
  }

  // ---- FAILURE / exception: freeze funds, open dispute window, notify both ----
  if (FAILURE_STATUSES.has(mappedStatus)) {
    let notify: { buyerId?: string; sellerId?: string; articleTitle?: string; articleId?: string } | null =
      null;

    const changed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(txRef);
      if (!snap.exists) return false;
      const data = snap.data()!;

      // Only act on in-flight statuses; never override a terminal/dispute state.
      if (!['paid', 'shipped', 'label_created'].includes(data.status)) {
        return false;
      }
      // Idempotence: already flagged failed.
      if (data.deliveryFailedAt) return false;

      tx.update(txRef, {
        trackingStatus: 'FAILURE',
        status: 'delivery_failed',
        // Open the dispute window so releaseHeldFunds keeps the money frozen and
        // a manual/admin refund can resolve it. Funds are NOT released.
        disputed: true,
        deliveryFailedAt: FieldValue.serverTimestamp(),
        statusBeforeDispute: data.status,
      });

      notify = {
        buyerId: data.buyerId,
        sellerId: data.sellerId,
        articleTitle: data.articleTitle || 'votre commande',
        articleId: data.articleId || '',
      };
      return true;
    });

    if (changed && notify) {
      await emitFailureSideEffects(transactionId, notify, source);
    }
    return { kind: 'failed', changed };
  }

  // ---- Real carrier scan: label_created -> shipped ----
  if (CARRIER_SCANNED.has(mappedStatus)) {
    const changed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(txRef);
      if (!snap.exists) return false;
      const data = snap.data()!;

      const trackingChanged = data.trackingStatus !== mappedStatus;

      if (PRESHIP_STATUSES.has(data.status)) {
        tx.update(txRef, {
          status: 'shipped',
          shippedAt: FieldValue.serverTimestamp(),
          trackingStatus: mappedStatus,
        });
        return true;
      }
      // Already shipped/delivered/etc — just refresh trackingStatus if changed.
      if (trackingChanged) {
        tx.update(txRef, { trackingStatus: mappedStatus });
      }
      return false;
    });
    return { kind: changed ? 'shipped' : 'tracking_updated', changed };
  }

  // ---- UNKNOWN / other: best-effort trackingStatus refresh, no state change ----
  const changed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(txRef);
    if (!snap.exists) return false;
    const data = snap.data()!;
    if (data.trackingStatus === mappedStatus) return false;
    tx.update(txRef, { trackingStatus: mappedStatus });
    return true;
  });
  return { kind: 'tracking_updated', changed };
}

/** Best-effort system message + buyer push after a delivery transition. */
async function emitDeliveredSideEffects(
  transactionId: string,
  notify: { buyerId?: string; chatId?: string; articleTitle?: string; articleId?: string },
  source: string
): Promise<void> {
  if (notify.chatId) {
    try {
      let participants: string[] = [];
      const chatSnap = await db.collection('chats').doc(notify.chatId).get();
      if (chatSnap.exists) {
        participants = (chatSnap.data()?.participants as string[]) || [];
      }
      await db.collection('messages').add({
        chatId: notify.chatId,
        senderId: 'system',
        receiverId: 'system',
        type: 'system',
        content:
          'Colis livré ! Les fonds du vendeur seront disponibles après la fenêtre de litige de 7 jours.',
        participants,
        timestamp: FieldValue.serverTimestamp(),
        status: 'sent',
        isRead: true,
      });
    } catch (msgErr) {
      logger.warn('[trackingTransition] delivered system message failed', {
        transactionId,
        source,
        error: msgErr instanceof Error ? msgErr.message : msgErr,
      });
    }
  }

  if (notify.buyerId) {
    try {
      await sendPushNotification(
        notify.buyerId,
        'Colis livre !',
        `Votre commande ${notify.articleTitle} a ete livree.`,
        { transactionId, articleId: notify.articleId || '' },
        'order_delivered'
      );
    } catch (notifErr) {
      logger.warn('[trackingTransition] delivered buyer notification failed', {
        transactionId,
        source,
        error: notifErr instanceof Error ? notifErr.message : notifErr,
      });
    }
  }
}

/** Best-effort push to BOTH parties after a delivery failure / lost parcel. */
async function emitFailureSideEffects(
  transactionId: string,
  notify: { buyerId?: string; sellerId?: string; articleTitle?: string; articleId?: string },
  source: string
): Promise<void> {
  const payload = { transactionId, articleId: notify.articleId || '' };

  if (notify.buyerId) {
    sendPushNotification(
      notify.buyerId,
      'Probleme de livraison',
      `La livraison de ${notify.articleTitle} a echoue. Notre equipe va etudier votre dossier — vous serez rembourse si le colis est introuvable.`,
      payload,
      'delivery_failed'
    ).catch((err) =>
      logger.warn('[trackingTransition] failure buyer notification failed', {
        transactionId,
        source,
        error: err instanceof Error ? err.message : err,
      })
    );
  }

  if (notify.sellerId) {
    sendPushNotification(
      notify.sellerId,
      'Probleme de livraison',
      `La livraison de ${notify.articleTitle} a echoue. Les fonds restent en attente le temps de la resolution.`,
      payload,
      'delivery_failed'
    ).catch((err) =>
      logger.warn('[trackingTransition] failure seller notification failed', {
        transactionId,
        source,
        error: err instanceof Error ? err.message : err,
      })
    );
  }

  logger.warn('[trackingTransition] delivery failure — funds frozen, dispute window opened', {
    transactionId,
    source,
  });
}
