import { financialRecoverySourceFields } from "./financialRecoverySources";
import { FinancialRecoveryBlocked } from "./financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "./financialRecoverySources";
import { financialRecoveryWalletFields } from "./financialRecoverySources";
/** Native never-authorized work survives provider outages. One atomic first
 * authorization owns dispatch; every recovery after it only observes Stripe.
 * Neither a dead letter nor metadata creates the missing native authority. */
import {randomUUID, createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import {db, FieldValue} from '../config/firebase';
import {getStripe} from '../config/stripe';
import {hasActiveBankDispute} from './bankDispute';
import {qualifyManualSwapTopUpRefundSource} from './swapTopUpCheckout';

type Data = FirebaseFirestore.DocumentData;
type StripeClient = NonNullable<ReturnType<typeof getStripe>>;
export type SwapRefundOutcome = 'resolved' | 'pending' | 'reconciliation_required';
const own = (v: any, key: string) => v != null && Object.prototype.hasOwnProperty.call(v, key);
const cents = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const id = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('/') && v.length <= 200;
const piId = (v: unknown): v is string => typeof v === 'string' && /^pi_[A-Za-z0-9_]+$/.test(v);
const refundId = (v: unknown): v is string => typeof v === 'string' && /^re_[A-Za-z0-9_]+$/.test(v);
const objectId = (v: any): string | null => typeof v === 'string' ? v : typeof v?.id === 'string' ? v.id : null;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v, (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)).digest('hex');
const swapRef = (sid: string) => db.collection('swaps').doc(sid);
const intentRef = (sid: string) => swapRef(sid).collection('topup_refund').doc('current');
const workRef = (sid: string) => swapRef(sid).collection('topup_refund').doc('prepared');
type RefundSource = 'overpaid_capture' | 'cancelled_capture' | 'cancelled_native';
const queueRef = (sid: string) => db.collection('failed_operations').doc(`swap_topup_refund_${hash(sid)}`);

function parties(swap: Data) {
  if (!id(swap.initiatorId) || !id(swap.receiverId) || swap.initiatorId === swap.receiverId ||
      ![swap.initiatorId, swap.receiverId].includes(swap.cashTopUp?.payerId) ||
      !cents(swap.cashTopUp?.amount) || swap.cashTopUp.amount <= 0 || !piId(swap.topUpPaymentIntentId)) return null;
  const payerId = swap.cashTopUp.payerId as string;
  return {payerId, payeeId: payerId === swap.initiatorId ? swap.receiverId : swap.initiatorId,
    baseCents: swap.cashTopUp.amount as number, paymentIntentId: swap.topUpPaymentIntentId as string};
}

