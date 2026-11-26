import { financialRecoverySourceFields } from "./financialRecoverySources";
import { FinancialRecoveryBlocked } from "./financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "./financialRecoverySources";
import { hasUnsettledRefund } from './refundState';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
/**
 * Shared tracking-state-machine transitions (P1: decouple shipped/label_created,
 * DELIVERED held-funds contract and nonterminal tracking incidents).
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
 *        └── carrier EX/exception ──> review + funds retained
 *                                     (commercial status unchanged)
 *
 * `label_created` means a label exists but the carrier has not scanned the
 * parcel yet (the seller may have printed but not dropped off). The first real
 * carrier scan (IN_TRANSIT / TRANSIT) advances to `shipped`. This lets the
 * label_created-expiry sweep nudge sellers who never actually ship.
 *
 * DELIVERED applies the held-funds contract (pendingBalance -> heldBalance +
 * fundsReleaseAt = +7d), owned by releaseHeldFunds.applyDeliveredHeldFunds.
 *
 * EX/exception is not proof of loss or a refund instruction. It records a
 * review and retains funds without rewriting commercial status/delivery dates.
 *
 * All wallet/ledger amounts are CENTS. Transaction cost fields are DOLLARS.
 */
import { sellerPendingCreditCents } from './sellerEscrow';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { applyDeliveredHeldFunds } from '../scheduled/releaseHeldFunds';
import { getOrCreateSellerWallet } from '../callable/wallet';
import { prepareOperationalNotices } from '../utils/notifications';
import { captureServerEvent } from '../lib/analytics';
import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { getShipEngine, ShipEngineClient, trackingIdentity, trackingProofMatches, trackingObservationDisposition, type QualifiedTracking, type TrackingLeg } from '../config/shipEngine';
import { labelLifecycleIdentityQualified } from './labelLifecycle';
import { deliveryCorrectionBlocksProgress } from './orderModeration';
import { deliveredPurchasePolicyUpdate } from './purchasePolicy';
import { recordTrackingHistory } from './trackingHistory';
import { prepareSystemTransportReview } from './transportReview';
import { supportSourceHash } from './supportRequest';

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

/** The provider currently supplies no qualified terminal-loss outcome. */
const INCIDENT_STATUSES = new Set(['EXCEPTION']);

/** A tracking number can be recycled or shared across carriers/legs. Never
 * choose the first match; ambiguity is a private review, not a money event. */
