/** Documentary late transport observations. Never a money or possession instruction. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { trackingIdentity, type QualifiedTracking } from '../config/shipEngine';
import { qualifiedRefundNoticeSource } from './refundState';
import { prepareOperationalNotices } from './notifications';
import { supportCurrentAdminSession } from './supportRequest';
import { hasActiveBankDispute } from './bankDispute';

const PROTOCOL = 'late_transport_incident_v1';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const timestamp = (value: unknown): value is Timestamp => value instanceof Timestamp &&
  Number.isSafeInteger(value.toMillis()) && value.toMillis() >= 0 && value.toMillis() <= Date.now();
const iso = (value: Timestamp | null) => value?.toDate().toISOString() ?? null;
const incidentRef = (transactionId: string) => db.collection('transactions').doc(transactionId).collection('late_transport_incidents');

/** Status/refundedAt alone never qualify returned money. Native intention and
 * exact local ledgers qualify recording; bank receipt by the person is unknown. */
async function financialSource(tx: FirebaseFirestore.Transaction, transactionId: string, order: FirebaseFirestore.DocumentData) {
  const intent = order.refund, source = intent && qualifiedRefundNoticeSource(order, intent);
  const requestedAt = source && timestamp(intent.requestedAt) ? intent.requestedAt as Timestamp : null;
  const qualified = !!source && !!requestedAt && Number.isSafeInteger(intent.requestedAtMs) &&
    intent.requestedAtMs <= requestedAt.toMillis() && requestedAt.toMillis() - intent.requestedAtMs <= 60_000;
  const fundsAppliedAt = qualified && timestamp(intent.fundsAppliedAt) ? intent.fundsAppliedAt as Timestamp : null;
  let localMoneyQualified = false;
  const bankUnresolved = hasActiveBankDispute(order) || order.bankDispute?.outcome === 'lost' || order.refundedVia === 'chargeback';
  if (qualified && fundsAppliedAt && fundsAppliedAt.toMillis() >= requestedAt!.toMillis() && !bankUnresolved &&
      intent.legacyApplied !== true && intent.legacyReconciliationRequired !== true &&
      intent.state === 'succeeded' && intent.outstandingCardCents === 0 && intent.localOutstandingWalletCents === 0 &&
      intent.localOutstandingSellerCents === 0 && order.refundBlocked !== true && order.refundLegacyReconciliationRequired !== true &&
      (intent.cardAmountCents === 0 || intent.providerStatus === 'succeeded' && id(intent.stripeRefundId) &&
        intent.cardConfirmedCents === intent.cardAmountCents && intent.cardSatisfiedVia === 'stripe')) {
    const buyer = intent.walletAmountCents > 0 ? (await tx.get(db.collection('wallets').doc(source!.buyerId)
      .collection('ledger').doc(`refund_credit_${source!.intentId}`))).data() : null;
    const seller = intent.sellerDebitCents > 0 ? (await tx.get(db.collection('wallets').doc(source!.sellerId)
      .collection('ledger').doc(`refund_debit_${source!.intentId}`))).data() : null;
    const buyerQualified = intent.walletAmountCents === 0 || buyer?.type === 'refund_credit' &&
      buyer.transactionId === transactionId && buyer.refundIntentId === source!.intentId &&
      buyer.amount === intent.walletAmountCents && timestamp(buyer.createdAt) && buyer.createdAt.isEqual(fundsAppliedAt);
    const sellerQualified = intent.sellerDebitCents === 0 || seller?.type === 'refund_debit' &&
      seller.transactionId === transactionId && seller.refundIntentId === source!.intentId &&
      Number.isSafeInteger(seller.amount) && seller.amount >= 0 && Number.isSafeInteger(seller.debtRecorded) && seller.debtRecorded >= 0 &&
      seller.amount + seller.debtRecorded === intent.sellerDebitCents && timestamp(seller.createdAt) && seller.createdAt.isEqual(fundsAppliedAt);
    localMoneyQualified = !!buyerQualified && !!sellerQualified;
  }
  const state = localMoneyQualified ? 'confirmed' : qualified && ['requested', 'pending', 'requires_action'].includes(intent.state) &&
    intent.fundsAppliedAt == null && intent.legacyApplied !== true && intent.legacyReconciliationRequired !== true ? 'engaged' : 'unknown';
  const refund = { qualification: qualified ? 'native_intent' : 'historical_unknown', state,
    intentId: qualified ? source!.intentId : null, requestedAt: qualified ? iso(requestedAt) : null,
    fundsAppliedAt: localMoneyQualified ? iso(fundsAppliedAt) : null };
  // Financial fingerprint is private, documentary and separate from the hashes
  // used to authorize financial mutations. No provider call happens here.
  const sourceHash = hash([PROTOCOL, transactionId, order.buyerId, order.sellerId, refund,
    qualified ? source!.attemptId : null, qualified ? intent.cardAmountCents : null,
    qualified ? intent.walletAmountCents : null, qualified ? intent.sellerDebitCents : null,
    qualified ? intent.providerStatus ?? null : null, qualified ? intent.stripeRefundId ?? null : null,
    qualified ? intent.state : null, order.refundBlocked === true, order.refundLegacyReconciliationRequired === true,
    bankUnresolved]);
  return { refund, sourceHash, requestedAt };
}

