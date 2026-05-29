/**
 * Buyer recourse callables — anti-fraud refund & dispute flows.
 *
 * Firebase Functions v2, region northamerica-northeast1.
 *
 * PRINCIPLE (anti-fraud, NON negotiable): we NEVER refund on the buyer's word
 * alone. An automatic refund is only triggered by an OBJECTIVE carrier signal
 * (confirmed delivery failure / lost parcel, or — for returns — confirmed
 * reception of the returned parcel by the seller).
 *
 *   1. requestRefund(transactionId)
 *        Buyer-only auto-refund, ALLOWED only when the carrier has already
 *        confirmed the parcel is `delivery_failed` or `lost`. Reuses the shared
 *        issueTransactionRefund core (reverse_transfer / sellerDebt). The
 *        article is NOT re-listed (the parcel is gone). Idempotent.
 *
 *   2. reportTransactionProblem(transactionId, reason, details?)
 *        Buyer-only "delivered but problem" report. NO money movement. Freezes
 *        the funds (disputed=true), records buyerReport + statusBeforeDispute,
 *        opens a `disputes` doc for admin review. Refuses a re-report.
 *
 *   3. requestReturn(transactionId, reason)
 *        Buyer-only "item not as described, sending it back". ALLOWED only on a
 *        DELIVERED shipping transaction still inside the 7-day window. Buys a
 *        RETURN label (origin = buyer shipping address, destination = seller
 *        origin address) via shipEngine.createReturnLabel, freezes the funds
 *        (disputed=true, status -> 'return_requested') and notifies the seller.
 *        NO refund here — the return-leg refund is triggered downstream by the
 *        carrier DELIVERED signal on the returnTrackingNumber (the buyer is
 *        refunded `total - returnLabelCost`; the seller is debited their payout).
 *        That signal handler lives in utils/returnRefund.ts and is wired into
 *        the poller (trackingCheck.ts) + the ShipEngine webhook.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';
import { issueTransactionRefund } from '../utils/refund';
import { sendPushNotification } from '../utils/notifications';
import {
  getShipEngine,
  ShipEngineAddress,
  ShipEngineParcel,
} from '../config/shipEngine';
import { resolveSellerOriginAddress } from './payments';
import { Timestamp } from 'firebase-admin/firestore';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Allowed reason codes for a buyer-initiated return ("item not as described"). */
const RETURN_REASONS = new Set(['not_as_described', 'damaged', 'wrong_item', 'other']);

/** Carrier-confirmed failure statuses that authorize a buyer auto-refund. */
const AUTO_REFUNDABLE_STATUSES = new Set(['delivery_failed', 'lost']);

/** Allowed reason codes for a "delivered but problem" buyer report. */
const REPORT_REASONS = new Set([
  'not_received_despite_delivered',
  'not_as_described',
  'damaged',
  'other',
]);

/** Statuses from which a buyer may file a "delivered but problem" report. */
const REPORTABLE_STATUSES = new Set(['shipped', 'delivered', 'completed']);

// =============================================================================
// requestRefund — Buyer auto-refund on a carrier-confirmed failed/lost parcel
// =============================================================================

/**
 * Buyer-initiated automatic refund, ALLOWED only when the transporter has
 * already confirmed the parcel failed or was lost (status `delivery_failed`
 * or `lost`). Any other status is refused with `failed-precondition`, steering
 * the buyer toward `reportTransactionProblem` instead.
 *
 * Reuses the shared refund core: card portion refunded via Stripe with
 * reverse_transfer, wallet portion re-credited, seller debited exactly what was
 * credited (shortfall -> sellerDebt). The article is NOT put back on sale (the
 * parcel is lost/failed). Idempotent: a no-op if already refunded.
 */