export async function trackingOutcomeMatches(tx: FirebaseFirestore.Transaction, transactionId: string,
  data: FirebaseFirestore.DocumentData, proof: QualifiedTracking['proof'] | undefined, leg: TrackingLeg): Promise<boolean> {
  if (!trackingProofMatches(transactionId, data, proof, leg)) return false;
  if (!await labelLifecycleIdentityQualified(tx, transactionId, data, leg)) return false;
  if (!['accept', 'replay', 'snapshot'].includes(trackingObservationDisposition(data, proof!, leg))) return false;
  return uniqueTrackingOwner(tx, transactionId, proof!.trackingNumber, leg);
}
async function uniqueTrackingOwner(tx: FirebaseFirestore.Transaction, transactionId: string, trackingNumber: string, leg: TrackingLeg): Promise<boolean> {
  const [forward, returned] = await Promise.all([
    tx.get(db.collection('transactions').where('trackingNumber', '==', trackingNumber).limit(2)),
    tx.get(db.collection('transactions').where('returnTrackingNumber', '==', trackingNumber).limit(2)),
  ]);
  return forward.size + returned.size === 1 && (leg === 'forward' ? forward : returned).docs[0]?.id === transactionId;
}
export async function recordTrackingReview(transactionId: string, data: FirebaseFirestore.DocumentData, leg: TrackingLeg, reason: string): Promise<void> {
  const ref = db.collection('transactions').doc(transactionId);
  const trackingNumber = leg === 'forward' ? data.trackingNumber : data.returnTrackingNumber;
  const labelId = leg === 'forward' ? data.shipEngineLabelId : data.returnLabelId;
  const alert = db.collection('admin_alerts').doc('tracking_' + createHash('sha256').update(JSON.stringify([transactionId, leg, reason])).digest('hex'));
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data(), prior = (await tx.get(alert)).data();
    if (!prior) tx.create(alert, {kind: 'tracking_identity_review', severity: 'critical', refId: transactionId, status: 'open',
      message: 'Vérifier l’identité de l’étiquette et les scans du transporteur. Cet indice ne permet aucune livraison ni restitution.',
      context: {leg, reason, labelId: typeof labelId === 'string' ? labelId : null, trackingNumber: typeof trackingNumber === 'string' ? trackingNumber : null},
      createdAt: FieldValue.serverTimestamp()});
    if (current && (leg === 'forward' ? current.trackingNumber === trackingNumber && current.shipEngineLabelId === labelId :
      current.returnTrackingNumber === trackingNumber && current.returnLabelId === labelId)) tx.update(ref,
      {trackingReviewRequired: true, trackingReviewReason: reason, trackingOwnerMessage: 'Le suivi de ce colis doit être vérifié par notre équipe.',
        ...(current.transportExceptionReview?.protocol === 'transport_exception_guard_v1' ? {
          transportExceptionReview: { ...current.transportExceptionReview, trackingFlagOwnership: 'historical_unknown' } } : {}),
        ...(leg === 'forward' && reason === 'delivery_scan_time_unqualified' ? {
          purchasePolicyReviewRequired: true, purchasePolicyReviewReason: 'delivery_policy_time_unqualified' } : {})});
  });
}
export async function readQualifiedTracking(transactionId: string, data: FirebaseFirestore.DocumentData, leg: TrackingLeg): Promise<QualifiedTracking> {
  try {
    const identity = trackingIdentity(transactionId, data, leg);
    if (!identity) throw new Error('tracking_saved_identity_unqualified');
    const readId = randomUUID(), readField = leg === 'forward' ? 'trackingRead' : 'returnTrackingRead';
    const nativeRead = await db.runTransaction(async tx => {
      const current = (await tx.get(db.collection('transactions').doc(transactionId))).data();
      if (!current || trackingIdentity(transactionId, current, leg)?.sourceHash !== identity.sourceHash ||
          !await labelLifecycleIdentityQualified(tx, transactionId, current, leg) ||
          !await uniqueTrackingOwner(tx, transactionId, identity.trackingNumber, leg)) return null;
      const prior = current[readField];
      if (prior != null && (prior.schemaVersion !== 1 || !Number.isSafeInteger(prior.version) || prior.version < 1 ||
          !(prior.authorizedAt instanceof Timestamp))) throw new Error('tracking_read_witness_unqualified');
      const version = (prior?.version ?? 0) + 1;
      if (!Number.isSafeInteger(version)) throw new Error('tracking_read_witness_unqualified');
      tx.update(db.collection('transactions').doc(transactionId), {[readField]: {schemaVersion: 1, readId, version,
        sourceHash: identity.sourceHash, labelId: identity.labelId, leg, authorizedAt: Timestamp.now()}});
      return {readId, version};
    });
    if (!nativeRead) throw new Error('tracking_number_ambiguous');
    const engine = getShipEngine(); if (!engine) throw new Error('tracking_provider_unavailable');
    const tracking = await engine.getQualifiedTracking(transactionId, data, leg, nativeRead);
    const current = (await db.collection('transactions').doc(transactionId).get()).data();
    if (!current || !trackingProofMatches(transactionId, current, tracking.proof, leg)) throw new Error('tracking_read_superseded');
    const chronology = trackingObservationDisposition(current, tracking.proof, leg);
    if (chronology === 'stale') throw new Error('tracking_observation_stale');
    if (chronology === 'ambiguous') throw new Error('tracking_observation_time_ambiguous');
    await db.runTransaction(async tx => {
      const latest = (await tx.get(db.collection('transactions').doc(transactionId))).data();
      if (!latest || !await trackingOutcomeMatches(tx, transactionId, latest, tracking.proof, leg)) throw new Error('tracking_read_superseded');
      await recordTrackingHistory(tx, transactionId, latest, tracking);
    });
    if (chronology === 'snapshot' && tracking.statusCode === 'DE') await recordTrackingReview(transactionId, current, leg, 'delivery_scan_time_unqualified');
    return tracking;
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    const message = error instanceof Error ? error.message : '';
    const reason = ['tracking_saved_identity_unqualified', 'tracking_number_ambiguous', 'tracking_provider_unavailable',
      'tracking_label_identity_contradictory', 'tracking_response_unqualified', 'tracking_label_time_unqualified',
      'tracking_response_time_unqualified', 'tracking_current_history_unqualified',
      'tracking_saved_identity_changed', 'tracking_read_witness_unqualified', 'tracking_read_superseded',
      'tracking_observation_stale', 'tracking_observation_time_ambiguous'].includes(message) ? message : 'tracking_current_read_unavailable';
    // Another native read winning this race is routine, not an operator incident.
    if (reason !== 'tracking_read_superseded') await recordTrackingReview(transactionId, data, leg, reason);
    throw new Error(reason);
  }
}

