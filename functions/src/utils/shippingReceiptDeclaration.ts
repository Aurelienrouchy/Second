/** A buyer's statement is separate from a carrier event, money and recourse.
 * These readers never call providers and never write to an order or ledger. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { acceptedOrderPurchasePolicy, acceptedQuotePurchasePolicy, purchasePolicyTimeline } from './purchasePolicy';
import { exactMixedDebit } from './stripeCheckoutProof';
import { readOperationalNoticeReceipt, type OperationalNoticeInput } from './notifications';

export const RECEIPT_DECLARATION_PROTOCOL = 'buyer_shipping_receipt_declaration_v1';
export const RECEIPT_DECLARATION_STATEMENT = 'Je déclare avoir reçu le colis lié à cette commande. Cette déclaration ne valide pas son contenu et ne ferme aucun recours.';
export const receiptDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const revision = (v: unknown): v is string => typeof v === 'string' && /^\d{1,12}:\d{1,9}$/.test(v);
const nativeRevision = (snap: FirebaseFirestore.DocumentSnapshot) => snap.updateTime
  ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
const nativeDate = (v: unknown): v is Timestamp => v instanceof Timestamp && Number.isFinite(v.toMillis()) &&
  v.toMillis() >= 0 && v.toMillis() <= Date.now();
export const declarationRef = (transactionId: string) => db.collection('shipping_receipt_declarations').doc(transactionId);
export const declarationCommandRef = (uid: string, requestId: string) => db.collection('shipping_receipt_declaration_commands')
  .doc(receiptDigest([uid, requestId]));
export const receiptReview = () => new HttpsError('failed-precondition', 'La déclaration nécessite un rapprochement. Contactez notre équipe.',
  { reason: 'receipt_declaration_reconciliation_required', action: 'contactSupport' });
export interface ReceiptDeclarationInput {
  mode: 'execute' | 'observe' | 'neutralize'; expectedUid: string; transactionId: string; requestId: string;
  statementVersion: typeof RECEIPT_DECLARATION_PROTOCOL; statement: typeof RECEIPT_DECLARATION_STATEMENT; accepted: true;
  expectedSourceRevision: string; expectedSourceHash: string;
}
export interface ReceiptDeclarationPreview { mode: 'preview'; expectedUid: string; transactionId: string }
export function parseReceiptDeclarationInput(uid: string, raw: unknown): ReceiptDeclarationInput | ReceiptDeclarationPreview {
  const invalid = () => new HttpsError('invalid-argument', 'Déclaration de réception invalide.');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
  const d = raw as Record<string, unknown>;
  if (d.expectedUid !== uid) throw new HttpsError('failed-precondition', 'La session a changé.', { reason: 'account_actor_changed' });
  if (!id(d.transactionId)) throw invalid();
  if (d.mode === 'preview') {
    if (Object.keys(d).some(k => !['mode', 'expectedUid', 'transactionId'].includes(k))) throw invalid();
    return d as unknown as ReceiptDeclarationPreview;
  }
  if (Object.keys(d).some(k => !['mode', 'expectedUid', 'transactionId', 'requestId', 'statementVersion', 'statement',
    'accepted', 'expectedSourceRevision', 'expectedSourceHash'].includes(k)) || !['execute', 'observe', 'neutralize'].includes(d.mode as string) ||
      !id(d.requestId) || d.statementVersion !== RECEIPT_DECLARATION_PROTOCOL || d.statement !== RECEIPT_DECLARATION_STATEMENT ||
      d.accepted !== true || !revision(d.expectedSourceRevision) || !hash(d.expectedSourceHash)) throw invalid();
  return d as unknown as ReceiptDeclarationInput;
}
export function declarationInputHash(uid: string, d: ReceiptDeclarationInput): string {
  return receiptDigest([RECEIPT_DECLARATION_PROTOCOL, uid, d.transactionId, d.requestId, d.statementVersion,
    d.statement, d.accepted, d.expectedSourceRevision, d.expectedSourceHash]);
}
export interface DeclarationCommand extends FirebaseFirestore.DocumentData {
  schemaVersion: 1; protocol: typeof RECEIPT_DECLARATION_PROTOCOL; commandId: string; inputHash: string;
  actorUid: string; buyerId: string; sellerId: string; transactionId: string; requestId: string;
  statementVersion: typeof RECEIPT_DECLARATION_PROTOCOL; statement: typeof RECEIPT_DECLARATION_STATEMENT; accepted: true;
  expectedSourceRevision: string; expectedSourceHash: string; recordedAt: Timestamp;
  state: 'committed' | 'neutralized' | 'not_executed';
  reason: null | 'source_changed' | 'source_unqualified' | 'already_declared';
}
export function qualifyDeclarationCommand(raw: FirebaseFirestore.DocumentData | undefined, uid: string,
  d: ReceiptDeclarationInput, commandId: string): DeclarationCommand {
  if (!raw || raw.schemaVersion !== 1 || raw.protocol !== RECEIPT_DECLARATION_PROTOCOL || raw.commandId !== commandId ||
      commandId !== declarationCommandRef(uid, d.requestId).id || raw.transactionId !== d.transactionId || raw.requestId !== d.requestId ||
      raw.actorUid !== uid || raw.buyerId !== uid || !id(raw.sellerId) || raw.sellerId === uid ||
      raw.inputHash !== declarationInputHash(uid, d) || raw.expectedSourceRevision !== d.expectedSourceRevision ||
      raw.expectedSourceHash !== d.expectedSourceHash || raw.statementVersion !== RECEIPT_DECLARATION_PROTOCOL ||
      raw.statement !== RECEIPT_DECLARATION_STATEMENT || raw.accepted !== true || !nativeDate(raw.recordedAt) ||
      !['committed', 'neutralized', 'not_executed'].includes(raw.state) ||
      (raw.state === 'not_executed' ? !['source_changed', 'source_unqualified', 'already_declared'].includes(raw.reason) : raw.reason !== null)) throw receiptReview();
  return raw as DeclarationCommand;
}
export function receiptDeclarationNotice(command: DeclarationCommand): OperationalNoticeInput {
  return { eventKey: `buyer_receipt_declared:${command.transactionId}:${command.commandId}`, userId: command.sellerId,
    type: 'buyer_receipt_declared', title: 'Déclaration de réception du colis',
    message: 'L’acheteur déclare avoir reçu le colis. Cela ne valide pas son contenu et ne ferme aucun recours.',
    data: { ownerId: command.sellerId, transactionId: command.transactionId, receiptDeclarationCommandId: command.commandId } };
}
/** A summary is qualified by its EXACT immutable command and essential notice,
 * never by a status, an arbitrary prior intention or a client field. */
