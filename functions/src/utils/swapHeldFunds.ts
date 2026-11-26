/** Native swap-linked movements, never a residual of an aggregate wallet. */
import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';

type Data = FirebaseFirestore.DocumentData;
export type SwapHoldReason = 'commercial_dispute' | 'financial_source_reconciliation' |
  'reception_source_reconciliation' | 'hold_clock_unqualified';
const REASONS = new Set<SwapHoldReason>(['commercial_dispute', 'financial_source_reconciliation',
  'reception_source_reconciliation', 'hold_clock_unqualified']);
export const ACTIVE_SWAP_HOLD_STATUSES = ['completed', 'disputed'] as const;
const id = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('/') && v !== '.' && v !== '..' && Buffer.byteLength(v) <= 1500;
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const cad = (v: unknown) => typeof v === 'string' && v.toUpperCase() === 'CAD';
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)).digest('hex');
const ms = (v: unknown, nowMs: number): number | null => {
  const n = v instanceof Timestamp ? v.toMillis() : NaN;
  return Number.isFinite(n) && n >= 0 && n <= nowMs ? n : null;
};
const iso = (v: number | null) => v === null ? null : new Date(v).toISOString();
const own = (data: Data, key: string) => Object.prototype.hasOwnProperty.call(data, key);
const timestampKey = (v: Timestamp) => [v.seconds, v.nanoseconds];

export type SwapHoldPublicSource = {
  state: 'no_topup' | 'held' | 'release_recorded' | 'review_required';
  reason: SwapHoldReason | null; amountCents: number | null; currency: 'CAD';
  amountBasis: 'observed_swap_hold' | 'recorded_swap_release';
  financialQualification: 'native_linked_movements' | 'unknown';
  releaseReceiptQualification: 'native_receipt' | 'legacy_linked_movement' | 'unknown';
  startedAt: string | null; initialDeadlineAt: string | null;
  startQualification: 'native_timestamp' | 'unknown'; deadlineQualification: 'native_timestamp' | 'unknown';
  deadlineState: 'future' | 'elapsed' | 'unknown'; bothReceptionsAt: string | null;
  receptionsQualification: 'native_participant_confirmations' | 'unknown';
};
type MoneyPlan = {walletRef: FirebaseFirestore.DocumentReference; wallet: Data; payeeId: string; payerId: string;
  amountCents: number; creditLedgerId: string; heldLedgerId: string};

/** A reception may move only the pending credit attributed to THIS exchange.
 * An aggregate balance or a paid marker alone never proves that attribution.
 * All reads precede the caller's inventory, wallet and swap writes. */
export async function readPendingSwapTopUp(tx: FirebaseFirestore.Transaction, swapId: string, data: Data, now: Timestamp) {
  const financialHint = Object.keys(data).some(key => /^topup|^refund/i.test(key) ||
    ['stripeRefundId', 'stripePaymentIntentId', 'paymentIntentId', 'bankDispute'].includes(key));
  if (data.cashTopUp == null && !financialHint) return null;
  const refuse = (): never => { throw new HttpsError('failed-precondition',
    'Le règlement du complément doit être vérifié avant de terminer cet échange.', {reason: 'swap_topup_credit_unqualified'}); };
  const topUp = data.cashTopUp, paidMs = ms(data.topUpPaidAt, now.toMillis());
  if (!id(data.initiatorId) || !id(data.receiverId) || data.initiatorId === data.receiverId ||
      !topUp || !cents(topUp.amount) || topUp.amount <= 0 || ![data.initiatorId, data.receiverId].includes(topUp.payerId) ||
      paidMs === null || !/^pi_[A-Za-z0-9_]+$/.test(data.topUpPaymentIntentId ?? '') ||
      Object.keys(data).some(key => /^topup(refund|fundsheld|fundsrelease|released)|^refund/i.test(key) ||
        ['stripeRefundId', 'bankDispute'].includes(key))) return refuse();
  const payeeId = topUp.payerId === data.initiatorId ? data.receiverId : data.initiatorId;
  const walletRef = db.collection('wallets').doc(payeeId), wallet = (await tx.get(walletRef)).data();
  if (!wallet || !cad(wallet.currency) || !cents(wallet.pendingBalance) || wallet.pendingBalance < topUp.amount ||
      !cents(wallet.heldBalance) || !cents(wallet.balance) || !cents(wallet.heldBalance + topUp.amount)) return refuse();
  const ledger = await tx.get(walletRef.collection('ledger').where('swapId', '==', swapId).limit(101));
  if (ledger.size !== 1) return refuse();
  const credit = ledger.docs[0].data();
  if (credit.type !== 'sale_credit' || credit.swapId !== swapId || credit.amount !== topUp.amount ||
      credit.currency != null && !cad(credit.currency) || !(credit.createdAt instanceof Timestamp) ||
      !credit.createdAt.isEqual(data.topUpPaidAt) || credit.paymentIntentId != null && credit.paymentIntentId !== data.topUpPaymentIntentId) return refuse();
  return {walletRef, wallet, amountCents: topUp.amount as number, payeeId: payeeId as string,
    paymentIntentId: data.topUpPaymentIntentId as string, creditLedgerId: ledger.docs[0].id};
}

