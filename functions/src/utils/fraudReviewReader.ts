/** SDK participants and current operators can read risk records without financial permission. */
import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {trackingIdentity} from '../config/shipEngine';
import {fraudReviewBlocksProgress, fraudNativeBinding, qualifiedFraudObservation} from './fraudReview';
import {supportAdmin, supportCurrentAdminSession, supportSourceHash} from './supportRequest';
import {fraudBusinessReviewKey} from '../shared/fraudReviewGuard';
import {readFraudCaseHumanResolution} from './fraudReviewResolutionProof';
import {readSellerActivityFacts} from './sellerActivityFacts';

type Data = FirebaseFirestore.DocumentData;
const cases = () => db.collection('fraud_review_cases');
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const documentId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 &&
  !v.includes('/') && v !== '.' && v !== '..';
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const rev = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}:\d{1,9}$/.test(v);
const revision = (snap: FirebaseFirestore.DocumentSnapshot) => snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() >= 0 && v.toMillis() <= Date.now();
function clock(value: unknown, qualification: 'native_timestamp' | 'provider_object_created' | 'provider_read' | 'provider_event' = 'native_timestamp') {
  const ms = qualification === 'native_timestamp' ? native(value) ? value.toMillis() : null : typeof value === 'number' &&
    Number.isSafeInteger(value) && value >= 0 && value <= Date.now() ? value : null;
  return {qualification: ms === null ? 'unknown' : qualification, at: ms === null ? null : new Date(ms).toISOString()};
}
const unknownClock = () => ({qualification: 'unknown', at: null});
const noEffect = {guiltEstablished: false, identityDecision: 'none', financialEffectAuthorized: false,
  inventoryReleaseAuthorized: false, guardReleased: false, recipientReceiptVerified: false, bankReceiptVerified: false};
