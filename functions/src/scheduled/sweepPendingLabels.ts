import {financialRecoverySourceFields} from '../utils/financialRecoverySources';
import { qualifiedAutomaticParcelSource, qualifiedShippingParcelSnapshot } from '../utils/automaticShippingParcel';
import { FinancialRecoveryBlocked } from "../utils/financialRecoveryInterlock";
import { withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
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
 *   1. Recover the accepted shipment/rate against frozen addresses, parcel and
 *      quote evidence. An unavailable or unqualified contract requires review.
 *   2. Resume the same label purchase. On success: ATOMICALLY credit the
 *      seller (pendingBalance), reconcile the real label cost, persist label
 *      fields, clear the flag and mark `label_created`.
 *   3. Only a definitive provider rejection counts as a failed attempt. An
 *      unknown purchase result or changed contract never authorizes a new label
 *      purchase or this job's automatic refund. After the accepted number of definitive
 *      failures, the existing qualified refund path handles the obligation.
 *      Its purpose is to REFUND the
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
import { HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getShipEngine, type ShipEngineAddress } from '../config/shipEngine';
import { createLabelIdempotent, markLabelPurchaseReconciliation } from '../utils/labelFulfillment';
import { labelLifecycleAllowsLeg } from '../utils/labelLifecycle';
import { issueTransactionRefund } from '../utils/refund';
import { acquireJobLock, releaseJobLock } from '../utils/jobLock';
import { orderModerationAllowsProgress, ensureOrderModerationNotices } from '../utils/orderModeration';
import { canonicalShippingAddress, canonicalParcel } from '../utils/shippingPurchase';
import { consistentRateDetails, exactCents, hasCurrentRateQualification, providerId, type PurchaseRate } from '../utils/shippingPurchaseRate';
import { nativeTime } from '../utils/stripeCheckoutProof';
import { hasActiveBankDispute } from '../utils/bankDispute';
import { hasUnsettledRefund, qualifiedRejectedLabelPurchase, hasUnresolvedLabelOrParcelSource } from '../utils/refundState';
import { fraudReviewAllowsProgress } from '../utils/fraudReviewDecision';
import { readLabelAbandonmentPolicySource, recordPurchasePreparationReview } from '../utils/purchasePolicy';

/** Process at most this many transactions per run to bound execution time. */
const MAX_TRANSACTIONS_PER_RUN = 50;

/** Leave room for checkpoint and lease release before the default timeout. */
const NEXT_ROW_BUDGET_MS = 45 * 1000;

/** The accepted V2 policy supplies the rejection threshold. Hourly scheduling
 * and retry/lease budgets never promise a number of elapsed hours. */

/** Anti-overlap lock TTL (the job runs hourly; one run must finish well within). */
const JOB_LOCK_TTL_MS = 30 * 60 * 1000;

class UnqualifiedShipmentError extends Error {
  constructor(readonly reason: string) { super(reason); }
}
function creationDateIssue(value: unknown, now = Date.now()): 'missing' | 'malformed' | 'future' | null {
  if (value == null) return 'missing';
  if (!(value instanceof Timestamp)) return 'malformed';
  const ms = Math.floor(value.toMillis());
  if (!Number.isFinite(ms) || ms <= 0) return 'malformed';
  return ms > now ? 'future' : null;
}
/** Orientation only. Never stamp a replacement order.createdAt, convert a
 * purchased label to failure, clear an obligation or overwrite GET recovery.
 * This core has no recoverOnly authorization: a requested->rejected race could
 * otherwise create a new POST. Unknown-date labels therefore keep their exact
 * native reference for operator GET-only reconciliation. */
async function inspectPendingLabelCreationDate(ref: FirebaseFirestore.DocumentReference, transactionId: string) {
  return db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (!data || data.status !== 'paid' || data.labelCreationPending !== true) return null;
    const issue = creationDateIssue(data.createdAt);
    const priorReview = Object.prototype.hasOwnProperty.call(data, 'labelDateReviewRequired') && data.labelDateReviewRequired !== false;
    if (!issue && !priorReview) return { data, noNewEffects: false };
    const alertRef = db.collection('admin_alerts').doc(`pending_label_date_${transactionId}`), alert = await tx.get(alertRef);
    const recovery = data.refund != null ? 'native_refund_intention_preserved' :
      data.labelPurchase != null || data.shipEngineLabelId != null ? 'native_label_reference_preserved_get_only' : 'no_new_purchase_without_instruction';
    if (!alert.exists) tx.create(alertRef, { kind: 'pending_label_creation_date_review', severity: 'critical', refId: transactionId,
      status: 'open', message: 'Rapprocher la date de création sans la remplacer. Conserver les achats et remboursements engagés ; une lecture GET de la même étiquette ne permet aucun rachat.',
      context: { reason: issue ?? 'existing_date_review_requires_instruction', recovery,
        labelAttemptId: typeof data.labelPurchase?.attemptId === 'string' ? data.labelPurchase.attemptId : null,
        refundIntentId: typeof data.refund?.intentId === 'string' ? data.refund.intentId : null }, createdAt: FieldValue.serverTimestamp() });
    if (!priorReview) tx.update(ref, { labelDateReviewRequired: true, labelDateReview: { schemaVersion: 1, transactionId,
      reason: issue ?? 'existing_date_review_requires_instruction', recovery, observedAt: FieldValue.serverTimestamp(),
      ownerAction: 'contactSupport' } });
    return { data, noNewEffects: true };
  });
}
function frozenAddress(raw: unknown): ShipEngineAddress {
  const address = canonicalShippingAddress(raw);
  return {name: address.name, addressLine1: address.street, cityLocality: address.city, stateProvince: address.province,
    postalCode: address.postalCode, countryCode: address.country,
    ...(address.line2 ? {addressLine2: address.line2} : {}), ...(address.phone ? {phone: address.phone} : {}),
    ...(address.email ? {email: address.email} : {})};
}
function stable(value: any): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? nativeTime(v) ? {timestampMs: v instanceof Date ? v.getTime() : v.toMillis()}
      : Object.fromEntries(Object.keys(v).sort().map(key => [key, canonical(v[key])])) : v;
  return JSON.stringify(canonical(value));
}
async function requireShipmentReview(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData,
  transactionId: string, reason: string): Promise<void> {
  // The helper rechecks this exact still-paid contract atomically. Keep any
  // previous provider evidence rather than replacing it with a source error.
  await markLabelPurchaseReconciliation(ref, transactionId, reason, undefined, {status: 'paid', rateId: data.shipEngineRateId,
    snapshotHash: createHash('sha256').update(JSON.stringify(data.shippingSnapshot ?? null)).digest('hex')});
}

