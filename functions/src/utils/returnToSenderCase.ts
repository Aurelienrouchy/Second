/** Explicit participant reports, never a carrier-derived return or money instruction. */
import { createHash } from 'node:crypto';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { trackingIdentity } from '../config/shipEngine';
import { supportHash, supportSourceHash, supportCurrentAdminSession, supportAdmin } from './supportRequest';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
import { prepareOperationalNotices } from './notifications';

const PROTOCOL = 'return_to_sender_case_v1';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const revision = (snap: { updateTime?: Timestamp }) => snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
const collection = (transactionId: string) => db.collection('transactions').doc(transactionId).collection('return_to_sender_cases');
const nativeTime = (value: unknown): value is Timestamp => value instanceof Timestamp &&
  value.toMillis() >= 0 && value.toMillis() <= Date.now();
const privateFailure = () => new HttpsError('permission-denied', 'Commande privée non autorisée.');
const qualifiedGuard = (guard: any, transactionId: string, order: FirebaseFirestore.DocumentData) =>
  !!guard && guard.schemaVersion === 1 && guard.transactionId === transactionId && guard.buyerId === order.buyerId &&
  guard.sellerId === order.sellerId && nativeTime(guard.createdAt) && Array.isArray(guard.caseIds) &&
  guard.caseIds.length > 0 && guard.caseIds.length <= 20 && new Set(guard.caseIds).size === guard.caseIds.length &&
  guard.caseIds.every((value: unknown) => typeof value === 'string' && /^rts_[a-f0-9]{64}$/.test(value));

/** Absence is the only automatic permission. No report withdrawal, DE scan,
 * support response or documentary instruction clears this independent guard. */
export { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
function finance(order: FirebaseFirestore.DocumentData) {
  const source = { refund: order.refund ?? null, refundedAt: order.refundedAt ?? null, stripeRefundId: order.stripeRefundId ?? null,
    refundBlocked: order.refundBlocked ?? null, refundLegacyReconciliationRequired: order.refundLegacyReconciliationRequired ?? null,
    bankDispute: order.bankDispute ?? null, disputeId: order.disputeId ?? null, paidAt: order.paidAt ?? null,
    walletPayment: order.walletPayment ?? null, walletAmountUsed: order.walletAmountUsed ?? null,
    stripePaymentIntentId: order.stripePaymentIntentId ?? null, capturedCardCents: order.capturedCardCents ?? null,
    sellerCreditedCents: order.sellerCreditedCents ?? null, sellerPendingCreditCents: order.sellerPendingCreditCents ?? null,
    fundsReleaseAt: order.fundsReleaseAt ?? null, fundsReleasedAt: order.fundsReleasedAt ?? null, status: order.status ?? null };
  return { sourceHash: supportSourceHash(source), recording: {
    refundSource: order.refund == null ? 'absent' : 'record_present_unverified',
    releaseSource: order.fundsReleasedAt == null ? 'absent' : nativeTime(order.fundsReleasedAt) ? 'native_timestamp_recorded' : 'historical_unknown',
    // This source binds examination of the native records. It does not qualify
    // settlement or infer returned money from refunded/completed/status alone.
    moneyReturnedVerified: false, bankReceiptVerified: false, financialEffectAuthorized: false } };
}
async function readSource(tx: FirebaseFirestore.Transaction, transactionId: string, ownerId: string) {
  const snap = await tx.get(db.collection('transactions').doc(transactionId)), order = snap.data();
  if (!order || order.buyerId === order.sellerId || !id(order.buyerId) || !id(order.sellerId) ||
      (order.buyerId !== ownerId && order.sellerId !== ownerId)) return null;
  const pointer = order.trackingHistoryCapture;
  const captureSnap = /^tracking_[a-f0-9]{64}$/.test(pointer?.captureId ?? '')
    ? await tx.get(snap.ref.collection('tracking_history').doc(pointer.captureId)) : null;
  const capture = captureSnap?.data(), info = capture?.info;
  const captureQualified = !!capture && capture.protocol === 'tracking_history_v1' && capture.captureId === pointer.captureId &&
    capture.buyerId === order.buyerId && capture.sellerId === order.sellerId && nativeTime(capture.recordedAt) &&
    info?.transactionId === transactionId && info.leg === 'forward' && id(info.readId) &&
    Number.isSafeInteger(info.readVersion) && info.readVersion > 0 && /^[a-f0-9]{64}$/.test(info.sourceHash ?? '') &&
    Array.isArray(capture.pageHashes) && capture.pageHashes.every((value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) &&
    capture.displayHash === digest(['tracking_history_v1', info, capture.pageHashes]);
  const read = order.trackingRead;
  const currentCapture = captureQualified && pointer.protocol === 'tracking_history_v1' && pointer.displayHash === capture.displayHash &&
    pointer.sourceHash === info.sourceHash && pointer.readVersion === info.readVersion && nativeTime(pointer.recordedAt) &&
    pointer.recordedAt.isEqual(capture.recordedAt) && trackingIdentity(transactionId, order, 'forward')?.sourceHash === info.sourceHash &&
    read?.schemaVersion === 1 && read.readId === info.readId && read.version === info.readVersion &&
    read.sourceHash === info.sourceHash && read.leg === 'forward' && read.authorizedAt instanceof Timestamp;
  const financial = finance(order), captureReference = captureQualified ? { captureId: capture.captureId as string,
    displayHash: capture.displayHash as string, sourceHash: info.sourceHash as string, readVersion: info.readVersion as number } : null;
  const sourceHash = supportSourceHash({ order, capture: capture ?? null });
  return { order, view: { protocol: 'return_to_sender_source_v1', ownerId, transactionId, orderRevision: revision(snap), sourceHash,
    financialSourceHash: financial.sourceHash, financialRecording: financial.recording,
    capture: captureReference, captureQualification: captureQualified ? 'native_capture' : pointer === undefined ? 'absent' : 'historical_unknown',
    currentCapture, transportContext: order.deliveryType === 'shipping' || order.shipEngineLabelId != null || order.trackingNumber != null,
    reportVerified: false, returnToSenderVerified: false, recipientReceiptVerified: false, contentsVerified: false,
    financialEffectAuthorized: false, inventoryReleaseAuthorized: false } };
}
export function returnToSenderSourceReference(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key =>
    !['orderRevision', 'sourceHash', 'financialSourceHash', 'capture', 'captureQualification'].includes(key)) ||
    typeof value.orderRevision !== 'string' || !/^\d+:\d+$/.test(value.orderRevision) ||
    !['sourceHash', 'financialSourceHash'].every(key => typeof value[key] === 'string' && /^[a-f0-9]{64}$/.test(value[key])) ||
    !['native_capture', 'absent', 'historical_unknown'].includes(value.captureQualification)) throw new HttpsError('invalid-argument', 'Sources exactes de la commande requises.');
  const capture = value.capture;
  if (capture !== null && (!capture || typeof capture !== 'object' || Array.isArray(capture) || Object.keys(capture).some(key =>
      !['captureId', 'displayHash', 'sourceHash', 'readVersion'].includes(key)) || !/^tracking_[a-f0-9]{64}$/.test(capture.captureId ?? '') ||
      !['displayHash', 'sourceHash'].every(key => typeof capture[key] === 'string' && /^[a-f0-9]{64}$/.test(capture[key])) ||
      !Number.isSafeInteger(capture.readVersion) || capture.readVersion < 1) ||
      (value.captureQualification === 'native_capture') !== (capture !== null)) throw new HttpsError('invalid-argument', 'Capture exacte ou absence explicitement inconnue requise.');
  return { orderRevision: value.orderRevision as string, sourceHash: value.sourceHash as string,
    financialSourceHash: value.financialSourceHash as string, capture, captureQualification: value.captureQualification as string };
}
const sourceReference = (view: any) => returnToSenderSourceReference({ orderRevision: view.orderRevision, sourceHash: view.sourceHash,
  financialSourceHash: view.financialSourceHash, capture: view.capture, captureQualification: view.captureQualification });