/** All facts are re-read in the caller's TX. Unknown evidence never authorizes a debit. */
export async function readSwapHoldSource(tx: FirebaseFirestore.Transaction, swapId: string, data: Data, now: Timestamp) {
  const nowMs = now.toMillis(), topUp = data.cashTopUp;
  const startMs = ms(data.topUpFundsHeldAt, nowMs), first = ms(data.initiatorReceivedAt, nowMs), second = ms(data.receiverReceivedAt, nowMs);
  const partiesQualified = id(data.initiatorId) && id(data.receiverId) && data.initiatorId !== data.receiverId;
  const bothMs = !partiesQualified || first === null || second === null ? null : Math.max(first, second);
  const rawEnd = data.topUpFundsReleaseAt instanceof Timestamp ? data.topUpFundsReleaseAt.toMillis() : NaN;
  const endMs = Number.isFinite(rawEnd) && rawEnd >= 0 && (startMs === null || rawEnd >= startMs) ? rawEnd : null;
  const source: SwapHoldPublicSource = {state: 'review_required', reason: 'financial_source_reconciliation', amountCents: null,
    currency: 'CAD', amountBasis: 'observed_swap_hold', startedAt: iso(startMs), initialDeadlineAt: iso(endMs),
    financialQualification: 'unknown', releaseReceiptQualification: 'unknown',
    startQualification: startMs === null ? 'unknown' : 'native_timestamp', deadlineQualification: endMs === null ? 'unknown' : 'native_timestamp',
    deadlineState: endMs === null ? 'unknown' : endMs > nowMs ? 'future' : 'elapsed', bothReceptionsAt: iso(bothMs),
    receptionsQualification: bothMs === null ? 'unknown' : 'native_participant_confirmations'};
  const result = (plan: MoneyPlan | null = null) => ({source, plan, releaseReady: plan !== null && source.state === 'held' &&
    source.deadlineState === 'elapsed' && data.status === 'completed'});
  // Missing cashTopUp never erases a previous payment/refund/clock witness.
  // Presence, even malformed or null, calls for reconciliation, not a value,
  // a debt or proof that money is currently held.
  const financialHint = Object.keys(data).some(key => /^topup/i.test(key) || /^refund/i.test(key) ||
    ['stripeRefundId', 'stripePaymentIntentId', 'paymentIntentId', 'stripeChargeId', 'chargeId'].includes(key));
  if (topUp == null && !financialHint) {
    const [release, review] = await tx.getAll(
      db.collection('swaps').doc(swapId).collection('topup_release').doc('committed'),
      db.collection('swaps').doc(swapId).collection('swap_hold_reviews').doc('latest'));
    if (!release.exists && !review.exists) {source.state = 'no_topup'; source.reason = null;}
    return result();
  }
  if (!id(data.initiatorId) || !id(data.receiverId) || data.initiatorId === data.receiverId ||
      !topUp || !cents(topUp.amount) || topUp.amount <= 0 || ![data.initiatorId, data.receiverId].includes(topUp.payerId)) return result();
  const payerId = topUp.payerId as string, payeeId = payerId === data.initiatorId ? data.receiverId as string : data.initiatorId as string;
  const walletRef = db.collection('wallets').doc(payeeId), wallet = (await tx.get(walletRef)).data();
  if (!wallet || !cad(wallet.currency)) return result();
  const ledger = await tx.get(walletRef.collection('ledger').where('swapId', '==', swapId).limit(101));
  if (ledger.size > 100) return result();
  const entries = ledger.docs.map(doc => ({id: doc.id, data: doc.data()}));
  const validMovement = (row: typeof entries[number]) => row.data.swapId === swapId && cents(row.data.amount) && row.data.amount > 0 &&
    ms(row.data.createdAt, nowMs) !== null && (row.data.currency == null || cad(row.data.currency));
  const credits = entries.filter(row => row.data.type === 'sale_credit'), held = entries.filter(row => row.data.type === 'funds_held');
  const releases = entries.filter(row => row.data.type === 'funds_released');
  const nativeRelease = (await tx.get(db.collection('swaps').doc(swapId).collection('topup_release').doc('committed'))).data();
  // A real recorded movement precedes today's missing clock or receptions.
  // A marker alone, a zero movement, or a partial/ambiguous movement is never completion.
  const nativeReleased = releases.length === 1 && validMovement(releases[0]) && releases[0].data.amount === topUp.amount &&
    nativeRelease?.protocol === 'swap_topup_release_v1' && nativeRelease.swapId === swapId &&
      nativeRelease.initiatorId === data.initiatorId && nativeRelease.receiverId === data.receiverId &&
      nativeRelease.payerId === payerId && nativeRelease.payeeId === payeeId && nativeRelease.amountCents === topUp.amount &&
      nativeRelease.currency === 'CAD' && nativeRelease.releaseLedgerId === releases[0].id &&
      nativeRelease.sourceVersion instanceof Timestamp && id(nativeRelease.creditLedgerId) && id(nativeRelease.heldLedgerId) &&
      nativeRelease.recordedAt instanceof Timestamp && nativeRelease.recordedAt.isEqual(releases[0].data.createdAt) &&
      nativeRelease.sourceVersion.toMillis() <= nativeRelease.recordedAt.toMillis();
  const legacyReleased = nativeRelease == null && releases.length === 1 && validMovement(releases[0]) && releases[0].data.amount === topUp.amount &&
     credits.length === 1 && validMovement(credits[0]) && credits[0].data.amount === topUp.amount && ms(data.topUpPaidAt, nowMs) !== null &&
      credits[0].data.createdAt.isEqual(data.topUpPaidAt) && data.topUpReleasedAt instanceof Timestamp &&
      data.topUpReleasedAt.isEqual(releases[0].data.createdAt);
  if (nativeReleased || legacyReleased) {
    source.state = 'release_recorded'; source.reason = null; source.amountCents = topUp.amount; source.amountBasis = 'recorded_swap_release';
    source.financialQualification = 'native_linked_movements';
    source.releaseReceiptQualification = nativeReleased ? 'native_receipt' : 'legacy_linked_movement';
    return result();
  }
  // Historical linked releases above remain readable. For a NEW release,
  // a present but malformed dispute flag is unknown, never false/absent.
  if (own(data, 'disputed') && typeof data.disputed !== 'boolean') return result();
  if (entries.some(row => !validMovement(row))) return result();
  if (nativeRelease != null || own(data, 'topUpReleasedAt') || releases.length > 0 ||
      entries.some(row => !['sale_credit', 'funds_held'].includes(row.data.type)) ||
      ['topUpRefundPreparationId', 'topUpRefundIntentId', 'topUpRefundId', 'topUpRefundedAt', 'topUpRefundReconciledAt', 'stripeRefundId'].some(key => own(data, key))) return result();
  const paidMs = ms(data.topUpPaidAt, nowMs);
  if (paidMs === null || typeof data.topUpPaymentIntentId !== 'string' || !/^pi_[A-Za-z0-9_]+$/.test(data.topUpPaymentIntentId) ||
      credits.length !== 1 || credits[0].data.amount !== topUp.amount || !credits[0].data.createdAt.isEqual(data.topUpPaidAt) ||
      held.length !== 1 || held[0].data.amount !== topUp.amount || startMs === null || !held[0].data.createdAt.isEqual(data.topUpFundsHeldAt)) return result();
  if (!cents(wallet.heldBalance) || wallet.heldBalance < topUp.amount || !cents(wallet.balance) || !cents(wallet.balance + topUp.amount)) return result();
  source.amountCents = topUp.amount;
  source.financialQualification = 'native_linked_movements';
  if (bothMs === null || paidMs > bothMs || startMs < bothMs) {source.reason = 'reception_source_reconciliation'; return result();}
  if (endMs === null) {source.reason = 'hold_clock_unqualified'; return result();}
  if (data.status === 'disputed' || data.disputed === true) {source.reason = 'commercial_dispute'; return result();}
  if (data.status !== 'completed') return result();
  source.state = 'held'; source.reason = null;
  return result({walletRef, wallet, payeeId, payerId, amountCents: topUp.amount,
    creditLedgerId: credits[0].id, heldLedgerId: held[0].id});
}