export async function readReceiptDeclaration(tx: FirebaseFirestore.Transaction, transactionId: string,
  raw: FirebaseFirestore.DocumentData | undefined): Promise<DeclarationCommand | null> {
  if (!raw) return null;
  if (!id(raw.actorUid) || !id(raw.requestId) || raw.transactionId !== transactionId ||
      !revision(raw.expectedSourceRevision) || !hash(raw.expectedSourceHash)) throw receiptReview();
  const d: ReceiptDeclarationInput = { mode: 'observe', expectedUid: raw.actorUid, transactionId,
    requestId: raw.requestId, statementVersion: RECEIPT_DECLARATION_PROTOCOL, statement: RECEIPT_DECLARATION_STATEMENT,
    accepted: true, expectedSourceRevision: raw.expectedSourceRevision, expectedSourceHash: raw.expectedSourceHash };
  const ref = declarationCommandRef(raw.actorUid, raw.requestId);
  const summary = qualifyDeclarationCommand(raw, raw.actorUid, d, ref.id);
  const command = qualifyDeclarationCommand((await tx.get(ref)).data(), raw.actorUid, d, ref.id);
  if (summary.state !== 'committed' || command.state !== 'committed' || command.sellerId !== summary.sellerId ||
      !command.recordedAt.isEqual(summary.recordedAt)) throw receiptReview();
  const notice = await readOperationalNoticeReceipt(tx, receiptDeclarationNotice(command));
  if (!notice || notice.notificationId !== command.notificationId || summary.notificationId !== command.notificationId) throw receiptReview();
  return command;
}
export interface ReceiptSource { buyerId: string; sellerId: string; sourceRevision: string | null; sourceHash: string | null;
  qualification: 'native_paid_contract' | 'needs_review' }
/** Native paid-contract qualification. No scan is required or inferred. Missing
 * historical witnesses are review, not a fresh contract or provider lookup. */
