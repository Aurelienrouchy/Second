/** Bounded recovery of private, signature-origin fraud dossiers. No money rail. */
import {randomUUID} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {db} from '../config/firebase';
import {fraudDigest, commitFraudSignal, storedFraudEvent, qualifiedFraudObservation, type FraudEvent} from './fraudReview';
import {lookupFraudSignal} from './fraudProviderEvidence';
import {supportSourceHash} from './supportRequest';

type Data = FirebaseFirestore.DocumentData;
const cases = () => db.collection('fraud_review_cases');
const scanRef = () => db.collection('job_locks').doc('fraudReviewReconciliation_cursor');
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 && !v.includes('/');
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const owns = (data: Data | undefined, ownerId: string) => data?.scanLease?.ownerId === ownerId &&
  data.scanLease.protocol === 'fraud_scan_lease_v1' && data.scanLease.lockedUntil instanceof Timestamp && data.scanLease.lockedUntil.toMillis() > Date.now();
type Cursor = {protocol: 'fraud_scan_cursor_v1'; cycleId: string; untilId: string; lastId: string | null; startedAt: Timestamp; completedAt: Timestamp | null};
function cursorValue(v: any): Cursor | null {
  return v?.protocol === 'fraud_scan_cursor_v1' && id(v.cycleId) && id(v.untilId) && (v.lastId === null || id(v.lastId) &&
    Buffer.compare(Buffer.from(v.lastId), Buffer.from(v.untilId)) <= 0) && native(v.startedAt) && v.completedAt === null ? v : null;
}
async function acquire() {
  const ownerId = randomUUID();
  return db.runTransaction(async tx => {
    const data = (await tx.get(scanRef())).data();
    if (data?.scanLease?.lockedUntil instanceof Timestamp && data.scanLease.lockedUntil.toMillis() > Date.now()) return null;
    let cursor = cursorValue(data?.scanCursor);
    if (!cursor) {
      const tail = await tx.get(cases().orderBy('__name__', 'desc').limit(1));
      if (tail.empty) return null;
      cursor = {protocol: 'fraud_scan_cursor_v1', cycleId: randomUUID(), untilId: tail.docs[0].id,
        lastId: null, startedAt: Timestamp.now(), completedAt: null};
    }
    tx.set(scanRef(), {scanCursor: cursor, scanLease: {protocol: 'fraud_scan_lease_v1', ownerId,
      lockedUntil: Timestamp.fromMillis(Date.now() + 120_000)}}, {merge: true});
    return {ownerId, cursor};
  });
}
/** A private malformed/missing source becomes an operator receipt, not a
 * chosen order. The checkpoint and alert proof commit together. */