const fail = () => new HttpsError('failed-precondition', 'Les sources du dossier ont changé ou doivent être rapprochées. Actualisez ou contactez le support.');
function qualifiedCase(data: Data | undefined, caseId: string) {
  return data?.protocol === 'fraud_review_case_v1' && data.caseId === caseId && /^fr_[a-f0-9]{64}$/.test(caseId) &&
    ['early_fraud_warning', 'review'].includes(data.family) && ['lookup_pending', 'matched', 'reconciliation_required'].includes(data.state) &&
    native(data.firstObservedAt) && data.resolutionState === 'human_review_required' && data.financialDecision === 'none' && data.identityDecision === 'none';
}
function source(caseSnap: FirebaseFirestore.DocumentSnapshot, orderSnap: FirebaseFirestore.DocumentSnapshot | null) {
  return {caseRevision: revision(caseSnap), caseSourceHash: supportSourceHash(caseSnap.data() ?? null),
    orderRevision: orderSnap?.exists ? revision(orderSnap) : null, orderSourceHash: orderSnap?.exists ? supportSourceHash(orderSnap.data() ?? null) : null};
}
function sourceInput(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k =>
      !['caseRevision', 'caseSourceHash', 'orderRevision', 'orderSourceHash'].includes(k)) || !rev(value.caseRevision) || !hash(value.caseSourceHash) ||
      !(value.orderRevision === null && value.orderSourceHash === null || rev(value.orderRevision) && hash(value.orderSourceHash))) throw fail();
  return value;
}
function sameSource(expected: any, actual: any) {return ['caseRevision', 'caseSourceHash', 'orderRevision', 'orderSourceHash'].every(k => expected[k] === actual[k]);}
async function readerHuman(tx: FirebaseFirestore.Transaction, snap: FirebaseFirestore.DocumentSnapshot, order: Data | null) {
  const data = snap.data(), pointer = data?.humanResolution;
  const unknown = {qualification: pointer === undefined ? 'unrecorded' : 'unknown', action: null, decisionId: null,
    decidedAt: unknownClock(), appliesToLatestObservation: false};
  if (!pointer || !order || !id(data?.transactionId)) return unknown;
  const proof = hash(data?.latestObservationId) ? (await tx.get(snap.ref.collection('observations').doc(data!.latestObservationId))).data() : undefined;
  const valid = qualifiedFraudObservation(proof, snap.id, data!.latestObservationId) && proof?.binding?.transactionId === data!.transactionId &&
    proof.binding.buyerId === order.buyerId && proof.binding.sellerId === order.sellerId && proof.payment;
  const key = valid ? fraudBusinessReviewKey(snap.id, proof!.current, proof!.payment, proof!.binding) : null;
  const human = await readFraudCaseHumanResolution(tx, snap.id, pointer.reviewKey, data, order, data!.transactionId);
  if (!human) return unknown;
  return {qualification: 'native_human_receipt', action: human.action, decisionId: human.decisionId,
    decidedAt: clock(human.decidedAt), appliesToLatestObservation: data!.state === 'matched' && key !== null && key === pointer.reviewKey};
}
function humanPublicState(data: Data | undefined, caseId: string, human: Awaited<ReturnType<typeof readerHuman>>) {
  if (!qualifiedCase(data, caseId)) return 'unknown';
  return human.appliesToLatestObservation && human.action === 'close_review_for_sources' ? 'review_closed_for_sources' : 'human_review_required';
}
async function summary(tx: FirebaseFirestore.Transaction, snap: FirebaseFirestore.DocumentSnapshot, orderSnap: FirebaseFirestore.DocumentSnapshot | null) {
  const data = snap.data();
  const humanReview = await readerHuman(tx, snap, orderSnap?.data() ?? null);
  return {caseId: snap.id, transactionId: id(data?.transactionId) ? data!.transactionId : null,
    qualification: qualifiedCase(data, snap.id) ? 'native_case' : 'unknown',
    publicState: humanPublicState(data, snap.id, humanReview), humanReview,
    firstObservedAt: clock(data?.firstObservedAt), source: source(snap, orderSnap), ...noEffect};
}
function pageInput(raw: any, keys: string[]) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !keys.includes(k)))
    throw new HttpsError('invalid-argument', 'Paramètres de lecture invalides.');
  const cursor = raw.cursor ?? null;
  if (cursor !== null && (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || Object.keys(cursor).some(k => k !== 'lastId') ||
      !documentId(cursor.lastId)))
    throw new HttpsError('invalid-argument', 'Curseur natif invalide.');
  return cursor;
}
async function currentTransport(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data) {
  const unknown = {qualification: 'unknown', currentSource: false, capture: null, providerStatusCode: null,
    recordedAt: unknownClock(), providerReadAt: unknownClock(), providerEventAt: unknownClock(),
    physicalDepositTimeVerified: false, nonDepositVerified: false, recipientReceiptVerified: false};
  const p = order.trackingHistoryCapture;
  if (!/^tracking_[a-f0-9]{64}$/.test(p?.captureId ?? '')) return unknown;
  const snap = await tx.get(db.collection('transactions').doc(transactionId).collection('tracking_history').doc(p.captureId));
  const c = snap.data(), info = c?.info;
  if (!c || c.protocol !== 'tracking_history_v1' || c.captureId !== p.captureId || c.buyerId !== order.buyerId ||
      c.sellerId !== order.sellerId || !native(c.recordedAt) || !info || info.transactionId !== transactionId || info.leg !== 'forward' ||
      !id(info.readId) || !Number.isSafeInteger(info.readVersion) || info.readVersion < 1 || !hash(info.sourceHash) ||
      !Number.isSafeInteger(info.providerRequestedAtMs) || info.providerRequestedAtMs < 0 ||
      !Number.isSafeInteger(info.providerObservedAtMs) || info.providerObservedAtMs < info.providerRequestedAtMs ||
      info.providerObservedAtMs > c.recordedAt.toMillis() || !Number.isSafeInteger(info.totalEvents) || info.totalEvents < 0 || info.totalEvents > 1000 ||
      !Array.isArray(c.pageHashes) || c.pageHashes.length !== Math.ceil(info.totalEvents / 50) || !c.pageHashes.every(hash) ||
      c.displayHash !== digest(['tracking_history_v1', info, c.pageHashes])) return unknown;
  const read = order.trackingRead;
  const current = p.protocol === c.protocol && p.displayHash === c.displayHash && p.sourceHash === info.sourceHash && p.readVersion === info.readVersion &&
    native(p.recordedAt) && p.recordedAt.isEqual(c.recordedAt) && trackingIdentity(transactionId, order, 'forward')?.sourceHash === info.sourceHash &&
    read?.schemaVersion === 1 && read.readId === info.readId && read.version === info.readVersion && read.sourceHash === info.sourceHash &&
    read.leg === 'forward' && native(read.authorizedAt) && read.authorizedAt.toMillis() <= info.providerRequestedAtMs;
  const event = !['actual_delivery_date', 'normalized_event'].includes(info.providerEventTimeSource) ||
    info.providerEventAtMs === null || !Number.isSafeInteger(info.providerEventAtMs) || info.providerEventAtMs < 0 ||
    info.providerEventAtMs > info.providerObservedAtMs ? unknownClock() : clock(info.providerEventAtMs, 'provider_event');
  return {qualification: 'native_capture', currentSource: current,
    capture: {captureId: c.captureId, displayHash: c.displayHash, sourceHash: info.sourceHash, readId: info.readId, readVersion: info.readVersion},
    providerStatusCode: typeof info.providerStatusCode === 'string' && /^[A-Z_]{1,64}$/.test(info.providerStatusCode) ? info.providerStatusCode : null,
    recordedAt: clock(c.recordedAt), providerReadAt: clock(info.providerObservedAtMs, 'provider_read'), providerEventAt: event,
    physicalDepositTimeVerified: false, nonDepositVerified: false, recipientReceiptVerified: false};
}
function observation(snap: FirebaseFirestore.DocumentSnapshot, caseId: string, order: Data | null, operator: boolean) {
  const value = snap.data(), qualified = qualifiedFraudObservation(value, caseId, snap.id);
  const binding = value?.binding;
  const partiesMatch = !!order && id(binding?.transactionId) && binding.buyerId === order.buyerId && binding.sellerId === order.sellerId;
  if (!operator && !partiesMatch) return null;
  const attributed = qualified && partiesMatch && binding && ['captured', 'authorized'].includes(binding.captureState) &&
    Number.isSafeInteger(binding.cardCents) && binding.cardCents > 0 && Number.isSafeInteger(binding.capturedCardCents) && binding.capturedCardCents >= 0 &&
    value?.payment?.currency === 'CAD' && value.payment.captureState === binding.captureState &&
    value.payment.amountCents === binding.cardCents && value.payment.capturedCents === binding.capturedCardCents &&
    (binding.captureState === 'captured' ? binding.capturedCardCents === binding.cardCents : binding.capturedCardCents === 0);
  return {observationId: snap.id, qualification: qualified ? 'native_observation' : 'unknown',
    recordedAt: clock(qualified ? value?.recordedAt : null),
    attribution: attributed ? 'native_order_qualified_at_observation' : 'unknown',
    payment: {qualification: attributed ? 'provider_get_qualified_at_observation' : 'unknown', currency: 'CAD',
      captureState: attributed ? binding.captureState : 'unknown', amountCents: attributed ? binding.cardCents : null,
      capturedCents: attributed ? binding.capturedCardCents : null, occurredAt: unknownClock(), bankReceiptVerified: false},
    signalCreatedAt: clock(qualified && value && typeof value.current?.createdAtMs === 'number' && value.current.createdAtMs <= value.recordedAt.toMillis()
      ? value?.current?.createdAtMs ?? null : null, 'provider_object_created'),
    signalOccurredAt: unknownClock(), physicalDepositTimeVerified: false, nonDepositVerified: false,
    reviewStillRequired: true, ...noEffect};
}