function observationId(proof: Data): string | null {
  if (!(proof.sourceVersion instanceof Timestamp)) return null;
  const content = {...proof}; delete content.observationId; delete content.observedAt;
  return digest({...content, sourceVersion: timestampKey(proof.sourceVersion)});
}
function qualifiedObservation(proof: Data | undefined, swapId: string, expectedId: string, now: Timestamp) {
  return !!proof && proof.protocol === 'swap_hold_observation_v1' && proof.swapId === swapId && proof.observationId === expectedId &&
    observationId(proof) === expectedId && ms(proof.observedAt, now.toMillis()) !== null && REASONS.has(proof.source?.reason) &&
    id(proof.initiatorId) && id(proof.receiverId) && proof.initiatorId !== proof.receiverId && proof.financialPermission === false;
}
function publicSource(raw: any): SwapHoldPublicSource | null {
  const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  if (!raw || !['no_topup', 'held', 'release_recorded', 'review_required'].includes(raw.state) || raw.reason !== null && !REASONS.has(raw.reason) ||
      raw.currency !== 'CAD' || raw.amountCents !== null && !cents(raw.amountCents) ||
      !['observed_swap_hold', 'recorded_swap_release'].includes(raw.amountBasis) ||
      !['native_linked_movements', 'unknown'].includes(raw.financialQualification) ||
      !['native_receipt', 'legacy_linked_movement', 'unknown'].includes(raw.releaseReceiptQualification) ||
      !['future', 'elapsed', 'unknown'].includes(raw.deadlineState) ||
      !(raw.startQualification === 'native_timestamp' && date(raw.startedAt) || raw.startQualification === 'unknown' && raw.startedAt === null) ||
      !(raw.deadlineQualification === 'native_timestamp' && date(raw.initialDeadlineAt) || raw.deadlineQualification === 'unknown' && raw.initialDeadlineAt === null) ||
      !(raw.receptionsQualification === 'native_participant_confirmations' && date(raw.bothReceptionsAt) ||
        raw.receptionsQualification === 'unknown' && raw.bothReceptionsAt === null)) return null;
  return {state: raw.state, reason: raw.reason, amountCents: raw.amountCents, currency: 'CAD', amountBasis: raw.amountBasis,
    financialQualification: raw.financialQualification, releaseReceiptQualification: raw.releaseReceiptQualification,
    startedAt: raw.startedAt, initialDeadlineAt: raw.initialDeadlineAt, startQualification: raw.startQualification,
    deadlineQualification: raw.deadlineQualification, deadlineState: raw.deadlineState,
    bothReceptionsAt: raw.bothReceptionsAt, receptionsQualification: raw.receptionsQualification};
}