function caseView(value: any) {
  return { protocol: PROTOCOL, caseId: value.caseId, transactionId: value.transactionId, reporterId: value.reporterId,
    version: value.version, narrative: value.narrative, statementVersion: 'return_to_sender_report_v1',
    source: value.source, recordedAt: value.recordedAt.toDate().toISOString(),
    reportVerified: false, returnToSenderVerified: false, recipientReceiptVerified: false, contentsVerified: false,
    financialEffectAuthorized: false, inventoryReleaseAuthorized: false, guardReleased: false };
}
function qualifiedCase(value: any, transactionId: string, order: FirebaseFirestore.DocumentData) {
  try { returnToSenderSourceReference(value?.source); } catch { return false; }
  return !!value && value.protocol === PROTOCOL && /^rts_[a-f0-9]{64}$/.test(value.caseId ?? '') && value.transactionId === transactionId &&
    value.buyerId === order.buyerId && value.sellerId === order.sellerId && [order.buyerId, order.sellerId].includes(value.reporterId) &&
    value.version === 1 && value.statementVersion === 'return_to_sender_report_v1' &&
    typeof value.narrative === 'string' && !!value.narrative.trim() && value.narrative.length <= 4000 &&
    nativeTime(value.recordedAt) && value.contentHash === supportSourceHash(value.document) &&
    value.contentHash === supportSourceHash({ protocol: value.protocol, caseId: value.caseId, transactionId: value.transactionId,
      reporterId: value.reporterId, buyerId: value.buyerId, sellerId: value.sellerId, version: value.version, narrative: value.narrative,
      statementVersion: value.statementVersion, source: value.source });
}
export async function commandReturnToSender(request: any) {
  const raw = request.data, uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise.');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key =>
      !['mode', 'expectedUid', 'requestId', 'operation', 'command'].includes(key)) || raw.expectedUid !== uid ||
      typeof raw.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(raw.requestId) ||
      !['execute', 'observe', 'neutralize'].includes(raw.operation)) throw new HttpsError('invalid-argument', 'Intention exacte requise.');
  const command = raw.command;
  if (!command || typeof command !== 'object' || Array.isArray(command) || Object.keys(command).some(key =>
      !['transactionId', 'narrative', 'source', 'statementVersion', 'accepted'].includes(key)) || !id(command.transactionId) ||
      typeof command.narrative !== 'string' || !command.narrative.trim() || command.narrative.length > 4000 ||
      command.statementVersion !== 'return_to_sender_report_v1' || command.accepted !== true) throw new HttpsError('invalid-argument', 'Déclaration explicite et commande liées requises.');
  const expected = returnToSenderSourceReference(command.source), payloadHash = supportHash(command);
  const ref = collection(command.transactionId).doc('command_' + digest([uid, raw.requestId]));
  const view = (record: any) => ({ protocol: 'return_to_sender_command_v1', ownerId: uid, requestId: raw.requestId,
    transactionId: command.transactionId, payloadHash, state: record.state, caseId: record.caseId ?? null,
    recordedAt: record.recordedAt instanceof Timestamp ? record.recordedAt.toDate().toISOString() : null,
    reason: record.reason ?? null, financialEffectAuthorized: false, inventoryReleaseAuthorized: false });
  return db.runTransaction(async tx => {
    const prior = (await tx.get(ref)).data();
    if (prior) {
      if (prior.protocol !== 'return_to_sender_command_v1' || prior.ownerId !== uid || prior.requestId !== raw.requestId ||
          prior.transactionId !== command.transactionId || prior.payloadHash !== payloadHash ||
          !['committed', 'not_executed'].includes(prior.state) || !nativeTime(prior.recordedAt)) throw new HttpsError('already-exists', 'Cette référence désigne une autre intention.');
      return view(prior);
    }
    if (raw.operation === 'observe') return view({ state: 'unrecorded' });
    const record = (state: string, reason: string | null, caseId: string | null = null) => {
      const receipt = { protocol: 'return_to_sender_command_v1', ownerId: uid, requestId: raw.requestId,
        transactionId: command.transactionId, payloadHash, command, state, reason, caseId, recordedAt: Timestamp.now() };
      tx.create(ref, receipt); return view(receipt);
    };
    if (raw.operation === 'neutralize') return record('not_executed', 'command_neutralized');
    const current = await readSource(tx, command.transactionId, uid);
    if (!current) throw privateFailure();
    if (!current.view.transportContext) return record('not_executed', 'transport_context_unqualified');
    if (supportSourceHash(sourceReference(current.view)) !== supportSourceHash(expected)) return record('not_executed', 'source_changed');
    const caseId = 'rts_' + digest([uid, command.transactionId, command.narrative, expected.capture, expected.captureQualification,
      expected.financialSourceHash]);
    const caseRef = collection(command.transactionId).doc(caseId), existing = (await tx.get(caseRef)).data();
    if (existing) {
      if (!qualifiedCase(existing, command.transactionId, current.order)) throw new HttpsError('failed-precondition', 'Dossier historique non qualifié.');
      if (!qualifiedGuard(current.order.returnToSenderGuard, command.transactionId, current.order) ||
          !current.order.returnToSenderGuard.caseIds.includes(caseId)) {
        return record('not_executed', 'guard_source_unqualified');
      }
      return record('committed', null, caseId);
    }
    const guard = current.order.returnToSenderGuard;
    if (returnToSenderBlocksProgress(current.order) && !qualifiedGuard(guard, command.transactionId, current.order)) {
      return record('not_executed', 'guard_source_unqualified');
    }
    const caseIds = guard?.caseIds ?? [];
    if (caseIds.length >= 20) return record('not_executed', 'case_capacity_requires_review');
    const document = { protocol: PROTOCOL, caseId, transactionId: command.transactionId, reporterId: uid,
      buyerId: current.order.buyerId, sellerId: current.order.sellerId, version: 1, narrative: command.narrative,
      statementVersion: command.statementVersion, source: expected };
    const notices = await prepareOperationalNotices(tx, [current.order.buyerId, current.order.sellerId].map(userId => ({
      eventKey: `${PROTOCOL}:${command.transactionId}:${caseId}`, userId, type: 'order_moderation',
      title: 'Retour à l’expéditeur signalé', message: 'Un participant a signalé un retour à l’expéditeur. Ce récit doit être examiné par le support. Il ne confirme ni la réception ni le contenu du colis et ne décide pas des fonds ou de la remise en vente.',
      data: { ownerId: userId, transactionId: command.transactionId, returnToSenderCaseId: caseId, financialEffectAuthorized: 'false' },
    })));
    const recordedAt = Timestamp.now();
    tx.create(caseRef, { ...document, document, contentHash: supportSourceHash(document), recordedAt });
    tx.update(db.collection('transactions').doc(command.transactionId), { returnToSenderGuard: { schemaVersion: 1,
      transactionId: command.transactionId, buyerId: current.order.buyerId, sellerId: current.order.sellerId,
      caseIds: [...caseIds, caseId], createdAt: guard?.createdAt ?? recordedAt } });
    notices.commit();
    return record('committed', null, caseId);
  });
}
export async function readReturnToSenderSource(ownerId: string, raw: any) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['mode', 'expectedUid', 'transactionId'].includes(key)) ||
      raw.expectedUid !== ownerId || !id(raw.transactionId)) throw new HttpsError('invalid-argument', 'Compte et commande exacts requis.');
  return db.runTransaction(async tx => {
    const source = await readSource(tx, raw.transactionId, ownerId);
    if (!source) throw privateFailure();
    return source.view;
  });
}
export async function readReturnToSenderSupportSource(tx: FirebaseFirestore.Transaction, transactionId: string, caseId: string, ownerId: string) {
  const current = await readSource(tx, transactionId, ownerId);
  if (!current) return null;
  const snap = await tx.get(collection(transactionId).doc(caseId)), data = snap.data();
  if (!data || !qualifiedCase(data, transactionId, current.order)) return null;
  return { protocol: 'return_to_sender_support_source_v1', reference: { kind: 'return_to_sender_report', transactionId, caseId,
    caseRevision: revision(snap), caseHash: data.contentHash, financialSourceHash: current.view.financialSourceHash,
    orderRevision: current.view.orderRevision }, report: caseView(data), financialRecording: current.view.financialRecording,
    recipientReceiptVerified: false, contentsVerified: false, financialEffectAuthorized: false, inventoryReleaseAuthorized: false };
}
export async function readReturnToSenderCases(request: any) {
  const uid = request.auth?.uid, raw = request.data;
  if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise.');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['mode', 'expectedUid', 'transactionId', 'scope'].includes(key)) ||
      raw.expectedUid !== uid || !id(raw.transactionId) || !['owner', 'admin'].includes(raw.scope ?? 'owner')) throw new HttpsError('invalid-argument', 'Compte et commande exacts requis.');
  const admin = raw.scope === 'admin', currentClaim = admin ? await supportCurrentAdminSession(request) : false;
  return db.runTransaction(async tx => {
    if (admin) await supportAdmin(tx, uid, currentClaim);
    const snap = await tx.get(db.collection('transactions').doc(raw.transactionId)), order = snap.data();
    if (!order || !admin && order.buyerId !== uid && order.sellerId !== uid) throw privateFailure();
    const guard = order.returnToSenderGuard, caseIds = Array.isArray(guard?.caseIds) ? guard.caseIds : [];
    if (returnToSenderBlocksProgress(order) && !qualifiedGuard(guard, raw.transactionId, order)) throw new HttpsError('failed-precondition', 'Garde documentaire à rapprocher.');
    if (caseIds.length > 20 || caseIds.some((value: unknown) => typeof value !== 'string' || !/^rts_[a-f0-9]{64}$/.test(value))) throw new HttpsError('failed-precondition', 'Garde documentaire à rapprocher.');
    const refs: FirebaseFirestore.DocumentReference[] = caseIds.map((value: string) => collection(raw.transactionId).doc(value));
    const docs = refs.length ? await tx.getAll(...refs) : [];
    const items = docs.map(doc => {
      const data = doc.data();
      if (!qualifiedCase(data, raw.transactionId, order)) throw new HttpsError('failed-precondition', 'Dossier à rapprocher.');
      return { ...caseView(data), caseRevision: revision(doc), caseHash: data!.contentHash };
    });
    const financial = finance(order);
    return { protocol: 'return_to_sender_cases_v1', ownerId: uid, transactionId: raw.transactionId, sourceRevision: revision(snap),
      financialSourceHash: financial.sourceHash, financialRecording: financial.recording,
      guardPresent: returnToSenderBlocksProgress(order), items, financialEffectAuthorized: false, inventoryReleaseAuthorized: false };
  });
}