export const requestRefund = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'requestRefund',
      maxCallsAuthenticated: 5,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const txRef = db.collection('transactions').doc(transactionId);
    const preSnap = await txRef.get();
    if (!preSnap.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }
    const preData = preSnap.data()!;

    // Buyer-only.
    if (preData.buyerId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Only the buyer can request this refund');
    }

    // Idempotence: already refunded (or in progress) — no-op.
    if (preData.status === 'refunded' || preData.status === 'refund_in_progress') {
      return { success: true, alreadyRefunded: true };
    }

    // Anti-fraud gate: refund only on an OBJECTIVE carrier signal.
    if (!AUTO_REFUNDABLE_STATUSES.has(preData.status)) {
      throw new HttpsError(
        'failed-precondition',
        'Le remboursement automatique est réservé aux colis confirmés perdus ou en échec de ' +
          'livraison par le transporteur. Pour un colis livré présentant un problème, ' +
          'signalez-le via le formulaire de réclamation.'
      );
    }

    // Mark in-progress so a concurrent retry short-circuits before the Stripe
    // call. issueTransactionRefund is itself idempotent on the Stripe key.
    await txRef.update({
      status: 'refund_in_progress',
      refundInitiatedAt: FieldValue.serverTimestamp(),
    });

    try {
      const result = await issueTransactionRefund(transactionId, preData, {
        reason: `buyer_auto_refund_${preData.status}`,
        // Deterministic per logical refund so retries never double-refund.
        idempotencyKey: `rf_buyer_${transactionId}`,
        // Parcel is lost/failed — do NOT put the article back on sale.
        relistArticle: false,
        source: 'requestRefund',
      });

      // Notify both parties (best-effort).
      const articleTitle = preData.articleTitle || 'votre commande';
      const payload = { transactionId, articleId: preData.articleId || '' };
      if (preData.buyerId) {
        sendPushNotification(
          preData.buyerId,
          'Remboursement effectué',
          `Votre commande ${articleTitle} a été remboursée suite à un problème de livraison.`,
          payload,
          'order_refunded'
        ).catch((err) =>
          logger.warn('[requestRefund] buyer notification failed', {
            transactionId,
            error: err instanceof Error ? err.message : err,
          })
        );
      }
      if (preData.sellerId) {
        sendPushNotification(
          preData.sellerId,
          'Commande remboursée',
          `La commande ${articleTitle} a été remboursée à l'acheteur (colis perdu ou non livré).`,
          payload,
          'order_refunded'
        ).catch((err) =>
          logger.warn('[requestRefund] seller notification failed', {
            transactionId,
            error: err instanceof Error ? err.message : err,
          })
        );
      }

      logger.warn('[requestRefund] buyer auto-refund completed', {
        transactionId,
        buyerId: request.auth.uid,
        fromStatus: preData.status,
      });

      return result;
    } catch (error: unknown) {
      // Roll the status back so the buyer can retry; the Stripe call is keyed
      // and idempotent, and issueTransactionRefund no-ops if already refunded.
      await txRef
        .update({
          status: preData.status,
          refundInitiatedAt: FieldValue.delete(),
        })
        .catch(() => undefined);

      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[requestRefund] refund failed', { transactionId, error: message });
      throw new HttpsError('internal', `Refund failed: ${message}`);
    }
  }
);

// =============================================================================
// reportTransactionProblem — Buyer flags a delivered-but-problematic order
// =============================================================================

/**
 * Buyer reports a problem on a DELIVERED order ("delivered but problem").
 *
 * NO money moves. This freezes the funds by setting `disputed=true` (the
 * held-funds release job already blocks on `disputed === true`), records the
 * buyer report and the pre-dispute status, sets status `disputed`, opens a
 * `disputes` doc for admin review and notifies the admin team. A second report
 * on an already-disputed transaction is refused.
 *
 * Resolution (refund / no-refund) is an ADMIN decision via
 * adminRefundTransaction — this function never decides the outcome.
 */