/** Pure native reads. No user/profile/activity/feature admission for owners.
 * Operators qualify current Auth/cutoff plus a private role inside this TX. */
export async function readFraudReview(request: any) {
  if (request.data?.mode === 'seller_activity_facts_observe') return readSellerActivityFacts(request);
  const uid = request.auth?.uid, raw = request.data;
  if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise.');
  if (raw?.expectedUid !== uid) throw new HttpsError('permission-denied', 'La session a changé.');
  const operator = ['fraud_admin_cases_observe', 'fraud_admin_case_observe'].includes(raw?.mode);
  const detail = ['fraud_case_observe', 'fraud_admin_case_observe'].includes(raw?.mode);
  const cursor = pageInput(raw, detail ? ['mode', 'expectedUid', 'transactionId', 'caseId', 'expectedSource', 'cursor'] :
    ['mode', 'expectedUid', 'transactionId', 'cursor']);
  if (!operator && !id(raw.transactionId) || detail && !documentId(raw.caseId))
    throw new HttpsError('invalid-argument', 'Commande ou dossier exact requis.');
  const expected = detail ? sourceInput(raw.expectedSource) : null;
  const currentAdmin = operator ? await supportCurrentAdminSession(request) : false;
  return db.runTransaction(async tx => {
    if (operator) await supportAdmin(tx, uid, currentAdmin);
    const readAt = Timestamp.now();
    let orderSnap: FirebaseFirestore.DocumentSnapshot | null = null, order: Data | null = null;
    if (!operator) {
      orderSnap = await tx.get(db.collection('transactions').doc(raw.transactionId)); order = orderSnap.data() ?? null;
      if (!order || !id(order.buyerId) || !id(order.sellerId) || order.buyerId === order.sellerId ||
          ![order.buyerId, order.sellerId].includes(uid)) throw new HttpsError('permission-denied', 'Commande privée non autorisée.');
    }
    if (!detail) {
      let query = operator ? cases().orderBy('__name__') : cases().where('transactionId', '==', raw.transactionId).orderBy('__name__');
      if (cursor) query = query.startAfter(cursor.lastId);
      const page = await tx.get(query.limit(11)), inspected = page.docs.slice(0, 10);
      const items = [];
      for (const snap of inspected) {
        const transactionId = snap.data().transactionId;
        const itemOrder = operator && id(transactionId) ? await tx.get(db.collection('transactions').doc(transactionId)) : orderSnap;
        items.push(await summary(tx, snap, itemOrder));
      }
      return {protocol: operator ? 'fraud_admin_cases_v1' : 'fraud_owner_cases_v1', ownerId: uid,
        transactionId: operator ? null : raw.transactionId, readAt: readAt.toDate().toISOString(),
        items,
        pagination: {inspected: inspected.length, limit: 10, hasMore: page.size > 10,
          nextCursor: page.size > 10 ? {lastId: inspected[inspected.length - 1].id} : null},
        coverage: {source: 'native_case_records', exhaustiveRiskHistoryVerified: false}, ...noEffect};
    }
    const snap = await tx.get(cases().doc(raw.caseId)), data = snap.data();
    if (!operator && data?.transactionId !== raw.transactionId) throw new HttpsError('permission-denied', 'Dossier privé non autorisé.');
    if (operator && id(data?.transactionId)) {
      orderSnap = await tx.get(db.collection('transactions').doc(data!.transactionId)); order = orderSnap.data() ?? null;
    }
    const actualSource = source(snap, orderSnap);
    if (!sameSource(expected, actualSource)) throw fail();
    let query = snap.ref.collection('observations').orderBy('__name__');
    if (cursor) query = query.startAfter(cursor.lastId);
    const page = await tx.get(query.limit(21)), inspected = page.docs.slice(0, 20);
    const transport = order && id(data?.transactionId) ? await currentTransport(tx, data!.transactionId, order) : null;
    const humanReview = await readerHuman(tx, snap, order);
    return {protocol: operator ? 'fraud_admin_case_v1' : 'fraud_owner_case_v1', ownerId: uid,
      transactionId: operator ? id(data?.transactionId) ? data!.transactionId : null : raw.transactionId,
      caseId: snap.id, readAt: readAt.toDate().toISOString(), source: actualSource,
      qualification: qualifiedCase(data, snap.id) ? 'native_case' : 'unknown',
      publicState: humanPublicState(data, snap.id, humanReview), humanReview,
      guard: {qualification: order && fraudReviewBlocksProgress(order) ? order.fraudReview?.protocol === 'fraud_review_guard_v1' &&
        order.fraudReview.transactionId === data?.transactionId && order.fraudReview.reviewRequired === true && native(order.fraudReview.firstObservedAt)
          ? 'native_review_guard' : 'unknown' : 'absent', reviewMarkerPresent: !!order && fraudReviewBlocksProgress(order), restrictionEnforcementVerified: false},
      items: inspected.map(doc => observation(doc, snap.id, order, operator)).filter(v => v !== null),
      currentTransport: transport,
      pagination: {inspected: inspected.length, limit: 20, hasMore: page.size > 20,
        nextCursor: page.size > 20 ? {lastId: inspected[inspected.length - 1].id} : null},
      coverage: {source: 'native_observations', chronologicalOrderVerified: false, exhaustiveRiskHistoryVerified: false},
      resolution: {state: humanPublicState(data, snap.id, humanReview),
        resolvedAt: humanReview.appliesToLatestObservation && humanReview.action === 'close_review_for_sources' ? humanReview.decidedAt : unknownClock(),
        legalDeadline: unknownClock()}, ...noEffect};
  });
}