function providerPayment(pi: any, swap: Data) {
  const p = parties(swap), chargeId = objectId(pi?.latest_charge);
  if (!p || pi?.id !== p.paymentIntentId || pi.status !== 'succeeded' || pi.currency !== 'cad' ||
      !cents(pi.amount_received) || pi.amount_received <= 0 || !cents(pi.amount) || pi.amount_received !== pi.amount ||
      pi.transfer_data != null || pi.application_fee_amount != null && pi.application_fee_amount !== 0 ||
      !chargeId || !/^ch_[A-Za-z0-9_]+$/.test(chargeId)) return null;
  return {...p, chargeId, amountCents: pi.amount_received as number};
}
function qualifiedIntent(intent: Data | undefined, sid: string, swap: Data) {
  const p = parties(swap);
  if (!p || !intent || intent.protocol !== 'swap_topup_refund_v1' || intent.swapId !== sid ||
      intent.paymentIntentId !== p.paymentIntentId || intent.payerId !== p.payerId || intent.payeeId !== p.payeeId ||
      intent.baseCents !== p.baseCents || !cents(intent.amountCents) || intent.amountCents <= 0 ||
      !(intent.authorizedAt instanceof Timestamp) || !(intent.postAuthorizedAt instanceof Timestamp) ||
      !id(intent.dispatchOwner) || intent.idempotencyKey !== `rf_swap_${sid}` ||
      intent.bodyHash !== hash(intent.body) || intent.body?.payment_intent !== p.paymentIntentId ||
      intent.body?.amount !== intent.amountCents ||
      hash(intent.body) !== hash({payment_intent: p.paymentIntentId, amount: intent.amountCents,
        metadata: {type: 'swap_topup_refund', swapId: sid, nativeIntent: intent.intentId}}) ||
      intent.intentId !== hash([sid, p.paymentIntentId, p.payerId, p.payeeId, intent.amountCents, 'swap_topup_refund_v1']) ||
      swap.topUpRefundIntentId !== intent.intentId ||
      !['dispatching', 'pending', 'reconciliation_required', 'succeeded'].includes(intent.state) ||
      intent.authorizedAt.toMillis() > Date.now() || intent.postAuthorizedAt.toMillis() < intent.authorizedAt.toMillis()) return null;
  return intent;
}
function bankUnknown(swap: Data) {
  return hasActiveBankDispute(swap) || own(swap, 'bankRefundReconciliation') || swap.refundedVia === 'chargeback' ||
    swap.bankDispute?.outcome === 'lost' || own(swap, 'disputed') && typeof swap.disputed !== 'boolean';
}

/** Current swap-linked movements select ONE bucket. An aggregate wallet never
 * proves attribution, and an absent credit never proves no credit occurred. */
async function debitPlan(tx: FirebaseFirestore.Transaction, sid: string, swap: Data, intent: Data) {
  const walletRef = db.collection('wallets').doc(intent.payeeId), wallet = (await tx.get(walletRef)).data();
  const rows = await tx.get(walletRef.collection('ledger').where('swapId', '==', sid).limit(101));
  if (rows.size > 100) return null;
  const entries = rows.docs.map(doc => ({id: doc.id, data: doc.data()}));
  const settlement = swap.topUpSettlement;
  if (settlement?.protocol === 'swap_topup_settlement_v1' && settlement.state === 'not_credited' &&
      settlement.swapId === sid && settlement.paymentIntentId === intent.paymentIntentId &&
      settlement.payerId === intent.payerId && settlement.payeeId === intent.payeeId &&
      settlement.baseCents === intent.baseCents && settlement.capturedCents === intent.amountCents &&
      settlement.recordedAt instanceof Timestamp && entries.length === 0 &&
      !own(swap, 'topUpFundsHeldAt') && !own(swap, 'topUpReleasedAt')) return {kind: 'not_credited' as const};
  if (!wallet || wallet.currency?.toUpperCase?.() !== 'CAD' || !(swap.topUpPaidAt instanceof Timestamp) ||
      entries.some(row => !cents(row.data.amount) || row.data.amount <= 0 || !(row.data.createdAt instanceof Timestamp) ||
        row.data.currency != null && row.data.currency?.toUpperCase?.() !== 'CAD')) return null;
  const credits = entries.filter(row => row.data.type === 'sale_credit');
  const held = entries.filter(row => row.data.type === 'funds_held');
  const released = entries.filter(row => row.data.type === 'funds_released');
  const debits = entries.filter(row => row.data.type === 'refund_debit');
  if (debits.length || entries.some(row => !['sale_credit', 'funds_held', 'funds_released'].includes(row.data.type)) ||
      credits.length !== 1 || credits[0].data.amount !== intent.baseCents ||
      !credits[0].data.createdAt.isEqual(swap.topUpPaidAt) ||
      credits[0].data.paymentIntentId != null && credits[0].data.paymentIntentId !== intent.paymentIntentId) return null;
  // No cascade into another sale's pending/held money; a released source needs
  // the separate payout/debt reconciliation and remains explicitly unresolved.
  if (own(swap, 'topUpReleasedAt') || released.length) return null;
  let bucket: 'pendingBalance' | 'heldBalance';
  if (!own(swap, 'topUpFundsHeldAt') && !held.length) bucket = 'pendingBalance';
  else if (swap.topUpFundsHeldAt instanceof Timestamp && held.length === 1 && held[0].data.amount === intent.baseCents &&
      held[0].data.createdAt.isEqual(swap.topUpFundsHeldAt)) bucket = 'heldBalance';
  else return null;
  if (!cents(wallet[bucket]) || wallet[bucket] < intent.baseCents) return null;
  return {kind: 'debit' as const, walletRef, wallet, bucket, creditLedgerId: credits[0].id};
}