export const reportTransactionProblem = onCall(
  { region: 'northamerica-northeast1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'reportTransactionProblem',
      maxCallsAuthenticated: 5,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId, reason, details } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }
    if (typeof reason !== 'string' || !REPORT_REASONS.has(reason)) {
      throw new HttpsError(
        'invalid-argument',
        'Un motif de réclamation valide est requis'
      );
    }
    // details is optional free text; trim + cap. Omit the field if empty.
    const trimmedDetails =
      typeof details === 'string' && details.trim().length > 0
        ? details.trim().substring(0, 1000)
        : null;

    const txRef = db.collection('transactions').doc(transactionId);
    const buyerUid = request.auth.uid;

    const disputeId = await db.runTransaction(async (tx) => {
      const snap = await tx.get(txRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Transaction not found');
      }
      const data = snap.data()!;

      // Buyer-only.
      if (data.buyerId !== buyerUid) {
        throw new HttpsError('permission-denied', 'Only the buyer can report a problem');
      }

      // Refuse a re-report on an already-disputed / resolved transaction.
      if (data.disputed === true || data.status === 'disputed') {
        throw new HttpsError(
          'failed-precondition',
          'Cette commande fait déjà l\'objet d\'une réclamation en cours'
        );
      }
      if (data.status === 'refunded' || data.status === 'refund_in_progress') {
        throw new HttpsError('failed-precondition', 'Cette commande a déjà été remboursée');
      }

      // Only "delivered-window" statuses can be reported as problematic.
      if (!REPORTABLE_STATUSES.has(data.status)) {
        throw new HttpsError(
          'failed-precondition',
          `Cette commande ne peut pas faire l'objet d'une réclamation (statut ${data.status})`
        );
      }

      // Freeze funds + flag dispute. NO money movement here.
      tx.update(txRef, {
        status: 'disputed',
        disputed: true,
        statusBeforeDispute: data.status,
        buyerReport: {
          reason,
          ...(trimmedDetails !== null ? { details: trimmedDetails } : {}),
          reportedAt: FieldValue.serverTimestamp(),
        },
        disputedAt: FieldValue.serverTimestamp(),
      });

      // Open a dispute doc for admin review.
      const disputeRef = db.collection('disputes').doc();
      tx.set(disputeRef, {
        transactionId,
        buyerId: data.buyerId,
        sellerId: data.sellerId ?? null,
        articleId: data.articleId ?? null,
        articleTitle: data.articleTitle ?? null,
        reason,
        ...(trimmedDetails !== null ? { details: trimmedDetails } : {}),
        status: 'open',
        statusBeforeDispute: data.status,
        createdAt: FieldValue.serverTimestamp(),
      });

      return disputeRef.id;
    });

    // Best-effort admin signal (in-app notification path is via support tooling;
    // here we emit a structured warning the on-call admin dashboard ingests).
    logger.warn('ADMIN_REVIEW — buyer reported a transaction problem', {
      disputeId,
      transactionId,
      buyerId: buyerUid,
      reason,
    });

    return { success: true, disputeId };
  }
);

// =============================================================================
// requestReturn — Buyer ships a non-conforming item back to the seller
// =============================================================================

/**
 * Buyer-initiated RETURN of a non-conforming item.
 *
 * ALLOWED only when:
 *   - status === 'delivered'           (carrier-confirmed delivery)
 *   - deliveryType === 'shipping'      (meetups have no return label)
 *   - inside the 7-day window          (fundsReleaseAt in the future and funds
 *                                       not yet released — fundsReleasedAt absent)
 *
 * Buys a RETURN label (origin = buyer shipping address, destination = seller
 * origin address) via shipEngine.createReturnLabel, persists the return-leg
 * fields, freezes the funds (disputed=true, status -> 'return_requested') and
 * notifies the seller. NO refund happens here.
 *
 * The actual refund is the ANTI-FRAUD guarantee: it is only issued once the
 * carrier confirms the RETURN parcel was DELIVERED back to the seller (see
 * utils/returnRefund.ts, wired into the poller + webhook). The buyer bears the
 * return label cost (refund = total - returnLabelCost).
 *
 * Rate-limited 3/min, buyer-only, idempotent (no-op if a return is already in
 * progress for this transaction).
 */