export const RETURN_TO_SENDER_REFUND_OPTIONS = { refundScope: 'full_original_payment', relistArticle: false,
  extraSellerDebitCents: 0, returnCostDeductionCents: 0 } as const;
export type ReturnToSenderCaseReference = { caseId: string; caseRevision: string; caseHash: string };
export type ReturnToSenderFinancialReference = { protocol: 'return_to_sender_financial_reference_v1';
  caseReferences: ReturnToSenderCaseReference[]; caseSetHash: string; financialSourceHash: string;
  authorizationSourceHash: string; cause: string; options: typeof RETURN_TO_SENDER_REFUND_OPTIONS };
const financialReviewRequired = () => new HttpsError('failed-precondition',
  'Les dossiers, les sources et les sommes doivent être examinés avant une nouvelle décision financière.',
  { reason: 'return_to_sender_financial_review_required', newRefundPermissionGranted: false });
export function parseReturnToSenderFinancialReference(value: any): ReturnToSenderFinancialReference {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key =>
      !['protocol', 'caseReferences', 'caseSetHash', 'financialSourceHash', 'authorizationSourceHash', 'cause', 'options'].includes(key)) ||
      value.protocol !== 'return_to_sender_financial_reference_v1' ||
      !['caseSetHash', 'financialSourceHash', 'authorizationSourceHash'].every(key => /^[a-f0-9]{64}$/.test(value[key] ?? '')) ||
      typeof value.cause !== 'string' || !value.cause.trim() || value.cause.trim().length > 300 ||
      !Array.isArray(value.caseReferences) || value.caseReferences.length < 1 || value.caseReferences.length > 20 ||
      value.caseReferences.some((item: any, index: number) => !item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some(key => !['caseId', 'caseRevision', 'caseHash'].includes(key)) ||
        !/^rts_[a-f0-9]{64}$/.test(item.caseId ?? '') || !/^\d+:\d+$/.test(item.caseRevision ?? '') ||
        !/^[a-f0-9]{64}$/.test(item.caseHash ?? '') || index > 0 && value.caseReferences[index - 1].caseId >= item.caseId) ||
      !value.options || Object.keys(value.options).sort().join(',') !== Object.keys(RETURN_TO_SENDER_REFUND_OPTIONS).sort().join(',') ||
      Object.entries(RETURN_TO_SENDER_REFUND_OPTIONS).some(([key, expected]) => value.options[key] !== expected))
    throw new HttpsError('invalid-argument', 'Liste complète des dossiers examinés, cause et options exactes requises.');
  return { protocol: 'return_to_sender_financial_reference_v1', caseReferences: value.caseReferences.map((item: any) =>
    ({ caseId: item.caseId, caseRevision: item.caseRevision, caseHash: item.caseHash })), caseSetHash: value.caseSetHash,
    financialSourceHash: value.financialSourceHash, authorizationSourceHash: value.authorizationSourceHash,
    cause: value.cause.trim(), options: { ...RETURN_TO_SENDER_REFUND_OPTIONS } };
}
/** Reservation changes only these fields. Every other native fact remains
 * bound, including payment split, release history, transport and other guards. */
