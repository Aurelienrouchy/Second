/** Stripe risk signals are private review evidence, never a verdict on a person. */
import {Timestamp} from 'firebase-admin/firestore';
import {db} from '../config/firebase';
import {exactCents} from './shippingPurchaseRate';
import {prepareOperationalNotices} from './notifications';
import {trackingProofMatches} from '../config/shipEngine';
import {fraudGuardDigest, fraudBusinessReviewKey, fraudReviewBlocksProgress} from '../shared/fraudReviewGuard';
import {readFraudCaseHumanResolution} from './fraudReviewResolutionProof';
import {fraudPlatformReferences, readFraudSignalCandidate} from './fraudReviewCandidates';

type Data = FirebaseFirestore.DocumentData;
export type FraudSignal = {
  family: 'early_fraud_warning' | 'review'; id: string | null; livemode: boolean | null;
  chargeId: string | null; paymentIntentId: string | null; createdAtMs: number | null;
  actionable: boolean | null; open: boolean | null; reason: string | null; closedReason: string | null;
};
export type FraudEvent = {eventId: string; eventType: string; eventCreatedAtMs: number | null;
  accountId: string | null; accountPresent: boolean; livemode: boolean | null; signed: FraudSignal; signedHash: string;
  signedIdentityQualified?: boolean};
export type FraudPayment = {paymentIntentId: string; chargeId: string; livemode: boolean;
  currency: 'CAD'; amountCents: number; capturedCents: number; captureState: 'captured' | 'authorized';
  metadata: {transactionId: string | null; buyerId: string | null; sellerId: string | null; walletCents: string | null}};
export const fraudDigest = fraudGuardDigest;
const uid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nativeMillis = (v: unknown, now: Timestamp): number | null => v instanceof Timestamp &&
  v.toMillis() >= 0 && v.toMillis() <= now.toMillis() ? v.toMillis() : null;

/** Consumers must check inside their NEW-effect TX, after genuine historical
 * receipts. Unknown markers also block. No provider closure clears this guard. */
export {fraudReviewBlocksProgress} from '../shared/fraudReviewGuard';
export function fraudCaseId(event: FraudEvent) {
  return 'fr_' + fraudDigest([event.signed.family, event.signed.id ?? event.eventId,
    event.livemode, event.accountPresent ? event.accountId ?? 'unknown_account' : 'platform']);
}
function eventReference(event: FraudEvent) {
  return db.collection('fraud_review_cases').doc(fraudCaseId(event)).collection('events').doc(event.eventId);
}

/** A resumed event comes only from this private dispatcher receipt, never a
 * client-supplied object. Its signed payload hash remains immutable. */