async function review(sid: string, paymentIntentId: string, reason: string, observed: Data = {}) {
  const ref = db.collection('admin_alerts').doc(`swap_refund_${hash([sid, paymentIntentId, reason])}`);
  await db.runTransaction(async tx => {
    const prior = await tx.get(ref);
    if (!prior.exists) tx.create(ref, {kind: 'swap_topup_refund_reconciliation', severity: 'critical', refId: sid,
      message: 'Rapprocher le remboursement du complément et ses mouvements natifs. Aucune nouvelle demande de fonds n’est autorisée.',
      context: {paymentIntentId, reason, ...observed}, status: 'open', createdAt: FieldValue.serverTimestamp()});
  });
  return 'reconciliation_required' as const;
}

async function settle(sid: string, intent: Data, refund: any, pi: any): Promise<SwapRefundOutcome> {
  return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const ref = swapRef(sid), swap = (await tx.get(ref)).data(), current = (await tx.get(intentRef(sid))).data();
    const committed = (await tx.get(ref.collection('topup_refund').doc('committed'))).data();
    if (!swap || !qualifiedIntent(current, sid, swap) || current!.intentId !== intent.intentId ||
        current!.bodyHash !== intent.bodyHash || !providerPayment(pi, swap) ||
        pi.amount_received !== intent.amountCents || objectId(pi.latest_charge) !== intent.chargeId) return 'reconciliation_required';
    if (committed) return committed.protocol === 'swap_topup_refund_committed_v1' && committed.intentId === intent.intentId &&
      committed.refundId === refund.id && committed.amountCents === intent.amountCents && committed.recordedAt instanceof Timestamp &&
      current!.state === 'succeeded' && current!.refundId === refund.id && swap.topUpRefundId === refund.id &&
      swap.topUpRefundedAt instanceof Timestamp && swap.topUpRefundReconciledAt instanceof Timestamp ? 'resolved' : 'reconciliation_required';
    if (current!.refundId != null && current!.refundId !== refund.id || own(swap, 'topUpRefundId') && swap.topUpRefundId !== refund.id)
      return 'reconciliation_required';
    const retainObservation = async () => {
      tx.update(intentRef(sid), await financialRecoverySourceFields('swap_topup',intentRef(sid),current!,{refundId: refund.id, state: 'reconciliation_required', providerStatus: refund.status ?? 'unknown',
        observedAt: FieldValue.serverTimestamp()}));
      tx.update(ref, {topUpRefundId: refund.id, updatedAt: FieldValue.serverTimestamp()});
    };
    if (bankUnknown(swap)) {await retainObservation(); return 'reconciliation_required';}
    if (refund.status !== 'succeeded') {
      await recoveryCommit({refs: [(intentRef(sid)).path]});
    tx.update(intentRef(sid), await financialRecoverySourceFields('swap_topup',intentRef(sid),current!,{refundId: refund.id, state: refund.status === 'pending' || refund.status === 'requires_action' ? 'pending' : 'reconciliation_required',
        providerStatus: refund.status ?? 'unknown', observedAt: FieldValue.serverTimestamp()}));
      await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('swap',ref,swap,{topUpRefundId: refund.id, updatedAt: FieldValue.serverTimestamp()}));
      return refund.status === 'pending' || refund.status === 'requires_action' ? 'pending' : 'reconciliation_required';
    }
    const plan = await debitPlan(tx, sid, swap, intent);
    if (!plan || own(swap, 'topUpRefundReconciledAt') || own(swap, 'topUpRefundedAt') ||
        own(swap, 'topUpRefundId') && swap.topUpRefundId !== refund.id) {retainObservation(); return 'reconciliation_required';}
    const debitId = `swap_refund_${intent.intentId}`;
    const debit = plan.kind === 'debit' ? await tx.get(plan.walletRef.collection('ledger').doc(debitId)) : null;
    if (debit?.exists) return 'reconciliation_required';
    const now = Timestamp.now();
    if (plan.kind === 'debit') {
      await recoveryCommit({refs: [(plan.walletRef).path]});
    tx.update(plan.walletRef, await financialRecoveryWalletFields(plan.walletRef,plan.wallet,{[plan.bucket]: FieldValue.increment(-intent.baseCents), updatedAt: now},{[plan.bucket]: ((plan.wallet)[plan.bucket]??0) + (-intent.baseCents)}));
      await recoveryCommit({refs: [(plan.walletRef.collection('ledger').doc(debitId)).path]});
    tx.create(plan.walletRef.collection('ledger').doc(debitId), {type: 'refund_debit', currency: 'CAD', amount: intent.baseCents,
        balanceAfter: plan.wallet[plan.bucket] - intent.baseCents, bucket: plan.bucket, swapId: sid, paymentIntentId: intent.paymentIntentId,
        refundId: refund.id, nativeIntentId: intent.intentId, creditLedgerId: plan.creditLedgerId,
        description: 'Remboursement complément d’échange — débit attribué', createdAt: now});
    }
    await recoveryCommit({refs: [(ref.collection('topup_refund').doc('committed')).path]});
    tx.create(ref.collection('topup_refund').doc('committed'), {protocol: 'swap_topup_refund_committed_v1', swapId: sid,
      intentId: intent.intentId, paymentIntentId: intent.paymentIntentId, refundId: refund.id, amountCents: intent.amountCents,
      payerId: intent.payerId, payeeId: intent.payeeId, baseCents: intent.baseCents,
      debitLedgerId: plan.kind === 'debit' ? debitId : null, debitState: plan.kind, recordedAt: now});
    await recoveryCommit({refs: [(intentRef(sid)).path]});
    tx.update(intentRef(sid), await financialRecoverySourceFields('swap_topup',intentRef(sid),current!,{state: 'succeeded', providerStatus: 'succeeded', refundId: refund.id, reconciledAt: now, observedAt: now}));
    await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('swap',ref,swap,{topUpRefundId: refund.id, topUpRefundedAt: now, topUpRefundReconciledAt: now, stripeRefundId: refund.id, updatedAt: now}));
    return 'resolved';
  });
}