export function returnToSenderAuthorizationHash(order: FirebaseFirestore.DocumentData, originalStatus?: string) {
  const source: FirebaseFirestore.DocumentData = { ...order, status: originalStatus ?? order.status };
  for (const key of ['refund', 'refundBlocked', 'refundReason', 'refundStartedAt']) delete source[key];
  return supportSourceHash(source);
}
/** Independently check the native set, not just the guard's declared IDs. A
 * missing, extra, saturated or malformed case can never authorize new money. */
export async function readReturnToSenderFinancialSource(tx: FirebaseFirestore.Transaction, transactionId: string,
  order: FirebaseFirestore.DocumentData, originalStatus?: string) {
  if (!qualifiedGuard(order.returnToSenderGuard, transactionId, order)) throw financialReviewRequired();
  const rows = await tx.get(collection(transactionId).orderBy(FieldPath.documentId()).startAt('rts_').endAt('rts_\uf8ff').limit(21));
  if (rows.size < 1 || rows.size >= 21 || rows.size !== order.returnToSenderGuard.caseIds.length ||
      rows.docs.some(doc => !order.returnToSenderGuard.caseIds.includes(doc.id) || !qualifiedCase(doc.data(), transactionId, order)))
    throw financialReviewRequired();
  const caseReferences = rows.docs.map(doc => ({ caseId: doc.id, caseRevision: revision(doc)!, caseHash: doc.data().contentHash as string }));
  if (caseReferences.some(item => item.caseRevision === null)) throw financialReviewRequired();
  const ledgerSources: unknown[] = [];
  for (const ownerId of [order.buyerId, order.sellerId]) {
    const ledger = await tx.get(db.collection('wallets').doc(ownerId).collection('ledger').where('transactionId', '==', transactionId).limit(101));
    if (ledger.size >= 101) throw financialReviewRequired();
    const entries = ledger.docs.filter(doc => {
      // The engine's one own reservation is not a second financial source.
      // Its exact identity and amount must still be native and qualified.
      if (originalStatus !== undefined && ownerId === order.sellerId && doc.id === `refund_hold_${order.refund?.intentId}`) {
        const value = doc.data();
        if (value.type !== 'refund_hold' || value.refundIntentId !== order.refund.intentId ||
            value.amount !== order.refund.freezeCents || !nativeTime(value.createdAt)) throw financialReviewRequired();
        return false;
      }
      return true;
    });
    if (entries.some(doc => doc.data().transactionId !== transactionId || !nativeTime(doc.data().createdAt) ||
        !Number.isSafeInteger(doc.data().amount) || doc.data().amount < 0 ||
        ['refund_credit', 'refund_debit', 'refund_hold'].includes(doc.data().type))) throw financialReviewRequired();
    if (ownerId === order.sellerId) {
      const credits = entries.filter(doc => doc.data().type === 'sale_credit');
      const debts = entries.filter(doc => doc.data().type === 'debt_repayment' && doc.data().description === 'Vente — régularisation du solde dû');
      const net = credits.reduce((sum, doc) => sum + doc.data().amount, 0), debt = debts.reduce((sum, doc) => sum + doc.data().amount, 0);
      if (credits.length > 1 || debts.length > 1 || net + debt !== order.sellerCreditedCents ||
          order.sellerPendingCreditCents != null && order.sellerPendingCreditCents !== net ||
          order.sellerDebtRepaidCents != null && order.sellerDebtRepaidCents !== debt) throw financialReviewRequired();
    }
    ledgerSources.push([ownerId, entries.map(doc => [doc.id, doc.data()]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
  }
  const financial = finance(order);
  return { protocol: 'return_to_sender_financial_source_v1' as const, caseReferences,
    caseSetHash: supportHash(caseReferences), financialSourceHash: financial.sourceHash,
    authorizationSourceHash: supportSourceHash([returnToSenderAuthorizationHash(order, originalStatus), ledgerSources]),
    reports: rows.docs.map(doc => ({ ...caseView(doc.data()), caseRevision: revision(doc), caseHash: doc.data().contentHash })),
    qualification: 'qualified' as const, financialPermissionScope: 'full_original_refund_only' as const,
    options: { ...RETURN_TO_SENDER_REFUND_OPTIONS }, inventoryPermissionGranted: false, physicalPossession: 'unknown', guardReleased: false,
    // Internal snapshots never form part of an SDK response.
    cases: rows };
}