/** Internal E20 source only. This documentary qualifier is never a money rail. */
export async function readLateTransportRecoveryFinance(tx: FirebaseFirestore.Transaction, transactionId: string, order: FirebaseFirestore.DocumentData) {
  return financialSource(tx, transactionId, order);
}

export function hasRefundTransportDossier(order: FirebaseFirestore.DocumentData): boolean {
  return order.refund != null || order.refundedAt != null || order.stripeRefundId != null ||
    ['refunded', 'refund_in_progress', 'refund_action_required'].includes(order.status);
}

/** One exact immutable incident plus the financial source currently examined.
 * The reference binds an instruction, never permission to move money or stock. */
export async function readLateTransportSupportSource(tx: FirebaseFirestore.Transaction, transactionId: string,
  incidentId: string, ownerId: string) {
  const orderSnap = await tx.get(db.collection('transactions').doc(transactionId)), order = orderSnap.data();
  if (!order || (order.buyerId !== ownerId && order.sellerId !== ownerId)) return null;
  const snap = await tx.get(incidentRef(transactionId).doc(incidentId)), record = snap.data(), doc = record?.document;
  if (!record || record.protocol !== PROTOCOL || record.incidentId !== incidentId || record.transactionId !== transactionId ||
      record.buyerId !== order.buyerId || record.sellerId !== order.sellerId || !timestamp(record.recordedAt) ||
      !doc || doc.protocol !== PROTOCOL || doc.incidentId !== incidentId || doc.transactionId !== transactionId ||
      doc.buyerId !== order.buyerId || doc.sellerId !== order.sellerId || record.contentHash !== hash(doc) ||
      !snap.updateTime || !orderSnap.updateTime) return null;
  const finance = await financialSource(tx, transactionId, order);
  return { protocol: 'late_transport_support_source_v1', reference: { kind: 'late_transport_incident', transactionId, incidentId,
    incidentRevision: `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}`, incidentHash: record.contentHash as string,
    financialSourceHash: finance.sourceHash, orderRevision: `${orderSnap.updateTime.seconds}:${orderSnap.updateTime.nanoseconds}` },
    providerStatusCode: doc.providerStatusCode, providerOccurredAt: doc.providerOccurredAt,
    providerObservedAt: doc.providerObservedAt, temporalRelation: doc.temporalRelation,
    refundAtObservation: doc.refund, refundCurrentlyRecorded: finance.refund,
    financialSourceCurrent: finance.sourceHash === doc.financialSourceHash,
    recipientReceiptVerified: false, bankReceiptVerified: false, financialEffectAuthorized: false,
    inventoryReleaseAuthorized: false };
}

/** Prepare ALL native reads before the caller writes its immutable capture.
 * Current qualified identity/capture authorization is enforced by that caller. */
