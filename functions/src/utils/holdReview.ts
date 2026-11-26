import {productRoutingAllowsRelease} from './productRoutingReview';
import {productMixedOrderAllowsRelease} from './productMixedOrders';
/** Private observations of a blocked hold. No observation authorizes money. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { hasUnsettledRefund, qualifiedRefundNoticeSource } from './refundState';
import { hasActiveBankDispute } from './bankDispute';
import { hasUnsettledReturnRequest, returnRequestView } from './returnRequest';
import { deliveryCorrectionBlocksProgress, orderModerationAllowsProgress } from './orderModeration';
import { fraudReviewAllowsProgress } from './fraudReviewDecision';
import { effectivePurchaseReleaseAt, purchasePolicyAllowsRelease } from './purchasePolicy';

type Data = FirebaseFirestore.DocumentData;
export type HoldSource = 'transactions' | 'swaps';
export const HOLD_REVIEW_REASONS = [
  'commercial_dispute', 'delivery_correction', 'tracking_reconciliation', 'purchase_policy_reconciliation',
  'return_in_progress', 'bank_dispute', 'refund_reconciliation', 'label_reconciliation',
  'moderation_review', 'financial_source_reconciliation', 'dispute_date_unqualified',
] as const;
export type HoldReviewReason = typeof HOLD_REVIEW_REASONS[number];
export const HOLD_OPERATIONAL_AGING_THRESHOLD_MS = 5 * 24 * 60 * 60 * 1000;
const reasonSet = new Set<string>(HOLD_REVIEW_REASONS);
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v, (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)).digest('hex');
const nativeMillis = (v: unknown, nowMs: number): number | null => {
  const ms = v instanceof Timestamp ? v.toMillis() : NaN;
  return Number.isFinite(ms) && ms >= 0 && ms <= nowMs ? ms : null;
};
const timestampKey = (v: Timestamp) => [v.seconds, v.nanoseconds];
function observationDigest(data: Data): string | null {
  if (!(data.sourceVersion instanceof Timestamp)) return null;
  const payload = { ...data };
  delete payload.observationId;
  delete payload.observedAt;
  return hash({ ...payload, sourceVersion: timestampKey(data.sourceVersion) });
}
const validId = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('/') &&
  v !== '.' && v !== '..' && Buffer.byteLength(v, 'utf8') <= 1500;
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const cad = (v: unknown) => typeof v === 'string' && v.toUpperCase() === 'CAD';
export const ACTIVE_PURCHASE_HOLD_STATUSES = ['delivered', 'disputed', 'delivery_failed', 'lost', 'return_requested',
  'refund_in_progress', 'refund_action_required'] as const;

/** Existence of a native obligation is not an amount or a current held balance. */
async function nativeHoldObligation(tx: FirebaseFirestore.Transaction, id: string, data: Data, nowMs: number): Promise<boolean> {
  const refund = data.refund;
  if (hasUnsettledRefund(data) && qualifiedRefundNoticeSource(data, refund ?? {}) &&
      nativeMillis(refund.requestedAt, nowMs) !== null && refund.requestedAtMs <= nowMs &&
      (refund.cardAmountCents > 0 || refund.walletAmountCents > 0 || refund.sellerDebitCents > 0) &&
      (refund.paymentIntentId === data.stripePaymentIntentId || refund.cardAmountCents === 0 && refund.paymentIntentId == null)) return true;
  // The recorded return survives a changed current source; that is an existing
  // obligation, not a permission to buy a label or an attribution of funds.
  if (hasUnsettledReturnRequest(data) && returnRequestView(id, data, true).requestRecorded &&
      nativeMillis(data.returnRequest?.requestedAt, nowMs) !== null) return true;
  const bank = data.bankDispute;
  if (hasActiveBankDispute(data) && bank?.state === 'open' && typeof bank.id === 'string' && /^dp_[A-Za-z0-9_]+$/.test(bank.id) &&
      bank.id === data.disputeId && nativeMillis(bank.openedAt, nowMs) !== null && cents(bank.amountCents) && bank.amountCents > 0 &&
      cents(bank.freezeCents) && validId(data.buyerId) && validId(data.sellerId) && data.buyerId !== data.sellerId) return true;
  if (!validId(data.sellerId)) return false;
  const entries = await tx.get(db.collection('wallets').doc(data.sellerId).collection('ledger')
    .where('transactionId', '==', id).limit(101));
  return entries.docs.some(doc => {
    const row = doc.data();
    return row.transactionId === id && ['funds_held', 'refund_hold', 'dispute_hold'].includes(row.type) &&
      cents(row.amount) && row.amount > 0 && nativeMillis(row.createdAt, nowMs) !== null;
  });
}

