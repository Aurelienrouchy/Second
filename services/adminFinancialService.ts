import { collection, documentId, getDocs, limit, or, orderBy, query, startAfter, where, type QueryNonFilterConstraint } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, firestore, functions } from '@/config/firebaseConfig';
import { mapTransaction, readTransactionDate } from '@/services/transactionService';
import { getRefundPresentation, hasUnsettledRefund } from '@/utils/refundPresentation';
import type { Transaction } from '@/types/transaction';
import { assertTradeSessionCurrent, captureTradeSession, type TradeSession } from '@/services/tradeOperation';
import { parseAdminReturnToSenderResumeSource } from '@/services/adminFinancialDecisionJournal';
import type { AdminReturnToSenderResumeSource } from '@/types/adminReturnToSenderFinancial';
import type { AdminProductResumeSource } from '@/types/adminProductFinancial';
import { productFinancialCaseId } from '@/services/adminProductFinancialSource';

export interface AdminPage<T> { items: T[]; cursor: string | null; hasMore: boolean }
export interface CaptureEvidence {
  paymentIntentId?: string | null;
  observedPaymentIntentId?: string | null;
  candidateReference?: string | null;
  candidateTransactionId?: string | null;
  originalPaymentIntentId?: string | null;
  currency?: string | null;
  collectedAmountCents?: number | null;
  requestedAmountCents?: number | null;
  status?: string | null;
  checkedAtMs?: number | null;
}
export interface CaptureOrderProof {
  transactionId: string;
  status: string | null;
  paymentIntentId: string | null;
  currency: 'CAD' | null;
  totalCents: number | null;
  walletCents: number | null;
  capturedCardCents: number | null;
  stripeChargeId: string | null;
  paidAtMs: number | null;
  intentId: string | null;
  intentVersion: number | null;
  orderRevision: string | null;
  intentRevision: string | null;
  sourceHash: string;
}
export interface CaptureCheckoutProof {
  evidenceKind: 'native_checkout_without_order_v1';
  transactionId: string; articleId: string; buyerId: string; sellerId: string;
  paymentIntentId: string; stripeChargeId: string | null;
  intentId: string; intentVersion: number; quoteId: string; rateId: string;
  totalCents: number; walletCents: number; cardCents: number; currency: 'CAD';
  authorizedAtMs: number; acceptedAtMs: number;
  intentRevision: string; quoteRevision: string; sourceHash: string;
}
export interface CaptureAnomaly {
  type: 'payment_capture_reconciliation';
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
  sourceRevision?: string | null;
  firstEvidence: CaptureEvidence;
  lastEvidence: CaptureEvidence;
  currentProviderProof: CaptureEvidence | null;
  currentCheckoutProof?: CaptureCheckoutProof | null;
  providerLookupState: 'not_checked' | 'verified' | 'invalid' | 'unavailable';
  status: 'pending';
  actionRequired: true;
}
interface CaptureInspectionBase {
  type: 'payment_capture_reconciliation';
  operationId: string;
  automaticRefundAllowed: false;
  automaticCaptureAllowed: false;
  automaticCardRefundAllowed: false;
  paymentPermissionGranted: false;
  reason: string;
  currentOrderProof: CaptureOrderProof | null;
  currentCheckoutProof: CaptureCheckoutProof | null;
  message: string;
  signedEvidence: CaptureEvidence;
  currentProviderProof: CaptureEvidence | null;
  providerLookupState: 'verified' | 'invalid' | 'unavailable';
}
export interface CapturePendingInspection extends CaptureInspectionBase {
  status: 'pending';
  actionRequired: true;
  resolution: null;
  paymentCommitted: false;
  qualified: false;
}
export interface CaptureResolvedInspection extends CaptureInspectionBase {
  status: 'resolved';
  actionRequired: false;
  resolution: 'purchase_payment_committed';
  paymentCommitted: true;
  qualified: true;
  currentOrderProof: CaptureOrderProof;
}
export type CaptureInspectionResult = CapturePendingInspection | CaptureResolvedInspection;
export interface CheckoutProviderProof {
  paymentIntentId: string | null;
  status: string | null;
  currency: string | null;
  requestedCents: number | null;
  receivedCents: number | null;
  capturableCents: number | null;
  confirmationMethod: string | null;
  captureMethod: string | null;
  transactionId: string | null;
  buyerId: string | null;
  sellerId: string | null;
  checkoutIntentId: string | null;
  checkedAtMs: number | null;
}
export interface CheckoutOrderProof {
  transactionId: string | null;
  buyerId: string | null;
  sellerId: string | null;
  status: string | null;
  paymentIntentId: string | null;
  totalCents: number | null;
  walletCents: number | null;
  intentId: string | null;
  intentVersion: number | null;
  intentState: string | null;
  walletLedgerId: string | null;
  authorizedAtMs: number | null;
  paidAtMs: number | null;
  capturedCardCents: number | null;
  stripeChargeId: string | null;
}
export interface CheckoutAnomaly {
  type: 'payment_checkout_reconciliation';
  id: string;
  transactionId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  sourceRevision?: string | null;
  kind: string | null;
  status: 'pending';
  actionRequired: true;
  qualified: boolean;
  reason: string | null;
  currentProviderProof: CheckoutProviderProof | null;
  currentOrderProof: CheckoutOrderProof | null;
}
interface CheckoutInspectionBase {
  type: 'payment_checkout_reconciliation';
  protocol: 'checkout_reconciliation_v1';
  operationId: string;
  transactionId: string;
  kind: string;
  qualified: boolean;
  reason: string;
  automaticCaptureAllowed: false;
  automaticRefundAllowed: false;
  automaticCardRefundAllowed: false;
  paymentPermissionGranted: false;
  newConfirmationAllowed?: false;
}
export interface CheckoutPendingInspection extends CheckoutInspectionBase {
  status: 'pending';
  actionRequired: true;
  localRestitutionMayCommit: true;
  resolution: null;
  paymentCommitted: false;
  currentProviderProof: CheckoutProviderProof;
  currentOrderProof: CheckoutOrderProof;
}
export interface CheckoutResolvedInspection extends CheckoutInspectionBase {
  kind: 'cancellation_unsettled';
  status: 'resolved';
  actionRequired: false;
  qualified: true;
  localRestitutionCommitted: true;
  cancellationCommitted: true;
  walletRefundCommitted: true;
  refundedCents: number;
  replay: boolean;
  resolution: 'canceled_purchase_committed';
  paymentCommitted?: false;
}
export interface CheckoutPaidInspection extends CheckoutInspectionBase {
  status: 'resolved';
  actionRequired: false;
  qualified: true;
  resolution: 'purchase_payment_committed';
  paymentCommitted: true;
  localRestitutionMayCommit: true;
  currentProviderProof: CheckoutProviderProof;
  currentOrderProof: CheckoutOrderProof;
}
export type AdminPaymentAnomaly = CaptureAnomaly | CheckoutAnomaly;
export type AdminPaymentInspection = CaptureInspectionResult | CheckoutPendingInspection | CheckoutResolvedInspection | CheckoutPaidInspection;
export async function requireAdminClaim(userId: string, forceRefresh = false): Promise<boolean> {
  const current = auth.currentUser;
  if (!current || current.uid !== userId) return false;
  const token = await current.getIdTokenResult(forceRefresh);
  return auth.currentUser === current && auth.currentUser.uid === userId && token.claims.admin === true;
}
/** Pure discovery; qualification never authorizes a new refund or a provider request. */
export async function observeAdminReturnToSenderResumeSource(userId: string, transactionId: string, assertContext: () => void, decisionContext?: 'transport_review'): Promise<AdminReturnToSenderResumeSource> {
  const session = captureTradeSession(userId); assertContext();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(transactionId) || !await requireAdminClaim(userId, true)) throw new Error('Accès administrateur requis.');
  assertTradeSessionCurrent(session); assertContext();
  const result = await httpsCallable<unknown, unknown>(functions, 'adminRefundTransaction')({mode: 'resume_source_observe', expectedAdminUid: session.uid, transactionId, ...(decisionContext ? {decisionContext} : {})});
  assertTradeSessionCurrent(session); assertContext();
  return parseAdminReturnToSenderResumeSource(result.data, session.uid, transactionId);
}
export async function observeAdminProductResumeSource(uid: string, transactionId: string, assertContext: () => void, material = false, topic: 'authenticity' | 'nonconformity' | 'parcel_delivery' = 'authenticity', parcel = false): Promise<AdminProductResumeSource> {
  const session = captureTradeSession(uid); assertContext();
  const expectedCase = await productFinancialCaseId(transactionId); assertTradeSessionCurrent(session); assertContext();
  if (!await requireAdminClaim(uid, true)) throw new Error('Accès administrateur requis.'); assertTradeSessionCurrent(session); assertContext();
  const result = await httpsCallable<unknown, unknown>(functions, 'adminRefundTransaction')({mode: 'resume_source_observe', expectedAdminUid: uid,
    transactionId, capability: 'product_review_financial_v1', decisionContext: 'product_review', ...(material || parcel ? {productReviewTopic: topic} : {}), ...(material ? {materialCapability: 'product_review_material_v1'} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {})});
  assertTradeSessionCurrent(session); assertContext(); const v = result.data;
  if (!record(v) || v.protocol !== 'admin_product_review_resume_source_v1' || v.productReviewCaseId !== expectedCase ||
    v.productReviewTopic !== topic || (v.materialCapability === 'product_review_material_v1') !== material || v.materialCapability !== undefined && !material || (v.parcelCapability === 'product_review_parcel_v1') !== parcel || v.parcelCapability !== undefined && !parcel ||
    v.authenticityVerified !== false || v.expertiseVerified !== false) throw new Error('La reprise d’origine doit être qualifiée.');
  const {productReviewCaseId, productReviewTopic, authenticityVerified, expertiseVerified, materialCapability, parcelCapability, ...base} = v;
  const parsed = parseAdminReturnToSenderResumeSource({...base, protocol: 'admin_return_to_sender_resume_source_v1'}, uid, transactionId);
  return {...parsed, protocol: 'admin_product_review_resume_source_v1', productReviewCaseId: productReviewCaseId as string,
    productReviewTopic: productReviewTopic as 'authenticity' | 'nonconformity' | 'parcel_delivery', authenticityVerified: authenticityVerified as false, expertiseVerified: expertiseVerified as false,
    ...(materialCapability ? {materialCapability: 'product_review_material_v1' as const} : {}), ...(parcelCapability ? {parcelCapability: 'product_review_parcel_v1' as const} : {})};
}
async function assertAdmin(userId: string, assertContext?: () => void): Promise<TradeSession> {
  const session = captureTradeSession(userId); assertContext?.();
  if (!await requireAdminClaim(userId)) throw new Error('Accès administrateur requis.');
  assertTradeSessionCurrent(session); assertContext?.();
  return session;
}
function pageConstraints(cursor?: string | null): QueryNonFilterConstraint[] {
  return [orderBy(documentId(), 'asc'), ...(cursor ? [startAfter(cursor)] : []), limit(50)];
}
export async function getAdminRefundPage(userId: string, cursor?: string | null, assertContext?: () => void): Promise<AdminPage<Transaction>> {
  const session = await assertAdmin(userId, assertContext);
  // Every page targets refund evidence/legacy markers. Empty filtered pages
  // retain their cursor: they do not assert global absence of obligations.
  const snapshot = await getDocs(query(collection(firestore, 'transactions'), or(
    where('refundBlocked', '==', true), where('refundLegacyReconciliationRequired', '==', true),
    where('refund.state', 'in', ['requested', 'pending', 'requires_action', 'unknown', 'succeeded', 'failed', 'canceled', 'reconciliation_required']),
    where('status', 'in', ['refund_in_progress', 'refund_action_required', 'refunded']),
  ), ...pageConstraints(cursor)));
  assertTradeSessionCurrent(session); assertContext?.();
  const items = snapshot.docs.map(d => mapTransaction(d.id, d.data())).filter(tx => hasUnsettledRefund(tx) || getRefundPresentation(tx, 'admin')?.confirmed === false);
  return {items, cursor: snapshot.docs.at(-1)?.id ?? null, hasMore: snapshot.docs.length === 50};
}