/** Future human instructions must bind this exact native case/observation and
 * current order source. This is documentary provenance, never an unlock or a
 * financial decision; other cases and holds remain independent. */
export async function readFraudDecisionSource(tx: FirebaseFirestore.Transaction, transactionId: string, caseId: string) {
  if (!id(transactionId) || !/^fr_[a-f0-9]{64}$/.test(caseId)) return null;
  const caseSnap = await tx.get(cases().doc(caseId)), orderSnap = await tx.get(db.collection('transactions').doc(transactionId));
  const data = caseSnap.data(), order = orderSnap.data();
  if (!qualifiedCase(data, caseId) || data!.transactionId !== transactionId || !order ||
      !id(order.buyerId) || !id(order.sellerId) || order.buyerId === order.sellerId) return null;
  const observationId = data!.latestObservationId;
  const proofSnap = hash(observationId) ? await tx.get(caseSnap.ref.collection('observations').doc(observationId)) : null;
  const proof = proofSnap?.data();
  const proofQualified = qualifiedFraudObservation(proof, caseId, observationId);
  let nativeCurrentBindingQualified = false;
  if (proofQualified && proof?.payment && proof.binding?.transactionId === transactionId) {
    const candidates = await tx.get(db.collection('transactions').where('stripePaymentIntentId', '==', proof.payment.paymentIntentId).limit(2));
    nativeCurrentBindingQualified = candidates.size === 1 && candidates.docs[0].id === transactionId &&
      fraudNativeBinding(transactionId, order, proof.payment, Timestamp.now()) !== null;
  }
  return {protocol: 'fraud_decision_source_v1', caseId, transactionId, source: source(caseSnap, orderSnap),
    observationId: proofQualified ? observationId : null, observationHash: proofQualified ? proof!.semanticHash : null,
    observationRevision: proofQualified && proofSnap ? revision(proofSnap) : null, nativeCurrentBindingQualified,
    guardMarkerPresent: fraudReviewBlocksProgress(order), globalReleaseAuthorized: false,
    independentHoldsReleased: false, ...noEffect};
}