export function storedFraudEvent(caseId: string, eventId: string, value: Data): FraudEvent | null {
  const s = value.signed;
  const event: FraudEvent = {eventId: value.eventId, eventType: value.eventType, signed: s,
    eventCreatedAtMs: value.eventCreatedAtMs, accountId: value.accountId, accountPresent: value.accountPresent,
    livemode: value.eventLivemode, signedHash: value.signedHash,
    ...(typeof value.signedIdentityQualified === 'boolean' ? {signedIdentityQualified: value.signedIdentityQualified} : {})};
  const millis = (v: unknown) => v === null || typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= Date.now();
  const nullableId = (v: unknown, prefix: string) => v === null || typeof v === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]{1,190}$`).test(v);
  if (value.protocol !== 'fraud_signal_event_v1' || eventId !== event.eventId || !/^evt_[A-Za-z0-9_]{1,190}$/.test(eventId) ||
      !['radar.early_fraud_warning.created', 'radar.early_fraud_warning.updated', 'review.opened', 'review.closed'].includes(event.eventType) ||
      !/^[a-f0-9]{64}$/.test(event.signedHash ?? '') || nativeMillis(value.receivedAt, Timestamp.now()) === null ||
      typeof event.accountPresent !== 'boolean' || !nullableId(event.accountId, 'acct') ||
      !(event.livemode === null || typeof event.livemode === 'boolean') || !millis(event.eventCreatedAtMs) ||
      !s || !['review', 'early_fraud_warning'].includes(s.family) || (s.family === 'review') !== event.eventType.startsWith('review.') ||
      !nullableId(s.id, s.family === 'review' ? 'prv' : 'issfr') || !nullableId(s.chargeId, 'ch') || !nullableId(s.paymentIntentId, 'pi') ||
      !(s.livemode === null || typeof s.livemode === 'boolean') || !millis(s.createdAtMs) ||
      !['actionable', 'open'].every(key => s[key] === null || typeof s[key] === 'boolean') ||
      !['reason', 'closedReason'].every(key => s[key] === null || typeof s[key] === 'string' && s[key].length <= 200) ||
      fraudCaseId(event) !== caseId) return null;
  return event;
}

export function qualifiedFraudObservation(value: Data | undefined, caseId: string, observationId: string): boolean {
  if (!value || value.protocol !== 'fraud_signal_observation_v1' || value.caseId !== caseId ||
      value.observationId !== observationId || value.semanticHash !== observationId || nativeMillis(value.recordedAt, Timestamp.now()) === null) return false;
  return fraudDigest({caseId: value.caseId, current: value.current, payment: value.payment,
    binding: value.binding, carrier: value.carrier, reconciliationReason: value.reconciliationReason}) === observationId;
}

export type FraudRecoveryCommit = {attemptId: string; eventSourceHash: string; scanOwnerId: string;
  scanRef: FirebaseFirestore.DocumentReference; cursor: Data; previousLastId: string | null};

/** Persist signed evidence before provider I/O. A timeout leaves a resumable
 * native event rather than a handled-event marker or an invented order. */
export async function beginFraudSignal(event: FraudEvent): Promise<boolean> {
  return db.runTransaction(async tx => {
    const ref = eventReference(event), receipt = (await tx.get(ref)).data();
    const parent = (await tx.get(ref.parent.parent!)).data();
    if (parent && (parent.protocol !== 'fraud_review_case_v1' || parent.caseId !== fraudCaseId(event) ||
        parent.family !== event.signed.family || parent.signalId !== event.signed.id || parent.livemode !== event.livemode ||
        parent.accountPresent !== event.accountPresent || parent.accountId !== event.accountId))
      throw new Error('Fraud case native identity requires reconciliation.');
    if (receipt && (receipt.protocol !== 'fraud_signal_event_v1' || receipt.eventId !== event.eventId || receipt.signedHash !== event.signedHash))
      throw new Error('Fraud signal event identity requires reconciliation.');
    if (receipt?.state === 'matched' || receipt?.state === 'reconciliation_required') {
      if (!(receipt.completedAt instanceof Timestamp) || !/^[a-f0-9]{64}$/.test(receipt.observationId ?? ''))
        throw new Error('Fraud signal completion receipt unqualified.');
      const proof = (await tx.get(ref.parent.parent!.collection('observations').doc(receipt.observationId))).data();
      if (!qualifiedFraudObservation(proof, fraudCaseId(event), receipt.observationId))
        throw new Error('Fraud signal observation receipt missing.');
      return true;
    }
    const referenceBridge = fraudPlatformReferences(event);
    const candidate = await readFraudSignalCandidate(tx, referenceBridge);
    const receivedAt = Timestamp.now();
    if (!receipt) tx.create(ref, {protocol: 'fraud_signal_event_v1', eventId: event.eventId, eventType: event.eventType,
      signedHash: event.signedHash, signed: event.signed, eventCreatedAtMs: event.eventCreatedAtMs,
      eventLivemode: event.livemode, accountId: event.accountId, accountPresent: event.accountPresent,
      state: 'lookup_pending', receivedAt, signedIdentityQualified: event.signedIdentityQualified ?? null,
      provenance: 'signature_verified_dispatcher'});
    if (!parent) tx.create(ref.parent.parent!, {protocol: 'fraud_review_case_v1', caseId: fraudCaseId(event),
      family: event.signed.family, signalId: event.signed.id, livemode: event.livemode,
      accountId: event.accountId, accountPresent: event.accountPresent, state: 'lookup_pending', firstObservedAt: receivedAt,
      latestReceivedEventId: event.eventId, resolutionState: 'human_review_required', financialDecision: 'none', identityDecision: 'none',
      attributionQualified: false, ...referenceBridge, ...candidate});
    else if (!receipt) tx.update(ref.parent.parent!, {latestReceivedEventId: event.eventId, state: 'lookup_pending', ...referenceBridge, ...candidate});
    return false;
  });
}

export function fraudNativeBinding(transactionId: string, order: Data, payment: FraudPayment, now: Timestamp) {
  if (!uid(order.buyerId) || !uid(order.sellerId) || order.buyerId === order.sellerId || order.currency !== 'CAD' ||
      order.stripePaymentIntentId !== payment.paymentIntentId ||
      order.stripeChargeId != null && order.stripeChargeId !== payment.chargeId ||
      order.stripeLivemode != null && order.stripeLivemode !== payment.livemode) return null;
  const total = exactCents(order.totalAmount), mixed = ['mixed', 'wallet_and_card'].includes(order.paidVia);
  const wallet = mixed ? order.walletAmountUsed : order.walletAmountUsed == null ? 0 : order.walletAmountUsed;
  if (total === null || total <= 0 || !cents(wallet) || wallet >= total || !mixed && wallet !== 0 || order.paidVia === 'wallet' ||
      total - wallet !== payment.amountCents ||
      order.capturedCardCents != null && order.capturedCardCents !== payment.capturedCents ||
      order.paidAt != null && nativeMillis(order.paidAt, now) === null) return null;
  // Native PI + immutable parties/amounts are required. Metadata only adds a
  // consistency check and never selects the order or supplies its actors.
  const meta = payment.metadata;
  const locallyCaptured = payment.captureState === 'captured' && order.stripeChargeId === payment.chargeId &&
    order.capturedCardCents === payment.capturedCents && nativeMillis(order.paidAt, now) !== null;
  const metadataMatches = meta.transactionId === transactionId && meta.buyerId === order.buyerId && meta.sellerId === order.sellerId &&
    (wallet > 0 ? meta.walletCents === String(wallet) : meta.walletCents === null || meta.walletCents === '0');
  if (!locallyCaptured && !metadataMatches || meta.transactionId !== null && meta.transactionId !== transactionId ||
      meta.buyerId !== null && meta.buyerId !== order.buyerId || meta.sellerId !== null && meta.sellerId !== order.sellerId) return null;
  return {transactionId, buyerId: order.buyerId as string, sellerId: order.sellerId as string,
    totalCents: total, walletCents: wallet, cardCents: payment.amountCents,
    capturedCardCents: payment.capturedCents, captureState: payment.captureState,
    localCaptureQualification: locallyCaptured ? 'native_capture_recorded' : 'native_capture_not_recorded'};
}

/** A qualified carrier event proves that observation only. A label, a local
 * shippedAt or absence of a scan never proves physical deposit/non-deposit. */
function carrierEvidence(transactionId: string, order: Data, signal: FraudSignal, now: Timestamp) {
  const proof = order.trackingObservation;
  const qualified = proof && ['IT', 'DE', 'AT', 'SP'].includes(proof.statusCode) &&
    trackingProofMatches(transactionId, order, proof, 'forward') && nativeMillis(proof.recordedAt, now) !== null &&
    Number.isSafeInteger(proof.providerEventAtMs) && proof.providerEventAtMs >= proof.providerLabelCreatedAtMs &&
    proof.providerEventAtMs <= proof.observedAtMs && proof.observedAtMs <= now.toMillis() &&
    ['actual_delivery_date', 'normalized_event'].includes(proof.providerEventTimeSource);
  const eventAtMs = qualified ? proof.providerEventAtMs as number : null;
  const relation = eventAtMs === null || signal.createdAtMs === null ? 'unknown' : signal.createdAtMs < eventAtMs
    ? 'signal_before_qualified_carrier_event' : 'signal_at_or_after_qualified_carrier_event';
  return {qualification: qualified ? 'native_carrier_event' : 'unknown', providerEventAtMs: eventAtMs,
    signalCreatedAtMs: signal.createdAtMs, relation, physicalDepositTimeVerified: false, nonDepositVerified: false};
}

/** The query, native source, evidence, barrier, operator receipt and essential
 * owner notices serialize together. No status, funds, inventory or Auth change. */
export async function commitFraudSignal(event: FraudEvent, current: FraudSignal | null,
  payment: FraudPayment | null, reconciliationReason: string | null, recovery?: FraudRecoveryCommit): Promise<void> {
  await db.runTransaction(async tx => {
    const caseRef = db.collection('fraud_review_cases').doc(fraudCaseId(event)), eventRef = eventReference(event);
    const receipt = (await tx.get(eventRef)).data(), caseData = (await tx.get(caseRef)).data();
    if (!receipt || receipt.signedHash !== event.signedHash || receipt.protocol !== 'fraud_signal_event_v1')
      throw new Error('Fraud signal intake receipt unqualified.');
    if (caseData?.protocol !== 'fraud_review_case_v1' || caseData.caseId !== caseRef.id ||
        caseData.family !== event.signed.family || caseData.signalId !== event.signed.id || caseData.livemode !== event.livemode ||
        caseData.accountPresent !== event.accountPresent || caseData.accountId !== event.accountId)
      throw new Error('Fraud case intake source unqualified.');
    const now = Timestamp.now();
    const attemptRef = recovery ? caseRef.collection('recovery_attempts').doc(recovery.attemptId) : null;
    const attempt = attemptRef ? (await tx.get(attemptRef)).data() : null;
    const scan = recovery ? (await tx.get(recovery.scanRef)).data() : null;
    if (recovery && (scan?.scanLease?.ownerId !== recovery.scanOwnerId || !(scan.scanLease.lockedUntil instanceof Timestamp) ||
        scan.scanLease.lockedUntil.toMillis() <= now.toMillis() || attempt?.protocol !== 'fraud_recovery_attempt_v1' ||
        attempt.attemptId !== recovery.attemptId || attempt.eventId !== event.eventId || attempt.eventSourceHash !== recovery.eventSourceHash ||
        scan.scanCursor?.cycleId !== recovery.cursor.cycleId || scan.scanCursor?.untilId !== recovery.cursor.untilId ||
        !(scan.scanCursor?.lastId === recovery.previousLastId || attempt.state !== 'lookup_pending' && scan.scanCursor?.lastId === recovery.cursor.lastId)))
      throw new Error('Fraud recovery lease or attempt unqualified.');
    if (recovery && attempt?.state !== 'lookup_pending') {
      if (!(attempt?.completedAt instanceof Timestamp)) throw new Error('Fraud recovery completion unqualified.');
      tx.update(recovery.scanRef, {scanCursor: recovery.cursor}); return;
    }
    if (receipt.state === 'matched' || receipt.state === 'reconciliation_required') {
      const previous = /^[a-f0-9]{64}$/.test(receipt.observationId ?? '')
        ? (await tx.get(caseRef.collection('observations').doc(receipt.observationId))).data() : undefined;
      if (!(receipt.completedAt instanceof Timestamp) || !qualifiedFraudObservation(previous, caseRef.id, receipt.observationId))
        throw new Error('Fraud recovery historical receipt unqualified.');
      if (!recovery) return;
      if (receipt.state === 'matched') {
        tx.update(attemptRef!, {state: 'historical_match_preserved', completedAt: now});
        if (caseData.fraudRecovery?.attemptId === recovery.attemptId &&
            (caseData.latestReceivedEventId == null || caseData.latestReceivedEventId === event.eventId)) {
          tx.update(caseRef, {'fraudRecovery.state': 'association_recorded', 'fraudRecovery.completedAt': now, 'fraudRecovery.nextAttemptAt': null});
        }
        tx.update(recovery.scanRef, {scanCursor: recovery.cursor}); return;
      }
    }
    if (recovery && (fraudDigest(storedFraudEvent(caseRef.id, event.eventId, receipt)) !== recovery.eventSourceHash ||
        caseData.fraudRecovery?.attemptId !== recovery.attemptId || caseData.fraudRecovery?.state !== 'looking_up' ||
        !Number.isSafeInteger(caseData.fraudRecovery.attempts) || caseData.fraudRecovery.attempts < 1 || caseData.fraudRecovery.attempts > 8 ||
        caseData.latestReceivedEventId != null && caseData.latestReceivedEventId !== event.eventId)) {
      tx.update(attemptRef!, {state: 'source_changed', completedAt: now});
      tx.update(recovery.scanRef, {scanCursor: recovery.cursor}); return;
    }
    let binding: ReturnType<typeof fraudNativeBinding> = null, order: Data | null = null, orderRef: FirebaseFirestore.DocumentReference | null = null;
    let reason = reconciliationReason;
    if (payment && current && !reason) {
      const candidates = await tx.get(db.collection('transactions').where('stripePaymentIntentId', '==', payment.paymentIntentId).limit(2));
      if (candidates.size === 1) {
        const doc = candidates.docs[0];
        const native = fraudNativeBinding(doc.id, doc.data(), payment, now);
        if (native) {binding = native; order = doc.data(); orderRef = doc.ref;}
        else reason = 'native_order_source_unqualified';
      } else reason = candidates.empty ? 'native_order_not_found' : 'native_order_ambiguous';
    }
    if (!binding && !reason) reason = 'provider_payment_unqualified';
    const referenceBridge = fraudPlatformReferences(event, payment);
    const candidate = await readFraudSignalCandidate(tx, referenceBridge);
    const carrier = binding && order && current ? carrierEvidence(binding.transactionId, order, current, now) : null;
    // Native source update times and GET/read times are not business identities.
    const semantic = {caseId: caseRef.id, current, payment, binding, carrier, reconciliationReason: reason};
    const observationId = fraudDigest(semantic), observationRef = caseRef.collection('observations').doc(observationId);
    const prior = await tx.get(observationRef), operatorRef = caseRef.collection('operator_receipts').doc(observationId);
    const operator = await tx.get(operatorRef), alertRef = db.collection('admin_alerts').doc(`fraud_review_${observationId}`);
    const alert = !operator.exists ? await tx.get(alertRef) : null;
    if (prior.exists && !qualifiedFraudObservation(prior.data(), caseRef.id, observationId))
      throw new Error('Fraud signal observation identity unqualified.');
    if (operator.exists && (operator.data()?.protocol !== 'fraud_review_operator_v1' || operator.data()?.observationId !== observationId ||
        operator.data()?.caseId !== caseRef.id || operator.data()?.alertId !== alertRef.id || !(operator.data()?.committedAt instanceof Timestamp) || !prior.exists))
      throw new Error('Fraud signal operator receipt unqualified.');
    if (alert?.exists) throw new Error('Unreceipted fraud signal operator alert requires reconciliation.');
    // Transport progress or the later local paid commit may add private proof,
    // but do not repeat an identical business notice for the same signal.
    const noticeId = binding ? fraudBusinessReviewKey(caseRef.id, current, payment, binding) : null;
    const human = binding && order ? await readFraudCaseHumanResolution(tx, caseRef.id, noticeId, caseData, order, binding.transactionId) : null;
    const notices = binding ? await prepareOperationalNotices(tx, [binding.buyerId, binding.sellerId].map(userId => ({
      eventKey: `fraud_review:v1:${noticeId}`, userId, type: 'order_moderation', title: 'Paiement à examiner',
      message: 'Un signal de contrôle sur le paiement de cette commande nécessite un examen humain. Il ne constitue pas une accusation. Conservez les documents et contactez le support avant une nouvelle remise du colis. Cet avis ne décide ni du remboursement ni des fonds déjà traités.',
      data: {ownerId: userId, transactionId: binding!.transactionId, fraudCaseId: caseRef.id, fraudNoticeId: noticeId!},
    }))) : null;
    if (!prior.exists) tx.create(observationRef, {protocol: 'fraud_signal_observation_v1', observationId, semanticHash: observationId,
      ...semantic, recordedAt: now, source: 'signed_event_and_current_provider_get',
      captureOccurrenceAtMs: null, fraudOccurrenceAtMs: null, financialDecision: 'none', identityDecision: 'none'});
    if (!operator.exists) {
      tx.create(alertRef, {kind: 'stripe_fraud_review', severity: 'warning', refId: binding?.transactionId ?? caseRef.id,
        status: 'open', createdAt: now,
        message: 'Signal Stripe à examiner. Il ne constitue pas une preuve de culpabilité, de dépôt, de perte ou de remboursement. Aucune décision financière ou d’identité n’a été prise.',
        context: {caseId: caseRef.id, observationId, attribution: binding ? 'native_order_qualified' : 'reconciliation_required', reason}});
      tx.create(operatorRef, {protocol: 'fraud_review_operator_v1', caseId: caseRef.id, observationId, alertId: alertRef.id, committedAt: now});
    }
    if (orderRef && order && human?.action !== 'close_review_for_sources' && !fraudReviewBlocksProgress(order)) tx.update(orderRef, {fraudReview: {
      protocol: 'fraud_review_guard_v1', transactionId: binding!.transactionId, caseId: caseRef.id,
      reviewRequired: true, firstObservedAt: now, source: 'stripe_radar', resolutionState: 'human_review_required'}});
    notices?.commit();
    if (!recovery) tx.update(eventRef, {state: binding ? 'matched' : 'reconciliation_required', observationId, completedAt: now,
      current, payment, reconciliationReason: reason, ownerNoticesCommitted: binding !== null});
    else {
      tx.update(attemptRef!, {state: binding ? 'matched' : 'reconciliation_required', observationId, completedAt: now,
        reconciliationReason: reason, ownerNoticesCommitted: binding !== null});
      const attempts = caseData.fraudRecovery.attempts as number;
      tx.update(recovery.scanRef, {scanCursor: recovery.cursor});
      tx.update(caseRef, {fraudRecovery: {protocol: 'fraud_recovery_v1', attemptId: recovery.attemptId,
        eventId: event.eventId, eventSourceHash: recovery.eventSourceHash, attempts,
        state: binding ? 'association_recorded' : attempts >= 8 ? 'operator_required' : 'deferred',
        nextAttemptAt: binding || attempts >= 8 ? null : Timestamp.fromMillis(now.toMillis() + Math.min(48, 6 * 2 ** (attempts - 1)) * 3_600_000),
        completedAt: now}});
    }
    tx.set(caseRef, {state: binding ? 'matched' : 'reconciliation_required', latestObservationId: observationId,
      latestObservedAt: now, transactionId: binding?.transactionId ?? caseData?.transactionId ?? null,
      ...referenceBridge, ...candidate,
      ...(binding ? {buyerId: binding.buyerId, sellerId: binding.sellerId, attributionQualified: true} : {}),
      resolutionState: 'human_review_required', financialDecision: 'none', identityDecision: 'none'}, {merge: true});
  });
}