export async function readReceiptSource(tx: FirebaseFirestore.Transaction, transactionId: string,
  snap: FirebaseFirestore.DocumentSnapshot): Promise<ReceiptSource> {
  const order = snap.data();
  if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
  if (!id(order.buyerId) || !id(order.sellerId) || order.buyerId === order.sellerId) throw receiptReview();
  const sourceRevision = nativeRevision(snap);
  const fallback: ReceiptSource = { buyerId: order.buyerId, sellerId: order.sellerId, sourceRevision,
    sourceHash: sourceRevision ? receiptDigest([RECEIPT_DECLARATION_PROTOCOL, transactionId, sourceRevision, 'unqualified']) : null,
    qualification: 'needs_review' };
  const policy = acceptedOrderPurchasePolicy(order, transactionId), timeline = purchasePolicyTimeline(order, transactionId);
  if (!policy || !sourceRevision || order.deliveryType !== 'shipping' || !nativeDate(order.createdAt) || !nativeDate(order.paidAt) ||
      order.createdAt.toMillis() > order.paidAt.toMillis() || timeline.nonShipmentStartsAtMs === null ||
      timeline.paymentClockBasis !== 'qualified_payment_recorded_at') return fallback;
  const quoteSnap = await tx.get(db.collection('shipping_quotes').doc(policy.quoteId)), quote = quoteSnap.data();
  if (!quote || quote.transactionId !== transactionId || quote.state !== 'claimed' || quote.ownerId !== order.buyerId ||
      quote.articleId !== order.articleId || quote.sellerId !== order.sellerId || quote.acceptedRateId !== order.shipEngineRateId ||
      quote.acceptedTotal !== order.totalAmount || !acceptedQuotePurchasePolicy(order, transactionId, quote) || !nativeRevision(quoteSnap)) return fallback;
  const rows = await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').where('transactionId', '==', transactionId).limit(101));
  if (rows.size >= 101) return fallback;
  const debits = rows.docs.filter(row => row.data().type === 'purchase_debit');
  const payment = order.nonShipmentPolicyWindow.payment;
  if (payment.kind === 'wallet_ledger') {
    const debit = debits[0]?.data();
    if (debits.length !== 1 || debits[0].id !== payment.referenceId || debit?.transactionId !== transactionId || debit.currency !== 'CAD' ||
        debit.amount !== payment.amountCents || !Number.isSafeInteger(debit.balanceAfter) || debit.balanceAfter < 0 ||
        !(debit.createdAt instanceof Timestamp) || !debit.createdAt.isEqual(order.paidAt) || order.stripePaymentIntentId != null ||
        order.stripeChargeId != null || (order.capturedCardCents != null && order.capturedCardCents !== 0)) return fallback;
  } else {
    if (!/^ch_[A-Za-z0-9]+$/.test(order.stripeChargeId ?? '') || order.walletPayment != null ||
        (payment.walletCents === 0 ? debits.length !== 0 : !exactMixedDebit(order, debits.map(row => ({ id: row.id, data: row.data() })), payment.walletCents)) ||
        debits.some(row => row.data().transactionId !== transactionId || row.data().currency !== 'CAD' ||
          !(row.data().createdAt instanceof Timestamp) || row.data().createdAt.toMillis() > order.paidAt.toMillis())) return fallback;
  }
  return { buyerId: order.buyerId, sellerId: order.sellerId, sourceRevision, qualification: 'native_paid_contract',
    sourceHash: receiptDigest([RECEIPT_DECLARATION_PROTOCOL, transactionId, sourceRevision, policy.hash,
      order.nonShipmentPolicyWindow.sourceHash, nativeRevision(quoteSnap),
      debits.map(row => [row.id, nativeRevision(row), receiptDigest(row.data())]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]) };
}
export function declarationDTO(command: DeclarationCommand | null) {
  return command ? { requestId: command.requestId, commandId: command.commandId, actorUid: command.actorUid,
    recordedAt: command.recordedAt.toDate().toISOString(), sourceRevision: command.expectedSourceRevision, sourceHash: command.expectedSourceHash,
    humanDeclaration: true, physicalReceiptVerified: false, contentValidated: false, recoursesClosed: false } : null;
}
export function receiptCommandDTO(command: DeclarationCommand | null) {
  return command ? { requestId: command.requestId, commandId: command.commandId, inputHash: command.inputHash,
    state: command.state, reason: command.reason, recordedAt: command.recordedAt.toDate().toISOString(),
    expectedSourceRevision: command.expectedSourceRevision, expectedSourceHash: command.expectedSourceHash } : null;
}