/**
 * Recover the exact accepted rate for the exact frozen shipment. A paid order
 * has no new quote deadline and is never re-priced from current seller data.
 */
async function readAcceptedRateForTransaction(
  txData: FirebaseFirestore.DocumentData,
  transactionId: string
): Promise<PurchaseRate> {
  const shipEngine = getShipEngine();
  if (!shipEngine) {
    logger.warn('[sweepPendingLabels] ShipEngine not configured — cannot re-rate', {
      transactionId,
    });
    throw new UnqualifiedShipmentError('accepted_shipment_provider_unavailable');
  }

  const snapshot = txData.shippingSnapshot;
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.provider !== 'shipengine' || snapshot.currency !== 'CAD' ||
      snapshot.priceAcceptedBy !== txData.buyerId || !nativeTime(snapshot.validatedAt) || !nativeTime(txData.paidAt) ||
      !providerId(snapshot.shipmentId) || !providerId(txData.shipEngineRateId) ||
      typeof txData.shippingQuoteId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(txData.shippingQuoteId))
    throw new UnqualifiedShipmentError('shipping_snapshot_unqualified');
  let origin: ShipEngineAddress, destination: ShipEngineAddress, parcel: ReturnType<typeof canonicalParcel>;
  try {
    origin = frozenAddress(snapshot.origin); destination = frozenAddress(snapshot.destination); parcel = canonicalParcel(snapshot.parcel);
    if (stable(canonicalShippingAddress(txData.shippingAddress)) !== stable(canonicalShippingAddress(snapshot.destination)))
      throw new Error('Frozen destination conflict');
  } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; throw new UnqualifiedShipmentError('accepted_shipment_context_unqualified'); }
  const quote = (await db.collection('shipping_quotes').doc(txData.shippingQuoteId).get()).data();
  const context = {shipFrom: origin, shipTo: destination, parcel};
  if (!quote || quote.schemaVersion !== 1 || quote.state !== 'claimed' || quote.transactionId !== transactionId ||
      quote.ownerId !== txData.buyerId || quote.sellerId !== txData.sellerId || quote.articleId !== txData.articleId ||
      quote.acceptedRateId !== txData.shipEngineRateId || quote.acceptedTotal !== txData.totalAmount || !nativeTime(quote.acceptedAt) ||
      stable(quote.source?.origin) !== stable(snapshot.origin) || stable(quote.source?.destination) !== stable(snapshot.destination) ||
      stable(quote.source?.parcel) !== stable(snapshot.parcel) || quote.source?.parcelVersion !== snapshot.parcelVersion ||
      !qualifiedShippingParcelSnapshot(snapshot) ||
      stable(quote.source?.parcelSource ?? null) !== stable(qualifiedAutomaticParcelSource({ source: snapshot.measurementSource,
        profileSize: snapshot.profileSize, profileVersion: snapshot.profileVersion, profileFamily: snapshot.profileFamily }, snapshot.parcel)) ||
      !Number.isSafeInteger(snapshot.parcelVersion) || snapshot.parcelVersion < 1 ||
      !hasCurrentRateQualification(quote.rates, context) ||
      !hasCurrentRateQualification({...quote.rates, qualification: quote.acceptedQualification}, context) ||
      quote.rates.shipmentId !== snapshot.shipmentId) throw new UnqualifiedShipmentError('accepted_quote_binding_unqualified');
  const selected = quote.rates.rates.find(rate => rate.rateId === txData.shipEngineRateId);
  const item = exactCents(txData.amount), fee = exactCents(txData.serviceFee), tax = exactCents(txData.taxTotal), total = exactCents(txData.totalAmount);
  if (!selected || stable(selected) !== stable(snapshot.rate) || !consistentRateDetails(quote.rates.qualification, quote.acceptedQualification, selected.rateId) ||
      txData.currency !== 'CAD' || exactCents(txData.shippingCost) !== selected.shippingCents || item === null || fee === null || tax === null ||
      total === null || total !== item + fee + tax + selected.shippingCents || total <= 0)
    throw new UnqualifiedShipmentError('accepted_rate_or_amount_unqualified');
  let rates;
  try {
    rates = await shipEngine.getPurchaseRatesForShipment(snapshot.shipmentId, context);
  } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
    logger.error('[sweepPendingLabels] getRates failed', {
      transactionId,
      error: err instanceof Error ? err.message : err,
    });
    throw new UnqualifiedShipmentError('accepted_shipment_rate_unavailable');
  }

  const exact = rates.rates.find(rate => rate.rateId === selected.rateId);
  if (!hasCurrentRateQualification(rates, context) || rates.shipmentId !== snapshot.shipmentId || !exact || stable(exact) !== stable(selected) ||
      !consistentRateDetails(quote.acceptedQualification, rates.qualification, selected.rateId))
    throw new UnqualifiedShipmentError('accepted_shipment_rate_changed');
  return selected;
}