/** Bound all evidence reads. Ambiguous consumption never becomes a guessed residual. */
async function attributedHoldCents(tx: FirebaseFirestore.Transaction, source: HoldSource, id: string, data: Data,
  nowMs: number): Promise<number | null> {
  if (source !== 'transactions' || !validId(data.sellerId) || !cad(data.currency) || data.fundsReleasedAt != null) return null;
  const walletRef = db.collection('wallets').doc(data.sellerId);
  const wallet = (await tx.get(walletRef)).data();
  if (!wallet || !cad(wallet.currency) || !cents(wallet.heldBalance)) return null;
  const entries = await tx.get(walletRef.collection('ledger').where('transactionId', '==', id).limit(101));
  if (entries.size > 100) return null;
  let total = 0, found = false;
  for (const entry of entries.docs) {
    const row = entry.data();
    if (row.transactionId !== id || typeof row.type !== 'string') return null;
    // These entries do not consume the delivery hold. All other kinds need a
    // financial reconciliation rather than attributing an aggregate balance.
    if (row.type === 'sale_credit' || row.type === 'debt_repayment') continue;
    if (row.type !== 'funds_held' || !cents(row.amount) || nativeMillis(row.createdAt, nowMs) === null ||
        row.currency != null && !cad(row.currency)) return null;
    found = true;
    total += row.amount;
    if (!Number.isSafeInteger(total)) return null;
  }
  if (!found || total > wallet.heldBalance || !cents(data.sellerHeldCreditCents) || data.sellerHeldCreditCents !== total) return null;
  // funds_held historically has no currency field: only this exact native CAD
  // order + CAD wallet linkage qualifies its cents. Never infer from a symbol.
  return total;
}

function timeline(source: HoldSource, data: Data, nowMs: number) {
  const start = source === 'transactions' ? data.deliveredAt : data.topUpFundsHeldAt;
  const deadline = source === 'transactions' ? data.fundsReleaseAt : data.topUpFundsReleaseAt;
  const startMs = nativeMillis(start, nowMs);
  const rawDeadlineMs = deadline instanceof Timestamp ? deadline.toMillis() : NaN;
  const deadlineMs = Number.isFinite(rawDeadlineMs) && rawDeadlineMs >= 0 && (startMs === null || rawDeadlineMs >= startMs) ? rawDeadlineMs : null;
  return { startedAtMs: startMs, initialDeadlineAtMs: deadlineMs,
    startQualification: startMs === null ? 'unknown' : 'native_timestamp',
    deadlineQualification: deadlineMs === null ? 'unknown' : 'native_timestamp' };
}