/** All provider Refund fields are compared to native intent, never the event. */
function exactRefund(refund: any, intent: Data) {
  return refundId(refund?.id) && objectId(refund.payment_intent) === intent.paymentIntentId &&
    objectId(refund.charge) === intent.chargeId && refund.amount === intent.amountCents && refund.currency === 'cad' &&
    hash(refund.metadata ?? {}) === hash(intent.body.metadata) &&
    Number.isSafeInteger(refund.created) && refund.created * 1000 >= intent.authorizedAt.toMillis() - 1000;
}
async function currentCharge(stripe: StripeClient, pi: any, expectedAmount: number) {
  const chargeId = objectId(pi.latest_charge);
  if (!chargeId) return null;
  const charge = await stripe.charges.retrieve(chargeId);
  return charge.id === chargeId && objectId(charge.payment_intent) === pi.id && charge.currency === 'cad' &&
    charge.amount === expectedAmount && charge.captured === true && charge.paid === true && charge.disputed === false &&
    charge.transfer_data == null && (charge.application_fee_amount == null || charge.application_fee_amount === 0) ? charge : null;
}

/** Public internal recovery entry. Flags OFF do not erase a committed intent.
 * No POST occurs here, including when the prior request outcome is unknown. */
export async function observeSwapTopUpRefund(sid: string, expectedPi?: string, eventRefundId?: string,
  client?: StripeClient): Promise<SwapRefundOutcome> {
  if (!id(sid)) return 'reconciliation_required';
  const swap = (await swapRef(sid).get()).data(), intent = (await intentRef(sid).get()).data();
  const p = swap && parties(swap);
  if (!p || expectedPi && expectedPi !== p.paymentIntentId) return 'reconciliation_required';
  const stripe = client ?? getStripe();
  if (!stripe) return 'pending';
  const pi = await stripe.paymentIntents.retrieve(p.paymentIntentId);
  const payment = providerPayment(pi, swap!);
  if (!payment) return review(sid, p.paymentIntentId, 'provider_payment_identity_unqualified');
  if (!await currentCharge(stripe, pi, payment.amountCents)) return review(sid, p.paymentIntentId, 'provider_charge_or_bank_obligation_unqualified');
  const native = qualifiedIntent(intent, sid, swap!);
  // Historical body/authority unknown: current GET/list evidence is retained,
  // but cannot be turned into a new command, local debit or terminal receipt.
  if (!native) {
    const listed = await stripe.refunds.list({payment_intent: p.paymentIntentId, limit: 100});
    return review(sid, p.paymentIntentId, 'legacy_native_intention_unknown', {
      refundIds: listed.data.map(r => r.id), saturated: listed.has_more,
      statuses: listed.data.map(r => r.status ?? 'unknown'), eventRefundId: eventRefundId ?? null});
  }
  let refund: any;
  if (native.refundId != null) {
    if (!refundId(native.refundId) || eventRefundId && eventRefundId !== native.refundId)
      return review(sid, p.paymentIntentId, 'refund_identity_conflict');
    refund = await stripe.refunds.retrieve(native.refundId);
  } else {
    const listed = await stripe.refunds.list({payment_intent: p.paymentIntentId, limit: 100});
    const matches = listed.data.filter(r => exactRefund(r, native));
    if (listed.has_more || matches.length !== 1 || listed.data.length !== 1 || eventRefundId && matches[0]?.id !== eventRefundId)
      return review(sid, p.paymentIntentId, 'refund_outcome_unknown', {refundIds: listed.data.map(r => r.id), saturated: listed.has_more});
    // List data is not the final observation: retrieve the exact current object.
    refund = await stripe.refunds.retrieve(matches[0].id);
  }
  if (!exactRefund(refund, native)) return review(sid, p.paymentIntentId, 'refund_provider_fields_diverged', {refundId: refund?.id ?? null});
  const result = await settle(sid, native, refund, pi);
  if (result === 'reconciliation_required') await review(sid, p.paymentIntentId, 'refund_or_local_settlement_unqualified',
    {refundId: refund.id, providerStatus: refund.status ?? 'unknown'});
  return result;
}