/** Observe/count an exact native rejection once; caller chooses NEW retry or
 * the separately source-qualified refund. This helper never moves money. */
async function countRejectedLabelPurchase(txRef:FirebaseFirestore.DocumentReference,txData:FirebaseFirestore.DocumentData,transactionId:string) {
  return db.runTransaction(async tx => {
    const current = (await tx.get(txRef)).data();
    const purchase = current?.labelPurchase;
    const proof = current ? qualifiedRejectedLabelPurchase(current, transactionId) : null;
    if (!current || !proof || current.status !== 'paid' || current.labelCreationPending !== true || hasUnresolvedLabelOrParcelSource(current) ||
        creationDateIssue(current.createdAt) !== null || current.labelDateReviewRequired === true ||
        hasActiveBankDispute(current) || hasUnsettledRefund(current) || stable(current.shippingSnapshot) !== stable(txData.shippingSnapshot) ||
        !await fraudReviewAllowsProgress(tx, transactionId, current) ||
        !await orderModerationAllowsProgress(tx, current)) return null;
    const previous = current.labelAttempts ?? 0;
    if (!Number.isSafeInteger(previous) || previous < 0 || previous > 20) return null;
    const attempts = current.lastCountedLabelAttemptId === proof.attemptId ? previous : previous + 1;
    const policy=await readLabelAbandonmentPolicySource(tx,transactionId,{...current,labelAttempts:attempts,lastCountedLabelAttemptId:proof.attemptId});
    // Count this attributed rejection once, before reserve. A different
    // purchase winning the race is requalified under the refund lock.
    if (current.lastCountedLabelAttemptId !== proof.attemptId) tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,current,{labelAttempts:attempts,
      lastCountedLabelAttemptId:proof.attemptId,lastLabelAttemptAt:purchase.rejectedAt}));
    return { attempts, proof, policy };
  });
}