async function prepareUnknown(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference,
  source: Data | undefined, sourceRevision: string | null, reason: string) {
  const reviewId = fraudDigest([ref.id, sourceRevision, supportSourceHash(source ?? null), reason]);
  const receiptRef = ref.collection('scan_reviews').doc(reviewId), receipt = (await tx.get(receiptRef)).data();
  const alertRef = db.collection('admin_alerts').doc(`fraud_source_${reviewId}`);
  const alert = receipt ? null : await tx.get(alertRef);
  if (receipt && (receipt.protocol !== 'fraud_scan_review_v1' || receipt.reviewId !== reviewId ||
      receipt.caseId !== ref.id || receipt.alertId !== alertRef.id || !native(receipt.recordedAt))) throw new Error('Fraud scan review unqualified.');
  if (alert?.exists) throw new Error('Fraud scan alert lacks receipt.');
  return () => {
    if (receipt) return;
    const recordedAt = Timestamp.now();
    tx.create(receiptRef, {protocol: 'fraud_scan_review_v1', reviewId, caseId: ref.id, sourceRevision, reason,
      alertId: alertRef.id, recordedAt, attribution: 'unknown', financialDecision: 'none'});
    tx.create(alertRef, {kind: 'stripe_fraud_source_reconciliation', severity: 'warning', refId: ref.id,
      status: 'open', createdAt: recordedAt, message: 'La source privée du signal de paiement doit être rapprochée par un opérateur. Aucun compte ou effet financier n’a été choisi.',
      context: {caseId: ref.id, reviewId, reason}});
  };
}
async function claim(ref: FirebaseFirestore.DocumentReference, ownerId: string, next: Cursor, previousLastId: string | null): Promise<{
  event: FraudEvent; attemptId: string; eventSourceHash: string;
} | null> {
  return db.runTransaction(async tx => {
    const scan = (await tx.get(scanRef())).data();
    if (!owns(scan, ownerId) || scan?.scanCursor?.cycleId !== next.cycleId || scan.scanCursor.untilId !== next.untilId ||
        scan.scanCursor.lastId !== previousLastId) throw new Error('Fraud scan lease changed.');
    const snap = await tx.get(ref), source = snap.data();
    const checkpoint = () => tx.update(scanRef(), {scanCursor: next});
    if (!source || source.protocol !== 'fraud_review_case_v1' || source.caseId !== ref.id ||
        !/^fr_[a-f0-9]{64}$/.test(ref.id) || !['review', 'early_fraud_warning'].includes(source.family) ||
        !native(source.firstObservedAt) || source.financialDecision !== 'none' || source.identityDecision !== 'none' ||
        source.resolutionState !== 'human_review_required' ||
        !['lookup_pending', 'matched', 'reconciliation_required'].includes(source.state)) {
      const persist = await prepareUnknown(tx, ref, source, snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null,
        'native_case_unqualified'); persist(); checkpoint(); return null;
    }
    const recovery = source.fraudRecovery;
    if (source.state === 'matched') {
      const proof = /^[a-f0-9]{64}$/.test(source.latestObservationId ?? '')
        ? (await tx.get(ref.collection('observations').doc(source.latestObservationId))).data() : undefined;
      if (!qualifiedFraudObservation(proof, ref.id, source.latestObservationId) || !id(proof?.binding?.transactionId) ||
          proof?.binding?.transactionId !== source.transactionId) {
        const persist = await prepareUnknown(tx, ref, source, snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null,
          'historical_match_source_unqualified'); persist(); checkpoint(); return null;
      }
      checkpoint(); return null;
    }
    const sameRecoveryEvent = recovery?.eventId === source.latestReceivedEventId || source.latestReceivedEventId == null;
    let eventId = source.latestReceivedEventId;
    if (eventId == null) {
      // Legacy sources without a pointer can be adopted only if globally unique
      // in this case's private events, never the first of an incomplete list.
      const legacy = await tx.get(ref.collection('events').orderBy('__name__').limit(2));
      if (legacy.size === 1) eventId = legacy.docs[0].id;
    }
    const eventSnap = typeof eventId === 'string' && /^evt_[A-Za-z0-9_]{1,190}$/.test(eventId)
      ? await tx.get(ref.collection('events').doc(eventId)) : null;
    const record = eventSnap?.data(), event = record ? storedFraudEvent(ref.id, eventId, record) : null;
    let proofQualified = !!event;
    if (record?.state === 'matched' || record?.state === 'reconciliation_required') {
      const proof = /^[a-f0-9]{64}$/.test(record.observationId ?? '')
        ? (await tx.get(ref.collection('observations').doc(record.observationId))).data() : undefined;
      proofQualified = proofQualified && native(record.completedAt) && qualifiedFraudObservation(proof, ref.id, record.observationId);
    } else proofQualified = proofQualified && record?.state === 'lookup_pending' && record?.provenance === 'signature_verified_dispatcher';
    const sourceMatches = event && source.family === event.signed.family && source.signalId === event.signed.id &&
      source.livemode === event.livemode && source.accountPresent === event.accountPresent && source.accountId === event.accountId;
    const attempts = recovery == null || !sameRecoveryEvent ? 0 : recovery.protocol === 'fraud_recovery_v1' &&
      Number.isSafeInteger(recovery.attempts) && recovery.attempts >= 1 && recovery.attempts <= 8 ? recovery.attempts : null;
    if (!proofQualified || !sourceMatches || event?.signedIdentityQualified === false || record?.reconciliationReason === 'signed_signal_identity_unqualified' ||
        attempts === null || !['looking_up', 'deferred', 'operator_required', 'association_recorded'].includes(recovery?.state ?? 'deferred')) {
      const persist = await prepareUnknown(tx, ref, source, snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null,
        'native_event_or_retry_source_unqualified'); persist(); checkpoint(); return null;
    }
    const eventSourceHash = fraudDigest(event);
    if (sameRecoveryEvent && recovery && recovery.state !== 'looking_up') {
      const completed = id(recovery.attemptId) ? (await tx.get(ref.collection('recovery_attempts').doc(recovery.attemptId))).data() : null;
      const observation = completed && /^[a-f0-9]{64}$/.test(completed.observationId ?? '')
        ? (await tx.get(ref.collection('observations').doc(completed.observationId))).data() : undefined;
      const proof = completed?.protocol === 'fraud_recovery_attempt_v1' && completed.attemptId === recovery.attemptId &&
        completed.eventId === event!.eventId && completed.eventSourceHash === eventSourceHash && native(completed.completedAt) &&
        completed.attempt === attempts && (recovery.state === 'operator_required' ?
          completed.state === 'operator_required' || attempts === 8 && completed.state === 'reconciliation_required' &&
            qualifiedFraudObservation(observation, ref.id, completed.observationId) : recovery.state === 'association_recorded' ?
          completed.state === 'historical_match_preserved' && record?.state === 'matched' || completed.state === 'matched' &&
            qualifiedFraudObservation(observation, ref.id, completed.observationId) :
          completed.state === 'reconciliation_required' && qualifiedFraudObservation(observation, ref.id, completed.observationId));
      const clockQualified = recovery.state !== 'deferred' || recovery.nextAttemptAt instanceof Timestamp && native(recovery.completedAt) &&
        recovery.nextAttemptAt.toMillis() >= recovery.completedAt.toMillis() &&
        recovery.nextAttemptAt.toMillis() <= recovery.completedAt.toMillis() + 48 * 3_600_000;
      if (!proof || !clockQualified) {
        const persist = await prepareUnknown(tx, ref, source, snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null,
          'recovery_completion_source_unqualified'); persist(); checkpoint(); return null;
      }
      if (recovery.state === 'operator_required' || recovery.state === 'association_recorded' ||
          recovery.state === 'deferred' && recovery.nextAttemptAt.toMillis() > Date.now()) {checkpoint(); return null;}
    }
    if (attempts! >= 8) {
      const persist = await prepareUnknown(tx, ref, source, snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null,
        'recovery_attempt_budget_exhausted'); persist(); checkpoint(); return null;
    }
    if (sameRecoveryEvent && recovery?.state === 'looking_up') {
      const prior = id(recovery.attemptId) ? (await tx.get(ref.collection('recovery_attempts').doc(recovery.attemptId))).data() : null;
      if (prior?.protocol !== 'fraud_recovery_attempt_v1' || prior.attemptId !== recovery.attemptId ||
          prior.eventId !== event!.eventId || prior.eventSourceHash !== eventSourceHash || prior.state !== 'lookup_pending' ||
          prior.attempt !== attempts || !native(prior.claimedAt) || !Number.isSafeInteger(prior.lookupStarts) || prior.lookupStarts < 1 ||
          prior.lookupStarts > 8 || !(prior.nextLookupAfter instanceof Timestamp)) throw new Error('Unfinished fraud recovery receipt unqualified.');
      if (prior.lookupStarts >= 8) {
        const persist = await prepareUnknown(tx, ref, source, snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null,
          'recovery_lookup_budget_exhausted');
        persist();
        tx.update(ref.collection('recovery_attempts').doc(recovery.attemptId), {state: 'operator_required', completedAt: Timestamp.now()});
        tx.update(ref, {'fraudRecovery.state': 'operator_required', 'fraudRecovery.nextAttemptAt': null});
        checkpoint(); return null;
      }
      if (prior.nextLookupAfter.toMillis() > Date.now()) {checkpoint(); return null;}
      tx.update(ref.collection('recovery_attempts').doc(recovery.attemptId), {lookupStarts: prior.lookupStarts + 1,
        lastLookupStartedAt: Timestamp.now(), nextLookupAfter: Timestamp.fromMillis(Date.now() + 6 * 3_600_000)});
      return {event: event!, attemptId: recovery.attemptId as string, eventSourceHash};
    }
    const attemptId = randomUUID(), claimedAt = Timestamp.now();
    tx.create(ref.collection('recovery_attempts').doc(attemptId), {protocol: 'fraud_recovery_attempt_v1', attemptId,
      eventId: event!.eventId, eventSourceHash, state: 'lookup_pending', claimedAt, attempt: attempts + 1,
      lookupStarts: 1, lastLookupStartedAt: claimedAt, nextLookupAfter: Timestamp.fromMillis(claimedAt.toMillis() + 6 * 3_600_000)});
    tx.update(ref, {fraudRecovery: {protocol: 'fraud_recovery_v1', attemptId, eventId: event!.eventId,
      eventSourceHash, attempts: attempts + 1, state: 'looking_up', claimedAt, nextAttemptAt: null}});
    return {event: event!, attemptId, eventSourceHash};
  });
}