/** A source receipt, never the queue payload, identifies the native event that
 * requested the refund. This proof is frozen before the first provider access. */
function preparationSource(sid: string, swap: Data, source: RefundSource, expectedPi: string) {
  const p = parties(swap);
  if (!p || p.paymentIntentId !== expectedPi ||
      !(cents(swap.topUpFee ?? 0) && cents(swap.topUpTax ?? 0))) return null;
  if (source === 'cancelled_native') {
    if (swap.status !== 'cancelled' || swap.cancelReason !== 'cancelled_by_initiator' || !(swap.topUpPaidAt instanceof Timestamp)) return null;
    return {source, swapId: sid, ...p, cancelReason: swap.cancelReason, paidAt: swap.topUpPaidAt};
  }
  const receipt = swap.topUpSettlement;
  if (!['overpaid_capture', 'cancelled_capture'].includes(source) || receipt?.protocol !== 'swap_topup_settlement_v1' ||
      receipt.state !== 'not_credited' || receipt.source !== source || receipt.swapId !== sid ||
      receipt.paymentIntentId !== expectedPi || receipt.payerId !== p.payerId || receipt.payeeId !== p.payeeId ||
      receipt.baseCents !== p.baseCents || !cents(receipt.capturedCents) || receipt.capturedCents <= 0 ||
      !(receipt.recordedAt instanceof Timestamp) ||
      source === 'cancelled_capture' && !['cancelled', 'declined', 'expired', 'disputed'].includes(swap.status)) return null;
  return {source, swapId: sid, ...p, receipt};
}
function workContent(work: Data) {
  return {protocol: work.protocol, swapId: work.swapId, paymentIntentId: work.paymentIntentId,
    payerId: work.payerId, payeeId: work.payeeId, baseCents: work.baseCents, source: work.source,
    sourceProofHash: work.sourceProofHash, workId: work.workId, preparedAt: work.preparedAt};
}
function qualifiedWork(work: Data | undefined, sid: string, swap: Data) {
  if (!work || work.protocol !== 'swap_topup_refund_preparation_v1' || work.swapId !== sid ||
      work.state !== 'never_authorized' || !(work.preparedAt instanceof Timestamp) || work.preparedAt.toMillis() > Date.now() ||
      ['authorizedAt', 'postAuthorizedAt', 'dispatchOwner', 'body', 'bodyHash', 'intentId'].some(key => own(work, key)) ||
      work.contentHash !== hash(workContent(work)) || swap.topUpRefundPreparationId !== work.workId) return null;
  const proof = preparationSource(sid, swap, work.source, work.paymentIntentId), p = parties(swap);
  return proof && p && work.payerId === p.payerId && work.payeeId === p.payeeId && work.baseCents === p.baseCents &&
    work.sourceProofHash === hash(proof) &&
    work.workId === hash([sid, p.paymentIntentId, p.payerId, p.payeeId, p.baseCents, work.sourceProofHash, work.protocol]) ? work : null;
}
function qualifiedWorkQueue(queue: Data | undefined, sid: string, work: Data) {
  return queue?.protocol === 'swap_topup_refund_work_queue_v1' && queue.refId === sid && queue.type === 'stripe_refund_failed' &&
    queue.nativeWorkId === work.workId && queue.payload?.kind === 'swap_topup_native_refund' &&
    queue.payload?.paymentIntentId === work.paymentIntentId && queue.payload?.nativeWorkId === work.workId;
}