export type TrackingTransitionResult =
  | { kind: 'delivered'; changed: boolean }
  | { kind: 'shipped'; changed: boolean }
  | { kind: 'failed'; changed: boolean }
  | { kind: 'tracking_updated'; changed: boolean }
  | { kind: 'delivery_review'; changed: boolean }
  | { kind: 'noop' };

/** Reads before writes, under the same order lock as release. A current native
 * snapshot can withdraw confidence in delivery without proving a newer scan.
 * The old receipt/status/deadline and every monetary bucket are retained. */
async function preserveDeliveryCorrection(tx: FirebaseFirestore.Transaction, txRef: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData, proof: QualifiedTracking['proof'], source: string): Promise<boolean> {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
  // A new GET of the SAME approved business DE can requalify the native
  // observation without rewriting the human receipt or any financial clock.
  // A changed date/content/identity/status has no such continuation.
  const continuation = data.deliveryCorrection?.resolution?.nativeReviewResolution?.protocol === 'transport_review_resolution_v1' &&
    !deliveryCorrectionBlocksProgress({ ...data, trackingObservation: { ...proof, recordedAt: Timestamp.now() } });
  const open = !continuation && deliveryCorrectionBlocksProgress(data);
  const prior = data.deliveryCorrection;
  const baseline = !open && prior?.resolution?.providerProof ? prior.resolution.providerProof :
    data.deliveryTrackingProof ?? (data.trackingObservation?.statusCode === 'DE' ? data.trackingObservation : null);
  const disposition = trackingObservationDisposition(data, proof, 'forward');
  const changedStatus = ['AC', 'IT', 'AT', 'SP', 'EX'].includes(proof.statusCode);
  const changedDate = proof.statusCode === 'DE' && proof.providerEventAtMs != null && Number.isSafeInteger(baseline?.providerEventAtMs) &&
    baseline.providerEventAtMs !== proof.providerEventAtMs;
  if (!open && (!(data.deliveredAt instanceof Timestamp) || (!changedStatus && !changedDate))) return false;
  // Superseded/older proofs have already been rejected by trackingOutcomeMatches.
  // A replay of the known DE does not open a fresh incident.
  if (!open && disposition === 'replay') return false;
  const validPrior = prior?.schemaVersion === 1 && typeof prior.correctionId === 'string' && /^[a-f0-9]{64}$/.test(prior.correctionId) &&
    prior.transactionId === txRef.id && prior.buyerId === data.buyerId && prior.sellerId === data.sellerId && prior.detectedAt instanceof Timestamp;
  const correctionId = open && validPrior ? prior.correctionId : createHash('sha256').update(JSON.stringify([txRef.id,
    data.deliveredAt instanceof Timestamp ? data.deliveredAt.toMillis() : null, proof.sourceHash, proof.observedContentHash])).digest('hex');
  const alertRef = db.collection('admin_alerts').doc(`delivery_correction_${correctionId}`), alert = (await tx.get(alertRef)).data();
  const released = !!data.fundsReleasedAt || data.status === 'completed';
  const ownerMessage = open && !validPrior ? 'Le suivi et le gel de cette commande doivent être rapprochés par notre équipe avant une nouvelle sortie de fonds.' :
    released ? 'Le transporteur a corrigé le suivi de cette commande. La libération déjà enregistrée est conservée ; notre équipe doit vérifier la situation avant une nouvelle sortie de fonds.' :
    'Le suivi actuel contredit la livraison enregistrée. Les fonds restent en attente pendant la vérification de notre équipe.';
  const correction = {schemaVersion: 1, correctionId, transactionId: txRef.id, buyerId: data.buyerId, sellerId: data.sellerId,
    state: released ? 'released_review_required' : 'release_suspended', detectedAt: Timestamp.now(),
    originalDeliveryAt: data.deliveredAt instanceof Timestamp ? data.deliveredAt : null,
    originalFundsReleaseAt: data.fundsReleaseAt instanceof Timestamp ? data.fundsReleaseAt : null,
    originalFundsReleasedAt: data.fundsReleasedAt instanceof Timestamp ? data.fundsReleasedAt : null,
    originalDeliveryProof: baseline ?? null, initialObservation: {...proof, source, recordedAt: Timestamp.now()},
    qualification: open && !validPrior ? 'existing_marker_unqualified' : disposition === 'snapshot' ? 'current_snapshot_contradicts_delivery' : 'dated_provider_correction',
    reason: open && !validPrior ? 'correction_marker_unqualified' : changedDate ? 'delivery_date_changed' : 'current_delivery_status_changed', ownerMessage, ownerAction: 'contactSupport',
    flagProvenance: { schemaVersion: 1, disputedOwnership: !Object.prototype.hasOwnProperty.call(data, 'disputed') || data.disputed === false ||
      data.transportExceptionReview?.protocol === 'transport_exception_guard_v1' && data.transportExceptionReview.transactionId === txRef.id &&
      data.transportExceptionReview.buyerId === data.buyerId && data.transportExceptionReview.sellerId === data.sellerId &&
      data.transportExceptionReview.disputedFlagOwnership === 'native_owned' ? 'native_owned' : 'shared_or_unknown' } };
  const recordedCorrection = open && validPrior ? { ...prior, state: released ? 'released_review_required' : 'release_suspended',
    latestObservation: { ...proof, source, recordedAt: Timestamp.now() } } : correction;
  const correctionReview = !open || validPrior ? await prepareSystemTransportReview(tx, txRef.id, data, 'delivery_correction', proof, recordedCorrection) : null;
  const exceptionReview = proof.statusCode === 'EX' ? await prepareSystemTransportReview(tx, txRef.id,
    { ...data, deliveryCorrection: open && !validPrior ? prior : recordedCorrection }, 'carrier_exception', proof) : null;
  const correctionNotices = !open || !validPrior ? await prepareOperationalNotices(tx, [data.buyerId, data.sellerId].map(userId => ({
    eventKey: `delivery_correction:${txRef.id}:${correctionId}`, userId, type: 'order_moderation',
    title: 'Suivi de livraison en cours de vérification', message: ownerMessage, data: { transactionId: txRef.id, correctionId },
  }))) : null;
  if (!alert) { await recoveryCommit({refs: [(alertRef).path]}); tx.create(alertRef, {kind: 'delivery_correction_review', severity: 'critical', refId: txRef.id, correctionId,
    status: 'open', message: 'Rapprocher le suivi actuel et la livraison historique avant toute décision sur les fonds. Ne pas rembourser ou annuler depuis ce marqueur.',
    context: {buyerId: data.buyerId, sellerId: data.sellerId, qualification: correction.qualification,
      initialObservation: correction.initialObservation, originalDeliveryProof: baseline ?? null, releasedHistory: released}, createdAt: FieldValue.serverTimestamp()}); }
  await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, {disputed: true, deliveryCorrectionBlocked: true, deliveryCorrectionOwnerMessage: ownerMessage,
    deliveryCorrectionOwnerAction: 'contactSupport',
    ...(open && !validPrior ? {} : { deliveryCorrection: { ...recordedCorrection, transportReviewId: correctionReview!.reviewId } }),
    ...(exceptionReview ? { ...exceptionReview.orderPatch, trackingReviewRequired: true,
      ...(!Object.prototype.hasOwnProperty.call(data, 'trackingReviewRequired') || data.trackingReviewRequired === false ||
        data.trackingReviewRequired === true && data.trackingReviewReason === 'carrier_exception_requires_human_review'
        ? { trackingReviewReason: 'carrier_exception_requires_human_review' } : {}) } : {}),
    [disposition === 'snapshot' ? 'trackingSnapshot' : 'trackingObservation']: {...proof, source, recordedAt: FieldValue.serverTimestamp()}});
  correctionNotices?.commit();
  correctionReview?.commit();
  exceptionReview?.commit();
  return true;
}