export async function prepareLateTransportIncident(tx: FirebaseFirestore.Transaction, transactionId: string,
  order: FirebaseFirestore.DocumentData, tracking: QualifiedTracking,
  capture: { captureId: string; displayHash: string; sourceContentHash: string }) {
  const proof = tracking.proof;
  if (proof.leg !== 'forward' || !['IT', 'DE'].includes(tracking.statusCode) || !hasRefundTransportDossier(order)) return null;
  const finance = await financialSource(tx, transactionId, order);
  const providerOccurredAt = proof.providerEventAtMs == null ? null : new Date(proof.providerEventAtMs).toISOString();
  const temporalRelation = proof.providerEventAtMs == null || !finance.requestedAt ? 'unknown' :
    proof.providerEventAtMs > finance.requestedAt.toMillis() ? 'after_refund_request' : 'before_or_at_refund_request';
  const observationHash = hash([PROTOCOL, transactionId, proof.leg, proof.sourceHash, tracking.statusCode,
    proof.providerEventAtMs, capture.sourceContentHash, finance.sourceHash]);
  const incidentId = 'late_' + observationHash, ref = incidentRef(transactionId).doc(incidentId);
  const existing = (await tx.get(ref)).data();
  const alertRef = db.collection('admin_alerts').doc(incidentId);
  const alert = await tx.get(alertRef);
  const document = { protocol: PROTOCOL, incidentId, transactionId, buyerId: order.buyerId, sellerId: order.sellerId,
    leg: 'forward', captureId: capture.captureId, displayHash: capture.displayHash, trackingSourceHash: proof.sourceHash,
    sourceContentHash: capture.sourceContentHash, providerStatusCode: tracking.statusCode,
    providerObservedAt: new Date(proof.observedAtMs).toISOString(), providerOccurredAt, temporalRelation,
    refund: finance.refund, financialSourceHash: finance.sourceHash,
    recipientReceiptVerified: false, bankReceiptVerified: false, financialEffectAuthorized: false,
    inventoryReleaseAuthorized: false, humanReviewRequired: true };
  if (existing) {
    // A new GET with identical business content does not replace the original
    // evidence, notices, observation time, or owner's dismissal.
    if (existing.protocol !== PROTOCOL || existing.incidentId !== incidentId || existing.transactionId !== transactionId ||
        existing.buyerId !== order.buyerId || existing.sellerId !== order.sellerId ||
        existing.observationHash !== observationHash || !timestamp(existing.recordedAt) ||
        existing.contentHash !== hash(existing.document)) throw new Error('late_transport_incident_unqualified');
    return null;
  }
  const notices = await prepareOperationalNotices(tx, [order.buyerId, order.sellerId].map(userId => ({
    eventKey: `${PROTOCOL}:${transactionId}:${observationHash}`, userId, type: 'order_moderation',
    title: 'Suivi à vérifier avec le remboursement',
    message: 'Une observation du transporteur a été enregistrée pendant ou après le dossier de remboursement. Consultez la commande et demandez un examen humain au support. Elle ne prouve pas que le colis a été récupéré et ne modifie ni les fonds ni la disponibilité de l’article.',
    data: { ownerId: userId, transactionId, lateTransportIncidentId: incidentId,
      refundRecordingState: finance.refund.state, recipientReceiptVerified: 'false', financialEffectAuthorized: 'false' },
  })));
  return { commit: () => {
    tx.create(ref, { protocol: PROTOCOL, incidentId, transactionId, buyerId: order.buyerId, sellerId: order.sellerId,
      observationHash, document, contentHash: hash(document), recordedAt: Timestamp.now() });
    if (!alert.exists) tx.create(alertRef, { kind: 'late_transport_after_refund', severity: 'warning', refId: transactionId,
      status: 'open', createdAt: Timestamp.now(),
      message: 'Une observation transport doit être rapprochée avec le dossier de remboursement. Aucun mouvement financier ni remise en vente n’a été autorisé.',
      context: { protocol: PROTOCOL, incidentId, transactionId, leg: 'forward',
        refundRecordingState: finance.refund.state, temporalRelation } });
    notices.commit();
  } };
}

/** Pure private reader; old receipts and obligations remain available to SDK
 * parties without a complete profile, consent admission or payment flags. */