export const requestReturn = onCall(
  {
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['SHIPENGINE_API_KEY'],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'requestReturn',
      maxCallsAuthenticated: 3,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId, reason } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }
    if (typeof reason !== 'string' || !RETURN_REASONS.has(reason)) {
      throw new HttpsError('invalid-argument', 'Un motif de retour valide est requis');
    }

    const buyerUid = request.auth.uid;
    const txRef = db.collection('transactions').doc(transactionId);

    // --- Read + validate the precondition BEFORE buying a paid label ---
    const preSnap = await txRef.get();
    if (!preSnap.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }
    const preData = preSnap.data()!;

    // Buyer-only.
    if (preData.buyerId !== buyerUid) {
      throw new HttpsError('permission-denied', 'Only the buyer can request a return');
    }

    // Idempotence: a return is already in progress / done — no-op.
    if (
      preData.status === 'return_requested' ||
      preData.returnLabelId ||
      preData.returnTrackingNumber
    ) {
      return {
        success: true,
        alreadyRequested: true,
        returnTrackingNumber: preData.returnTrackingNumber ?? null,
        returnLabelUrl: preData.returnLabelUrl ?? null,
      };
    }

    // Must be a DELIVERED shipping transaction.
    if (preData.status !== 'delivered') {
      throw new HttpsError(
        'failed-precondition',
        'Un retour ne peut être demandé que pour une commande livrée.'
      );
    }
    if (preData.deliveryType !== 'shipping') {
      throw new HttpsError(
        'failed-precondition',
        'Le retour par étiquette n\'est possible que pour les commandes expédiées.'
      );
    }

    // Inside the 7-day window: funds not yet released, and the release deadline
    // (set at delivery) is still in the future.
    if (preData.fundsReleasedAt) {
      throw new HttpsError(
        'failed-precondition',
        'La fenêtre de retour de 7 jours est écoulée pour cette commande.'
      );
    }
    const releaseAtMs =
      preData.fundsReleaseAt instanceof Timestamp
        ? preData.fundsReleaseAt.toMillis()
        : null;
    if (releaseAtMs !== null && releaseAtMs <= Date.now()) {
      throw new HttpsError(
        'failed-precondition',
        'La fenêtre de retour de 7 jours est écoulée pour cette commande.'
      );
    }

    // --- Resolve return-label addresses (origin = buyer, destination = seller) ---
    const shipEngine = getShipEngine();
    if (!shipEngine) {
      throw new HttpsError('failed-precondition', 'ShipEngine API not configured');
    }

    const articleId = preData.articleId;
    if (typeof articleId !== 'string' || articleId.length === 0) {
      throw new HttpsError('failed-precondition', 'Article introuvable pour ce retour.');
    }
    const articleSnap = await db.collection('articles').doc(articleId).get();
    if (!articleSnap.exists) {
      throw new HttpsError('not-found', 'Cet article n\'existe plus');
    }
    const articleData = articleSnap.data()!;

    const sellerId = preData.sellerId;
    if (typeof sellerId !== 'string' || sellerId.length === 0) {
      throw new HttpsError('failed-precondition', 'Vendeur introuvable pour ce retour.');
    }
    const sellerSnap = await db.collection('users').doc(sellerId).get();
    if (!sellerSnap.exists) {
      throw new HttpsError('not-found', 'Vendeur introuvable');
    }
    const sellerData = sellerSnap.data()!;

    // Destination = seller's real origin address (reuse the forward-leg resolver).
    const sellerAddress = resolveSellerOriginAddress(sellerData, articleData);
    if (!sellerAddress) {
      throw new HttpsError(
        'failed-precondition',
        'L\'adresse du vendeur est introuvable. Le retour ne peut pas être créé.'
      );
    }

    // Origin = buyer shipping address (the address the parcel was delivered to).
    const shippingAddress = preData.shippingAddress || {};
    const buyerPostal = (shippingAddress.postalCode || '').toString().trim();
    const buyerStreet = (shippingAddress.street || '').toString().trim();
    const buyerCity = (shippingAddress.city || '').toString().trim();
    const buyerProvince = (shippingAddress.province || '').toString().trim();
    if (
      buyerPostal.length === 0 ||
      buyerStreet.length === 0 ||
      buyerCity.length === 0 ||
      buyerProvince.length === 0
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Votre adresse de livraison est incomplète. Le retour ne peut pas être créé.'
      );
    }
    const buyerAddress: ShipEngineAddress = {
      name: shippingAddress.name || 'Acheteur',
      addressLine1: buyerStreet,
      cityLocality: buyerCity,
      stateProvince: buyerProvince,
      postalCode: buyerPostal,
      countryCode: 'CA',
      ...(typeof shippingAddress.phone === 'string' && shippingAddress.phone.trim().length > 0
        ? { phone: shippingAddress.phone.trim() }
        : sellerAddress.phone
          ? { phone: sellerAddress.phone }
          : {}),
    };

    // Parcel from the article metadata (same defaults as the forward leg).
    const dims = articleData.dimensions || {};
    const parcel: ShipEngineParcel = {
      weight: { value: parseFloat(articleData.weight) || 0.5, unit: 'kilogram' },
      dimensions: {
        length: parseFloat(dims.length) || 30,
        width: parseFloat(dims.width) || 25,
        height: parseFloat(dims.height) || 10,
        unit: 'centimeter',
      },
    };

    // --- Buy the return label (NOT idempotent in ShipEngine; precondition above
    // short-circuits if a label already exists). Buyer -> seller. ---
    let label;
    try {
      label = await shipEngine.createReturnLabel(buyerAddress, sellerAddress, parcel);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[requestReturn] createReturnLabel failed', {
        transactionId,
        buyerId: buyerUid,
        error: message,
      });
      throw new HttpsError(
        'unavailable',
        'Impossible de générer l\'étiquette de retour pour le moment. Veuillez réessayer.'
      );
    }

    const returnLabelCost = (label.shipmentCost || 0) + (label.insuranceCost || 0);

    // --- Atomically persist the return-leg fields + freeze the funds ---
    // Re-check the precondition under the lock so two concurrent calls (the 2nd
    // racing past the pre-read) cannot both flip the status. The 1st commit wins;
    // the 2nd sees status !== 'delivered' and aborts (its already-bought label is
    // logged for manual cleanup — rate-limited 3/min keeps this rare).
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(txRef);
        if (!snap.exists) throw new HttpsError('not-found', 'Transaction not found');
        const data = snap.data()!;

        if (data.buyerId !== buyerUid) {
          throw new HttpsError('permission-denied', 'Only the buyer can request a return');
        }
        if (data.returnLabelId || data.returnTrackingNumber || data.status === 'return_requested') {
          // Lost the race — another call already registered a return.
          throw new HttpsError('aborted', 'Un retour est déjà en cours pour cette commande.');
        }
        if (data.status !== 'delivered') {
          throw new HttpsError(
            'failed-precondition',
            'Un retour ne peut être demandé que pour une commande livrée.'
          );
        }

        tx.update(txRef, {
          status: 'return_requested',
          disputed: true,
          statusBeforeDispute: data.status,
          returnLabelId: label.labelId,
          returnTrackingNumber: label.trackingNumber,
          returnLabelUrl: label.labelDownload?.href ?? null,
          returnCarrierCode: label.carrierCode ?? null,
          returnLabelCost,
          returnReason: reason,
          returnRequestedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (error: unknown) {
      if (error instanceof HttpsError && error.code === 'aborted') {
        // Concurrent winner already registered a return — surface as idempotent.
        logger.warn('[requestReturn] concurrent return — label bought but not used', {
          transactionId,
          returnLabelId: label.labelId,
          returnTrackingNumber: label.trackingNumber,
        });
        return { success: true, alreadyRequested: true };
      }
      throw error;
    }

    // Notify the seller (best-effort).
    const articleTitle = preData.articleTitle || 'la commande';
    if (sellerId) {
      sendPushNotification(
        sellerId,
        'Retour demandé',
        `L'acheteur retourne "${articleTitle}". Vous recevrez le colis sous peu — le remboursement sera traité à sa réception.`,
        { transactionId, articleId },
        'return_requested'
      ).catch((err) =>
        logger.warn('[requestReturn] seller notification failed', {
          transactionId,
          error: err instanceof Error ? err.message : err,
        })
      );
    }

    logger.warn('[requestReturn] return label created — funds frozen', {
      transactionId,
      buyerId: buyerUid,
      returnTrackingNumber: label.trackingNumber,
      returnLabelCost,
      reason,
    });

    return {
      success: true,
      returnTrackingNumber: label.trackingNumber,
      returnLabelUrl: label.labelDownload?.href ?? null,
      returnLabelCost,
    };
  }
);