/** Reads first. Caller commits review, operational alert and row checkpoint together. */
export async function prepareHoldReview(tx: FirebaseFirestore.Transaction, source: HoldSource,
  snap: FirebaseFirestore.DocumentSnapshot, reason: HoldReviewReason, observedAt: Timestamp,
  aging?: { openedAtMs: number | null; thresholdMs: number; exceeded: boolean | null },
  basis?: 'overdue_hold' | 'clock_unqualified') {
  const data = snap.data();
  if (!data || !(snap.updateTime instanceof Timestamp)) throw new Error('Hold review requires a native source version.');
  const dates = timeline(source, data, observedAt.toMillis());
  const amountCents = await attributedHoldCents(tx, source, snap.id, data, observedAt.toMillis());
  const payload = { schemaVersion: 1, source, sourceId: snap.id, sourceVersion: snap.updateTime,
    sellerId: source === 'transactions' && validId(data.sellerId) ? data.sellerId : null,
    reason, ...dates, amountCents, currency: 'CAD', amountBasis: 'observed_sale_hold',
    aging: aging ?? null, ...(basis ? {basis} : {}), legalMaximumDeadlineAt: null, resolutionState: 'unknown', financialPermission: false };
  const observationId = observationDigest(payload)!;
  const reviewRef = snap.ref.collection('hold_reviews').doc(observationId);
  const headRef = snap.ref.collection('hold_reviews').doc('latest');
  const prior = await tx.get(reviewRef), head = await tx.get(headRef);
  // The permanent episode receipt survives deletion/dismissal of an operator
  // alert. Unrelated edits to the source may add a review, never repeat an alert.
  const episodeId = aging ? hash([source, snap.id, 'dispute_aging', aging.openedAtMs, reason]) :
    hash([source, snap.id, 'hold_release_review', basis ?? 'overdue_hold', reason, dates.startedAtMs, dates.initialDeadlineAtMs]);
  const alertReceiptRef = snap.ref.collection('hold_reviews').doc(`${aging ? 'aging' : 'release'}_${episodeId}`);
  const alertReceipt = await tx.get(alertReceiptRef);
  const alertRef = db.collection('admin_alerts').doc(`${aging ? 'hold_aging' : 'hold_release'}_${episodeId}`);
  // A permanent native receipt precedes a mutable operator presentation.
  const alert = !alertReceipt.exists ? await tx.get(alertRef) : null;
  if (prior.exists && (prior.data()?.observationId !== observationId || observationDigest(prior.data()!) !== observationId ||
      !(prior.data()?.observedAt instanceof Timestamp)))
    throw new Error('Private hold-review receipt needs reconciliation.');
  if (alertReceipt.exists && (alertReceipt.data()?.schemaVersion !== 1 || alertReceipt.data()?.episodeId !== episodeId ||
      alertReceipt.data()?.source !== source || alertReceipt.data()?.sourceId !== snap.id ||
      alertReceipt.data()?.alertId !== alertRef.id || nativeMillis(alertReceipt.data()?.committedAt, observedAt.toMillis()) === null))
    throw new Error('Private hold-alert receipt needs reconciliation.');
  if (alert?.exists && (alert.data()?.context?.agingEpisodeId !== episodeId || alert.data()?.refId !== snap.id))
    throw new Error('Private hold alert needs reconciliation.');
  const referencedId = alertReceipt.exists ? alertReceipt.data()?.reviewObservationId : alert?.exists ? alert.data()?.context?.holdObservationId : null;
  if (alertReceipt.exists || alert?.exists) {
    if (typeof referencedId !== 'string' || !/^[a-f0-9]{64}$/.test(referencedId)) throw new Error('Hold-alert receipt has no native review.');
    const referenced = referencedId === observationId ? prior : await tx.get(snap.ref.collection('hold_reviews').doc(referencedId));
    const proof = referenced.data();
    if (!proof || proof.schemaVersion !== 1 || proof.source !== source || proof.sourceId !== snap.id ||
        proof.observationId !== referencedId || observationDigest(proof) !== referencedId ||
        nativeMillis(proof.observedAt, observedAt.toMillis()) === null) throw new Error('Hold-alert review source needs reconciliation.');
    const proofEpisodeId = proof.aging ? hash([source, snap.id, 'dispute_aging', proof.aging.openedAtMs, proof.reason]) :
      hash([source, snap.id, 'hold_release_review', proof.basis ?? 'overdue_hold', proof.reason, proof.startedAtMs, proof.initialDeadlineAtMs]);
    if (proofEpisodeId !== episodeId) throw new Error('Hold-alert receipt belongs to another observation.');
  }
  return {
    observationId, newAlert: !alertReceipt.exists && !alert!.exists,
    commit() {
      if (!prior.exists) tx.create(reviewRef, { ...payload, observationId, observedAt });
      if (head.data()?.observationId !== observationId) tx.set(headRef, {
        schemaVersion: 1, source, sourceId: snap.id, observationId,
      });
      if (!alertReceipt.exists) tx.create(alertReceiptRef, {
        schemaVersion: 1, episodeId, source, sourceId: snap.id, alertId: alertRef.id,
        reviewObservationId: alert?.data()?.context?.holdObservationId ?? observationId, committedAt: observedAt,
      });
      if (!alertReceipt.exists && !alert!.exists) tx.create(alertRef, {
        kind: aging ? source === 'swaps' ? 'swap_dispute_aging' : 'transaction_dispute_aging' : 'transaction_hold_review', severity: 'warning',
        refId: snap.id, status: 'open', createdAt: observedAt,
        message: !aging ? basis === 'clock_unqualified'
          ? 'L’échéance native du traitement des fonds de cette vente doit être rapprochée. Un examen humain est requis ; aucune date échue ni décision financière n’est déduite.'
          : 'L’échéance native initiale de cette vente est dépassée et son traitement des fonds nécessite un examen humain. Cet avis ne décide ni des fonds ni du délai légal applicable.'
          : aging.exceeded === true
          ? 'Le seuil opérationnel de suivi de ce litige est dépassé. Un examen humain est requis ; cet avis ne décide ni des fonds ni du délai légal applicable.'
          : 'La date native de ce litige ne permet pas de qualifier son ancienneté. Un rapprochement humain est requis ; cet avis ne décide ni des fonds ni du délai légal applicable.',
        context: { holdObservationId: observationId, agingEpisodeId: episodeId, source, sourceVersion: snap.updateTime,
          reason, amountCents, currency: 'CAD', aging: aging ?? null, basis: basis ?? null, financialPermission: false },
      });
    },
  };
}

