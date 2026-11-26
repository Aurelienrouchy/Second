/** Private reference bridge only: a native candidate is not payment attribution. */
import {Timestamp} from 'firebase-admin/firestore';
import {db} from '../config/firebase';
import type {FraudEvent, FraudPayment} from './fraudReview';

type Data = FirebaseFirestore.DocumentData;
const validId = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]{1,190}$`).test(v);
const actor = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const cases = () => db.collection('fraud_review_cases');

export function fraudPlatformReferences(event: FraudEvent, payment: FraudPayment | null = null): Data {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  const mode = key && /^(?:sk|rk)_live_/.test(key) ? true : key && /^(?:sk|rk)_test_/.test(key) ? false : null;
  if (mode === null || event.accountPresent || event.livemode !== mode || event.signed.livemode !== mode) return {};
  const signed = event.signedIdentityQualified === true;
  const observed = payment?.livemode === mode;
  return {...(signed && validId(event.signed.paymentIntentId, 'pi') ? {signedPaymentIntentId: event.signed.paymentIntentId} : {}),
    ...(signed && validId(event.signed.chargeId, 'ch') ? {signedChargeId: event.signed.chargeId} : {}),
    ...(observed && validId(payment?.paymentIntentId, 'pi') ? {observedPaymentIntentId: payment!.paymentIntentId} : {}),
    ...(observed && validId(payment?.chargeId, 'ch') ? {observedChargeId: payment!.chargeId} : {}),
    ...((signed || observed) ? {platformReferenceQualified: true, platformReferenceLivemode: mode} : {})};
}

function references(order: Data) {
  return {paymentIntentId: validId(order.stripePaymentIntentId, 'pi') ? order.stripePaymentIntentId as string : null,
    chargeId: validId(order.stripeChargeId, 'ch') ? order.stripeChargeId as string : null};
}
export function fraudCandidateMatchesOrder(candidate: Data, transactionId: string, order: Data): boolean {
  const source = candidate.candidateSource, refs = references(order);
  return source?.protocol === 'fraud_native_reference_candidate_v1' && source.attributionQualified === false &&
    candidate.candidateTransactionId === transactionId && source.transactionId === transactionId &&
    actor(order.buyerId) && actor(order.sellerId) && order.buyerId !== order.sellerId &&
    candidate.candidateBuyerId === order.buyerId && candidate.candidateSellerId === order.sellerId &&
    source.buyerId === order.buyerId && source.sellerId === order.sellerId && order.currency === 'CAD' &&
    !(typeof order.stripeLivemode === 'boolean' && source.livemode !== order.stripeLivemode) &&
    source.observedAt instanceof Timestamp && source.observedAt.toMillis() >= 0 && source.observedAt.toMillis() <= Date.now() &&
    (refs.paymentIntentId !== null && source.paymentIntentId === refs.paymentIntentId || refs.chargeId !== null && source.chargeId === refs.chargeId) &&
    !(refs.paymentIntentId !== null && source.paymentIntentId !== null && source.paymentIntentId !== refs.paymentIntentId) &&
    !(refs.chargeId !== null && source.chargeId !== null && source.chargeId !== refs.chargeId);
}

/** Each equality query has a lookahead. Unknown/overflow cannot clear a guard.
 * Alias matches stay unknown until the ordinary provider/native resolver binds them. */
export async function readFraudOrderCases(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data) {
  const refs = references(order);
  const queries = [cases().where('transactionId', '==', transactionId)];
  if (refs.paymentIntentId) for (const field of ['signedPaymentIntentId', 'observedPaymentIntentId']) queries.push(cases().where(field, '==', refs.paymentIntentId));
  if (refs.chargeId) for (const field of ['signedChargeId', 'observedChargeId']) queries.push(cases().where(field, '==', refs.chargeId));
  const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  let complete = true;
  for (const query of queries) {
    const page = await tx.get(query.orderBy('__name__').limit(31));
    if (page.size > 30) complete = false;
    for (const doc of page.docs) docs.set(doc.id, doc);
  }
  const ordered = [...docs.values()].sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  return {docs: ordered.slice(0, 30), complete: complete && ordered.length <= 30};
}

async function uniqueNativeOrder(tx: FirebaseFirestore.Transaction, paymentIntentId: string | null, chargeId: string | null,
  proposed?: {transactionId: string; order: Data}, mode?: boolean) {
  const found = new Map<string, {id: string; data: Data}>();
  for (const [field, value] of [['stripePaymentIntentId', paymentIntentId], ['stripeChargeId', chargeId]] as const) {
    if (!value) continue;
    const page = await tx.get(db.collection('transactions').where(field, '==', value).limit(2));
    if (page.size > 1) return null;
    for (const doc of page.docs) found.set(doc.id, {id: doc.id, data: doc.data()});
  }
  if (proposed) found.set(proposed.transactionId, {id: proposed.transactionId, data: proposed.order});
  if (found.size !== 1) return null;
  const item = [...found.values()][0], order = item.data;
  if (!actor(order.buyerId) || !actor(order.sellerId) || order.buyerId === order.sellerId || order.currency !== 'CAD' ||
      typeof order.stripeLivemode === 'boolean' && mode !== undefined && order.stripeLivemode !== mode ||
      !(paymentIntentId && order.stripePaymentIntentId === paymentIntentId || chargeId && order.stripeChargeId === chargeId) ||
      paymentIntentId && order.stripePaymentIntentId != null && order.stripePaymentIntentId !== paymentIntentId ||
      chargeId && order.stripeChargeId != null && order.stripeChargeId !== chargeId) return null;
  return item;
}

function projection(transactionId: string, order: Data, mode: boolean | null) {
  const refs = references(order);
  return {candidateTransactionId: transactionId, candidateBuyerId: order.buyerId, candidateSellerId: order.sellerId,
    candidateSource: {protocol: 'fraud_native_reference_candidate_v1', transactionId, buyerId: order.buyerId, sellerId: order.sellerId,
      ...refs, livemode: mode, attributionQualified: false, observedAt: Timestamp.now()}};
}

/** Intake derives only a conservative candidate from exact native references.
 * Neither metadata, a provider outage nor a signed reference supplies a UID. */
export async function readFraudSignalCandidate(tx: FirebaseFirestore.Transaction, refs: Data) {
  if (refs.platformReferenceQualified !== true || typeof refs.platformReferenceLivemode !== 'boolean') return {};
  const item = await uniqueNativeOrder(tx, refs.observedPaymentIntentId ?? refs.signedPaymentIntentId ?? null,
    refs.observedChargeId ?? refs.signedChargeId ?? null, undefined, refs.platformReferenceLivemode);
  return item ? projection(item.id, item.data, refs.platformReferenceLivemode) : {};
}

/** Reverse ordering: prepare BEFORE business writes, commit in the same TX as
 * the actual native PI write. This grants no capture/financial attribution. */
export async function prepareFraudCandidateProjection(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data) {
  const refs = references(order);
  const item = await uniqueNativeOrder(tx, refs.paymentIntentId, refs.chargeId, {transactionId, order});
  if (!item) return {commit() { /* An ambiguous relationship cannot select an actor. */ }};
  const page = await readFraudOrderCases(tx, transactionId, order);
  return {commit() {
    for (const doc of page.docs) {
      const data = doc.data();
      if (data.platformReferenceQualified === true && typeof data.platformReferenceLivemode === 'boolean' &&
          !(typeof order.stripeLivemode === 'boolean' && data.platformReferenceLivemode !== order.stripeLivemode) &&
          data.protocol === 'fraud_review_case_v1' && data.caseId === doc.id)
        tx.update(doc.ref, projection(transactionId, order, data.platformReferenceLivemode));
    }
  }};
}