/**
 * Definitive failure path: refund the buyer (idempotent), release the article,
 * debit the seller IF they were credited, mark the transaction refunded, notify
 * the buyer.
 *
 * REUSES the shared issueTransactionRefund core (single source of truth for the
 * Stripe refund + sellerDebt reconciliation + dead-lettering on Stripe
 * failure with the deterministic key). Inventory is released only from the
 * reserved native pre-send witness with no conflicting label/parcel evidence.
 * After the core succeeds we additionally
 * clear the label-pending bookkeeping (cancelReason / labelCreationPending) that
 * is specific to this flow and not owned by the generic refund core.
 */
async function refundPendingLabelTransaction(
  txRef: FirebaseFirestore.DocumentReference,
  _txData: FirebaseFirestore.DocumentData,
  transactionId: string,
  failed?: { attempts: number; proof: NonNullable<ReturnType<typeof qualifiedRejectedLabelPurchase>>; policy:NonNullable<Awaited<ReturnType<typeof readLabelAbandonmentPolicySource>>> }
): Promise<boolean> {
  // Pre-check the precondition before touching Stripe: only a still-paid,
  // still-pending-label transaction should be given up. A concurrent run may
  // have advanced it (label created -> label_created/shipped) in the meantime.
  const preSnap = await txRef.get();
  const preData = preSnap.exists ? preSnap.data()! : null;
  const historical = preData?.refund?.source === 'sweepPendingLabels_giveup' && typeof preData.refund.intentId === 'string' &&
    !!preData.refund.intentId && typeof preData.refund.idempotencyKey === 'string' && !!preData.refund.idempotencyKey;
  if (!preData || preData.refund && !historical || !historical && (preData.status !== 'paid' || preData.labelCreationPending !== true)) {
    logger.info('[sweepPendingLabels] label give-up skipped — tx no longer paid+pending', {
      transactionId,
      status: preData?.status,
    });
    return false;
  }
  if (!historical && !failed) return false;

  try {
    // Shared core: idempotent plain Stripe refund (platform charge, single-rail)
    // keyed rf_label_${txId}, then atomic wallet reconciliation
    // (re-credit buyer wallet portion, debit seller exactly sellerCreditedCents
    // — normally 0 for a never-credited pending-label tx — shortfall -> debt),
    // re-list the article, set status -> 'refunded'. On Stripe failure the core
    // dead-letters (type stripe_refund_failed) and throws.
    const result = historical ? await issueTransactionRefund(transactionId, preData, { expectedRefundIntentId: preData.refund.intentId,
      idempotencyKey: preData.refund.idempotencyKey, source: 'sweepPendingLabels_giveup' }) : await issueTransactionRefund(transactionId, preData, {
      reason: 'label_creation_failed',
      idempotencyKey: `rf_label_${transactionId}`,
      // Inventory requires the native reserved rejection witness again at
      // settlement; a source name or missing scan alone cannot release stock.
      relistArticle: true,
      source: 'sweepPendingLabels_giveup',
      allowedInitialStatuses: ['paid'],
      labelGiveup: { attemptId: failed!.proof.attemptId, rejectionSourceHash: failed!.proof.rejectionSourceHash,
        labelSourceHash: failed!.proof.labelSourceHash, expectedLabelAttempts: failed!.attempts, requiredFailures: failed!.policy.requiredFailures, policySourceHash:failed!.policy.sourceHash },
    });
    if (!result.success || (await txRef.get()).data()?.refund?.source !== 'sweepPendingLabels_giveup') return false;
  } catch (refundErr) {
      if (refundErr instanceof FinancialRecoveryBlocked) throw refundErr;
    if (refundErr instanceof HttpsError && (refundErr.details as any)?.reason === 'label_giveup_source_unqualified') {
      // A healthy newer purchase may have won the same order lock. Do not
      // overwrite its native pending/unknown recovery instruction from this
      // stale give-up observation; the sweep qualifies its own next outcome.
      logger.warn('[sweepPendingLabels] give-up source changed — no new refund', { transactionId });
      return false;
    }
    if (refundErr instanceof HttpsError && (refundErr.details as any)?.reason === 'label_giveup_obligation_open') return false;
    // The core already dead-lettered the Stripe failure with the same
    // deterministic key; the saved refund intention stays owned by its native
    // recovery queue. No new give-up or cancellation replaces that obligation.
    logger.error('CRITICAL [sweepPendingLabels] Stripe refund failed (label give-up)', {
      transactionId,
      paymentIntentId: preData.stripePaymentIntentId,
      error: refundErr instanceof Error ? refundErr.message : refundErr,
    });
    return false;
  }

  // The refund core commits the native explanation, label bookkeeping and
  // confirmed local movements together; no detached refund assertion follows.
  // Qualified refund settlement already committed one durable notice per
  // party. Do not duplicate it with a detached cancellation assertion.

  return true;
}