/** Reads first; a scanner can commit this native observation with its checkpoint. */
export async function preparePurchaseHoldObservation(tx: FirebaseFirestore.Transaction, transactionId: string, now: Timestamp) {
  const snap = await tx.get(db.collection('transactions').doc(transactionId)), data = snap.data();
  let review: Awaited<ReturnType<typeof prepareHoldReview>> | null = null;
  const result = (qualification: string) => ({sourceVersion: snap.updateTime ?? null, qualification,
    observationId: review?.observationId ?? null, commit: () => review?.commit()});
  if (!data || !(ACTIVE_PURCHASE_HOLD_STATUSES as readonly string[]).includes(data.status)) return result('source_not_active');
  const dates = timeline('transactions', data, now.toMillis());
  const effectiveReleaseAt = effectivePurchaseReleaseAt(data, transactionId);
  if (effectiveReleaseAt && effectiveReleaseAt.toMillis() > now.toMillis()) return result('native_clock_future');
  if (dates.initialDeadlineAtMs !== null && dates.initialDeadlineAtMs > now.toMillis()) return result('native_clock_future');
  if (nativeMillis(data.fundsReleasedAt, now.toMillis()) !== null && !hasUnsettledRefund(data) && !hasActiveBankDispute(data) && !hasUnsettledReturnRequest(data))
    return result('released_history_preserved');
  if (dates.initialDeadlineAtMs === null) {
    if (!await nativeHoldObligation(tx, transactionId, data, now.toMillis())) return result('clock_unknown_without_qualified_obligation');
    review = await prepareHoldReview(tx, 'transactions', snap, 'financial_source_reconciliation', now, undefined, 'clock_unqualified');
    return result('clock_unknown_review_observed');
  }
  let reason: HoldReviewReason | null = data.disputed === true || data.status === 'disputed' ? 'commercial_dispute' : null;
  if (!reason && deliveryCorrectionBlocksProgress(data)) reason = 'delivery_correction';
  if (!reason && data.trackingReviewRequired === true) reason = 'tracking_reconciliation';
  if (!reason && !purchasePolicyAllowsRelease(data, transactionId, await productRoutingAllowsRelease(tx, transactionId, data), await productMixedOrderAllowsRelease(tx, transactionId, data))) reason = 'purchase_policy_reconciliation';
  if (!reason && hasUnsettledReturnRequest(data)) reason = 'return_in_progress';
  if (!reason && hasActiveBankDispute(data)) reason = 'bank_dispute';
  if (!reason && hasUnsettledRefund(data)) reason = 'refund_reconciliation';
  if (!reason && data.labelReconciliationRequired === true) reason = 'label_reconciliation';
  if (!reason && !await fraudReviewAllowsProgress(tx, transactionId, data, snap)) reason = 'financial_source_reconciliation';
  if (!reason && !await orderModerationAllowsProgress(tx, data)) reason = 'moderation_review';
  if (!reason && (!validId(data.sellerId) || typeof (data.sellerPayout ?? data.amount) !== 'number'))
    reason = 'financial_source_reconciliation';
  if (!reason && (data.status !== 'delivered' || await attributedHoldCents(tx, 'transactions', transactionId, data, now.toMillis()) === null))
    reason = 'financial_source_reconciliation';
  if (!reason) return result('native_clock_due_without_observed_blocker');
  review = await prepareHoldReview(tx, 'transactions', snap, reason, now, undefined, 'overdue_hold');
  return result('overdue_hold_review_observed');
}