/** Native initiators alone may create this never-authorized work. It is durable
 * before getStripe/GET and has no request body or provider dispatch permission. */
async function prepareWork(sid: string, source: RefundSource, expectedPi: string) {
  return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const ref = swapRef(sid), swap = (await tx.get(ref)).data();
    const intent = (await tx.get(intentRef(sid))).data(), workSnapshot=await tx.get(workRef(sid)), prior=workSnapshot.data();
    if (intent) return true; // Authorized history is observed, never re-prepared.
    if (!swap) return false;
    const queue = (await tx.get(queueRef(sid))).data();
    if (prior) return !!qualifiedWork(prior, sid, swap) && qualifiedWorkQueue(queue, sid, prior);
    if (queue || ['topUpRefundPreparationId', 'topUpRefundIntentId', 'topUpRefundId', 'topUpRefundedAt',
      'topUpRefundReconciledAt', 'stripeRefundId'].some(key => own(swap, key))) return false;
    const proof = preparationSource(sid, swap, source, expectedPi), p = parties(swap);
    if (!proof || !p) return false;
    const legacyQueue = await tx.get(db.collection('failed_operations').where('refId', '==', sid).limit(101));
    if (legacyQueue.size > 100 || legacyQueue.docs.some(doc => doc.data().type === 'stripe_refund_failed' ||
        doc.data().payload?.idempotencyKey === `rf_swap_${sid}`)) return false;
    const now = Timestamp.now(), protocol = 'swap_topup_refund_preparation_v1', sourceProofHash = hash(proof);
    const workId = hash([sid, expectedPi, p.payerId, p.payeeId, p.baseCents, sourceProofHash, protocol]);
    const work = {protocol, swapId: sid, ...p, source, sourceProofHash, workId, preparedAt: now, state: 'never_authorized'};
    await recoveryCommit({refs: [(workRef(sid)).path]});
    tx.create(workRef(sid), await financialRecoverySourceFields('swap_topup',workRef(sid),workSnapshot,{...work,contentHash:hash(workContent(work))}));
    await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('swap',ref,swap,{topUpRefundPreparationId: workId, updatedAt: now}));
    await recoveryCommit({refs: [(queueRef(sid)).path]});
    tx.create(queueRef(sid), {protocol: 'swap_topup_refund_work_queue_v1', nativeWorkId: workId,
      type: 'stripe_refund_failed', refId: sid, payload: {kind: 'swap_topup_native_refund', paymentIntentId: expectedPi, nativeWorkId: workId},
      attempts: 0, status: 'pending', createdAt: now, lastTriedAt: null, error: 'Native refund first authorization pending'});
    return true;
  });
}