export const sweepPendingLabels = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['STRIPE_SECRET_KEY', 'SHIPENGINE_API_KEY'],
  },
  async () => {
    return withFinancialRecoveryScope({operation: "scheduled/sweepPendingLabels.sweepPendingLabels"}, async () => {
    const runStartedAt = Date.now();
    // F82: anti-overlap lock. This job creates PAID ShipEngine labels; two
    // concurrent runs (scheduler overrun / retry) picking the same docs could
    // each pay for a duplicate label. Take a short-lived lock; skip if held.
    const locked = await acquireJobLock('sweepPendingLabels', JOB_LOCK_TTL_MS);
    if (!locked) {
      logger.info('[sweepPendingLabels] another run holds the lock — skipping');
      return;
    }

    try {
    let shipped = 0;
    let refunded = 0;
    let retried = 0;
    let errors = 0;
    let dateReviews = 0;
    let completed = 0;
    let stoppedForBudget = false;

    // V2 covers missing/malformed/future dates too. Freeze the largest ID of
    // each cycle: continuous arrivals cannot extend this cycle indefinitely.
    const checkpointRef = db.collection('job_locks').doc('sweepPendingLabels');
    const checkpoint = (await checkpointRef.get()).data()?.scanCursor;
    const cursorId = (value: unknown): value is string => typeof value === 'string' && !!value && !value.includes('/');
    const validCheckpoint = checkpoint?.schemaVersion === 2 && checkpoint.kind === 'pending_labels_by_id_v2' &&
      cursorId(checkpoint.lastId) && cursorId(checkpoint.untilId);
    const pendingQuery = db
      .collection('transactions')
      .where('labelCreationPending', '==', true)
      .where('status', '==', 'paid');
    let untilId: string;
    if (validCheckpoint) untilId = checkpoint.untilId;
    else {
      const upper = await pendingQuery.orderBy('__name__', 'desc').limit(1).get();
      if (upper.empty) {
        await checkpointRef.update({ scanCursor: FieldValue.delete() });
        logger.info('[sweepPendingLabels] no pending-label transactions');
        return;
      }
      untilId = upper.docs[0].id;
    }
    let query = pendingQuery.where('__name__', '<=', untilId)
      .orderBy('__name__', 'asc')
      .limit(MAX_TRANSACTIONS_PER_RUN + 1);
    if (validCheckpoint) {
      query = query.startAfter(checkpoint.lastId);
    }
    const snap = await query.get();

    if (snap.empty) {
      await checkpointRef.update({ scanCursor: FieldValue.delete() });
      logger.info('[sweepPendingLabels] no pending-label transactions');
      return;
    }

    const page = snap.docs.slice(0, MAX_TRANSACTIONS_PER_RUN);
    for (const doc of page) {
      if (Date.now() - runStartedAt >= NEXT_ROW_BUDGET_MS) { stoppedForBudget = true; break; }
      let txData = doc.data();
      const transactionId = doc.id;
      const txRef = doc.ref;
      let lineComplete = true;

      try {
        const inspected = await inspectPendingLabelCreationDate(txRef, transactionId);
        if (!inspected) continue;
        txData = inspected.data;
        // A real refund gets its same native intention before global-date
        // admission. Other initiators keep their existing financial queue.
        if (txData.refund != null) {
          if (txData.refund.source === 'sweepPendingLabels_giveup' && await refundPendingLabelTransaction(txRef, txData, transactionId)) refunded++;
          continue;
        }
        if (inspected.noNewEffects) { dateReviews++; continue; }
        // Exhaustion is decided from the native rejected purchase BEFORE any
        // further paid POST. A blocked refund never permits a fifth purchase.
        // Requested/unknown attempts and existing refunds retain recovery first.
        if(txData.labelPurchase?.state==='rejected'){
          const priorFailure=await countRejectedLabelPurchase(txRef,txData,transactionId);
          if(!priorFailure){await requireShipmentReview(txRef,txData,transactionId,'label_failure_not_proven_rejected');continue;}
          if(!priorFailure.policy){await recordPurchasePreparationReview(transactionId,'label_abandonment','accepted_preparation_terms_or_rejections_unknown');continue;}
          if(priorFailure.policy.ready){
            if(await refundPendingLabelTransaction(txRef,txData,transactionId,{...priorFailure,policy:priorFailure.policy}))refunded++;
            continue;
          }
        }
        // Moderation is an operator pause, not a failed carrier attempt. Do not
        // re-rate, increase labelAttempts or trigger this job's auto-refund.
        const allowed = await db.runTransaction(async tx => {
          const current = (await tx.get(txRef)).data();
          const pending = current?.labelPurchase;
          const recoverNativeAttempt = pending?.schemaVersion === 1 && pending.transactionId === transactionId &&
            ['requested', 'unknown'].includes(pending.state) && nativeTime(pending.requestedAt);
          return !!current && current.status === 'paid' && current.labelCreationPending === true && !current.shipEngineLabelId &&
            creationDateIssue(current.createdAt) === null && current.labelDateReviewRequired !== true &&
            (recoverNativeAttempt || await fraudReviewAllowsProgress(tx, transactionId, current)) &&
            (recoverNativeAttempt || await labelLifecycleAllowsLeg(tx, transactionId, current, 'forward')) &&
            !hasActiveBankDispute(current) && !hasUnsettledRefund(current) && await orderModerationAllowsProgress(tx, current, recoverNativeAttempt ? undefined : 'forward', transactionId);
        });
        if (!allowed) { await ensureOrderModerationNotices(transactionId); continue; }
        if (!nativeTime(txData.paidAt) || txData.currency !== 'CAD' || (exactCents(txData.totalAmount) ?? 0) <= 0 ||
            exactCents(txData.shippingCost) === null) throw new UnqualifiedShipmentError('paid_shipping_evidence_unqualified');
        if (txData.labelReconciliationRequired === true && txData.labelPurchase == null) {
          await requireShipmentReview(txRef, txData, transactionId,
            typeof txData.labelReconciliationReason === 'string' ? txData.labelReconciliationReason : 'label_purchase_legacy_hold_unqualified');
          continue;
        }
        // Read the exact accepted shipment; never replace it with a cheaper
        // service or rebuild it from current seller/article data. An existing
        // native intention instead joins the core's same-purchase GET recovery;
        // failure to reload rate shopping never authorizes its replacement.
        const rateId = txData.labelPurchase != null ? txData.shipEngineRateId :
          (await readAcceptedRateForTransaction(txData, transactionId)).rateId;

        if (providerId(rateId)) {
          const shipEngine = getShipEngine();
          if (!shipEngine) {
            errors++;
            continue;
          }

          // F5/F82: idempotent, double-spend-safe label creation (reservation
          // BEFORE the paid ShipEngine call). Keeps the accepted rateId alongside
          // the label fields. Returns 'created' | 'skip' (already resolved by the
          // webhook / a concurrent run) | 'failed'.
          const outcome = await createLabelIdempotent({
            transactionRef: txRef,
            transactionId,
            rateId,
            shipEngine,
            estimatedShippingCost:
              typeof txData.shippingCost === 'number' ? txData.shippingCost : 0,
            applyExtraUpdate: (_label, update) => {
              update.labelCreationNote = FieldValue.delete();
            },
          });

          if (outcome === 'unknown' || outcome === 'reconciliation_required') {
            const current = (await txRef.get()).data();
            await requireShipmentReview(txRef, txData, transactionId,
              typeof current?.labelReconciliationReason === 'string' ? current.labelReconciliationReason : 'label_purchase_reconciliation_required');
            continue;
          }

          if (outcome === 'created' || outcome === 'skip') {
            if (outcome === 'created') {
              shipped++;
              logger.info('[sweepPendingLabels] label created on retry — shipped', {
                transactionId,
              });

              // Notify buyer + system message (best-effort). Read the persisted
              // label fields back (createLabelIdempotent committed them atomically).
              const fresh = (await txRef.get()).data();
              const trackingNumber = fresh?.trackingNumber || '';
              if (txData.chatId && trackingNumber) {
                let participants: string[] = [];
                try {
                  const chatSnap = await db.collection('chats').doc(txData.chatId).get();
                  if (chatSnap.exists) {
                    participants = (chatSnap.data()?.participants as string[]) || [];
                  }
                } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure;
                  // ignore lookup failure
                }
                await db
                  .collection('messages')
                  .add({
                    chatId: txData.chatId,
                    senderId: 'system',
                    receiverId: 'system',
                    type: 'system',
                    content: `Étiquette d’expédition enregistrée.\n\nNuméro de suivi : ${trackingNumber}\n\nConsultez les consignes actuelles de la commande avant d’utiliser cette étiquette.`,
                    participants,
                    timestamp: FieldValue.serverTimestamp(),
                    status: 'sent',
                    isRead: true,
                    shippingLabel: {
                      labelUrl: fresh?.shippingLabelUrl || '',
                      trackingNumber,
                      trackingUrl: fresh?.trackingUrl || '',
                    },
                  })
                  .catch((recoveryFailure) => { if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; return undefined; });
              }
            }
            continue;
          }
          // outcome === 'failed' → fall through to attempt bookkeeping below.
          logger.error('[sweepPendingLabels] createLabel retry failed', { transactionId });
        } else { throw new UnqualifiedShipmentError('accepted_rate_identity_unqualified'); }

        // Count only the core's native, attributed definitive rejection. An
        // orphan label, lost commit or ambiguous provider result is review,
        // even if an older caller still reports the generic outcome 'failed'.
        const failed = await countRejectedLabelPurchase(txRef,txData,transactionId);
        if (!failed) { await requireShipmentReview(txRef, txData, transactionId, 'label_failure_not_proven_rejected'); continue; }

        if(!failed.policy){
          await recordPurchasePreparationReview(transactionId,'label_abandonment','accepted_preparation_terms_or_rejections_unknown');
          continue;
        }
        if (failed.policy.ready) {
          if (await refundPendingLabelTransaction(txRef, txData, transactionId, {...failed,policy:failed.policy})) refunded++;
        } else {
          retried++;
        }
      } catch (err) {
        if (err instanceof FinancialRecoveryBlocked) { lineComplete = false; throw err; }
        // An orientation that itself fails is not a completed row. In
        // particular, never checkpoint while its provider call is in flight.
        lineComplete = false;
        errors++;
        if (err instanceof UnqualifiedShipmentError) {
          await requireShipmentReview(txRef, txData, transactionId, err.reason);
          logger.warn('[sweepPendingLabels] accepted shipment requires review', {transactionId, reason: err.reason});
          lineComplete = true;
          continue;
        }
        logger.error('[sweepPendingLabels] error processing transaction', {
          transactionId,
          error: err instanceof Error ? err.message : err,
        });
        // Keep the previous checkpoint and stop: finishing a later row would
        // otherwise move the cursor past this unqualified operation too.
        break;
      } finally {
        if (lineComplete) {
          completed++;
          // Save each finished row: a slow later provider call must not replay
          // the same page head forever. Never advance an unfinished operation.
          await checkpointRef.update({ scanCursor: completed < page.length || snap.size > MAX_TRANSACTIONS_PER_RUN
            ? { schemaVersion: 2, kind: 'pending_labels_by_id_v2', lastId: doc.id, untilId } : FieldValue.delete() });
        }
      }
    }

    // A first page full of paused orders must not starve unrelated purchases.
    // Resume next hour under the existing job lock, then wrap at the end.
    logger.info('[sweepPendingLabels] run complete', { shipped, refunded, retried, errors, dateReviews, completed, stoppedForBudget });
    } finally {
      await releaseJobLock('sweepPendingLabels');
    }

    });
  }
);