export async function readLateTransportIncidents(request: any) {
  const raw = request.data, uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise.');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).some(key => !['mode', 'expectedUid', 'transactionId', 'scope', 'cursor'].includes(key)) ||
      raw.expectedUid !== uid || !id(raw.transactionId) || !['owner', 'admin'].includes(raw.scope ?? 'owner') ||
      raw.cursor != null && !/^late_[a-f0-9]{64}$/.test(raw.cursor)) throw new HttpsError('invalid-argument', 'Compte, commande et curseur exacts requis.');
  const admin = raw.scope === 'admin';
  if (admin) await supportCurrentAdminSession(request);
  return db.runTransaction(async tx => {
    if (admin) {
      const user = (await tx.get(db.collection('users').doc(uid))).data();
      if (user?.isAdmin !== true || user.isActive === false) throw new HttpsError('permission-denied', 'Accès administratif indisponible.');
    }
    const orderSnap = await tx.get(db.collection('transactions').doc(raw.transactionId)), order = orderSnap.data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    if (!admin && order.buyerId !== uid && order.sellerId !== uid) throw new HttpsError('permission-denied', 'Dossier privé non autorisé.');
    let query = incidentRef(raw.transactionId).orderBy('__name__', 'asc').limit(21);
    if (raw.cursor != null) query = query.startAfter(raw.cursor);
    const page = await tx.get(query), rows = page.docs.slice(0, 20);
    const finance = rows.length ? await financialSource(tx, raw.transactionId, order) : null;
    const pointer = order.trackingHistoryCapture;
    const currentRecord = rows.length && /^tracking_[a-f0-9]{64}$/.test(pointer?.captureId ?? '')
      ? (await tx.get(db.collection('transactions').doc(raw.transactionId)
        .collection('tracking_history').doc(pointer.captureId))).data() : null;
    const info = currentRecord?.info, currentRead = order.trackingRead;
    // The original pointer can survive a newer failed GET. Its immutable native
    // capture must still match both the saved transport identity and the latest
    // authorized read, exactly as the tracking-history reader qualifies it.
    const pointerCurrent = !!currentRecord && currentRecord.protocol === 'tracking_history_v1' &&
      currentRecord.captureId === pointer.captureId && currentRecord.buyerId === order.buyerId &&
      currentRecord.sellerId === order.sellerId && timestamp(currentRecord.recordedAt) &&
      info?.transactionId === raw.transactionId && info.leg === 'forward' &&
      /^[a-f0-9]{64}$/.test(info.sourceHash ?? '') && id(info.readId) &&
      Number.isSafeInteger(info.readVersion) && info.readVersion > 0 &&
      Array.isArray(currentRecord.pageHashes) && currentRecord.pageHashes.every((value: unknown) =>
        typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) &&
      currentRecord.displayHash === hash(['tracking_history_v1', info, currentRecord.pageHashes]) &&
      pointer.protocol === 'tracking_history_v1' && pointer.displayHash === currentRecord.displayHash &&
      pointer.sourceHash === info.sourceHash && pointer.readVersion === info.readVersion &&
      timestamp(pointer.recordedAt) && pointer.recordedAt.isEqual(currentRecord.recordedAt) &&
      trackingIdentity(raw.transactionId, order, 'forward')?.sourceHash === info.sourceHash &&
      currentRead?.schemaVersion === 1 && currentRead.readId === info.readId && currentRead.version === info.readVersion &&
      currentRead.sourceHash === info.sourceHash && currentRead.leg === 'forward' && currentRead.authorizedAt instanceof Timestamp;
    const items = rows.map(row => {
      const record = row.data(), doc = record.document;
      if (record.protocol !== PROTOCOL || record.incidentId !== row.id || record.transactionId !== raw.transactionId ||
          record.buyerId !== order.buyerId || record.sellerId !== order.sellerId || !timestamp(record.recordedAt) ||
          !doc || doc.protocol !== PROTOCOL || doc.incidentId !== row.id || doc.transactionId !== raw.transactionId ||
          doc.buyerId !== order.buyerId || doc.sellerId !== order.sellerId || record.contentHash !== hash(doc)) {
        throw new HttpsError('failed-precondition', 'Ce dossier documentaire doit être rapproché.');
      }
      return { incidentId: row.id, leg: doc.leg, captureId: doc.captureId, displayHash: doc.displayHash,
        incidentRevision: row.updateTime ? `${row.updateTime.seconds}:${row.updateTime.nanoseconds}` : null,
        incidentHash: record.contentHash, financialSourceHash: finance?.sourceHash ?? null,
        trackingSourceHash: doc.trackingSourceHash, providerStatusCode: doc.providerStatusCode,
        providerObservedAt: doc.providerObservedAt, providerOccurredAt: doc.providerOccurredAt,
        recordedAt: iso(record.recordedAt), refund: doc.refund, temporalRelation: doc.temporalRelation,
        currentCapture: pointerCurrent && pointer.captureId === doc.captureId &&
          pointer.displayHash === doc.displayHash && pointer.sourceHash === doc.trackingSourceHash,
        financialSourceCurrent: finance?.sourceHash === doc.financialSourceHash,
        recipientReceiptVerified: false, bankReceiptVerified: false, financialEffectAuthorized: false,
        inventoryReleaseAuthorized: false, humanReviewRequired: true };
    });
    const hasMore = page.size > rows.length;
    return { protocol: PROTOCOL, ownerId: uid, transactionId: raw.transactionId,
      sourceRevision: orderSnap.updateTime ? `${orderSnap.updateTime.seconds}:${orderSnap.updateTime.nanoseconds}` : null, items,
      cursor: hasMore ? rows[rows.length - 1].id : null, hasMore };
  });
}