/** Queue replay can authorize the FIRST request only from this exact native
 * never-authorized work. Once current exists, every path is GET-only forever. */
export async function resumeSwapTopUpRefund(sid: string, expectedPi: string, client?: StripeClient): Promise<SwapRefundOutcome> {
  if (!id(sid) || !piId(expectedPi)) return 'reconciliation_required';
  if ((await intentRef(sid).get()).exists) return observeSwapTopUpRefund(sid, expectedPi, undefined, client);
  const prepared = await db.runTransaction(async tx => {
    const swap = (await tx.get(swapRef(sid))).data(), work = (await tx.get(workRef(sid))).data();
    const queue = (await tx.get(queueRef(sid))).data();
    return swap && qualifiedWork(work, sid, swap) && work!.paymentIntentId === expectedPi && qualifiedWorkQueue(queue, sid, work!) ? work! : null;
  });
  if (!prepared) return observeSwapTopUpRefund(sid, expectedPi, undefined, client);
  const stripe = client ?? getStripe();
  if (!stripe) return 'pending';
  let pi: any;
  try {
    pi = await stripe.paymentIntents.retrieve(expectedPi);
    if (!cents(pi.amount_received) || !await currentCharge(stripe, pi, pi.amount_received))
      return review(sid, expectedPi, 'provider_charge_or_bank_obligation_unqualified');
    const listed = await stripe.refunds.list({payment_intent: expectedPi, limit: 100});
    if (listed.has_more || listed.data.length) return observeSwapTopUpRefund(sid, expectedPi, undefined, stripe);
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    logger.warn('Swap top-up refund first authorization waits for provider observation', {swapId: sid,
      paymentIntentId: expectedPi, error: error instanceof Error ? error.message : String(error)});
    return 'pending';
  }
  const owner = randomUUID();
  const first = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const ref = swapRef(sid), swap = (await tx.get(ref)).data(), intentSnapshot=await tx.get(intentRef(sid)), current=intentSnapshot.data();
    const work = (await tx.get(workRef(sid))).data(), queue = (await tx.get(queueRef(sid))).data();
    if (current) return null;
    const payment = swap && providerPayment(pi, swap);
    if (!swap || !payment || payment.paymentIntentId !== expectedPi || !qualifiedWork(work, sid, swap) ||
        work!.contentHash !== prepared.contentHash || !qualifiedWorkQueue(queue, sid, work!) || bankUnknown(swap) ||
        ['topUpRefundId', 'topUpRefundedAt', 'topUpRefundReconciledAt', 'stripeRefundId', 'topUpRefundIntentId'].some(key => own(swap, key))) return null;
    const manual = (await tx.get(ref.collection('topup_checkout').doc('current'))).exists ||
      swap.topUpCheckoutProtocol === 'swap_server_manual_v1' || pi.metadata?.swapCheckoutIntentId != null;
    if (manual && !await qualifyManualSwapTopUpRefundSource(tx, sid, swap, pi)) return null;
    const expected = payment.baseCents + (swap.topUpFee ?? 0) + (swap.topUpTax ?? 0);
    if (work!.source === 'overpaid_capture' && payment.amountCents - expected <= 1) return null;
    const legacyQueue = await tx.get(db.collection('failed_operations').where('refId', '==', sid).limit(101));
    if (legacyQueue.size > 100 || legacyQueue.docs.some(doc => doc.id !== queueRef(sid).id &&
        (doc.data().type === 'stripe_refund_failed' || doc.data().payload?.idempotencyKey === `rf_swap_${sid}`))) return null;
    const nativeId = hash([sid, expectedPi, payment.payerId, payment.payeeId, payment.amountCents, 'swap_topup_refund_v1']);
    const body = {payment_intent: expectedPi, amount: payment.amountCents,
      metadata: {type: 'swap_topup_refund', swapId: sid, nativeIntent: nativeId}};
    const now = Timestamp.now();
    const intent = {protocol: 'swap_topup_refund_v1', swapId: sid, ...payment, intentId: nativeId, body, bodyHash: hash(body),
      idempotencyKey: `rf_swap_${sid}`, source: work!.source, nativeWorkId: work!.workId, dispatchOwner: owner,
      authorizedAt: now, postAuthorizedAt: now, refundId: null, state: 'dispatching'};
    if (!await debitPlan(tx, sid, swap, intent)) return null;
    await recoveryCommit({refs: [(intentRef(sid)).path]});
    tx.create(intentRef(sid), await financialRecoverySourceFields('swap_topup',intentRef(sid),intentSnapshot,intent));
    await recoveryCommit({refs: [(workRef(sid)).path]});
    tx.update(workRef(sid), await financialRecoverySourceFields('swap_topup',workRef(sid),work!,{state:'authorized',intentId:nativeId,authorizedAt:now}));
    await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('swap',ref,swap,{topUpRefundIntentId: nativeId, updatedAt: now}));
    await recoveryCommit({refs: [(queueRef(sid)).path]});
    tx.update(queueRef(sid), {payload: {...queue!.payload, nativeIntentId: nativeId}, error: 'Native refund observation pending'});
    return intent;
  });
  if (!first) return observeSwapTopUpRefund(sid, expectedPi, undefined, stripe);
  try {
    const refund = await stripe.refunds.create(first.body, {idempotencyKey: first.idempotencyKey});
    if (!refundId(refund.id)) throw new Error('Provider refund ID unknown');
    await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const current = (await tx.get(intentRef(sid))).data();
      if (!current || current.dispatchOwner !== owner || current.bodyHash !== first.bodyHash ||
          current.refundId != null && current.refundId !== refund.id) return;
      await recoveryCommit({refs: [(intentRef(sid)).path]});
    tx.update(intentRef(sid), await financialRecoverySourceFields('swap_topup',intentRef(sid),current!,{refundId: refund.id, observedAt: FieldValue.serverTimestamp()}));
    });
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    logger.error('Swap top-up refund outcome requires current provider observation', {swapId: sid, paymentIntentId: expectedPi,
      error: error instanceof Error ? error.message : String(error)});
  }
  return observeSwapTopUpRefund(sid, expectedPi, undefined, stripe);
}

/** Only the original three native callers can create a first preparation. A
 * legacy queue can call resume, but can never create its missing authority. */
export async function requestSwapTopUpRefund(sid: string, source: RefundSource, expectedPi: string): Promise<SwapRefundOutcome> {
  if (!id(sid) || !piId(expectedPi)) return 'reconciliation_required';
  if (!await prepareWork(sid, source, expectedPi)) return observeSwapTopUpRefund(sid, expectedPi);
  return resumeSwapTopUpRefund(sid, expectedPi);
}