/** At most 40 inspected IDs, two provider observations, and ~30 seconds of
 * launched work per run. Every unfinished line remains before its checkpoint. */
export async function reconcileFraudReviews() {
  const scan = await acquire();
  if (!scan) return;
  let cursor = scan.cursor, inspected = 0, lookedUp = 0;
  const deadline = Date.now() + 30_000;
  try {
    while (inspected < 40 && lookedUp < 2 && Date.now() + 14_000 < deadline) {
      let query = cases().orderBy('__name__').endAt(cursor.untilId).limit(Math.min(10, 40 - inspected));
      if (cursor.lastId) query = query.startAfter(cursor.lastId);
      const page = await query.get();
      if (page.empty) {
        await db.runTransaction(async tx => {
          if (!owns((await tx.get(scanRef())).data(), scan.ownerId)) throw new Error('Fraud scan lease changed.');
          tx.update(scanRef(), {scanCursor: {...cursor, completedAt: Timestamp.now()}});
        }); break;
      }
      for (const doc of page.docs) {
        if (inspected >= 40 || lookedUp >= 2 || Date.now() + 14_000 >= deadline) return;
        const next = {...cursor, lastId: doc.id};
        const work = await claim(doc.ref, scan.ownerId, next, cursor.lastId);
        inspected++;
        if (work) {
          lookedUp++;
          const result = await lookupFraudSignal(work.event, true);
          await commitFraudSignal(work.event, result.current, result.payment, result.reason,
            {attemptId: work.attemptId, eventSourceHash: work.eventSourceHash, scanOwnerId: scan.ownerId, scanRef: scanRef(), cursor: next, previousLastId: cursor.lastId});
        }
        cursor = next;
      }
    }
  } finally {
    await db.runTransaction(async tx => {
      const data = (await tx.get(scanRef())).data();
      if (data?.scanLease?.ownerId === scan.ownerId) tx.update(scanRef(), {'scanLease.lockedUntil': Timestamp.fromMillis(0)});
    });
  }
}