/**
 * Apply a tracking outcome to one transaction atomically + fire best-effort
 * notifications. Idempotent and status-guarded — safe to call from the poller,
 * the manual callable and the webhook for the same parcel.
 *
 * @param transactionId  the transaction doc id
 * @param mappedStatus   ShipEngineClient.mapStatus(...) output
 *                       (UNKNOWN | TRANSIT | IN_TRANSIT | DELIVERED | EXCEPTION)
 * @param source         short tag for structured logs
 */
export async function applyTrackingOutcome(
  transactionId: string,
  mappedStatus: string,
  source: string,
  proof?: QualifiedTracking['proof'],
  guard?: (tx: FirebaseFirestore.Transaction) => Promise<unknown>
): Promise<TrackingTransitionResult> {
  const txRef = db.collection('transactions').doc(transactionId);
  let correctionRecorded = false;

  // ---- DELIVERED: pendingBalance -> heldBalance + 7-day window ----
  if (mappedStatus === 'DELIVERED') {
    let notify: { buyerId?: string; sellerId?: string; chatId?: string; articleTitle?: string; articleId?: string } | null =
      null;
    let deliveredCarrier = '';
    let deliveredTransitDays = 0;

    const changed = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      await guard?.(tx);
      correctionRecorded = false;
      const snap = await tx.get(txRef);
      if (!snap.exists) return false;
      const data = snap.data()!;
      if (ShipEngineClient.mapStatus(proof?.statusCode ?? '') !== mappedStatus || !await trackingOutcomeMatches(tx, transactionId, data, proof, 'forward')) return false;
      if (await preserveDeliveryCorrection(tx, txRef, data, proof!, source)) { correctionRecorded = true; return false; }
      const disposition = trackingObservationDisposition(data, proof!, 'forward');
      if (disposition === 'replay') return false;
      if (disposition === 'snapshot') {
        await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,data,{trackingSnapshot: {...proof, source, recordedAt: FieldValue.serverTimestamp()},
          purchasePolicyReviewRequired: true, purchasePolicyReviewReason: 'delivery_policy_time_unqualified'}));
        return false;
      }

      // Status guard (P1-21): only deliverable statuses advance to delivered.
      if (returnToSenderBlocksProgress(data) || hasUnsettledRefund(data) || !DELIVERABLE_STATUSES.has(data.status)) {
        if (data.deliveredAt) { await recoveryCommit({refs: [(txRef).path]}); tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,data,{trackingObservation: {...proof, source, recordedAt: FieldValue.serverTimestamp()}})); }
        return false;
      }

      const deliveryRecordedAt = Timestamp.now();
      const policyUpdate = deliveredPurchasePolicyUpdate(data, transactionId, proof, deliveryRecordedAt);

      const sellerId = data.sellerId;
      const sellerPayout = data.sellerPayout ?? data.amount;
      const sellerPayoutCents =
        typeof sellerPayout === 'number' ? Math.round(sellerPayout * 100) : 0;

      // The seller is credited (pendingBalance) at label creation under the
      // deferred-credit model. If for any reason they were never credited
      // (sellerCreditedCents absent) we still mark delivered but cannot move
      // funds that are not there — log and skip the held-funds move.
      let creditedCents =
        typeof data.sellerPendingCreditCents === 'number'
          ? data.sellerPendingCreditCents
          : typeof data.sellerCreditedCents === 'number' ? data.sellerCreditedCents : 0;

      // ALL reads first (Admin SDK forbids read-after-write in a transaction):
      // read the wallet BEFORE any tx.update, otherwise getOrCreateSellerWallet's
      // tx.get throws READ_AFTER_WRITE_ERROR and the delivery never commits (F1).
      let wallet: { walletRef: FirebaseFirestore.DocumentReference; walletData: FirebaseFirestore.DocumentData; isNew: boolean } | null =
        null;
      // getOrCreateSellerWallet buffers a write when absent. Prepare all
      // notice reads BEFORE calling it, including that first-wallet branch.
      const deliveredNotices = await prepareOperationalNotices(tx, [data.buyerId, data.sellerId].map(userId => ({
        eventKey: `order_delivered:${transactionId}`, userId, type: 'order_delivered', title: 'Livraison enregistrée',
        message: 'Une livraison est enregistrée pour cette commande. Consultez le suivi, le délai de réclamation et les recours disponibles.',
        data: { transactionId },
      })));
      if (sellerId && typeof data.sellerCreditedCents === 'number') {
        wallet = await getOrCreateSellerWallet(tx, sellerId);
        creditedCents = wallet.isNew ? 0 : await sellerPendingCreditCents(tx, wallet.walletRef, data, transactionId);
      }

      await recoveryCommit({refs: [(txRef).path]});
    const recoveryDeliveryFields = {
        trackingStatus: 'DELIVERED',
        trackingIdentityProof: {...proof, recordedAt: FieldValue.serverTimestamp()},
        trackingObservation: {...proof, source, recordedAt: FieldValue.serverTimestamp()},
        deliveryTrackingProof: {...proof, source, recordedAt: FieldValue.serverTimestamp()},
        status: 'delivered',
        // The qualified carrier event and our recording are distinct clocks.
        ...(data.deliveredAt == null ? { deliveredAt: Timestamp.fromMillis(proof!.providerEventAtMs!) } : {}),
        ...(data.deliveryRecordedAt == null ? { deliveryRecordedAt } : {}),
        ...policyUpdate,
        ...(wallet ? { sellerPendingCreditCents: creditedCents } : {}),
      };
    tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,data,recoveryDeliveryFields));

      if (wallet) {
        // Move exactly what was credited (creditedCents), not a freshly derived
        // payout, so credit and held-move can never drift.
        await applyDeliveredHeldFunds(
          tx,
          wallet.walletRef,
          wallet.walletData,
          txRef,
          transactionId,
          creditedCents,
          proof!.providerEventAtMs!,
          { deadline: policyUpdate.fundsReleaseAt instanceof Timestamp ? policyUpdate.fundsReleaseAt : null }, data, recoveryDeliveryFields
        );
      } else {
        logger.warn('[trackingTransition] DELIVERED but seller not credited — no held move', {
          transactionId,
          source,
          sellerId,
          sellerPayoutCents,
        });
      }
      deliveredNotices.commit();

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
    return correctionRecorded ? {kind: 'delivery_review', changed: true} : { kind: 'delivered', changed };
  }

  // ---- EX/exception: current incident; no terminal/permanent-loss inference ----
  if (INCIDENT_STATUSES.has(mappedStatus)) {
    let notify: { buyerId?: string; sellerId?: string; articleTitle?: string; articleId?: string } | null =
      null;

    const changed = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      await guard?.(tx);
      correctionRecorded = false;
      const snap = await tx.get(txRef);
      if (!snap.exists) return false;
      const data = snap.data()!;
      if (ShipEngineClient.mapStatus(proof?.statusCode ?? '') !== mappedStatus || !await trackingOutcomeMatches(tx, transactionId, data, proof, 'forward')) return false;
      if (await preserveDeliveryCorrection(tx, txRef, data, proof!, source)) { correctionRecorded = true; return false; }
      const disposition = trackingObservationDisposition(data, proof!, 'forward');
      // A fresh read of an old EX must still qualify the current unresolved
      // review. Legacy tracking/status data alone never certifies that review.
      // Existing refund servicing stays separate. A commercial dispute, old
      // delivery_failed/lost classification or a missing legacy delivery date
      // must not swallow a current incident before its review is recorded.
      if (!['paid', 'shipped', 'label_created', 'disputed', 'return_requested', 'delivered', 'completed', 'delivery_failed', 'lost'].includes(data.status)) {
        return false;
      }

      const transportReview = await prepareSystemTransportReview(tx, transactionId, data, 'carrier_exception', proof!);
      if (disposition === 'replay' && data.trackingReviewRequired === true && data.disputed === true && !transportReview.created &&
          supportSourceHash(transportReview.orderPatch.transportExceptionReview ?? data.transportExceptionReview ?? null) === supportSourceHash(data.transportExceptionReview ?? null)) return false;

      const failureNotices = await prepareOperationalNotices(tx, [data.buyerId, data.sellerId].map(userId => ({
        eventKey: `delivery_failed:${transactionId}`, userId, type: 'delivery_failed', title: 'Incident de livraison enregistré',
        message: 'Le transporteur signale un incident de livraison. Notre équipe doit examiner la situation. Consultez la commande et contactez le support ; ce signal ne confirme pas une perte ni un remboursement.',
        data: { transactionId },
      })));

      await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,data,{
        trackingStatus: 'EXCEPTION',
        trackingIdentityProof: {...proof, recordedAt: FieldValue.serverTimestamp()},
        [disposition === 'snapshot' ? 'trackingSnapshot' : 'trackingObservation']: {...proof, source, recordedAt: FieldValue.serverTimestamp()},
        // Even an undated, identity-qualified CURRENT snapshot is an unresolved
        // incident. The release transaction already checks this native flag via
        // purchasePolicyAllowsRelease; a later DE/claim dismissal cannot clear it.
        trackingReviewRequired: true,
        ...transportReview.orderPatch,
        ...(!Object.prototype.hasOwnProperty.call(data, 'trackingReviewRequired') || data.trackingReviewRequired === false ||
          data.trackingReviewRequired === true && data.trackingReviewReason === 'carrier_exception_requires_human_review'
          ? { trackingReviewReason: 'carrier_exception_requires_human_review',
            trackingOwnerMessage: 'Le transporteur signale un incident. Notre équipe doit l’examiner ; ce signal ne confirme ni une perte ni un remboursement.' } : {}),
        disputed: true,
      }));
      failureNotices.commit();
      transportReview.commit();

      notify = {
        buyerId: data.buyerId,
        sellerId: data.sellerId,
        articleTitle: data.articleTitle || 'votre commande',
        articleId: data.articleId || '',
      };
      return true;
    });

    if (changed && notify) {
      logger.warn('[trackingTransition] delivery incident and both notices committed; funds retained', { transactionId, source });
    }
    return correctionRecorded ? {kind: 'delivery_review', changed: true} : { kind: 'tracking_updated', changed };
  }

  // ---- Real carrier scan: label_created -> shipped ----
  if (CARRIER_SCANNED.has(mappedStatus)) {
    let shippedBuyerId: string | null = null;
    let shippedCarrier = '';
    let shippedDaysSincePaid = 0;

    const changed = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      await guard?.(tx);
      correctionRecorded = false;
      const snap = await tx.get(txRef);
      if (!snap.exists) return false;
      const data = snap.data()!;
      if (ShipEngineClient.mapStatus(proof?.statusCode ?? '') !== mappedStatus || !await trackingOutcomeMatches(tx, transactionId, data, proof, 'forward')) return false;
      if (await preserveDeliveryCorrection(tx, txRef, data, proof!, source)) { correctionRecorded = true; return false; }
      const disposition = trackingObservationDisposition(data, proof!, 'forward');
      if (disposition === 'replay') return false;
      const observationKey = disposition === 'snapshot' ? 'trackingSnapshot' : 'trackingObservation';
      if (data.deliveredAt && disposition === 'snapshot') {
        await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,data,{[observationKey]: {...proof, source, recordedAt: FieldValue.serverTimestamp()}}));
        return false;
      }

      const trackingChanged = data.trackingStatus !== mappedStatus;

      if (PRESHIP_STATUSES.has(data.status) && !returnToSenderBlocksProgress(data)) {
        const shippedNotices = await prepareOperationalNotices(tx, [data.buyerId, data.sellerId].map(userId => ({
          eventKey: `order_shipped:${transactionId}`, userId, type: 'order_shipped', title: 'Colis pris en charge',
          message: 'Le transporteur a pris en charge le colis de cette commande. Consultez son suivi dans l’application.', data: { transactionId },
        })));
        await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,data,{
          status: 'shipped',
          shippedAt: FieldValue.serverTimestamp(),
          trackingStatus: mappedStatus,
          trackingIdentityProof: {...proof, recordedAt: FieldValue.serverTimestamp()},
          [observationKey]: {...proof, source, recordedAt: FieldValue.serverTimestamp()},
        }));
        shippedNotices.commit();
        shippedBuyerId = typeof data.buyerId === 'string' ? data.buyerId : null;
        shippedCarrier = typeof data.carrierCode === 'string' ? data.carrierCode : '';
        shippedDaysSincePaid = daysSince(data.paidAt);
        return true;
      }
      // Already shipped/delivered/etc — just refresh trackingStatus if changed.
      await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,data,{ ...(trackingChanged ? {trackingStatus: mappedStatus} : {}), trackingIdentityProof: {...proof, recordedAt: FieldValue.serverTimestamp()},
        [observationKey]: {...proof, source, recordedAt: FieldValue.serverTimestamp()} }));
      return false;
    });

    // Analytics (§12): order_shipped follows the BUYER.
    if (changed && shippedBuyerId) {
      await captureServerEvent(shippedBuyerId, 'order_shipped', {
        transaction_id: transactionId,
        carrier: shippedCarrier,
        days_since_paid: shippedDaysSincePaid,
        $insert_id: `order_shipped_${transactionId}`,
      });
    }
    return correctionRecorded ? {kind: 'delivery_review', changed: true} : { kind: changed ? 'shipped' : 'tracking_updated', changed };
  }

  // ---- UNKNOWN / other: best-effort trackingStatus refresh, no state change ----
  const changed = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      await guard?.(tx);
    correctionRecorded = false;
    const snap = await tx.get(txRef);
    if (!snap.exists) return false;
    const data = snap.data()!;
    if (ShipEngineClient.mapStatus(proof?.statusCode ?? '') !== mappedStatus || !await trackingOutcomeMatches(tx, transactionId, data, proof, 'forward')) return false;
    if (await preserveDeliveryCorrection(tx, txRef, data, proof!, source)) { correctionRecorded = true; return false; }
    const disposition = trackingObservationDisposition(data, proof!, 'forward');
    if (disposition === 'replay') return false;
    const observationKey = disposition === 'snapshot' ? 'trackingSnapshot' : 'trackingObservation';
    const changed = !data.deliveredAt && data.trackingStatus !== mappedStatus;
    await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,data,{ ...(changed ? {trackingStatus: mappedStatus} : {}), trackingIdentityProof: {...proof, recordedAt: FieldValue.serverTimestamp()},
      [observationKey]: {...proof, source, recordedAt: FieldValue.serverTimestamp()} }));
    return changed;
  });
  return correctionRecorded ? {kind: 'delivery_review', changed: true} : { kind: 'tracking_updated', changed };
}

/** Optional chat mirror; durable notices are committed with delivery above. */
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
          'Livraison enregistrée. Consultez la commande pour son suivi, les délais et les recours disponibles.',
        participants,
        timestamp: FieldValue.serverTimestamp(),
        status: 'sent',
        isRead: true,
      });
    } catch (msgErr) {
      if (msgErr instanceof FinancialRecoveryBlocked) throw msgErr;
      logger.warn('[trackingTransition] delivered system message failed', {
        transactionId,
        source,
        error: msgErr instanceof Error ? msgErr.message : msgErr,
      });
    }
  }

}