/** Operator presentation and its permanent receipt commit with the review and checkpoint. */
export async function prepareSwapHoldReview(tx: FirebaseFirestore.Transaction, snap: FirebaseFirestore.DocumentSnapshot,
  source: SwapHoldPublicSource, now: Timestamp) {
  const data = snap.data();
  if (!data || !(snap.updateTime instanceof Timestamp) || !source.reason) throw new Error('Native swap hold review source required.');
  const payload = {protocol: 'swap_hold_observation_v1', swapId: snap.id, sourceVersion: snap.updateTime,
    initiatorId: id(data.initiatorId) ? data.initiatorId : null, receiverId: id(data.receiverId) ? data.receiverId : null,
    source, resolutionState: 'unknown', legalMaximumDeadlineAt: null, financialPermission: false};
  const key = observationId(payload)!, reviewRef = snap.ref.collection('swap_hold_reviews').doc(key);
  const headRef = snap.ref.collection('swap_hold_reviews').doc('latest'), prior = await tx.get(reviewRef), head = await tx.get(headRef);
  const episode = digest([snap.id, source.reason, source.startedAt, source.initialDeadlineAt, data.cashTopUp?.payerId ?? null, data.cashTopUp?.amount ?? null]);
  const receiptRef = snap.ref.collection('swap_hold_reviews').doc(`alert_${episode}`), receipt = await tx.get(receiptRef);
  const alertRef = db.collection('admin_alerts').doc(`swap_hold_${episode}`), alert = !receipt.exists ? await tx.get(alertRef) : null;
  if (prior.exists && (observationId(prior.data()!) !== key || ms(prior.data()?.observedAt, now.toMillis()) === null))
    throw new Error('Swap hold observation requires reconciliation.');
  if (receipt.exists && (receipt.data()?.protocol !== 'swap_hold_alert_v1' || receipt.data()?.swapId !== snap.id ||
      receipt.data()?.episode !== episode || receipt.data()?.alertId !== alertRef.id || ms(receipt.data()?.committedAt, now.toMillis()) === null))
    throw new Error('Swap hold operator receipt requires reconciliation.');
  if (alert?.exists && (alert.data()?.refId !== snap.id || alert.data()?.context?.episode !== episode))
    throw new Error('Swap hold operator alert requires reconciliation.');
  const referencedId = receipt.exists ? receipt.data()?.observationId : alert?.exists ? alert.data()?.context?.observationId : null;
  if (receipt.exists || alert?.exists) {
    if (typeof referencedId !== 'string' || !/^[a-f0-9]{64}$/.test(referencedId)) throw new Error('Swap hold alert has no native observation.');
    const proof = (referencedId === key ? prior : await tx.get(snap.ref.collection('swap_hold_reviews').doc(referencedId))).data();
    if (!proof || proof.swapId !== snap.id || proof.observationId !== referencedId || observationId(proof) !== referencedId ||
        ms(proof.observedAt, now.toMillis()) === null) throw new Error('Swap hold alert observation requires reconciliation.');
  }
  return {key, commit() {
    if (!prior.exists) tx.create(reviewRef, {...payload, observationId: key, observedAt: now});
    if (head.data()?.observationId !== key) tx.set(headRef, {protocol: 'swap_hold_head_v1', swapId: snap.id, observationId: key});
    if (!receipt.exists) tx.create(receiptRef, {protocol: 'swap_hold_alert_v1', swapId: snap.id, episode, alertId: alertRef.id,
      observationId: referencedId ?? key, committedAt: now});
    if (!receipt.exists && !alert!.exists) tx.create(alertRef, {kind: 'swap_hold_review', severity: 'warning', refId: snap.id,
      status: 'open', createdAt: now,
      message: 'Le traitement du complément de cet échange nécessite un examen humain. Aucun montant global, réception effective, remboursement ou date de résolution n’est déduit.',
      context: {observationId: key, episode, sourceVersion: snap.updateTime, reason: source.reason, amountCents: source.amountCents, currency: 'CAD'}});
  }};
}