/** Unknown clock needs a native obligation. A future clock is never overdue. */
export async function observeOverduePurchaseHold(transactionId: string, now: Timestamp,
  scan?: {ref: FirebaseFirestore.DocumentReference; ownerId: string}): Promise<void> {
  await db.runTransaction(async tx => {
    if (scan) {
      const lease = (await tx.get(scan.ref)).data()?.scanLease;
      if (lease?.schemaVersion !== 1 || lease.ownerId !== scan.ownerId || !(lease.lockedUntil instanceof Timestamp) ||
          lease.lockedUntil.toMillis() <= Date.now()) throw new Error('Held-funds scan lease no longer owned.');
    }
    (await preparePurchaseHoldObservation(tx, transactionId, now)).commit();
  });
}

const publicDate = (ms: unknown): string | null => typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 &&
  ms <= 253402300799999 ? new Date(ms).toISOString() : null;

/** Owner-only, pure and bounded. A page is never proof of all retained funds. */
export async function readSellerHoldReviews(ownerId: string, input: any, guard?: (tx: FirebaseFirestore.Transaction) => Promise<unknown>) {
  if (input?.scope !== 'seller_sales') throw new HttpsError('invalid-argument', 'Le périmètre de lecture des ventes est requis.');
  const cursor = input.cursor ?? null;
  if (cursor !== null && (cursor.schemaVersion !== 1 || cursor.ownerId !== ownerId || cursor.scope !== 'seller_sales' || !validId(cursor.lastId)))
    throw new HttpsError('invalid-argument', 'Le curseur appartient à une autre lecture.');
  return db.runTransaction(async tx => {
    await guard?.(tx);
    const readAt = Timestamp.now();
    let query = db.collection('transactions').where('sellerId', '==', ownerId).orderBy('__name__', 'asc').limit(31);
    if (cursor) query = query.startAfter(cursor.lastId);
    const page = await tx.get(query), inspected = page.docs.slice(0, 30);
    const rows: {transactionId: string; review: Record<string, unknown> | null; reviewQualification: 'observed' | 'absent' | 'unqualified'}[] = [];
    let skippedOwnerSources = 0;
    for (const doc of inspected) {
      const source = (await tx.get(doc.ref));
      const sale = source.data();
      if (!sale || sale.sellerId !== ownerId) { skippedOwnerSources++; continue; }
      const head = (await tx.get(doc.ref.collection('hold_reviews').doc('latest'))).data();
      if (!head) { rows.push({ transactionId: doc.id, review: null, reviewQualification: 'absent' }); continue; }
      if (head.schemaVersion !== 1 || head.source !== 'transactions' || head.sourceId !== doc.id || !/^[a-f0-9]{64}$/.test(head.observationId ?? '')) {
        rows.push({ transactionId: doc.id, review: null, reviewQualification: 'unqualified' }); continue;
      }
      const proof = (await tx.get(doc.ref.collection('hold_reviews').doc(head.observationId))).data();
      const qualified = proof?.schemaVersion === 1 && proof.source === 'transactions' && proof.sourceId === doc.id && proof.sellerId === ownerId &&
        proof.observationId === head.observationId && observationDigest(proof) === head.observationId && proof.sourceVersion instanceof Timestamp &&
        proof.observedAt instanceof Timestamp && nativeMillis(proof.observedAt, readAt.toMillis()) !== null && reasonSet.has(proof.reason) &&
        proof.currency === 'CAD' && (proof.amountCents === null || cents(proof.amountCents)) &&
        proof.amountBasis === 'observed_sale_hold' && proof.resolutionState === 'unknown' && proof.financialPermission === false;
      if (!qualified) { rows.push({ transactionId: doc.id, review: null, reviewQualification: 'unqualified' }); continue; }
      const startedAt = publicDate(proof!.startedAtMs), initialDeadlineAt = publicDate(proof!.initialDeadlineAtMs);
      const agingOpenedAt = publicDate(proof!.aging?.openedAtMs);
      const operationalAgingThresholdMs = proof!.aging?.thresholdMs === HOLD_OPERATIONAL_AGING_THRESHOLD_MS
        ? HOLD_OPERATIONAL_AGING_THRESHOLD_MS : null;
      const thresholdQualified = operationalAgingThresholdMs !== null && agingOpenedAt !== null &&
        proof!.aging.openedAtMs <= proof!.observedAt.toMillis();
      const operationalThresholdExceeded = thresholdQualified && typeof proof!.aging.exceeded === 'boolean' &&
        proof!.aging.exceeded === (proof!.observedAt.toMillis() - proof!.aging.openedAtMs >= operationalAgingThresholdMs!)
        ? proof!.aging.exceeded as boolean : null;
      rows.push({ transactionId: doc.id, reviewQualification: 'observed', review: {
        protocol: 'hold_review_v1', observationId: proof!.observationId, reason: proof!.reason,
        observedAt: proof!.observedAt.toDate().toISOString(), currentSourceMatches: source.updateTime?.isEqual(proof!.sourceVersion) === true,
        amountCents: proof!.amountCents, currency: 'CAD', amountBasis: 'observed_sale_hold',
        startedAt: proof!.startQualification === 'native_timestamp' ? startedAt : null,
        initialDeadlineAt: proof!.deadlineQualification === 'native_timestamp' ? initialDeadlineAt : null,
        startQualification: proof!.startQualification === 'native_timestamp' && startedAt !== null ? 'native_timestamp' : 'unknown',
        deadlineQualification: proof!.deadlineQualification === 'native_timestamp' && initialDeadlineAt !== null ? 'native_timestamp' : 'unknown',
        agingOpenedAt: thresholdQualified ? agingOpenedAt : null, operationalAgingThresholdMs,
        operationalThresholdExceeded,
        legalMaximumDeadlineAt: null, resolutionState: 'unknown', financialPermission: false,
        message: 'Le traitement des fonds de cette vente a été signalé pour examen humain. Son échéance initiale ne fixe ni la date de résolution ni une autorisation de libération.',
        action: 'contactSupport',
      } });
    }
    const lastId = inspected[inspected.length - 1]?.id ?? null, hasMore = page.size > 30;
    return { protocol: 'seller_hold_reviews_v1', ownerId, scope: 'seller_sales', readAt: readAt.toDate().toISOString(), rows,
      nextCursor: hasMore && lastId ? {schemaVersion: 1, ownerId, scope: 'seller_sales', lastId} : null,
      coverage: { order: 'document_id_asc', inspectedCount: inspected.length, returnedCount: rows.length, skippedOwnerSources,
        limit: 30, hasMore, pageEnded: !hasMore, immutableCapture: false, globalCoverage: false },
      resolutionState: 'unknown', financialPermission: false };
  });
}