function evidence(value: unknown): CaptureEvidence {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: Record<string, string | number | null> = {};
  for (const field of ['paymentIntentId', 'observedPaymentIntentId', 'candidateReference', 'candidateTransactionId', 'originalPaymentIntentId', 'currency', 'status']) {
    result[field] = typeof source[field] === 'string' ? source[field] : null;
  }
  for (const field of ['collectedAmountCents', 'requestedAmountCents']) {
    const n = source[field];
    result[field] = typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
  }
  result.checkedAtMs = time(source.checkedAtMs);
  return result;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === 'string' && value.length <= 256 ? value : null;
const cents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const amount = (value: unknown): number | null => cents(value) ? value : null;
const time = (value: unknown): number | null => cents(value) && value > 0 && Number.isFinite(new Date(value).getTime()) ? value : null;
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
// Firebase identities are opaque; command/provider identifiers keep their own strict grammar.
const ownerIdentity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
function revision(value: unknown): value is string {
  if (typeof value !== 'string' || !/^-?\d+:\d{1,9}$/.test(value)) return false;
  const [seconds, nanoseconds] = value.split(':').map(Number);
  return Number.isSafeInteger(seconds) && Number.isInteger(nanoseconds) && nanoseconds >= 0 && nanoseconds < 1_000_000_000;
}
function sourceRevision(value: unknown): string | null {
  if (!record(value)) return null;
  const candidate = `${value.seconds}:${value.nanoseconds}`;
  return revision(candidate) ? candidate : null;
}
function captureOrderProof(value: unknown): CaptureOrderProof | null {
  if (value === null) return null;
  if (!record(value) || !identity(value.transactionId) || value.currency !== null && value.currency !== 'CAD' ||
      !validProof(value, ['status', 'paymentIntentId', 'stripeChargeId', 'intentId'],
        ['totalCents', 'walletCents', 'capturedCardCents', 'intentVersion'], []) ||
      value.paidAtMs !== null && (typeof value.paidAtMs !== 'number' || !Number.isFinite(value.paidAtMs) || !Number.isFinite(new Date(value.paidAtMs).getTime())) ||
      value.orderRevision !== null && !revision(value.orderRevision) || value.intentRevision !== null && !revision(value.intentRevision) ||
      typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash)) throw invalidInspection();
  return {transactionId: value.transactionId, status: value.status as string | null, paymentIntentId: value.paymentIntentId as string | null,
    currency: value.currency, totalCents: value.totalCents as number | null, walletCents: value.walletCents as number | null,
    capturedCardCents: value.capturedCardCents as number | null, stripeChargeId: value.stripeChargeId as string | null,
    paidAtMs: value.paidAtMs as number | null, intentId: value.intentId as string | null, intentVersion: value.intentVersion as number | null,
    orderRevision: value.orderRevision as string | null, intentRevision: value.intentRevision as string | null, sourceHash: value.sourceHash};
}
function captureCheckoutProof(value: unknown): CaptureCheckoutProof | null {
  // A missing legacy field is unavailable. A present malformed proof never falls back.
  if (value === null || value === undefined) return null;
  const keys = ['evidenceKind', 'transactionId', 'articleId', 'buyerId', 'sellerId', 'paymentIntentId', 'stripeChargeId',
    'intentId', 'intentVersion', 'quoteId', 'rateId', 'totalCents', 'walletCents', 'cardCents', 'currency',
    'authorizedAtMs', 'acceptedAtMs', 'intentRevision', 'quoteRevision', 'sourceHash'];
  if (!record(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
    value.evidenceKind !== 'native_checkout_without_order_v1' || !identity(value.transactionId) || !identity(value.articleId) ||
    !ownerIdentity(value.buyerId) || !ownerIdentity(value.sellerId) || value.buyerId === value.sellerId ||
    typeof value.paymentIntentId !== 'string' || !/^pi_[A-Za-z0-9]+$/.test(value.paymentIntentId) ||
    !(value.stripeChargeId === null || typeof value.stripeChargeId === 'string' && /^ch_[A-Za-z0-9]+$/.test(value.stripeChargeId)) ||
    typeof value.intentId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.intentId) ||
    !cents(value.intentVersion) || value.intentVersion < 3 || value.intentVersion >= Number.MAX_SAFE_INTEGER ||
    !identity(value.quoteId) || typeof value.rateId !== 'string' || !/^se-[A-Za-z0-9-]+$/.test(value.rateId) ||
    !cents(value.totalCents) || !cents(value.walletCents) || !cents(value.cardCents) || value.walletCents >= value.totalCents ||
    value.cardCents < 50 || value.cardCents !== value.totalCents - value.walletCents || value.currency !== 'CAD' ||
    time(value.authorizedAtMs) === null || time(value.acceptedAtMs) === null ||
    (value.acceptedAtMs as number) > (value.authorizedAtMs as number) || !revision(value.intentRevision) || !revision(value.quoteRevision) ||
    typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash)) throw invalidInspection();
  return {...value} as unknown as CaptureCheckoutProof;
}
function checkoutProviderProof(value: unknown): CheckoutProviderProof | null {
  if (!record(value)) return null;
  return {paymentIntentId: text(value.paymentIntentId), status: text(value.status), currency: text(value.currency),
    requestedCents: amount(value.requestedCents), receivedCents: amount(value.receivedCents), capturableCents: amount(value.capturableCents),
    confirmationMethod: text(value.confirmationMethod), captureMethod: text(value.captureMethod), transactionId: text(value.transactionId),
    buyerId: text(value.buyerId), sellerId: text(value.sellerId), checkoutIntentId: text(value.checkoutIntentId), checkedAtMs: time(value.checkedAtMs)};
}
function checkoutOrderProof(value: unknown): CheckoutOrderProof | null {
  if (!record(value)) return null;
  return {transactionId: text(value.transactionId), buyerId: text(value.buyerId), sellerId: text(value.sellerId), status: text(value.status),
    paymentIntentId: text(value.paymentIntentId), totalCents: amount(value.totalCents), walletCents: amount(value.walletCents),
    intentId: text(value.intentId), intentVersion: amount(value.intentVersion), intentState: text(value.intentState), walletLedgerId: text(value.walletLedgerId),
    authorizedAtMs: time(value.authorizedAtMs), paidAtMs: time(value.paidAtMs), capturedCardCents: amount(value.capturedCardCents), stripeChargeId: text(value.stripeChargeId)};
}
export async function getAdminCapturePage(userId: string, cursor?: string | null, assertContext?: () => void): Promise<AdminPage<AdminPaymentAnomaly>> {
  const session = await assertAdmin(userId, assertContext);
  const snapshot = await getDocs(query(collection(firestore, 'failed_operations'),
    where('type', 'in', ['payment_capture_reconciliation', 'payment_checkout_reconciliation']), where('status', '==', 'pending'), ...pageConstraints(cursor)));
  assertTradeSessionCurrent(session); assertContext?.();
  return {items: snapshot.docs.map((d): AdminPaymentAnomaly => {
    const data = d.data();
    const payload: Record<string, unknown> = record(data.payload) ? data.payload : {};
    if (data.type === 'payment_checkout_reconciliation') return {type: 'payment_checkout_reconciliation', id: d.id,
      transactionId: identity(data.refId) ? data.refId : null, createdAt: readTransactionDate(data.createdAt), updatedAt: readTransactionDate(data.lastProofCheckedAt),
      sourceRevision: JSON.stringify([sourceRevision(data.updatedAt), sourceRevision(data.lastProofCheckedAt)]),
      kind: text(payload.kind), qualified: payload.qualified === true, reason: text(payload.reason), status: 'pending', actionRequired: true,
      currentProviderProof: checkoutProviderProof(payload.currentProviderProof), currentOrderProof: checkoutOrderProof(payload.currentOrderProof)};
    const missingOrder = captureCheckoutProof(payload.currentCheckoutProof);
    if (missingOrder && (payload.reason !== 'native_checkout_link_found_order_missing' || payload.currentOrderProof !== null || payload.qualified !== false ||
      payload.paymentCommitted !== false || payload.providerLookupState !== 'verified' || missingOrder.stripeChargeId === null ||
      !record(payload.currentProviderProof) || payload.currentProviderProof.paymentIntentId !== missingOrder.paymentIntentId ||
      payload.currentProviderProof.currency !== 'cad' || payload.currentProviderProof.status !== 'succeeded' ||
      payload.currentProviderProof.collectedAmountCents !== missingOrder.cardCents || payload.currentProviderProof.requestedAmountCents !== missingOrder.cardCents ||
      !record(payload.signedEvidence) || payload.signedEvidence.observedPaymentIntentId !== missingOrder.paymentIntentId)) throw invalidInspection();
    return {type: 'payment_capture_reconciliation', id: d.id, createdAt: readTransactionDate(data.createdAt), updatedAt: readTransactionDate(data.lastProofCheckedAt),
      sourceRevision: JSON.stringify([sourceRevision(data.updatedAt), sourceRevision(data.lastProofCheckedAt)]),
      firstEvidence: evidence(payload.signedEvidence), lastEvidence: evidence(payload.lastSignedEvidence),
      currentCheckoutProof: missingOrder,
      currentProviderProof: payload.currentProviderProof ? evidence(payload.currentProviderProof) : null,
      providerLookupState: payload.providerLookupState === 'verified' || payload.providerLookupState === 'invalid' || payload.providerLookupState === 'unavailable' ? payload.providerLookupState : 'not_checked',
      status: 'pending', actionRequired: true};
  }), cursor: snapshot.docs.at(-1)?.id ?? null, hasMore: snapshot.docs.length === 50};
}
const invalidInspection = () => new Error('Le résultat du rapprochement reste à vérifier. Relisez ce même dossier ; aucune nouvelle opération carte ne sera lancée.');
function validProof(value: unknown, strings: string[], numbers: string[], times: string[]): boolean {
  return record(value) && strings.every(key => value[key] === null || text(value[key]) !== null) &&
    numbers.every(key => value[key] === null || cents(value[key])) && times.every(key => value[key] === null || time(value[key]) !== null);
}
function parseInspection(raw: unknown, operationId: string, transactionId?: string | null): AdminPaymentInspection {
  if (!record(raw) || raw.operationId !== operationId || raw.automaticRefundAllowed !== false) throw invalidInspection();
  if (operationId.startsWith('capture_')) {
    if (typeof raw.message !== 'string' || !text(raw.reason) || raw.automaticCaptureAllowed !== false ||
        raw.automaticCardRefundAllowed !== false || raw.paymentPermissionGranted !== false || !record(raw.signedEvidence) ||
        !['verified', 'invalid', 'unavailable'].includes(String(raw.providerLookupState)) ||
        raw.currentProviderProof !== null && !record(raw.currentProviderProof)) throw invalidInspection();
    const proof = captureOrderProof(raw.currentOrderProof);
    const checkoutProof = captureCheckoutProof(raw.currentCheckoutProof);
    if (checkoutProof && (raw.reason !== 'native_checkout_link_found_order_missing' || raw.currentOrderProof !== null ||
      raw.status !== 'pending' || raw.qualified !== false || raw.paymentCommitted !== false || raw.providerLookupState !== 'verified' ||
      checkoutProof.stripeChargeId === null || !record(raw.currentProviderProof) || raw.currentProviderProof.paymentIntentId !== checkoutProof.paymentIntentId ||
      raw.currentProviderProof.currency !== 'cad' || raw.currentProviderProof.status !== 'succeeded' ||
      raw.currentProviderProof.collectedAmountCents !== checkoutProof.cardCents || raw.currentProviderProof.requestedAmountCents !== checkoutProof.cardCents ||
      raw.signedEvidence.observedPaymentIntentId !== checkoutProof.paymentIntentId)) throw invalidInspection();
    const base: CaptureInspectionBase = {type: 'payment_capture_reconciliation', operationId, automaticRefundAllowed: false,
      automaticCaptureAllowed: false, automaticCardRefundAllowed: false, paymentPermissionGranted: false, reason: raw.reason as string, currentOrderProof: proof,
      currentCheckoutProof: checkoutProof,
      message: raw.message, signedEvidence: evidence(raw.signedEvidence), currentProviderProof: raw.currentProviderProof === null ? null : evidence(raw.currentProviderProof),
      providerLookupState: raw.providerLookupState as CaptureInspectionResult['providerLookupState']};
    if (raw.status === 'pending' && raw.actionRequired === true && raw.resolution === null && raw.paymentCommitted === false && raw.qualified === false &&
        raw.reason !== 'purchase_payment_committed') return {...base, status: 'pending', actionRequired: true, resolution: null, paymentCommitted: false, qualified: false};
    const provider = base.currentProviderProof;
    if (raw.status === 'resolved' && raw.actionRequired === false && raw.resolution === 'purchase_payment_committed' && raw.paymentCommitted === true &&
        raw.qualified === true && raw.reason === 'purchase_payment_committed' && raw.providerLookupState === 'verified' && proof &&
        ['paid', 'label_created', 'shipped', 'delivered', 'completed'].includes(proof.status ?? '') && /^pi_[A-Za-z0-9]+$/.test(proof.paymentIntentId ?? '') &&
        proof.currency === 'CAD' && proof.totalCents !== null && proof.totalCents > 0 && proof.walletCents !== null && proof.walletCents < proof.totalCents &&
        proof.capturedCardCents !== null && proof.capturedCardCents >= 50 && proof.capturedCardCents === proof.totalCents - proof.walletCents &&
        /^ch_[A-Za-z0-9]+$/.test(proof.stripeChargeId ?? '') && proof.paidAtMs !== null && !!proof.intentId && proof.intentVersion !== null && proof.intentVersion >= 1 &&
        proof.orderRevision !== null && proof.intentRevision !== null && provider?.paymentIntentId === proof.paymentIntentId && provider.currency === 'cad' &&
        provider.status === 'succeeded' && provider.collectedAmountCents === proof.capturedCardCents && provider.requestedAmountCents === proof.capturedCardCents &&
        base.signedEvidence.observedPaymentIntentId === proof.paymentIntentId) return {...base, status: 'resolved', actionRequired: false,
          resolution: 'purchase_payment_committed', paymentCommitted: true, qualified: true, currentOrderProof: proof};
    throw invalidInspection();
  }
  if (raw.protocol !== 'checkout_reconciliation_v1' || !identity(raw.transactionId) || raw.transactionId !== transactionId ||
      !text(raw.kind) || !text(raw.reason) || typeof raw.qualified !== 'boolean' || raw.automaticCaptureAllowed !== false ||
      raw.automaticCardRefundAllowed !== false || raw.paymentPermissionGranted !== false ||
      raw.newConfirmationAllowed !== undefined && raw.newConfirmationAllowed !== false) throw invalidInspection();
  const base: CheckoutInspectionBase = {type: 'payment_checkout_reconciliation', protocol: 'checkout_reconciliation_v1', operationId,
    transactionId: raw.transactionId, kind: raw.kind as string, reason: raw.reason as string, qualified: raw.qualified,
    automaticCaptureAllowed: false, automaticRefundAllowed: false, automaticCardRefundAllowed: false, paymentPermissionGranted: false,
    ...(raw.newConfirmationAllowed === false ? {newConfirmationAllowed: false} : {})};
  if (raw.status === 'resolved' && raw.actionRequired === false && raw.qualified === true && raw.kind === 'cancellation_unsettled' &&
      raw.resolution === 'canceled_purchase_committed' && raw.reason === 'canceled_purchase_committed' && raw.localRestitutionCommitted === true &&
      raw.cancellationCommitted === true && raw.walletRefundCommitted === true && cents(raw.refundedCents) && typeof raw.replay === 'boolean' &&
      (raw.paymentCommitted === undefined || raw.paymentCommitted === false)) return {...base, status: 'resolved', actionRequired: false, qualified: true,
        kind: 'cancellation_unsettled', resolution: 'canceled_purchase_committed', localRestitutionCommitted: true,
        cancellationCommitted: true, walletRefundCommitted: true, refundedCents: raw.refundedCents, replay: raw.replay};
  const p = checkoutProviderProof(raw.currentProviderProof), o = checkoutOrderProof(raw.currentOrderProof);
  if (!p || !o || o.transactionId !== raw.transactionId || raw.localRestitutionMayCommit !== true || raw.newConfirmationAllowed !== false ||
      !validProof(raw.currentProviderProof, ['paymentIntentId', 'status', 'currency', 'confirmationMethod', 'captureMethod', 'transactionId', 'buyerId', 'sellerId', 'checkoutIntentId'],
        ['requestedCents', 'receivedCents', 'capturableCents'], ['checkedAtMs']) || p.checkedAtMs === null ||
      !validProof(raw.currentOrderProof, ['transactionId', 'buyerId', 'sellerId', 'status', 'paymentIntentId', 'intentId', 'intentState', 'walletLedgerId', 'stripeChargeId'],
        ['totalCents', 'walletCents', 'intentVersion', 'capturedCardCents'], ['authorizedAtMs', 'paidAtMs'])) throw invalidInspection();
  if (raw.qualified && (!ownerIdentity(o.buyerId) || !ownerIdentity(o.sellerId) || o.buyerId === o.sellerId ||
      p.transactionId !== raw.transactionId || p.buyerId !== o.buyerId || p.sellerId !== o.sellerId || p.paymentIntentId !== o.paymentIntentId ||
      !/^pi_[A-Za-z0-9]+$/.test(p.paymentIntentId ?? '') || p.checkoutIntentId !== o.intentId || !o.intentId ||
      o.intentVersion === null || o.intentVersion < 1 || o.totalCents === null || o.walletCents === null ||
      o.totalCents - o.walletCents < 50 || p.requestedCents !== o.totalCents - o.walletCents || p.currency !== 'cad')) throw invalidInspection();
  if (raw.status === 'pending' && raw.actionRequired === true && raw.resolution === null && raw.paymentCommitted === false) return {
    ...base, status: 'pending', actionRequired: true, resolution: null, paymentCommitted: false, localRestitutionMayCommit: true,
    currentProviderProof: p, currentOrderProof: o};
  // This acknowledges an existing server settlement. A provider success alone cannot close the dossier.
  if (raw.status === 'resolved' && raw.actionRequired === false && raw.qualified === true && raw.resolution === 'purchase_payment_committed' &&
      raw.reason === 'purchase_payment_committed' && raw.paymentCommitted === true && p.status === 'succeeded' && p.currency === 'cad' &&
      p.transactionId === raw.transactionId && p.paymentIntentId === o.paymentIntentId && /^pi_[A-Za-z0-9]+$/.test(p.paymentIntentId ?? '') &&
      p.buyerId === o.buyerId && p.sellerId === o.sellerId && p.checkoutIntentId === o.intentId &&
      ['paid', 'label_created', 'shipped', 'delivered', 'completed'].includes(o.status ?? '') && o.paidAtMs !== null &&
      /^ch_[A-Za-z0-9]+$/.test(o.stripeChargeId ?? '') && o.capturedCardCents !== null && o.capturedCardCents > 0 &&
      o.totalCents !== null && o.walletCents !== null && o.capturedCardCents + o.walletCents === o.totalCents &&
      p.receivedCents === o.capturedCardCents && p.requestedCents === o.capturedCardCents && p.capturableCents === 0) return {
    ...base, status: 'resolved', actionRequired: false, qualified: true, resolution: 'purchase_payment_committed', paymentCommitted: true,
    localRestitutionMayCommit: true, currentProviderProof: p, currentOrderProof: o};
  throw invalidInspection();
}
const inspecting = new Set<string>();
export async function inspectPaymentCaptureAnomaly(operationId: string, expectedAdminUid: string, assertContext: () => void,
  expectedTransactionId?: string | null): Promise<AdminPaymentInspection> {
  if (!/^(capture|checkout)_[a-f0-9]{64}$/.test(operationId) || operationId.startsWith('checkout_') && !identity(expectedTransactionId)) throw invalidInspection();
  const slot = `${expectedAdminUid}:${operationId}`;
  if (inspecting.has(slot)) throw new Error('Une vérification est déjà en cours pour ce dossier.');
  inspecting.add(slot);
  try {
    const session = await assertAdmin(expectedAdminUid, assertContext);
    assertTradeSessionCurrent(session); assertContext();
    const result = await httpsCallable<{operationId: string; expectedAdminUid: string}, unknown>(functions, 'inspectPaymentCaptureAnomaly')({operationId, expectedAdminUid});
    assertTradeSessionCurrent(session); assertContext();
    return parseInspection(result.data, operationId, expectedTransactionId);
  } finally { inspecting.delete(slot); }
}