/** SDK participant, pure: no profile, feature flag, provider or financial permission. */
export async function readParticipantSwapHoldReview(ownerId: string, input: any, guard?: (tx: FirebaseFirestore.Transaction) => Promise<unknown>) {
  if (!id(input?.swapId)) throw new HttpsError('invalid-argument', 'La référence de l’échange est requise.');
  return db.runTransaction(async tx => {
    await guard?.(tx);
    const readAt = Timestamp.now(), snap = await tx.get(db.collection('swaps').doc(input.swapId)), data = snap.data();
    if (!data || data.initiatorId !== ownerId && data.receiverId !== ownerId)
      throw new HttpsError('permission-denied', 'Cette lecture est réservée aux participants de l’échange.');
    const qualified = await readSwapHoldSource(tx, snap.id, data, readAt);
    const head = (await tx.get(snap.ref.collection('swap_hold_reviews').doc('latest'))).data();
    let review: {protocol: string; observationId: string; observedAt: string; currentSourceMatches: boolean;
      source: SwapHoldPublicSource; resolutionState: 'unknown'; legalMaximumDeadlineAt: null; financialPermission: false;
      action: 'contactSupport'} | null = null;
    let reviewQualification: 'observed' | 'absent' | 'unqualified' = head ? 'unqualified' : 'absent';
    if (head?.protocol === 'swap_hold_head_v1' && head.swapId === snap.id && /^[a-f0-9]{64}$/.test(head.observationId ?? '')) {
      const proof = (await tx.get(snap.ref.collection('swap_hold_reviews').doc(head.observationId))).data();
      const source = publicSource(proof?.source);
      if (source && qualifiedObservation(proof, snap.id, head.observationId, readAt) && proof!.initiatorId === data.initiatorId && proof!.receiverId === data.receiverId) {
        reviewQualification = 'observed';
        review = {protocol: 'swap_hold_observation_v1', observationId: proof!.observationId, observedAt: proof!.observedAt.toDate().toISOString(),
          currentSourceMatches: snap.updateTime?.isEqual(proof!.sourceVersion) === true, source,
          resolutionState: 'unknown', legalMaximumDeadlineAt: null, financialPermission: false, action: 'contactSupport'};
      }
    }
    const payer = data.cashTopUp?.payerId, validPayer = id(data.initiatorId) && id(data.receiverId) && data.initiatorId !== data.receiverId &&
      id(payer) && [data.initiatorId, data.receiverId].includes(payer);
    return {protocol: 'swap_hold_review_v1', ownerId, swapId: snap.id, readAt: readAt.toDate().toISOString(),
      role: validPayer ? payer === ownerId ? 'payer' : 'payee' : 'participant_unknown', currentSource: qualified.source,
      reviewQualification, review, resolutionState: 'unknown', legalMaximumDeadlineAt: null, financialPermission: false};
  });
}
