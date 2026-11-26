import {transportContactAllowsNewLabel} from './transportContactReview';
/** Private label lifecycle. Documents, voiding, carrier refunds and buyer
 * money are separate facts. No deadline, possession or billing is inferred. */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import { db } from '../config/firebase';
import { getShipEngine, providerUtc, lifecycleLabelIdentityHash, savedLifecycleLabelIdentity, type LabelLifecycleIdentity, type LabelLifecycleObservation,
  type LabelVoidObservation, type ShipEngineLabel, type ReturnShipmentContext } from '../config/shipEngine';
import { supportUid, supportObject, supportId, supportText, supportRequestId, supportHash, supportSourceHash,
  supportRevision, supportCurrentAdminSession, supportAdmin } from './supportRequest';
import { exactCents, providerId, hasCurrentRateQualification, type PurchaseRateContext, type PurchaseRates } from './shippingPurchaseRate';
import { acceptedOrderPurchasePolicy } from './purchasePolicy';
import { frozenReturnContext, committedReturnReceipt, currentLifecycleReturnPermission, qualifiedReturnRequest, returnPreparationCanAmend } from './returnRequest';
import { prepareOperationalNotices } from './notifications';
import { hasActiveBankDispute } from './bankDispute';
import { hasUnsettledRefund } from './refundState';
import { orderModerationAllowsProgress, readOrderModeration } from './orderModeration';
import { fraudReviewAllowsProgress } from './fraudReviewDecision';
import { normalizeCanadianAddress } from '../shared/canadianAddress';
import { articleReservationOwnedBy } from './articleReservation';
import { productPhysicalAllowsLeg } from './productPhysicalInstruction';
import { readCommercialReturnAdmission, productMaterialReturnContextRequired } from './productCommercialReturn';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
import { checkRateLimit } from './rateLimit';
import {labelRouteAmendment,readAcceptedRouteAmendment,readHistoricalRouteAmendment,readRouteAmendmentSenderDeclaration} from './labelRouteAmendment';
import {attachOrderTransport,qualifiedOrderTransportQuote} from '../config/shippingTransportPolicy';
import {returnDepositAllowsNewDeposit} from './returnDepositDeadline';
import { FinancialRecoveryBlocked, assertFinancialRecoveryEffect, qualifiedFinancialRecoveryEnvironment, readFinancialRecoveryState, withFinancialRecoveryScope } from './financialRecoveryInterlock';
import { financialRecoveryCommitCheckpoint, financialRecoverySourceFields, financialRecoverySourceHash, prepareFinancialRecoverySource, type FinancialRecoveryDomain } from './financialRecoverySources';

export const LABEL_LIFECYCLE_DISPATCH_ENABLED: boolean = true;
export const LABEL_LIFECYCLE_ACTIONS = ['request_review', 'stop_use', 'maintain_review', 'observe_provider', 'void_label',
  'replacement_quote', 'accept_replacement', 'purchase_replacement', 'adopt_replacement'] as const;
type Leg = 'forward' | 'return';
type Context = {transactionId: string; leg: Leg};
type QuoteReference = {id: string; contentHash: string};
type Command = Context & {scope: 'own' | 'admin'; sourceHash: string; sourceRevision: string; caseVersion: number; action: typeof LABEL_LIFECYCLE_ACTIONS[number];
  message: string; privateNote: string | null; quoteReference: QuoteReference | null;
  platformAuthorization: null | {approved: true; payer: 'platform'; currency: 'CAD'; amountCents: number; authorityReference: string; cause: string}; acknowledged: true};
const HASH = /^[a-f0-9]{64}$/;
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const docId = (v: unknown): v is string => typeof v === 'string' && !!v && Buffer.byteLength(v, 'utf8') <= 1500 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const own = (v: any, k: string) => v != null && Object.prototype.hasOwnProperty.call(v, k);
const noAuthority = {shippingPermissionGranted: false, inventoryReleaseAuthorized: false, buyerFinancialEffectAuthorized: false,
  carrierRefundSettled: false, carrierPossessionVerified: false, interceptionGuaranteed: false};
const caseId = (c: Context) => 'll_' + supportHash([c.transactionId, c.leg]);
const caseRef = (c: Context) => db.collection('label_lifecycle_cases').doc(caseId(c));
const receiptRef = (uid: string, id: string) => db.collection('label_lifecycle_commands').doc(supportHash([uid, id]));
const entryId = (uid: string, id: string) => 'le_' + supportHash([uid, id]);
function context(raw: any): Context {
  if (!['forward', 'return'].includes(raw.leg)) throw new HttpsError('invalid-argument', 'Trajet exact requis.');
  return {transactionId: supportId(raw.transactionId, 'Commande'), leg: raw.leg};
}
function parseCommand(value: unknown): Command {
  const d = supportObject(value, ['transactionId', 'leg', 'scope', 'sourceHash', 'sourceRevision', 'caseVersion', 'action', 'message', 'privateNote', 'quoteReference', 'platformAuthorization', 'acknowledged']);
  if (typeof d.sourceHash !== 'string' || !HASH.test(d.sourceHash) || typeof d.sourceRevision !== 'string' || !/^\d+:\d+$/.test(d.sourceRevision) ||
      d.sourceRevision.length > 100 || !Number.isSafeInteger(d.caseVersion) || d.caseVersion < 0 ||
      !(LABEL_LIFECYCLE_ACTIONS as readonly unknown[]).includes(d.action) || !['own', 'admin'].includes(d.scope) || d.acknowledged !== true) throw new HttpsError('invalid-argument', 'Intention et sources exactes requises.');
  const admin = d.scope === 'admin';
  if (!(admin ? ['maintain_review', 'stop_use', 'observe_provider', 'void_label', 'replacement_quote', 'purchase_replacement', 'adopt_replacement'] :
    ['request_review', 'stop_use', 'observe_provider', 'accept_replacement']).includes(d.action)) throw new HttpsError('invalid-argument', 'Action incompatible avec la portée native.');
  const privateNote = admin ? supportText(d.privateNote, 'Motivation privée', 4000) : null;
  if (!admin && d.privateNote !== null) throw new HttpsError('invalid-argument', 'Aucune note opérateur dans une déclaration participante.');
  let quoteReference: QuoteReference | null = null;
  if (['accept_replacement', 'purchase_replacement', 'adopt_replacement'].includes(d.action)) {
    const q = supportObject(d.quoteReference, ['id', 'contentHash']);
    if (!/^le_[a-f0-9]{64}$/.test(q.id ?? '') || !HASH.test(q.contentHash ?? '')) throw new HttpsError('invalid-argument', 'Devis natif exact requis.');
    quoteReference = {id: q.id, contentHash: q.contentHash};
  } else if (d.quoteReference !== null) throw new HttpsError('invalid-argument', 'Référence de devis inattendue.');
  let platformAuthorization: Command['platformAuthorization'] = null;
  if (['purchase_replacement', 'adopt_replacement'].includes(d.action)) {
    const p = supportObject(d.platformAuthorization, ['approved', 'payer', 'currency', 'amountCents', 'authorityReference', 'cause']);
    if (p.approved !== true || p.payer !== 'platform' || p.currency !== 'CAD' || !Number.isSafeInteger(p.amountCents) || p.amountCents < 0)
      throw new HttpsError('invalid-argument', 'Autorisation distincte du coût plateforme requise.');
    platformAuthorization = {approved: true, payer: 'platform', currency: 'CAD', amountCents: p.amountCents,
      authorityReference: supportText(p.authorityReference, 'Référence de l’autorisation plateforme', 1000), cause: supportText(p.cause, 'Cause de la dépense', 2000)};
  } else if (d.platformAuthorization !== null) throw new HttpsError('invalid-argument', 'Autorisation de coût inattendue.');
  return {...context(d), scope: d.scope, sourceHash: d.sourceHash, sourceRevision: d.sourceRevision, caseVersion: d.caseVersion, action: d.action,
    message: supportText(d.message, 'Message aux parties', 4000), privateNote, quoteReference, platformAuthorization, acknowledged: true};
}
async function operator(tx: FirebaseFirestore.Transaction, request: any, uid: string, recent = false) {
  const claim = await supportCurrentAdminSession(request); await supportAdmin(tx, uid, claim);
  const seconds = request.auth.token.auth_time, ms = seconds * 1000, now = Date.now();
  if (recent && (!Number.isSafeInteger(seconds) || seconds < 1 || !Number.isSafeInteger(ms) || ms > now || now - ms > 300000))
    throw new HttpsError('permission-denied', 'Réauthentification opérateur récente requise.', {reason: 'label_lifecycle_recent_auth_required'});
  const role = await tx.get(db.collection('users').doc(uid));
  return {protocol: 'label_lifecycle_operator_v1', actorId: uid, authTime: seconds, currentRoleHash: supportSourceHash(role.data() ?? null), currentAuthorityQualified: true};
}
function semantic(order: FirebaseFirestore.DocumentData) {
  // Only this lifecycle's own markers are excluded. Status, funds, bank/risk,
  // transport/physical evidence and original contractual sources stay bound.
  const transient = ['labelLifecycleCurrent', 'updatedAt', 'trackingRead', 'returnTrackingRead', 'financialRecoveryWitness'];
  return Object.fromEntries(Object.entries(order).filter(([k]) => !transient.includes(k)).map(([k, v]) =>
    ['trackingObservation', 'returnTrackingObservation', 'trackingSnapshot', 'returnTrackingSnapshot'].includes(k) && v && typeof v === 'object'
      ? [k, Object.fromEntries(Object.entries(v).filter(([key]) => !['readId', 'readVersion', 'requestedAtMs', 'observedAtMs', 'recordedAt'].includes(key)))] : [k, v]));
}
function sourceIdentity(c: Context, d: any): {qualification: 'native_saved_label' | 'native_purchase_reconciliation' | 'unknown'; identity: LabelLifecycleIdentity | null} {
  const s = d.shippingSnapshot, p = c.leg === 'forward' ? d.labelPurchase : d.returnRequest;
  const saved = c.leg === 'forward' ? d.shipEngineLabelId : d.returnLabelId;
  const labelId = saved ?? (c.leg === 'forward' ? p?.providerLabelId : p?.labelProof?.labelId ?? p?.lastObservation?.labelId);
  const proof = c.leg === 'forward' ? p?.qualification : p?.labelProof;
  const shipmentId = c.leg === 'forward' ? p?.shipmentId ?? s?.shipmentId : proof?.shipmentId ?? p?.quote?.rates?.shipmentId;
  const rateId = c.leg === 'forward' ? p?.rateId ?? d.shipEngineRateId : p?.rateId ?? p?.quote?.rateId;
  const carrierId = c.leg === 'forward' ? s?.rate?.carrierId : proof?.carrierId ?? p?.quote?.context?.carrierId;
  const carrierCode = c.leg === 'forward' ? d.carrierCode ?? s?.rate?.carrierCode : d.returnCarrierCode ?? p?.quote?.context?.carrierCode;
  const serviceCode = c.leg === 'forward' ? s?.rate?.serviceCode : proof?.serviceCode ?? p?.quote?.context?.serviceCode;
  const trackingNumber = c.leg === 'forward' ? d.trackingNumber ?? p?.lastObservation?.trackingNumber ?? null : d.returnTrackingNumber ?? p?.lastObservation?.trackingNumber ?? null;
  const outboundLabelId = c.leg === 'return' ? proof?.outboundLabelId ?? p?.quote?.context?.outboundLabelId : null;
  // The original forward writer uses JSON insertion-order hashing, preserved
  // here rather than substituting the journal canonical hash.
  const forwardHash = c.leg === 'forward' ? createHash('sha256').update(JSON.stringify({buyerId: d.buyerId, sellerId: d.sellerId,
    articleId: d.articleId, snapshot: s, rateId: d.shipEngineRateId})).digest('hex') : null;
  const nativeIntent = p?.schemaVersion === 1 && p.transactionId === c.transactionId && p.buyerId === d.buyerId && p.sellerId === d.sellerId &&
    native(c.leg === 'forward' ? p.reservedAt : p.requestedAt) &&
    (c.leg === 'forward' ? typeof p.attemptId === 'string' && !!p.attemptId && p.sourceHash === forwardHash && p.shipmentId === s?.shipmentId && p.rateId === d.shipEngineRateId : typeof p.requestId === 'string' && !!p.requestId);
  if (!nativeIntent || ![labelId, shipmentId, rateId, carrierId].every(providerId) || typeof carrierCode !== 'string' || !/^[a-z0-9_-]{1,100}$/.test(carrierCode) ||
      typeof serviceCode !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(serviceCode) || c.leg === 'return' && !providerId(outboundLabelId) ||
      trackingNumber !== null && (typeof trackingNumber !== 'string' || !trackingNumber || trackingNumber.length > 200)) return {qualification: 'unknown', identity: null};
  const committed = p.state === 'committed' && native(p.committedAt) && (c.leg === 'forward' ? p.providerLabelId === saved : !!committedReturnReceipt(c.transactionId, d));
  if (!committed && !['requested', 'unknown', 'reconciliation_required'].includes(p.state)) return {qualification: 'unknown', identity: null};
  return {qualification: committed ? 'native_saved_label' : 'native_purchase_reconciliation', identity: {labelId, direction: c.leg, shipmentId, rateId,
    carrierId, carrierCode, serviceCode, trackingNumber, outboundLabelId, providerCreatedAtMs: providerUtc(proof?.providerCreatedAt)}};
}
function route(c: Context, d: any): PurchaseRateContext | ReturnShipmentContext | null {
  if (c.leg === 'return') return frozenReturnContext(c.transactionId, d);
  const s = d.shippingSnapshot;
  const contact = (raw: any) => {
    const a = normalizeCanadianAddress(raw);
    if (!a || raw.country !== 'CA' || typeof raw.name !== 'string' || !raw.name || raw.name.length > 100) return null;
    return {name: raw.name, addressLine1: a.street, ...(a.line2 ? {addressLine2: a.line2} : {}), cityLocality: a.city,
      stateProvince: a.province, postalCode: a.postalCode, countryCode: 'CA', ...(typeof raw.phone === 'string' ? {phone: raw.phone} : {}), ...(typeof raw.email === 'string' ? {email: raw.email} : {})};
  };
  const shipFrom = contact(s?.origin), shipTo = contact(s?.destination), parcel = s?.parcel;
  if (!acceptedOrderPurchasePolicy(d, c.transactionId) || s?.schemaVersion !== 1 || s.provider !== 'shipengine' || s.currency !== 'CAD' || !shipFrom || !shipTo ||
      parcel?.weight?.unit !== 'kilogram' || parcel?.dimensions?.unit !== 'centimeter' ||
      ![parcel.weight.value, parcel.dimensions.length, parcel.dimensions.width, parcel.dimensions.height].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null;
  try{return attachOrderTransport(d,{shipFrom,shipTo,parcel},'forward');}catch{return null;}
}
async function current(tx: FirebaseFirestore.Transaction, c: Context) {
  const orderRef = db.collection('transactions').doc(c.transactionId), snap = await tx.get(orderRef), order = snap.data();
  if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
  if (order.deliveryType !== 'shipping' || !docId(order.buyerId) || !docId(order.sellerId) || order.buyerId === order.sellerId) throw new HttpsError('failed-precondition', 'Parties et commande natives à rapprocher.');
  const rootSnap = await tx.get(caseRef(c)), root = rootSnap.data();
  const rootQualified = root == null || root.protocol === 'label_lifecycle_case_v1' && root.caseId === caseId(c) && root.transactionId === c.transactionId &&
    root.leg === c.leg && root.buyerId === order.buyerId && root.sellerId === order.sellerId && Number.isSafeInteger(root.version) && root.version > 0;
  const sem = semantic(order), semanticHash = supportSourceHash(sem);
  const id = own(order.labelLifecycleCurrent, c.leg) ? await readCurrentReplacementIdentity(tx, c, order) : sourceIdentity(c, order);
  const amendment = own(order.operationalRoutes, c.leg) ? await readAcceptedRouteAmendment(tx, c, order) : null;
  let nativeRoute = own(order.operationalRoutes, c.leg) ? amendment?.context ?? null : route(c, order);
  if(nativeRoute)try{nativeRoute=attachOrderTransport(order,nativeRoute,c.leg);}catch{nativeRoute=null;}
  return {c, snap, orderRef, order, rootSnap, root, rootQualified, version: rootQualified ? root?.version ?? 0 : null,
    semanticHash, sourceRevision: supportRevision(snap), sourceHash: supportSourceHash({semanticHash, case: root ?? null}),
    ...id, route: nativeRoute, routeHash: nativeRoute ? supportSourceHash(nativeRoute) : null,
    policyHash: acceptedOrderPurchasePolicy(order, c.transactionId)?.hash ?? null};
}
type State = Awaited<ReturnType<typeof current>>;
/** Documentary transitions can preserve an already qualified current witness
 * in normal operation. They cannot adopt a legacy row or open recovery. The
 * actual source helpers still recheck control before the native commit. */
async function maintainDocumentaryWitness(rows: {domain: FinancialRecoveryDomain; ref: string; data: any}[]): Promise<boolean> {
  if (rows.some(({data}) => !data?.financialRecoveryWitness)) return false;
  const control = await readFinancialRecoveryState();
  if (!control.admissionControlOpen || !control.epoch) return false;
  const installation = qualifiedFinancialRecoveryEnvironment();
  return rows.every(({domain, ref, data}) => {
    const w = data.financialRecoveryWitness;
    if (!(w && Object.keys(w).length === 5 && w.protocol === 'financial_recovery_source_witness_v1' &&
      w.installationId === installation.installationId && w.epoch === control.epoch && w.ref === ref &&
      HASH.test(w.nativeSourceHash))) return false;
    // This local calculation grants no permission. Malformed finance remains
    // unknown for documentary intake; actual source/effect assertions below
    // are deliberately outside this narrow catch and always propagate.
    try {return w.nativeSourceHash === financialRecoverySourceHash(domain, data);}
    catch (error) {
      if (error instanceof FinancialRecoveryBlocked && ['domain_source_unqualified', 'wallet_source_unqualified'].includes(error.reason)) return false;
      throw error;
    }
  });
}
type ReplacementQuote = {protocol: 'label_replacement_quote_v1'; oldLabelId: string; semanticSourceHash: string; routeSourceHash: string;
  purchasePolicyHash: string; costCents: number; currency: 'CAD'; rateId: string; originalBuyerTotalCents: number;
  additionalBuyerChargeCents: 0; platformAuthorizationRequired: true; platformFundingGuaranteed: false;
  providerShipmentSourceVerified: true; context: PurchaseRateContext | ReturnShipmentContext; rates: PurchaseRates};
async function quoteForCurrent(tx: FirebaseFirestore.Transaction, s: State, ref: QuoteReference) {
  const p = await nativeEntry(tx, s.c, ref.id, (await tx.get(caseRef(s.c).collection('entries').doc(ref.id))).data()), q: ReplacementQuote | undefined = p?.d.replacementQuote;
  if (!p || p.contentHash !== ref.contentHash || p.command.action !== 'replacement_quote' || !q || q.protocol !== 'label_replacement_quote_v1' ||
      q.oldLabelId !== s.identity?.labelId || q.semanticSourceHash !== s.semanticHash || q.routeSourceHash !== s.routeHash ||
      q.purchasePolicyHash !== s.policyHash || q.originalBuyerTotalCents !== exactCents(s.order.totalAmount) || q.additionalBuyerChargeCents !== 0 ||
      q.platformAuthorizationRequired !== true || q.platformFundingGuaranteed !== false || q.providerShipmentSourceVerified !== true ||
      !Number.isSafeInteger(q.costCents) || q.costCents < 0 || q.currency !== 'CAD' || !s.route ||
      supportSourceHash(q.context) !== supportSourceHash(s.c.leg === 'return' ? {...s.route, externalShipmentId: (q.context as ReturnShipmentContext).externalShipmentId} : s.route) ||
      !hasCurrentRateQualification(q.rates, q.context) || !q.rates.rates.some(r => r.rateId === q.rateId && r.shippingCents === q.costCents)) return null;
  return {quote: q, contentHash: p.contentHash};
}
async function bothAccepted(tx: FirebaseFirestore.Transaction, s: State, ref: QuoteReference) {
  for (const role of ['buyer', 'seller'] as const) {
    const a = s.root?.replacementAcceptances?.[role];
    if (!a || a.actorId !== s.order[`${role}Id`] || !native(a.recordedAt) || supportHash(a.quoteReference) !== supportHash(ref) || !/^le_[a-f0-9]{64}$/.test(a.entryId ?? '')) return false;
    const p = await nativeEntry(tx, s.c, a.entryId, (await tx.get(caseRef(s.c).collection('entries').doc(a.entryId))).data());
    if (!p || p.command.action !== 'accept_replacement' || p.d.actorId !== a.actorId || supportHash(p.command.quoteReference) !== supportHash(ref) ||
        !p.d.recordedAt.isEqual(a.recordedAt) || p.d.sourceCapture.semanticSourceHash !== s.semanticHash) return false;
  }
  return true;
}
async function pendingReplacement(tx: FirebaseFirestore.Transaction, s: State, ref: QuoteReference) {
  const pointer = s.root?.pendingReplacement;
  if (!/^le_[a-f0-9]{64}$/.test(pointer?.entryId ?? '') || !HASH.test(pointer?.contentHash ?? '')) return null;
  const p = await nativeEntry(tx, s.c, pointer.entryId, (await tx.get(caseRef(s.c).collection('entries').doc(pointer.entryId))).data());
  const r = p?.d.labelPurchaseResult, label: ShipEngineLabel | undefined = r?.label, q = label?.qualification;
  if (!p || p.contentHash !== pointer.contentHash || p.command.action !== 'purchase_replacement' || supportHash(p.command.quoteReference) !== supportHash(ref) ||
      pointer.labelId !== label?.labelId || !label || !q || q.schemaVersion !== 1 || q.currency !== 'CAD' || !providerId(label.labelId) || !providerId(label.shipmentId) ||
      !providerId(label.carrierId) || !providerId(q.requestedRateId) || !label.trackingNumber || !label.carrierCode || !label.serviceCode ||
      providerUtc(q.providerCreatedAt) === null || !Number.isSafeInteger(q.totalCents) || q.totalCents < 0 || q.totalCents !== r.costCents ||
      exactCents(label.shipmentCost) !== q.shipmentCents || exactCents(label.insuranceCost) !== q.insuranceCents || q.shipmentCents + q.insuranceCents !== q.totalCents ||
      p.d.sourceCapture.semanticSourceHash !== s.semanticHash) return null;
  return {entryId: pointer.entryId as string, contentHash: p.contentHash, result: r, purchaseCommand: p.command,
    receipt: p.receipt, actorId: p.d.actorId as string, requestId: p.d.requestId as string};
}
/** The paid route is bound to the exact committed purchase receipt and its
 * immutable quote, never to a subsequently agreed or live profile route. */
async function purchasedReplacementQuote(tx: FirebaseFirestore.Transaction, c: Context, purchase: NonNullable<Awaited<ReturnType<typeof nativeEntry>>>) {
  const ref = purchase.command.quoteReference, captured: ReplacementQuote | undefined = purchase.receipt.replacementQuoteCapture;
  if (purchase.command.action !== 'purchase_replacement' || !ref || !captured || purchase.receipt.replacementQuoteContentHash !== ref.contentHash) return null;
  const quoted = await nativeEntry(tx, c, ref.id, (await tx.get(caseRef(c).collection('entries').doc(ref.id))).data());
  const q: ReplacementQuote | undefined = quoted?.d.replacementQuote, source = purchase.d.sourceCapture, result = purchase.d.labelPurchaseResult;
  if (!quoted || quoted.command.action !== 'replacement_quote' || quoted.contentHash !== ref.contentHash || !q ||
      supportSourceHash(q) !== supportSourceHash(captured) || q.protocol !== 'label_replacement_quote_v1' ||
      quoted.d.recordedAt.toMillis() > purchase.d.recordedAt.toMillis() || q.oldLabelId !== source.identity?.labelId ||
      q.semanticSourceHash !== source.semanticSourceHash || q.routeSourceHash !== source.routeSourceHash ||
      q.purchasePolicyHash !== source.purchasePolicyHash || supportSourceHash(source.route) !== q.routeSourceHash ||
      q.originalBuyerTotalCents !== exactCents(source.order?.totalAmount) || q.currency !== 'CAD' || q.additionalBuyerChargeCents !== 0 ||
      q.platformAuthorizationRequired !== true || q.platformFundingGuaranteed !== false || q.providerShipmentSourceVerified !== true ||
      !source.route || supportSourceHash(q.context) !== supportSourceHash(c.leg === 'return' ? {...source.route, externalShipmentId: (q.context as ReturnShipmentContext)?.externalShipmentId} : source.route) ||
      !hasCurrentRateQualification(q.rates, q.context) || !q.rates.rates.some(r => r.rateId === q.rateId && r.shippingCents === q.costCents) ||
      !Number.isSafeInteger(q.costCents) || q.costCents < 0 || q.costCents !== result?.costCents || q.costCents !== purchase.command.platformAuthorization?.amountCents ||
      supportHash(result.quoteReference) !== supportHash(ref) || result.label?.qualification?.requestedRateId !== q.rateId) return null;
  return q;
}
/** Immutable association of the CURRENT replacement, checked independently of
 * the initial label receipt. Old receipts and contract snapshots remain intact. */
async function readCurrentReplacementIdentity(tx: FirebaseFirestore.Transaction, c: Context, order: any): Promise<ReturnType<typeof sourceIdentity>> {
  const marker = order.labelLifecycleCurrent?.[c.leg], unknown = {qualification: 'unknown' as const, identity: null};
  if (marker?.protocol !== 'label_lifecycle_current_label_v1' || marker.transactionId !== c.transactionId || marker.leg !== c.leg ||
      marker.buyerId !== order.buyerId || marker.sellerId !== order.sellerId || !/^le_[a-f0-9]{64}$/.test(marker.entryId ?? '') || !HASH.test(marker.contentHash ?? '') || !native(marker.recordedAt)) return unknown;
  const a = await nativeEntry(tx, c, marker.entryId, (await tx.get(caseRef(c).collection('entries').doc(marker.entryId))).data());
  if (!a || a.command.action !== 'adopt_replacement' || a.contentHash !== marker.contentHash || supportHash(a.d.replacementActivation) !== supportHash(marker.activation) ||
      !a.d.recordedAt.isEqual(marker.recordedAt) || !/^le_[a-f0-9]{64}$/.test(marker.activation?.purchaseEntryId ?? '')) return unknown;
  const p = await nativeEntry(tx, c, marker.activation.purchaseEntryId, (await tx.get(caseRef(c).collection('entries').doc(marker.activation.purchaseEntryId))).data());
  const r = p?.d.labelPurchaseResult, label: ShipEngineLabel | undefined = r?.label, q = label?.qualification;
  if (!p || p.command.action !== 'purchase_replacement' || p.contentHash !== marker.activation.purchaseContentHash || !label || !q ||
      label.labelId !== marker.activation.labelId || q.totalCents !== a.command.platformAuthorization?.amountCents ||
      label.labelId !== (c.leg === 'forward' ? order.shipEngineLabelId : order.returnLabelId) ||
      label.trackingNumber !== (c.leg === 'forward' ? order.trackingNumber : order.returnTrackingNumber) ||
      label.carrierCode !== (c.leg === 'forward' ? order.carrierCode : order.returnCarrierCode) ||
      q.currency !== 'CAD' || !providerId(label.shipmentId) || !providerId(label.carrierId) || !providerId(q.requestedRateId) ||
      !Number.isSafeInteger(q.totalCents) || q.totalCents < 0 || q.shipmentCents + q.insuranceCents !== q.totalCents ||
      exactCents(label.shipmentCost + label.insuranceCost) !== q.totalCents || providerUtc(q.providerCreatedAt) === null) return unknown;
  const identity: LabelLifecycleIdentity = {labelId: label.labelId, direction: c.leg, shipmentId: label.shipmentId!, rateId: q.requestedRateId,
    carrierId: label.carrierId!, carrierCode: label.carrierCode, serviceCode: label.serviceCode!, trackingNumber: label.trackingNumber,
    outboundLabelId: c.leg === 'return' ? p.d.replacementQuoteCapture?.context?.outboundLabelId ?? p.d.sourceCapture.identity?.outboundLabelId : null,
    providerCreatedAtMs: providerUtc(q.providerCreatedAt)};
  if (supportHash(savedLifecycleLabelIdentity(c.transactionId, order, c.leg)) !== supportHash(identity)) return unknown;
  return {qualification: 'native_saved_label', identity};
}
/** A documented route does not establish absence of carrier possession. */
type ReservedPreparation = {actorId: string; requestId: string; command: Command};
export async function labelRouteAmendmentPreparationBasis(tx: FirebaseFirestore.Transaction, transactionId: string, order: FirebaseFirestore.DocumentData, leg: Leg, reserved?: ReservedPreparation): Promise<boolean> {
  const c = {transactionId, leg}, root = (await tx.get(caseRef(c))).data();
  if (own(order.labelRouteReview,leg) && await readRouteAmendmentSenderDeclaration(tx,c,order) !== 'not_deposited_declared') return false;
  if (own(root, 'pendingReplacement') && root?.pendingReplacement !== null) return false;
  if (root?.pendingEffect != null) {
    // This optional exception is internal and proves only the SAME unescaped
    // reservation at its exact version. Unknown/concurrent effects still stop NEW IO.
    if (!reserved || reserved.command.transactionId !== transactionId || reserved.command.leg !== leg ||
        !['replacement_quote', 'purchase_replacement'].includes(reserved.command.action)) return false;
    const p = await priorReceipt(tx, reserved.actorId, reserved.requestId, reserved.command), effect = root.pendingEffect;
    if (!p || !['reserved', 'reconciliation_required'].includes(p.state) || p.providerOperationState !== 'reserved' || p.providerRequestedAt != null ||
        effect.actorId !== reserved.actorId || effect.requestId !== reserved.requestId || effect.payloadHash !== p.payloadHash ||
        effect.reservedVersion !== p.caseVersionAtCommit || root.version !== p.caseVersionAtCommit ||
        p.expectedSemanticHash !== supportSourceHash(semantic(order))) return false;
  }
  const observation = leg === 'forward' ? order.trackingObservation : order.returnTrackingObservation;
  const snapshot = leg === 'forward' ? order.trackingSnapshot : order.returnTrackingSnapshot;
  if ((leg === 'forward' ? order.shippedAt != null || order.deliveredAt != null : order.returnShippedAt != null || order.returnDeliveredAt != null) ||
      [observation, snapshot].some(v => v != null && !['NY','UN'].includes(v.statusCode))) return false;
  const returnCapture = order.returnRequest?.routeAmendmentCapture;
  const preparingAmendedReturn = leg === 'return' && returnCapture && ['reserved','preparing','quoted'].includes(order.returnRequest?.state) &&
    order.returnRequest.authorizedAt == null && order.returnRequest.purchaseExternalId == null && order.returnLabelId == null &&
    !!await readHistoricalRouteAmendment(tx,c,returnCapture);
  if (leg === 'return' && qualifiedReturnRequest(transactionId, order) && (returnPreparationCanAmend(order) || preparingAmendedReturn)) {
    const forward = own(order.labelLifecycleCurrent, 'forward') ? await readCurrentReplacementIdentity(tx, {transactionId, leg:'forward'}, order) : sourceIdentity({transactionId,leg:'forward'}, order);
    return forward.qualification === 'native_saved_label';
  }
  // No scan never proves no deposit. A genuine exact-label void observation is
  // the only documentary basis here for preparing a different shipment.
  const identity = own(order.labelLifecycleCurrent, leg) ? await readCurrentReplacementIdentity(tx, c, order) : sourceIdentity(c, order);
  const id = root?.latestProviderObservationId;
  const p = /^le_[a-f0-9]{64}$/.test(id ?? '') ? await nativeEntry(tx,c,id,(await tx.get(caseRef(c).collection('entries').doc(id))).data()) : null;
  return !!identity.identity && !!p && p.d.providerObservation?.identityQualified === true &&
    p.d.providerObservation.labelId === identity.identity.labelId && p.d.providerObservation.providerVoided === true;
}
/** Actual label route is taken from its immutable purchase/adoption, not an agreement to change it. */
export async function readLabelLifecycleCurrentRoute(tx: FirebaseFirestore.Transaction, transactionId: string, order: FirebaseFirestore.DocumentData, leg: Leg) {
  const c = {transactionId,leg};
  if (own(order.labelLifecycleCurrent,leg)) {
    const identity = await readCurrentReplacementIdentity(tx,c,order); if (!identity.identity) return null;
    const marker = order.labelLifecycleCurrent[leg], a = await nativeEntry(tx,c,marker.entryId,(await tx.get(caseRef(c).collection('entries').doc(marker.entryId))).data());
    const purchaseId = a?.d.replacementActivation?.purchaseEntryId;
    const p = /^le_[a-f0-9]{64}$/.test(purchaseId ?? '') ? await nativeEntry(tx,c,purchaseId,(await tx.get(caseRef(c).collection('entries').doc(purchaseId))).data()) : null;
    const quote = p ? await purchasedReplacementQuote(tx,c,p) : null, context = quote?.context;
    if (!p || !context) return null;
    return {qualification:'native_current_label_route' as const, context, sourceHash:supportSourceHash(context), labelId:identity.identity.labelId};
  }
  const identity = sourceIdentity(c,order); if(identity.qualification !== 'native_saved_label' || !identity.identity) return null;
  if(leg === 'return' && own(order.returnRequest,'routeAmendmentCapture') && !await readHistoricalRouteAmendment(tx,c,order.returnRequest.routeAmendmentCapture)) return null;
  const context = route(c,order); return context ? {qualification:'native_current_label_route' as const,context,sourceHash:supportSourceHash(context),labelId:identity.identity.labelId} : null;
}
export async function readLabelRouteAmendmentRoutes(tx:FirebaseFirestore.Transaction,transactionId:string,order:FirebaseFirestore.DocumentData,leg:Leg) {
  const r=order.returnRequest;
  const originalOrder=leg==='return'&&r?{...order,returnRequest:Object.fromEntries(Object.entries(r).filter(([k])=>k!=='routeAmendmentCapture'))}:order;
  const original=route({transactionId,leg},originalOrder),actual=await readLabelLifecycleCurrentRoute(tx,transactionId,order,leg);
  const privateContact=(c:any)=>{const {phone:_phone,email:_email,...body}=c;return body;};
  const visible=(c:any)=>c?{...c,shipFrom:privateContact(c.shipFrom),shipTo:privateContact(c.shipTo)}:null;
  return {originalRoute:{qualification:original?'native_historical_route':'unknown',context:visible(original),sourceHash:original?supportSourceHash(original):null},
    currentLabelRoute:actual?{...actual,context:visible(actual.context)}:{qualification:'unknown',context:null,sourceHash:null,labelId:null},
    preparationBasisQualified:await labelRouteAmendmentPreparationBasis(tx,transactionId,order,leg)};
}
async function replacementView(tx: FirebaseFirestore.Transaction, s: State) {
  const ref = {id: s.root?.latestQuoteId, contentHash: s.root?.latestQuoteHash};
  const p = /^le_[a-f0-9]{64}$/.test(ref.id ?? '') && HASH.test(ref.contentHash ?? '') ? await quoteForCurrent(tx, s, ref) : null;
  if (!p) return {qualification: 'unknown' as const, quote: null, bothParticipantsAccepted: false, platformFundingGuaranteed: false};
  return {qualification: 'native_current_quote' as const, quote: {id: ref.id as string, contentHash: p.contentHash, costCents: p.quote.costCents, currency: 'CAD',
    rateId: p.quote.rateId, shipmentId: p.quote.rates.shipmentId, routeSourceHash: p.quote.routeSourceHash, purchasePolicyHash: p.quote.purchasePolicyHash,
    oldLabelId: p.quote.oldLabelId, originalBuyerTotalCents: p.quote.originalBuyerTotalCents, additionalBuyerChargeCents: 0,
    platformAuthorizationRequired: true, platformFundingGuaranteed: false}, bothParticipantsAccepted: await bothAccepted(tx, s, ref), platformFundingGuaranteed: false};
}
async function currentLabelUse(tx: FirebaseFirestore.Transaction, s: State) {
  const noUse = {qualification: 'unknown' as const, canUseCurrentLabelNow: false, documentCurrentlyAvailable: false,
    nativeGuardsAllowUse: false, providerCurrentAvailability: 'unknown' as const, lastRecordedDocumentObservation: null};
  if (!s.rootQualified || !s.identity) return noUse;
  const id = s.root?.latestProviderObservationId;
  const p = /^le_[a-f0-9]{64}$/.test(id ?? '') ? await nativeEntry(tx, s.c, id, (await tx.get(caseRef(s.c).collection('entries').doc(id))).data()) : null;
  const o = p?.d.providerObservation;
  const available = !!p && p.d.sourceCapture.semanticSourceHash === s.semanticHash && o?.protocol === 'shipengine_label_lifecycle_observation_v1' &&
    o.identityQualified === true && o.labelId === s.identity.labelId && o.documentState === 'available' && o.providerVoided === false;
  if (!available) return noUse;
  let allowed = await labelLifecycleAllowsLeg(tx, s.c.transactionId, s.order, s.c.leg) &&
    !hasActiveBankDispute(s.order) && !hasUnsettledRefund(s.order) && !returnToSenderBlocksProgress(s.order) &&
    await fraudReviewAllowsProgress(tx, s.c.transactionId, s.order, s.snap);
  if (s.c.leg === 'forward') allowed = allowed && ['paid', 'label_created'].includes(s.order.status) && s.order.disputed !== true &&
    s.order.labelReconciliationRequired !== true && s.order.trackingReviewRequired !== true && await orderModerationAllowsProgress(tx, s.order, 'forward', s.c.transactionId);
  else allowed = allowed && await returnSourcesAllow(tx, s);
  // A saved GET establishes only what was observed then. Native source/guard
  // checks do not establish current provider validity or URL availability.
  return {qualification: allowed ? 'native_current_sources' as const : 'blocked' as const, canUseCurrentLabelNow: false,
    documentCurrentlyAvailable: false, nativeGuardsAllowUse: !!allowed, providerCurrentAvailability: 'unknown' as const,
    lastRecordedDocumentObservation: {entryId: id as string, contentHash: p!.contentHash, labelId: o.labelId as string,
      observedAt: new Date(o.observedAtMs).toISOString(), documentState: 'available' as const, providerVoided: false}};
}
async function returnSourcesAllow(tx: FirebaseFirestore.Transaction, s: State) {
  if (!await returnDepositAllowsNewDeposit(tx, s.c.transactionId, s.order)) return false;
  const mod = await readOrderModeration(tx, s.order), physical = await productPhysicalAllowsLeg(tx, s.order, 'return', s.c.transactionId);
  const moderation = mod == null || mod.sourceQualified && mod.action === 'continue' && mod.otherBlockers.every(b => b === 'order_recourse');
  const commercial = s.order.returnRequest?.commercialReturn ? await readCommercialReturnAdmission(tx, s.c.transactionId, s.order, s.order.returnRequest.commercialReturn) : null;
  const commercialAllowed = commercial ? commercial.allowed : !await productMaterialReturnContextRequired(tx, s.c.transactionId, s.order);
  return currentLifecycleReturnPermission(s.c.transactionId, s.order, s.qualification === 'native_saved_label',
    moderation && physical && commercialAllowed, commercial?.buyerReportQualified === true);
}
async function currentInstruction(tx: FirebaseFirestore.Transaction, s: State, uid: string, admin: boolean) {
  const id = s.root?.latestInstructionId;
  if (id == null) return {qualification: 'unrecorded' as const, instruction: null};
  const p = /^le_[a-f0-9]{64}$/.test(id) ? await nativeEntry(tx, s.c, id, (await tx.get(caseRef(s.c).collection('entries').doc(id))).data()) : null;
  if (!p || !['stop_use', 'maintain_review', 'void_label', 'adopt_replacement'].includes(p.command.action) || !admin && !p.d.addressedTo.includes(uid))
    return {qualification: 'unknown' as const, instruction: null};
  const applies = s.rootQualified && HASH.test(p.d.resultingSemanticSourceHash ?? '') && p.d.resultingSemanticSourceHash === s.semanticHash;
  return {qualification: applies ? 'native_current_instruction' as const : 'historical_sources_changed' as const, instruction: {
    protocol: 'label_lifecycle_current_instruction_v1', entryId: id as string, contentHash: p.contentHash, action: p.command.action,
    scopeAtRecording: p.command.scope, message: p.command.message, privateNote: admin ? p.command.privateNote : null,
    recordedAt: p.d.recordedAt.toDate().toISOString(), appliesToCurrentSources: applies, ...noAuthority}};
}
async function actionAvailability(tx: FirebaseFirestore.Transaction, s: State, uid: string, admin: boolean, request: any) {
  const participant = author(s, uid), sourceKnown = s.rootQualified && s.version !== null && s.sourceRevision !== null;
  const noPending = s.root?.pendingEffect == null, replace = sourceKnown && noPending && await replacementAllowed(tx, s, true);
  const replaceNew=replace&&await originalTransportSourceQualified(tx,s.c.transactionId,s.order);
  const noPurchasedReplacement = !hasPendingReplacement(s);
  const ref = {id: s.root?.latestQuoteId, contentHash: s.root?.latestQuoteHash};
  const quote = /^le_[a-f0-9]{64}$/.test(ref.id ?? '') && HASH.test(ref.contentHash ?? '') ? await quoteForCurrent(tx, s, ref) : null;
  const accepted = quote ? await bothAccepted(tx, s, ref) : false;
  const purchased = quote ? await pendingReplacement(tx, s, ref) : null;
  const t = request.auth.token.auth_time * 1000, recent = Number.isSafeInteger(t) && t > 0 && t <= Date.now() && Date.now() - t <= 300000;
  return {protocol: 'label_lifecycle_action_availability_v1', preparationOnly: true,
    canRequestReviewNow: !admin && participant && sourceKnown,
    canStopUseNow: sourceKnown && (admin || participant), canMaintainReviewNow: admin && sourceKnown,
    canObserveProviderNow: sourceKnown && noPending && s.identity !== null && (admin || participant),
    canPrepareVoidCommandNow: admin && recent && sourceKnown && noPending && s.identity !== null,
    canPrepareReplacementQuoteNow: admin && recent && replaceNew && noPurchasedReplacement,
    canAcceptReplacementNow: !admin && participant && sourceKnown && quote !== null,
    canPreparePurchaseCommandNow: admin && recent && replaceNew && quote !== null && accepted && noPurchasedReplacement,
    canPrepareAdoptionCommandNow: admin && replace && quote !== null && accepted && purchased !== null,
    recentReauthenticationRequiredForProviderEffect: admin && !recent,
    pendingProviderOperationRequiresReconciliation: !noPending,
    platformCostCentsForPurchase: quote?.quote.costCents ?? null, platformCostCentsForAdoption: purchased?.result.costCents ?? null,
    platformAuthorizationStillRequired: true, providerApprovalGuaranteed: false, ...noAuthority};
}
async function noticeQualification(tx: FirebaseFirestore.Transaction, s: State, uid: string, admin: boolean, ref: any) {
  if (ref == null) return null;
  const r = supportObject(ref, ['entryId', 'noticeState']);
  if (!/^le_[a-f0-9]{64}$/.test(r.entryId ?? '') || !['intent_reserved', 'entry_recorded'].includes(r.noticeState)) throw new HttpsError('invalid-argument', 'Avis natif invalide.');
  const p = await nativeEntry(tx, s.c, r.entryId, (await tx.get(caseRef(s.c).collection('entries').doc(r.entryId))).data());
  if (p && (admin || p.d.addressedTo.includes(uid))) return {entryId: r.entryId, noticeState: r.noticeState, qualification: 'native_entry_recorded',
    entry: {action: p.command.action, message: p.command.message, recordedAt: p.d.recordedAt.toDate().toISOString()}, currentInstructionVerified: false, ...noAuthority};
  const effect = s.root?.pendingEffect;
  if (effect && entryId(effect.actorId, effect.requestId) === r.entryId) {
    const reserved = (await tx.get(receiptRef(effect.actorId, effect.requestId))).data();
    let parsed: Command | null = null; try {parsed = parseCommand(reserved?.command);} catch { /* Unknown stays unknown. */ }
    if (parsed && reserved?.protocol === 'label_lifecycle_command_v1' && ['reserved', 'reconciliation_required'].includes(reserved.state) &&
        reserved.payloadHash === supportHash(parsed) && reserved.payloadHash === effect.payloadHash && native(reserved.recordedAt) &&
        reserved.actorId === effect.actorId && reserved.requestId === effect.requestId &&
        reserved.sourceCapture?.buyerId === s.order.buyerId && reserved.sourceCapture?.sellerId === s.order.sellerId &&
        (admin || reserved.addressedTo?.includes(uid))) return {entryId: r.entryId, noticeState: r.noticeState, qualification: 'native_intent_reserved',
      entry: {action: parsed.action, message: parsed.message, recordedAt: reserved.recordedAt.toDate().toISOString()}, currentInstructionVerified: false, ...noAuthority};
  }
  return {entryId: r.entryId, noticeState: r.noticeState, qualification: 'unknown', entry: null, currentInstructionVerified: false, ...noAuthority};
}
/** Read-only qualification used by tracking and NEW leg consumers. A true
 * result concerns this lifecycle only, never safety, funds or possession. */
async function originalTransportSourceQualified(tx:FirebaseFirestore.Transaction,transactionId:string,order:FirebaseFirestore.DocumentData):Promise<boolean> {
  if(order.shippingQuoteId!==undefined) {
    if(typeof order.shippingQuoteId!=='string'||!order.shippingQuoteId||order.shippingQuoteId.includes('/'))return false;
    const quote=(await tx.get(db.collection('shipping_quotes').doc(order.shippingQuoteId))).data();
    try{qualifiedOrderTransportQuote(order,quote,transactionId);}catch{return false;}
  }else if(['transportAdmission','transportBaseHash','transportTermsAcceptance'].some(k=>Object.prototype.hasOwnProperty.call(order,k))||Object.prototype.hasOwnProperty.call(order.shippingSnapshot??{},'transportAdmission'))return false;
  return true;
}
export async function labelLifecycleAllowsLeg(tx: FirebaseFirestore.Transaction, transactionId: string, order: FirebaseFirestore.DocumentData, leg: Leg, amendedReturnPreparation = false): Promise<boolean> {
  if(!await originalTransportSourceQualified(tx,transactionId,order))return false;
  if (!await transportContactAllowsNewLabel(tx, transactionId, order)) return false;
  if (own(order.labelRouteReview, leg)) {
    const currentRoute = await readLabelLifecycleCurrentRoute(tx, transactionId, order, leg);
    const accepted = await readAcceptedRouteAmendment(tx, {transactionId, leg}, order);
    // Return quote/purchase operations keep their own native external IDs.
    // Compare the agreed physical route without rewriting either identity.
    const routeMatches = !!accepted && !!currentRoute && supportHash(currentRoute.context) === supportHash(leg === 'return'
      ? {...accepted.context, externalShipmentId: (currentRoute.context as ReturnShipmentContext).externalShipmentId} : accepted.context);
    if (!accepted || (amendedReturnPreparation && leg === 'return' && order.returnLabelId == null && await labelRouteAmendmentPreparationBasis(tx,transactionId,order,leg) ? false : !routeMatches)) return false;
  }
  if (own(order.labelLifecycleStop, leg)) return false;
  if (own(order.labelLifecycleCurrent, leg)) {
    const i = await readCurrentReplacementIdentity(tx, {transactionId, leg}, order);
    if (!i.identity || i.qualification !== 'native_saved_label') return false;
  }
  const root = (await tx.get(caseRef({transactionId, leg}))).data();
  return root == null || root.protocol === 'label_lifecycle_case_v1' && root.caseId === caseId({transactionId, leg}) && root.transactionId === transactionId &&
    root.leg === leg && root.buyerId === order.buyerId && root.sellerId === order.sellerId && Number.isSafeInteger(root.version) && root.version > 0 && root.pendingReplacement == null;
}
/** Existing carrier effects remain observable while a stop is active. */
export async function labelLifecycleIdentityQualified(tx: FirebaseFirestore.Transaction, transactionId: string, order: FirebaseFirestore.DocumentData, leg: Leg): Promise<boolean> {
  return !own(order.labelLifecycleCurrent, leg) || (await readCurrentReplacementIdentity(tx, {transactionId, leg}, order)).qualification === 'native_saved_label';
}
/** The existing seller cancellation also records a stop request. This is not
 * provider voiding, interception, a refund decision or inventory evidence. */
export async function recordSellerCancellationLabelStop(request: any, transactionId: string): Promise<void> {
  if (!LABEL_LIFECYCLE_DISPATCH_ENABLED) return;
  const uid = request.auth?.uid;
  if (!docId(uid)) throw new HttpsError('unauthenticated', 'Compte vendeur requis.');
  const c: Context = {transactionId: supportId(transactionId, 'Commande'), leg: 'forward'};
  const requestId = 'seller_cancel_' + supportHash([uid, c.transactionId]), id = entryId(uid, requestId);
  await db.runTransaction(async tx => {
    const old = (await tx.get(receiptRef(uid, requestId))).data();
    if (old) {
      const previous = parseCommand(old.command);
      if (previous.transactionId !== c.transactionId || previous.leg !== c.leg || previous.scope !== 'own' || previous.action !== 'stop_use')
        throw new HttpsError('already-exists', 'Intention d’arrêt différente.');
      await priorReceipt(tx, uid, requestId, previous); return;
    }
    const s = await current(tx, c);
    if (s.order.sellerId !== uid) throw new HttpsError('permission-denied', 'Vendeur natif requis.');
    // True financial history is serviced by the original cancellation path.
    if (s.order.refund || s.order.status === 'refunded') return;
    if (!['paid', 'label_created'].includes(s.order.status) || !s.rootQualified || s.version === null || s.version >= Number.MAX_SAFE_INTEGER - 1)
      throw new HttpsError('failed-precondition', 'Sources de l’arrêt à rapprocher.');
    const now = Timestamp.now(), message = 'Le vendeur demande l’arrêt d’usage de l’étiquette lors de son annulation de commande. Cela ne prouve ni interception, ni absence de dépôt, ni annulation transporteur. Le traitement commercial reste distinct.';
    const command: Command = {transactionId: c.transactionId, leg: c.leg, scope: 'own', sourceHash: s.sourceHash, sourceRevision: s.sourceRevision!,
      caseVersion: s.version, action: 'stop_use', message, privateNote: null, quoteReference: null, platformAuthorization: null, acknowledged: true};
    const capture = {protocol: 'label_lifecycle_source_capture_v1', semanticSourceHash: s.semanticHash, order: semantic(s.order),
      sourceHash: s.sourceHash, sourceRevision: s.sourceRevision, caseVersion: s.version, identity: s.identity, route: s.route,
      routeSourceHash: s.routeHash, purchasePolicyHash: s.policyHash, buyerId: s.order.buyerId, sellerId: s.order.sellerId};
    const stop = {protocol: 'label_lifecycle_stop_v1', transactionId: c.transactionId, leg: c.leg, caseId: caseId(c), entryId: id, actorId: uid,
      recordedAt: now, source: 'native_seller_cancellation_intent', stopUseRequired: true};
    const resultingSemanticSourceHash = supportSourceHash(semantic({...s.order, labelLifecycleStop: {...s.order.labelLifecycleStop, forward: stop}}));
    const document = {protocol: 'label_lifecycle_entry_v1', entryId: id, caseId: caseId(c), transactionId: c.transactionId, leg: c.leg,
      actorId: uid, requestId, command, payloadHash: supportHash(command), sourceCapture: capture, operatorAuthority: null,
      addressedTo: [s.order.buyerId, s.order.sellerId], recordedAt: now, resultingSemanticSourceHash};
    if (Buffer.byteLength(JSON.stringify(document), 'utf8') > 750000) throw new HttpsError('failed-precondition', 'Sources de l’arrêt trop volumineuses ; revue requise.');
    const notice = await notices(tx, s, id, message);
    tx.create(caseRef(c).collection('entries').doc(id), {protocol: document.protocol, document, contentHash: supportSourceHash(document)});
    tx.set(caseRef(c), {...(s.root ?? {}), protocol: 'label_lifecycle_case_v1', caseId: caseId(c), transactionId: c.transactionId, leg: c.leg,
      buyerId: s.order.buyerId, sellerId: s.order.sellerId, version: s.version + 1, latestInstructionId: id});
    tx.create(receiptRef(uid, requestId), {protocol: 'label_lifecycle_command_v1', actorId: uid, requestId, command, payloadHash: supportHash(command),
      state: 'committed', reason: null, recordedAt: now, entryId: id, providerOperationState: null, caseVersionAtCommit: s.version + 1});
    tx.update(s.orderRef, {'labelLifecycleStop.forward': stop}); notice.commit();
  });
}
function sourceView(s: State) {
  return {protocol: 'label_lifecycle_source_v1', transactionId: s.c.transactionId, leg: s.c.leg, caseId: caseId(s.c),
    sourceHash: s.sourceHash, sourceRevision: s.sourceRevision, semanticSourceHash: s.semanticHash, caseVersion: s.version,
    qualification: s.rootQualified ? s.qualification : 'unknown', identity: s.rootQualified ? s.identity : null,
    reconciliation: {labelPurchaseRequired: s.order.labelReconciliationRequired === true,
      returnRequired: s.order.returnReconciliationRequired === true || s.order.returnRequest?.state === 'reconciliation_required',
      purchaseState: typeof (s.c.leg === 'forward' ? s.order.labelPurchase?.state : s.order.returnRequest?.state) === 'string' ?
        s.c.leg === 'forward' ? s.order.labelPurchase.state : s.order.returnRequest.state : null},
    routeSourceHash: s.routeHash, purchasePolicyHash: s.policyHash, stopUse: own(s.order.labelLifecycleStop, s.c.leg),
    latestInstructionId: s.rootQualified && typeof s.root?.latestInstructionId === 'string' ? s.root.latestInstructionId : null,
    currentLabelId: s.identity?.labelId ?? null, ...noAuthority};
}
function author(s: State, uid: string) {return [s.order.buyerId, s.order.sellerId].includes(uid);}
async function notices(tx: FirebaseFirestore.Transaction, s: State, id: string, message: string, noticeState: 'intent_reserved' | 'entry_recorded' = 'entry_recorded') {
  return prepareOperationalNotices(tx, [s.order.buyerId, s.order.sellerId].map(userId => ({eventKey: `label_lifecycle_v1:${id}:${noticeState}:${userId}`, userId,
    type: 'shipping_update', title: 'Suivi de l’étiquette de transport', message,
    data: {ownerId: userId, transactionId: s.c.transactionId, labelLifecycleCaseId: caseId(s.c), labelLifecycleLeg: s.c.leg,
      labelLifecycleEntryId: id, labelLifecycleNoticeState: noticeState}})));
}
function receiptView(uid: string, requestId: string, command: Command, d?: any) {
  return {protocol: 'label_lifecycle_command_v1', actorId: uid, requestId, command, payloadHash: supportHash(command), caseId: caseId(command),
    entryId: d?.entryId ?? null, state: d?.state ?? 'unrecorded', reason: d?.reason ?? null, recordedAt: native(d?.recordedAt) ? d.recordedAt.toDate().toISOString() : null,
    providerOperationState: d?.providerOperationState ?? null, caseVersionAtCommit: d?.caseVersionAtCommit ?? null, ...noAuthority};
}
async function qualifyNativeEntry(tx: FirebaseFirestore.Transaction, c: Context, id: string, raw: any) {
  const d = raw?.document;
  if (raw?.protocol !== 'label_lifecycle_entry_v1' || d?.protocol !== raw.protocol || d.entryId !== id || id !== entryId(d.actorId, d.requestId) ||
      d.caseId !== caseId(c) || d.transactionId !== c.transactionId || d.leg !== c.leg || !native(d.recordedAt) ||
      supportSourceHash(d) !== raw.contentHash || !Array.isArray(d.addressedTo) || d.addressedTo.length !== 2 || d.addressedTo.some((v: any) => !docId(v))) return null;
  let command: Command; try {command = parseCommand(d.command);} catch {return null;}
  if (command.scope === 'admin' && (d.operatorAuthority?.protocol !== 'label_lifecycle_operator_v1' || d.operatorAuthority.actorId !== d.actorId ||
      d.operatorAuthority.currentAuthorityQualified !== true || !HASH.test(d.operatorAuthority.currentRoleHash ?? '') ||
      !Number.isSafeInteger(d.operatorAuthority.authTime) || d.operatorAuthority.authTime < 1 || !Number.isSafeInteger(d.operatorAuthority.authTime * 1000) ||
      d.operatorAuthority.authTime * 1000 > d.recordedAt.toMillis())) return null;
  if (command.scope === 'own' && !d.addressedTo.includes(d.actorId)) return null;
  if (['observe_provider', 'void_label', 'replacement_quote', 'purchase_replacement'].includes(command.action)) {
    const o = d.providerObservation, i = d.sourceCapture?.identity;
    if (o?.protocol !== 'shipengine_label_lifecycle_observation_v1' || o.source !== 'exact_label_get' || o.labelId !== i?.labelId ||
        typeof o.identityQualified !== 'boolean' || !['available', 'voided', 'unknown'].includes(o.documentState) ||
        !Number.isSafeInteger(o.requestedAtMs) || !Number.isSafeInteger(o.observedAtMs) || o.requestedAtMs < 1 || o.observedAtMs < o.requestedAtMs ||
        o.observedAtMs > d.recordedAt.toMillis() || ![null, 'request_scheduled', 'pending', 'approved', 'rejected', 'excluded'].includes(o.refundStatus) ||
        o.costCents !== null && (!Number.isSafeInteger(o.costCents) || o.costCents < 0 || o.currency !== 'CAD') ||
        o.effectiveRefundCents !== null || o.remainingCostCents !== null || o.settledBillingProof !== null) return null;
    if (d.voidObservation != null) {
      const v = d.voidObservation;
      if (command.action !== 'void_label' || v.protocol !== 'shipengine_label_void_response_v1' || v.source !== 'exact_label_void_put' ||
          v.labelId !== i.labelId || !['approved', 'refused'].includes(v.outcome) || v.approved !== (v.outcome === 'approved') ||
          !Number.isSafeInteger(v.requestedAtMs) || !Number.isSafeInteger(v.observedAtMs) || v.requestedAtMs < 1 || v.observedAtMs < v.requestedAtMs ||
          v.observedAtMs > d.recordedAt.toMillis() || v.refundStatus !== null || v.effectiveRefundCents !== null) return null;
    }
    if (d.voidAlreadyObserved && (command.action !== 'void_label' || o.identityQualified !== true || o.providerVoided !== true)) return null;
  }
  const receipt = (await tx.get(receiptRef(d.actorId, d.requestId))).data();
  if (receipt?.protocol !== 'label_lifecycle_command_v1' || receipt.actorId !== d.actorId || receipt.requestId !== d.requestId || receipt.entryId !== id ||
      receipt.state !== 'committed' || receipt.payloadHash !== supportHash(command) || supportHash(receipt.command) !== supportHash(command) ||
      d.payloadHash !== supportHash(command) || !native(receipt.recordedAt) || !receipt.recordedAt.isEqual(d.recordedAt) ||
      d.sourceCapture?.protocol !== 'label_lifecycle_source_capture_v1' || d.sourceCapture.semanticSourceHash !== commandSemanticHash(d) ||
      d.sourceCapture.sourceHash !== command.sourceHash || d.sourceCapture.sourceRevision !== command.sourceRevision || d.sourceCapture.caseVersion !== command.caseVersion ||
      d.sourceCapture.buyerId !== d.sourceCapture.order?.buyerId || d.sourceCapture.sellerId !== d.sourceCapture.order?.sellerId ||
      supportHash(d.addressedTo) !== supportHash([d.sourceCapture.buyerId, d.sourceCapture.sellerId])) return null;
  return {d, command, contentHash: raw.contentHash as string, receipt};
}
async function nativeEntry(tx: FirebaseFirestore.Transaction, c: Context, id: string, raw: any) {
  try {return await qualifyNativeEntry(tx, c, id, raw);} catch (e) {
    if (e instanceof TypeError || e instanceof HttpsError && ['failed-precondition', 'invalid-argument'].includes(e.code)) return null;
    throw e;
  }
}
export type LabelPurchasedReference = {kind:'initial'} | {kind:'replacement';entryId:string;contentHash:string};
/** Private documentary purchase provenance. No current label permission, GET or money effect. */
export async function readLabelLifecyclePurchasedSource(tx:FirebaseFirestore.Transaction,transactionId:string,order:FirebaseFirestore.DocumentData,leg:Leg,selected:LabelPurchasedReference) {
  const c={transactionId,leg},unknown={qualification:'unknown' as const,identity:null,costCents:null,currency:null,costQualification:'unknown' as const,
    purchaseSourceHash:null,purchaseRecordedAt:null,currentness:'unknown' as const};
  if(order.deliveryType!=='shipping'||!docId(order.buyerId)||!docId(order.sellerId)||order.buyerId===order.sellerId)return unknown;
  let identity:LabelLifecycleIdentity|null=null,costCents:number|null=null,recordedAt:Timestamp|null=null,purchaseSource:unknown=null;
  if(selected.kind==='initial') {
    const p=leg==='forward'?order.labelPurchase:order.returnRequest,q=leg==='forward'?p?.qualification:p?.labelProof;
    const original={...order,labelLifecycleCurrent:{...(order.labelLifecycleCurrent??{})}};delete original.labelLifecycleCurrent[leg];
    if(leg==='forward'&&own(order.labelLifecycleCurrent,'forward'))Object.assign(original,{shipEngineLabelId:p?.providerLabelId,shipEngineRateId:p?.rateId,
      trackingNumber:p?.lastObservation?.trackingNumber??null,carrierCode:order.shippingSnapshot?.rate?.carrierCode});
    else if(leg==='return')Object.assign(original,{returnLabelId:q?.labelId,returnTrackingNumber:q?.trackingNumber,returnLabelUrl:q?.labelUrl,returnLabelCost:q?.cost,returnCarrierCode:q?.carrierCode});
    const observed=sourceIdentity(c,original);
    if(observed.qualification!=='native_saved_label'||!observed.identity||observed.identity.providerCreatedAtMs!==null&&observed.identity.providerCreatedAtMs>p.committedAt.toMillis())return unknown;
    identity=observed.identity;recordedAt=p.committedAt;
    if(q?.currency==='CAD'&&[q.shipmentCents,q.insuranceCents,q.totalCents].every(v=>Number.isSafeInteger(v)&&v>=0)&&q.totalCents===q.shipmentCents+q.insuranceCents&&
      (leg==='forward'?q.schemaVersion===1&&q.requestedRateId===identity.rateId:q.schemaVersion===2))costCents=q.totalCents;
    purchaseSource={kind:'initial',intent:p,shippingSnapshot:order.shippingSnapshot??null,identity};
  } else {
    if(!/^le_[a-f0-9]{64}$/.test(selected.entryId)||!HASH.test(selected.contentHash))return unknown;
    const p=await nativeEntry(tx,c,selected.entryId,(await tx.get(caseRef(c).collection('entries').doc(selected.entryId))).data());
    const label:ShipEngineLabel|undefined=p?.d.labelPurchaseResult?.label,q=label?.qualification;
    const quote=p?await purchasedReplacementQuote(tx,c,p):null;
    if(!p||p.contentHash!==selected.contentHash||p.command.action!=='purchase_replacement'||!quote||!label||!q||q.currency!=='CAD'||
      ![label.labelId,label.shipmentId,label.carrierId,q.requestedRateId].every(providerId)||!label.carrierCode||!label.serviceCode||
      ![q.shipmentCents,q.insuranceCents,q.totalCents].every(v=>Number.isSafeInteger(v)&&v>=0)||q.totalCents!==q.shipmentCents+q.insuranceCents||
      exactCents(label.shipmentCost)!==q.shipmentCents||exactCents(label.insuranceCost)!==q.insuranceCents||providerUtc(q.providerCreatedAt)===null||providerUtc(q.providerCreatedAt)!>p.d.recordedAt.toMillis())return unknown;
    identity={labelId:label.labelId,direction:leg,shipmentId:label.shipmentId!,carrierId:label.carrierId!,carrierCode:label.carrierCode,serviceCode:label.serviceCode!,
      rateId:q.requestedRateId,trackingNumber:label.trackingNumber??null,outboundLabelId:leg==='return'?(quote.context as ReturnShipmentContext).outboundLabelId:null,providerCreatedAtMs:providerUtc(q.providerCreatedAt)};
    costCents=q.totalCents;recordedAt=p.d.recordedAt;purchaseSource={kind:'replacement',entryId:selected.entryId,contentHash:p.contentHash,identity,costCents,quoteReference:p.command.quoteReference};
  }
  const currentIdentity=own(order.labelLifecycleCurrent,leg)?await readCurrentReplacementIdentity(tx,c,order):sourceIdentity(c,order);
  const currentness=currentIdentity.qualification==='native_saved_label'&&currentIdentity.identity ?
    currentIdentity.identity.labelId===identity.labelId?'current' as const:'historical' as const:'unknown' as const;
  return {qualification:'native_purchased_label' as const,identity,costCents,currency:costCents===null?null:'CAD' as const,
    costQualification:costCents===null?'unknown' as const:'native_purchase_cost' as const,purchaseSourceHash:supportSourceHash(purchaseSource),
    purchaseRecordedAt:native(recordedAt)?recordedAt.toDate().toISOString():null,currentness};
}
function commandSemanticHash(d: any) {return supportSourceHash(d.sourceCapture?.order ?? null);}
export async function readLabelLifecycleSource(request: any) {
  if (request.data?.routeAmendmentCapability !== undefined) return labelRouteAmendment(request);
  const uid = supportUid(request), raw = supportObject(request.data, ['mode', 'capability', 'expectedUid', 'transactionId', 'leg', 'scope', 'noticeReference']), c = context(raw);
  if (!['own', 'admin'].includes(raw.scope)) throw new HttpsError('invalid-argument', 'Portée requise.');
  return db.runTransaction(async tx => {if (raw.scope === 'admin') await operator(tx, request, uid);
    const s = await current(tx, c); if (raw.scope === 'own' && !author(s, uid)) throw new HttpsError('permission-denied', 'Pas votre commande.');
    return {protocol: 'label_lifecycle_source_observation_v1', actorId: uid, scope: raw.scope, source: sourceView(s), currentLabelUse: await currentLabelUse(tx, s),
      replacement: await replacementView(tx, s), currentInstruction: await currentInstruction(tx, s, uid, raw.scope === 'admin'),
      notice: await noticeQualification(tx, s, uid, raw.scope === 'admin', raw.noticeReference), readAt: Timestamp.now().toDate().toISOString(), ...noAuthority};});
}
export async function previewLabelLifecycle(request: any) {
  if (request.data?.routeAmendmentCapability !== undefined) return labelRouteAmendment(request);
  const uid = supportUid(request), raw = supportObject(request.data, ['mode', 'capability', 'expectedUid', 'transactionId', 'leg', 'scope']), c = context(raw);
  if (!['own', 'admin'].includes(raw.scope)) throw new HttpsError('invalid-argument', 'Portée requise.');
  return db.runTransaction(async tx => {
    const admin = raw.scope === 'admin'; if (admin) await operator(tx, request, uid);
    const s = await current(tx, c); if (!admin && !author(s, uid)) throw new HttpsError('permission-denied', 'Pas votre commande.');
    return {protocol: 'label_lifecycle_preview_v1', actorId: uid, scope: raw.scope, source: sourceView(s),
      options: s.rootQualified ? admin ? ['maintain_review', 'stop_use', 'observe_provider', 'void_label', 'replacement_quote', 'purchase_replacement', 'adopt_replacement'] : ['request_review', 'stop_use', 'observe_provider', 'accept_replacement'] : [],
      replacement: await replacementView(tx, s), currentLabelUse: await currentLabelUse(tx, s), currentInstruction: await currentInstruction(tx, s, uid, admin),
      actionAvailability: await actionAvailability(tx, s, uid, admin, request), commandPermissionGranted: false, additionalBuyerChargeAuthorized: false, ...noAuthority};
  });
}
export async function readLabelLifecycleHistory(request: any) {
  if (request.data?.routeAmendmentCapability !== undefined) return labelRouteAmendment(request);
  const uid = supportUid(request), raw = supportObject(request.data, ['mode', 'capability', 'expectedUid', 'transactionId', 'leg', 'scope', 'cursor']), c = context(raw);
  const cursor = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId']).lastId;
  if (!['own', 'admin'].includes(raw.scope) || cursor !== null && !docId(cursor)) throw new HttpsError('invalid-argument', 'Lecteur natif invalide.');
  return db.runTransaction(async tx => {
    const admin = raw.scope === 'admin'; if (admin) await operator(tx, request, uid);
    const s = await current(tx, c); if (!admin && !author(s, uid)) throw new HttpsError('permission-denied', 'Pas votre commande.');
    let query: FirebaseFirestore.Query = caseRef(c).collection('entries').orderBy('__name__').limit(21); if (cursor) query = query.startAfter(cursor);
    const page = await tx.get(query), inspected = page.docs.slice(0, 20), entries = [];
    for (const row of inspected) {
      const p = await nativeEntry(tx, c, row.id, row.data());
      if (!p || !admin && !p.d.addressedTo.includes(uid)) {entries.push({qualification: 'unknown', entryId: row.id, entry: null}); continue;}
      const publicProvider = p.d.providerObservation ? {...p.d.providerObservation, documentUrl: null} : null;
      entries.push({qualification: 'native_lifecycle_entry', entryId: row.id, entry: {protocol: 'label_lifecycle_entry_view_v1', contentHash: p.contentHash,
        action: p.command.action, message: p.command.message, privateNote: admin ? p.command.privateNote : null,
        recordedAt: p.d.recordedAt.toDate().toISOString(), providerObservation: publicProvider,
        voidResponse: p.d.voidObservation ? {approved: p.d.voidObservation.approved, outcome: p.d.voidObservation.outcome,
          message: p.d.voidObservation.message, reasonCode: p.d.voidObservation.reasonCode, source: 'exact_label_void_put'} : null,
        carrierRefund: {state: p.d.providerObservation?.refundStatus === 'request_scheduled' ? 'requested' : p.d.providerObservation?.refundStatus === 'rejected' ? 'refused' :
          p.d.providerObservation?.refundStatus ?? 'unknown', labelId: p.d.providerObservation?.labelId ?? p.d.sourceCapture.identity?.labelId ?? null,
          platformVoidRequestRecorded: p.command.action === 'void_label', voidApproved: p.d.voidObservation?.approved ?? (p.d.voidAlreadyObserved ? true : null),
          providerStatus: p.d.providerObservation?.providerRefundStatus ?? null, reasonCode: p.d.voidObservation?.reasonCode ?? null,
          reasonMessage: p.d.voidObservation?.message ?? null, costCents: p.d.providerObservation?.costCents ?? null,
          currency: p.d.providerObservation?.currency ?? null, effectiveRefundCents: null, remainingCostCents: null, settledBillingProof: null},
        replacementExpense: p.d.labelPurchaseResult ? {labelId: p.d.labelPurchaseResult.label.labelId, costCents: p.d.labelPurchaseResult.costCents,
          currency: 'CAD', fundingAuthorizationRecorded: p.command.platformAuthorization !== null,
          matchesAuthorizedCost: p.d.labelPurchaseResult.costCents === p.command.platformAuthorization?.amountCents,
          buyerChargeAuthorized: false, settledBillingProof: null} : null,
        replacementQuote: p.d.replacementQuote ? {id: row.id, contentHash: p.contentHash, costCents: p.d.replacementQuote.costCents, currency: 'CAD',
          rateId: p.d.replacementQuote.rateId, routeSourceHash: p.d.replacementQuote.routeSourceHash, purchasePolicyHash: p.d.replacementQuote.purchasePolicyHash,
          labelReplacedId: p.d.replacementQuote.oldLabelId, additionalBuyerChargeCents: null, platformFundingGuaranteed: false} : null,
        sourceCurrentlyMatches: p.d.sourceCapture.semanticSourceHash === s.semanticHash, ...noAuthority}});
    }
    return {protocol: 'label_lifecycle_history_page_v1', actorId: uid, scope: raw.scope, transactionId: c.transactionId, leg: c.leg,
      source: sourceView(s), entries, nextCursor: page.size > 20 ? {lastId: inspected.at(-1)!.id} : null,
      coverage: {inspected: inspected.length, limit: 20, hasMore: page.size > 20, exhaustiveHistoryVerified: false}, ...noAuthority};
  });
}
/** Global queue scans native order IDs rather than four independently sorted
 * flags. Filtering advances the last INSPECTED ID even for malformed history. */
export async function readLabelLifecycleAdminQueue(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['mode', 'capability', 'expectedUid', 'cursor', 'stream']);
  const stream = raw.stream ?? 'orders';
  if (!['orders', 'orphan_alerts'].includes(stream)) throw new HttpsError('invalid-argument', 'File native invalide.');
  const cursor = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId']).lastId;
  if (cursor !== null && !docId(cursor)) throw new HttpsError('invalid-argument', 'Curseur invalide.');
  return db.runTransaction(async tx => {
    await operator(tx, request, uid); let query: FirebaseFirestore.Query = db.collection(stream === 'orders' ? 'transactions' : 'admin_alerts').orderBy('__name__').limit(21);
    if (cursor) query = query.startAfter(cursor); const page = await tx.get(query), inspected = page.docs.slice(0, 20), entries = [];
    for (const row of inspected) {
      const d = row.data();
      if (stream === 'orphan_alerts') {
        if (d.kind !== 'orphan_shipping_label') continue;
        let transactionId: string | null = null;
        try {transactionId = supportId(d.refId, 'Commande');} catch { /* A partial alert is not a native order. */ }
        entries.push({transactionId, leg: 'forward', qualification: 'unknown', source: null, orphanAlert: {
          id: row.id, sourceRevision: supportRevision(row), sourceHash: supportSourceHash(d), qualification: 'native_alert_partial',
          labelId: providerId(d.context?.labelId) ? d.context.labelId : null,
          reason: typeof d.context?.reason === 'string' && d.context.reason.length <= 2000 ? d.context.reason : null}});
        continue;
      }
      for (const leg of ['forward', 'return'] as const) {
        const dossier = (await tx.get(caseRef({transactionId: row.id, leg}))).exists;
        const relevant = dossier || own(d.labelRouteReview, leg) || (leg === 'forward' ? d.labelReconciliationRequired === true || ['unknown', 'reconciliation_required'].includes(d.labelPurchase?.state) ||
          d.labelLifecycleStop?.forward != null || d.labelLifecycleCurrent?.forward != null : d.returnReconciliationRequired === true ||
          ['unknown', 'reconciliation_required'].includes(d.returnRequest?.state) || d.returnLabelPending === true || d.labelLifecycleStop?.return != null || d.labelLifecycleCurrent?.return != null);
        if (!relevant) continue;
        if (d.deliveryType !== 'shipping' || !docId(d.buyerId) || !docId(d.sellerId) || d.buyerId === d.sellerId) entries.push({transactionId: row.id, leg, qualification: 'unknown', source: null, orphanAlert: null});
        else {const s = await current(tx, {transactionId: row.id, leg}), source = sourceView(s); entries.push({transactionId: row.id, leg, qualification: source.qualification, source, orphanAlert: null});}
      }
    }
    return {protocol: 'label_lifecycle_admin_queue_v1', actorId: uid, stream, entries, nextCursor: page.size > 20 ? {lastId: inspected.at(-1)!.id} : null,
      coverage: {inspected: inspected.length, limit: 20, hasMore: page.size > 20, exhaustiveHistoryVerified: false}, ...noAuthority};
  });
}
function hasPendingReplacement(s: State) {
  // null is the native empty sentinel; false/0/strings/malformed objects and
  // any other present value are not evidence that no label was purchased.
  return own(s.root, 'pendingReplacement') && s.root?.pendingReplacement !== null;
}
async function replacementAllowed(tx: FirebaseFirestore.Transaction, s: State, adoptingExisting = false, reserved?: ReservedPreparation) {
  if(!adoptingExisting&&!await originalTransportSourceQualified(tx,s.c.transactionId,s.order))return false;
  if (!adoptingExisting && !await transportContactAllowsNewLabel(tx, s.c.transactionId, s.order)) return false;
  if (!adoptingExisting && own(s.order.operationalRoutes,s.c.leg) && !await labelRouteAmendmentPreparationBasis(tx,s.c.transactionId,s.order,s.c.leg,reserved)) return false;
  if (!adoptingExisting && hasPendingReplacement(s)) return false;
  if (!s.rootQualified || !s.route || !s.identity || s.qualification !== 'native_saved_label' || !s.policyHash ||
      hasActiveBankDispute(s.order) || hasUnsettledRefund(s.order) || s.order.labelReconciliationRequired === true ||
      s.order.returnReconciliationRequired === true || s.order.trackingReviewRequired === true || returnToSenderBlocksProgress(s.order) ||
      (s.c.leg === 'forward' ? s.order.disputed === true || !['paid', 'label_created'].includes(s.order.status) || own(s.order, 'returnRequest') : s.order.returnRequest?.state !== 'committed')) return false;
  if (!docId(s.order.articleId)) return false;
  const articleRef = db.collection('articles').doc(s.order.articleId), article = (await tx.get(articleRef)).data();
  if (!article || article.sellerId !== s.order.sellerId || article.isSold !== true || !await articleReservationOwnedBy(tx, articleRef, article, s.c.transactionId)) return false;
  return (s.c.leg === 'return' ? await returnSourcesAllow(tx, s) : await orderModerationAllowsProgress(tx, s.order, 'forward', s.c.transactionId)) &&
    await fraudReviewAllowsProgress(tx, s.c.transactionId, s.order, s.snap);
}
async function priorReceipt(tx: FirebaseFirestore.Transaction, uid: string, requestId: string, command: Command) {
  const p = (await tx.get(receiptRef(uid, requestId))).data(); if (!p) return null;
  if (p.protocol !== 'label_lifecycle_command_v1' || p.actorId !== uid || p.requestId !== requestId || p.payloadHash !== supportHash(command) ||
      supportHash(p.command) !== supportHash(command) || !native(p.recordedAt) || !['reserved', 'reconciliation_required', 'committed', 'not_executed'].includes(p.state))
    throw new HttpsError('already-exists', 'Intention différente ou reçu inconnu.');
  if (['reserved', 'reconciliation_required'].includes(p.state) && (p.sourceCapture?.protocol !== 'label_lifecycle_source_capture_v1' ||
      p.sourceCapture.sourceHash !== command.sourceHash || p.sourceCapture.sourceRevision !== command.sourceRevision ||
      p.sourceCapture.caseVersion !== command.caseVersion || p.sourceCapture.semanticSourceHash !== supportSourceHash(p.sourceCapture.order ?? null) ||
      p.sourceCapture.buyerId !== p.sourceCapture.order?.buyerId || p.sourceCapture.sellerId !== p.sourceCapture.order?.sellerId ||
      supportHash(p.addressedTo) !== supportHash([p.sourceCapture.buyerId, p.sourceCapture.sellerId]) ||
      !['reserved', 'requested'].includes(p.providerOperationState))) throw new HttpsError('failed-precondition', 'Intention fournisseur native inconnue.');
  if (p.state === 'committed' && !await nativeEntry(tx, command, entryId(uid, requestId), (await tx.get(caseRef(command).collection('entries').doc(entryId(uid, requestId)))).data()))
    throw new HttpsError('failed-precondition', 'Reçu historique à rapprocher.');
  return p;
}
export async function commandLabelLifecycle(request: any) {
  return withFinancialRecoveryScope({operation: 'labelLifecycle.command'}, () => commandLabelLifecycleInScope(request));
}
async function commandLabelLifecycleInScope(request: any) {
  if (request.data?.routeAmendmentCapability !== undefined) return labelRouteAmendment(request);
  const uid = supportUid(request), raw = supportObject(request.data, ['mode', 'capability', 'expectedUid', 'requestId', 'action', 'command']);
  if (!['execute', 'observe', 'neutralize', 'recover'].includes(raw.action)) throw new HttpsError('invalid-argument', 'Action du journal invalide.');
  const requestId = supportRequestId(raw.requestId), command = parseCommand(raw.command), id = entryId(uid, requestId);
  const prepared = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const prior = await priorReceipt(tx, uid, requestId, command);
    if (prior) {
      if (raw.action === 'neutralize' && ['reserved', 'reconciliation_required'].includes(prior.state) && prior.providerOperationState === 'reserved' && prior.providerRequestedAt == null)
        return {prior: await nonexecuteUnescaped(tx, uid, requestId, command, prior, 'requester_neutralized'), newEffect: false};
      return {prior, newEffect: false};
    }
    if (raw.action === 'observe' || raw.action === 'recover') return {prior: null, newEffect: false};
    const now = Timestamp.now(), noEffect = (reason: string) => {const p = {protocol: 'label_lifecycle_command_v1', actorId: uid, requestId,
      command, payloadHash: supportHash(command), state: 'not_executed', reason, recordedAt: now, entryId: null, providerOperationState: null, caseVersionAtCommit: null};
      tx.create(receiptRef(uid, requestId), p); return {prior: p, newEffect: false};};
    if (raw.action === 'neutralize') return noEffect('requester_neutralized');
    if (!LABEL_LIFECYCLE_DISPATCH_ENABLED) return noEffect('label_lifecycle_not_exposed');
    const adminAction = command.scope === 'admin';
    const authority = adminAction ? await operator(tx, request, uid, ['void_label', 'replacement_quote', 'purchase_replacement'].includes(command.action)) : null;
    let s: State; try {s = await current(tx, command);} catch (e) {if (e instanceof HttpsError && ['failed-precondition', 'not-found'].includes(e.code)) return noEffect('native_sources_unknown'); throw e;}
    if (!adminAction && !author(s, uid)) return noEffect('not_a_native_participant');
    if (!s.rootQualified || s.version === null || s.version >= Number.MAX_SAFE_INTEGER - 1) return noEffect('native_sources_unknown');
    if (command.sourceHash !== s.sourceHash || command.sourceRevision !== s.sourceRevision || command.caseVersion !== s.version) return noEffect('source_changed');
    if (['observe_provider', 'void_label', 'replacement_quote', 'purchase_replacement', 'adopt_replacement'].includes(command.action) && !s.identity) return noEffect('label_identity_unknown');
    if (['replacement_quote', 'purchase_replacement', 'adopt_replacement'].includes(command.action) &&
        !await replacementAllowed(tx, s, command.action === 'adopt_replacement')) return noEffect('replacement_current_guards_blocked');
    const effect = ['observe_provider', 'void_label', 'replacement_quote', 'purchase_replacement'].includes(command.action);
    if (effect && s.root?.pendingEffect != null) return noEffect('previous_provider_operation_requires_reconciliation');
    const replacement = command.quoteReference ? await quoteForCurrent(tx, s, command.quoteReference) : null;
    if (command.quoteReference && !replacement) return noEffect('replacement_quote_source_unknown_or_changed');
    if (command.action === 'purchase_replacement' && (!replacement || command.platformAuthorization?.amountCents !== replacement.quote.costCents ||
        !await bothAccepted(tx, s, command.quoteReference!))) return noEffect('replacement_cost_or_consents_unqualified');
    const purchased = command.action === 'adopt_replacement' ? await pendingReplacement(tx, s, command.quoteReference!) : null;
    if (command.action === 'adopt_replacement' && (!purchased || !replacement || !await bothAccepted(tx, s, command.quoteReference!) ||
        command.platformAuthorization?.amountCents !== purchased.result.costCents)) return noEffect('recovered_replacement_sources_or_cost_unknown');
    const financial = ['void_label', 'replacement_quote', 'accept_replacement', 'purchase_replacement', 'adopt_replacement'].includes(command.action) ||
      await maintainDocumentaryWitness([{domain: 'purchase', ref: s.orderRef.path, data: s.order},
        ...(s.root ? [{domain: 'label_lifecycle_case' as const, ref: caseRef(command).path, data: s.root}] : [])]);
    const missingReceipt = financial ? await tx.get(receiptRef(uid, requestId)) : null;
    // A documentary GET receipt never upgrades an old purchase to a newly
    // usable label. Adoption separately qualifies the exact paid intention.
    if (purchased) await prepareFinancialRecoverySource('label_lifecycle_command', receiptRef(purchased.actorId, purchased.requestId).path, purchased.receipt);
    const notice = await notices(tx, s, id, command.message + '\n\nLe document, l’annulation et le remboursement du transporteur restent distincts du règlement de la commande.', effect ? 'intent_reserved' : 'entry_recorded');
    const version = s.version + 1, capture = {protocol: 'label_lifecycle_source_capture_v1', semanticSourceHash: s.semanticHash, order: semantic(s.order),
      sourceHash: s.sourceHash, sourceRevision: s.sourceRevision, caseVersion: s.version, identity: s.identity, route: s.route, routeSourceHash: s.routeHash,
      purchasePolicyHash: s.policyHash, buyerId: s.order.buyerId, sellerId: s.order.sellerId};
    const voidStop = ['void_label', 'stop_use', 'maintain_review'].includes(command.action) ? {protocol: 'label_lifecycle_stop_v1', transactionId: command.transactionId,
      leg: command.leg, caseId: caseId(command), entryId: id, actorId: uid, recordedAt: now,
      source: command.action === 'void_label' ? 'native_operator_void_intent' : command.scope === 'admin' ? 'native_operator_stop_instruction' : 'explicit_participant_stop', stopUseRequired: true} : null;
    let projectedOrder = voidStop ? {...s.order, labelLifecycleStop: {...s.order.labelLifecycleStop, [command.leg]: voidStop}} : {...s.order};
    if (purchased) {
      const l: ShipEngineLabel = purchased.result.label;
      projectedOrder = {...projectedOrder, ...(command.leg === 'forward' ? {shipEngineLabelId: l.labelId, trackingNumber: l.trackingNumber,
        shippingLabelUrl: l.labelDownload.href, trackingUrl: l.trackingUrl, carrierCode: l.carrierCode} : {returnLabelId: l.labelId,
        returnTrackingNumber: l.trackingNumber, returnLabelUrl: l.labelDownload.href, returnCarrierCode: l.carrierCode})};
      if (own(projectedOrder.labelLifecycleStop, command.leg)) projectedOrder.labelLifecycleStop = Object.fromEntries(Object.entries(projectedOrder.labelLifecycleStop).filter(([k]) => k !== command.leg));
    }
    const expectedSemanticHash = supportSourceHash(semantic(projectedOrder));
    let p: Record<string, any> = {protocol: 'label_lifecycle_command_v1', actorId: uid, requestId, command, payloadHash: supportHash(command),
      state: effect ? 'reserved' : 'committed', reason: null, recordedAt: now, entryId: effect ? null : id, providerOperationState: effect ? 'reserved' : null,
      caseVersionAtCommit: version, sourceCapture: capture, operatorAuthority: authority, addressedTo: [s.order.buyerId, s.order.sellerId],
      expectedSemanticHash,
      ...(replacement ? {replacementQuoteCapture: replacement.quote, replacementQuoteContentHash: replacement.contentHash} : {})};
    if (Buffer.byteLength(JSON.stringify(p), 'utf8') > 750000) return noEffect('capture_capacity_requires_review');
    let next: Record<string, any> = {protocol: 'label_lifecycle_case_v1', caseId: caseId(command), transactionId: command.transactionId, leg: command.leg,
      buyerId: s.order.buyerId, sellerId: s.order.sellerId, version, latestInstructionId: ['stop_use', 'maintain_review', 'adopt_replacement'].includes(command.action) ? id : s.root?.latestInstructionId ?? null,
      pendingEffect: effect ? {actorId: uid, requestId, payloadHash: p.payloadHash, reservedVersion: version} : s.root?.pendingEffect ?? null,
      latestQuoteId: s.root?.latestQuoteId ?? null, latestQuoteHash: s.root?.latestQuoteHash ?? null,
      pendingReplacement: s.root?.pendingReplacement ?? null, latestProviderObservationId: s.root?.latestProviderObservationId ?? null,
      replacementAcceptances: s.root?.replacementAcceptances ?? null};
    if (command.action === 'accept_replacement') next.replacementAcceptances = {...next.replacementAcceptances,
      [uid === s.order.buyerId ? 'buyer' : 'seller']: {actorId: uid, entryId: id, quoteReference: command.quoteReference, recordedAt: now}};
    let documentWrite: {ref: FirebaseFirestore.DocumentReference; data: Record<string, any>} | null = null;
    let orderUpdate: Record<string, any> = voidStop ? {[`labelLifecycleStop.${command.leg}`]: voidStop} : {};
    if (!effect) {
      const document = {protocol: 'label_lifecycle_entry_v1', entryId: id, caseId: caseId(command), transactionId: command.transactionId, leg: command.leg,
        actorId: uid, requestId, command, payloadHash: p.payloadHash, sourceCapture: capture, operatorAuthority: authority, addressedTo: p.addressedTo, recordedAt: now,
        resultingSemanticSourceHash: expectedSemanticHash,
        ...(command.action === 'accept_replacement' ? {replacementQuoteCapture: replacement!.quote} : {}),
        ...(purchased ? {replacementActivation: {purchaseEntryId: purchased.entryId, purchaseContentHash: purchased.contentHash, labelId: purchased.result.label.labelId,
          previousLabelId: s.identity!.labelId, routeSourceHash: s.routeHash, purchasePolicyHash: s.policyHash}} : {})};
      const contentHash = supportSourceHash(document);
      documentWrite = {ref: caseRef(command).collection('entries').doc(id), data: {protocol: document.protocol, document, contentHash}};
      if (purchased) {
        const label: ShipEngineLabel = purchased.result.label;
        const identity: LabelLifecycleIdentity = {labelId: label.labelId, direction: command.leg, shipmentId: label.shipmentId!, carrierId: label.carrierId!, carrierCode: label.carrierCode,
          serviceCode: label.serviceCode!, rateId: label.qualification!.requestedRateId, trackingNumber: label.trackingNumber,
          outboundLabelId: command.leg === 'return' ? s.identity!.outboundLabelId : null,
          providerCreatedAtMs: providerUtc(label.qualification!.providerCreatedAt)};
        const marker = {protocol: 'label_lifecycle_current_label_v1', transactionId: command.transactionId, leg: command.leg,
          buyerId: s.order.buyerId, sellerId: s.order.sellerId, caseId: caseId(command), entryId: id, contentHash, activation: document.replacementActivation!, recordedAt: now};
        const currentMarker = {...marker, identity, identityHash: lifecycleLabelIdentityHash(command.transactionId, command.leg, marker, identity)};
        const update: Record<string, any> = {[`labelLifecycleCurrent.${command.leg}`]: currentMarker,
          ...(command.leg === 'forward' ? {shipEngineLabelId: label.labelId, trackingNumber: label.trackingNumber, shippingLabelUrl: label.labelDownload.href,
            trackingUrl: label.trackingUrl, carrierCode: label.carrierCode} : {returnLabelId: label.labelId, returnTrackingNumber: label.trackingNumber,
            returnLabelUrl: label.labelDownload.href, returnCarrierCode: label.carrierCode})};
        // An explicit source-bound adoption may supersede ONLY this lifecycle's
        // own stop. It never deletes another moderation/physical/financial flag.
        if (own(s.order.labelLifecycleStop, command.leg)) update[`labelLifecycleStop.${command.leg}`] = FieldValue.delete();
        orderUpdate = {...orderUpdate, ...update};
        next.pendingReplacement = null;
      }
    }
    if (financial) {
      // All projections are prepared before the native commit; no helper
      // performs writes and an existing case/command is never auto-adopted.
      orderUpdate = await financialRecoverySourceFields('purchase', s.orderRef, s.snap, orderUpdate);
      next = await financialRecoverySourceFields('label_lifecycle_case', caseRef(command), s.rootSnap, next);
      p = await financialRecoverySourceFields('label_lifecycle_command', receiptRef(uid, requestId), missingReceipt!, p);
      await recoveryCommit({refs: [s.orderRef.path, caseRef(command).path, receiptRef(uid, requestId).path]});
    }
    if (documentWrite) tx.create(documentWrite.ref, documentWrite.data);
    tx.set(caseRef(command), next);
    if (Object.keys(orderUpdate).length) tx.update(s.orderRef, orderUpdate);
    tx.create(receiptRef(uid, requestId), p); notice.commit(); return {prior: p, newEffect: effect};
  });
  const recovery = raw.action === 'recover' && ['reserved', 'reconciliation_required'].includes(prepared.prior?.state ?? '');
  if (!recovery && (!LABEL_LIFECYCLE_DISPATCH_ENABLED || !prepared.newEffect && (raw.action !== 'execute' || !['reserved', 'reconciliation_required'].includes(prepared.prior?.state ?? '')))) return receiptView(uid, requestId, command, prepared.prior);
  // Reserved provider operations are serviced only through the exact immutable
  // tuple. The implementation below never makes a second paid POST after an
  // escaped/unknown attempt, even if the lookup has no result.
  await serviceProviderEffect(request, uid, requestId, command, recovery);
  const final = await db.runTransaction(tx => priorReceipt(tx, uid, requestId, command));
  return receiptView(uid, requestId, command, final);
}
/** Only the native BEFORE-I/O state can prove that this particular operation
 * has not escaped. A requested marker or provider failure never proves it. */
async function nonexecuteUnescaped(tx: FirebaseFirestore.Transaction, uid: string, requestId: string, command: Command, prior: any, reason: string) {
  if (prior.providerOperationState !== 'reserved' || prior.providerRequestedAt != null) return prior;
  const rootSnap = await tx.get(caseRef(command)), root = rootSnap.data(), now = Timestamp.now();
  let fields: Record<string, any> = {state: 'not_executed', reason, recordedAt: now, entryId: null, providerOperationState: null, caseVersionAtCommit: null};
  let rootFields: Record<string, any> | null = root?.protocol === 'label_lifecycle_case_v1' && root.caseId === caseId(command) && root.pendingEffect?.actorId === uid && root.pendingEffect?.requestId === requestId &&
      root.pendingEffect?.payloadHash === prior.payloadHash && Number.isSafeInteger(root.version) && root.version > 0 && root.version < Number.MAX_SAFE_INTEGER - 1
    ? {version: root.version + 1, pendingEffect: null} : null;
  if (await maintainDocumentaryWitness([{domain: 'label_lifecycle_command', ref: receiptRef(uid, requestId).path, data: prior},
    ...(rootFields ? [{domain: 'label_lifecycle_case' as const, ref: caseRef(command).path, data: root}] : [])])) {
    fields = await financialRecoverySourceFields('label_lifecycle_command', receiptRef(uid, requestId), prior, fields);
    if (rootFields) rootFields = await financialRecoverySourceFields('label_lifecycle_case', caseRef(command), rootSnap, rootFields);
    await financialRecoveryCommitCheckpoint()({refs: [receiptRef(uid, requestId).path, ...(rootFields ? [caseRef(command).path] : [])]});
  }
  tx.update(receiptRef(uid, requestId), fields);
  if (rootFields) tx.update(caseRef(command), rootFields);
  const value = {...prior, ...fields};
  return value;
}
async function serviceProviderEffect(request: any, uid: string, requestId: string, command: Command, getOnly = false) {
  const p = await db.runTransaction(tx => priorReceipt(tx, uid, requestId, command));
  if (!p || !['reserved', 'reconciliation_required'].includes(p.state)) return;
  const engine = getShipEngine(), identity: LabelLifecycleIdentity | null = p.sourceCapture?.identity;
  if (!engine || !identity) return;
  await checkRateLimit(uid, true, {functionName: 'labelLifecycleProviderRead', maxCallsAuthenticated: 30, maxCallsUnauthenticated: 0, windowMs: 60000});
  const observation = await engine.readLabelLifecycle(identity);
  if (command.action === 'observe_provider') {await finishProviderEffect(uid, requestId, command, {providerObservation: observation}); return;}
  if (command.action === 'void_label' && observation.identityQualified && observation.providerVoided === true) {
    await finishProviderEffect(uid, requestId, command, {providerObservation: observation, voidAlreadyObserved: true}, getOnly); return;
  }
  if (command.action === 'replacement_quote') {
    await serviceReplacementQuote(request, uid, requestId, command, p, observation, getOnly); return;
  }
  if (command.action === 'purchase_replacement') {await serviceReplacementPurchase(request, uid, requestId, command, p, observation, getOnly); return;}
  if (command.action !== 'void_label' || !observation.identityQualified || observation.providerVoided !== false) {
    await holdProviderEffect(uid, requestId, command, 'provider_identity_or_outcome_unknown', observation, getOnly); return;
  }
  if (p.providerOperationState !== 'reserved') {await holdProviderEffect(uid, requestId, command, 'escaped_operation_unknown_get_only', observation, getOnly); return;}
  if (getOnly) {await holdProviderEffect(uid, requestId, command, 'recovery_get_only_no_new_void_permission', observation, true); return;}
  const permitted = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const prior = await priorReceipt(tx, uid, requestId, command); if (!prior || !['reserved', 'reconciliation_required'].includes(prior.state) || prior.providerOperationState !== 'reserved') return false;
    await operator(tx, request, uid, true); const s = await current(tx, command);
    if (!s.rootQualified || s.semanticHash !== prior.expectedSemanticHash || supportHash(s.identity) !== supportHash(identity) ||
        s.root?.pendingEffect?.payloadHash !== prior.payloadHash || s.root?.pendingEffect?.actorId !== uid || s.root?.pendingEffect?.requestId !== requestId ||
        s.version !== prior.caseVersionAtCommit) {await nonexecuteUnescaped(tx, uid, requestId, command, prior, 'source_changed_before_provider'); return false;}
    const fields = await financialProviderAuthorization(tx, s, uid, requestId, prior, {providerOperationState: 'requested', providerRequestedAt: Timestamp.now()});
    await recoveryCommit({refs: [s.orderRef.path, caseRef(command).path, receiptRef(uid, requestId).path]});
    fields.commit(); return fields.source;
  });
  if (!permitted) return;
  await assertFinancialRecoveryEffect('shipengine_label_mutation', {...permitted, providerOperation: 'labelLifecycle.void'});
  const voidObservation = await engine.voidLabelForLifecycle(identity.labelId);
  await finishProviderEffect(uid, requestId, command, {providerObservation: observation, voidObservation});
}
async function holdProviderEffect(uid: string, requestId: string, command: Command, reason: string, observation: LabelLifecycleObservation, documentaryOnly = false) {
  await db.runTransaction(async tx => {const p = await priorReceipt(tx, uid, requestId, command); if (!p || p.state === 'committed' || p.state === 'not_executed') return;
    const fields = {state: 'reconciliation_required', reason, lastProviderObservation: observation};
    tx.update(receiptRef(uid, requestId), documentaryOnly || command.action === 'observe_provider' ? fields :
      await financialRecoverySourceFields('label_lifecycle_command', receiptRef(uid, requestId), p, fields));});
}
async function finishProviderEffect(uid: string, requestId: string, command: Command, result: {providerObservation: LabelLifecycleObservation; voidObservation?: LabelVoidObservation; voidAlreadyObserved?: boolean;
  replacementQuote?: ReplacementQuote; labelPurchaseResult?: {label: ShipEngineLabel; quoteReference: QuoteReference; costCents: number; externalShipmentId: string | null}}, documentaryOnly = false) {
  await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const p = await priorReceipt(tx, uid, requestId, command); if (!p || p.state === 'committed' || p.state === 'not_executed') return;
    if (result.voidObservation?.outcome === 'unknown') {
      const fields = {state: 'reconciliation_required', reason: 'provider_void_outcome_unknown', lastProviderObservation: result.providerObservation, lastVoidObservation: result.voidObservation};
      tx.update(receiptRef(uid, requestId), documentaryOnly ? fields : await financialRecoverySourceFields('label_lifecycle_command', receiptRef(uid, requestId), p, fields)); return;
    }
    let s: State | null = null;
    try {s = await current(tx, command);} catch (e) {if (!(e instanceof HttpsError && ['failed-precondition', 'not-found'].includes(e.code))) throw e;}
    if (!s || !s.rootQualified || s.version === null || s.version >= Number.MAX_SAFE_INTEGER - 1 ||
        s.root?.pendingEffect?.payloadHash !== p.payloadHash || s.root?.pendingEffect?.actorId !== uid || s.root?.pendingEffect?.requestId !== requestId) {
      // The real provider response belongs to this immutable intention even
      // when the current order/case cannot admit a business commit. Preserve
      // it for GET-only reconciliation, without adopting or retrying it.
      const retained = {...p, lastProviderResult: result};
      tx.update(receiptRef(uid, requestId), {state: 'reconciliation_required', reason: 'provider_effect_current_sources_unknown',
        ...(Buffer.byteLength(JSON.stringify(retained), 'utf8') <= 850000 ? {lastProviderResult: result} :
          {lastProviderResultSummary: {labelId: result.labelPurchaseResult?.label.labelId ?? result.providerObservation.labelId,
            voidOutcome: result.voidObservation?.outcome ?? null, costCents: result.labelPurchaseResult?.costCents ?? null,
            sourceQualification: 'unknown', retainedOriginalResponse: false}})});
      return;
    }
    const id = entryId(uid, requestId), now = Timestamp.now();
    const notice = await notices(tx, s, id, result.voidAlreadyObserved || result.voidObservation?.approved === true ?
      'L’annulation de cette étiquette est enregistrée. Cela ne prouve ni interception du colis ni restitution du coût transporteur ou de l’argent de l’acheteur.' :
      result.voidObservation?.approved === false ? 'Le transporteur a refusé l’annulation de cette étiquette. Une revue du dossier est nécessaire.' : 'Une observation du document et du coût transporteur est enregistrée. Le statut du remboursement acheteur reste distinct.');
    const document = {protocol: 'label_lifecycle_entry_v1', entryId: id, caseId: caseId(command), transactionId: command.transactionId, leg: command.leg,
      actorId: uid, requestId, command, payloadHash: p.payloadHash, sourceCapture: p.sourceCapture, operatorAuthority: p.operatorAuthority,
      addressedTo: p.addressedTo, providerObservation: result.providerObservation, ...(result.voidObservation ? {voidObservation: result.voidObservation} : {}),
      ...(result.replacementQuote ? {replacementQuote: result.replacementQuote} : {}), ...(result.labelPurchaseResult ? {labelPurchaseResult: result.labelPurchaseResult} : {}),
      voidAlreadyObserved: result.voidAlreadyObserved === true, resultingSemanticSourceHash: p.expectedSemanticHash,
      sourceCurrentAtRecording: s.semanticHash === p.expectedSemanticHash, recordedAt: now};
    if (Buffer.byteLength(JSON.stringify(document), 'utf8') > 800000) {tx.update(receiptRef(uid, requestId), {state: 'reconciliation_required', reason: 'capture_capacity_requires_review'}); return;}
    const contentHash = supportSourceHash(document);
    let rootFields: Record<string, any> = {version: s.version! + 1, pendingEffect: null, latestProviderObservationId: id,
      ...(command.action === 'void_label' ? {latestInstructionId: id} : {}),
      // An old escaped quote can still be documented, but must never replace
      // the quote/consents associated with a purchased pending replacement.
      ...(result.replacementQuote && !hasPendingReplacement(s) ? {latestQuoteId: id, latestQuoteHash: contentHash, replacementAcceptances: null} : {}),
      ...(result.labelPurchaseResult ? {pendingReplacement: {entryId: id, contentHash, labelId: result.labelPurchaseResult.label.labelId}} : {})};
    let receiptFields: Record<string, any> = {state: 'committed', reason: null, entryId: id, providerOperationState: 'observation_recorded', caseVersionAtCommit: s.version! + 1, recordedAt: now};
    if (!documentaryOnly && (command.action !== 'observe_provider' || await maintainDocumentaryWitness([
      {domain: 'purchase', ref: s.orderRef.path, data: s.order}, {domain: 'label_lifecycle_case', ref: caseRef(command).path, data: s.root},
      {domain: 'label_lifecycle_command', ref: receiptRef(uid, requestId).path, data: p}]))) {
      await prepareFinancialRecoverySource('purchase', s.orderRef.path, s.order);
      rootFields = await financialRecoverySourceFields('label_lifecycle_case', caseRef(command), s.rootSnap, rootFields);
      receiptFields = await financialRecoverySourceFields('label_lifecycle_command', receiptRef(uid, requestId), p, receiptFields);
      await recoveryCommit({refs: [s.orderRef.path, caseRef(command).path, receiptRef(uid, requestId).path]});
    }
    tx.create(caseRef(command).collection('entries').doc(id), {protocol: document.protocol, document, contentHash});
    tx.update(caseRef(command), rootFields);
    tx.update(receiptRef(uid, requestId), receiptFields);
    notice.commit();
  });
}
/** Native BEFORE-I/O authorization qualifies all causal rows in the same
 * transaction. Documentary observations alone never reach this helper. */
async function financialProviderAuthorization(tx: FirebaseFirestore.Transaction, s: State, uid: string, requestId: string, p: any, patch: Record<string, any>) {
  const orderFields = await financialRecoverySourceFields('purchase', s.orderRef, s.snap, {});
  const rootFields = await financialRecoverySourceFields('label_lifecycle_case', caseRef(s.c), s.rootSnap, {});
  const receiptFields = await financialRecoverySourceFields('label_lifecycle_command', receiptRef(uid, requestId), p, patch);
  return {source: {refs: [s.orderRef.path, caseRef(s.c).path, receiptRef(uid, requestId).path],
    sourceHash: receiptFields.financialRecoveryWitness.nativeSourceHash},
    commit: () => {tx.update(s.orderRef, orderFields); tx.update(caseRef(s.c), rootFields); tx.update(receiptRef(uid, requestId), receiptFields);}};
}
async function authorizeProviderStep(request: any, uid: string, requestId: string, command: Command, expectedState: string) {
  return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const p = await priorReceipt(tx, uid, requestId, command); if (!p || !['reserved', 'reconciliation_required'].includes(p.state) || p.providerOperationState !== expectedState) return false;
    await operator(tx, request, uid, true); const s = await current(tx, command);
    const q = command.quoteReference ? await quoteForCurrent(tx, s, command.quoteReference) : null;
    const qualifies = s.rootQualified && s.semanticHash === p.expectedSemanticHash && s.version === p.caseVersionAtCommit &&
      s.root?.pendingEffect?.payloadHash === p.payloadHash && s.root?.pendingEffect?.actorId === uid && s.root?.pendingEffect?.requestId === requestId &&
      await replacementAllowed(tx, s, false, {actorId: uid, requestId, command}) && (command.action !== 'purchase_replacement' || q && command.platformAuthorization?.amountCents === q.quote.costCents && await bothAccepted(tx, s, command.quoteReference!));
    if (!qualifies) {await nonexecuteUnescaped(tx, uid, requestId, command, p, 'source_or_guards_changed_before_provider'); return false;}
    const fields = await financialProviderAuthorization(tx, s, uid, requestId, p, {providerOperationState: 'requested', providerRequestedAt: Timestamp.now()});
    await recoveryCommit({refs: fields.source.refs}); fields.commit(); return fields.source;
  });
}
async function serviceReplacementQuote(request: any, uid: string, requestId: string, command: Command, p: any, observation: LabelLifecycleObservation, getOnly: boolean) {
  const engine = getShipEngine(), nativeRoute: PurchaseRateContext | ReturnShipmentContext | null = p.sourceCapture?.route;
  if (!engine || !nativeRoute || !observation.identityQualified) {await holdProviderEffect(uid, requestId, command, 'replacement_quote_sources_unknown', observation, getOnly); return;}
  const externalId = 'sr_' + supportHash([uid, requestId, 'quote']).slice(0, 40);
  const quoteContext = command.leg === 'return' ? {...nativeRoute, externalShipmentId: externalId} as ReturnShipmentContext : nativeRoute;
  let rates: PurchaseRates;
  try {
    if (p.providerOperationState !== 'reserved' || getOnly) {
      if (command.leg !== 'return') {await holdProviderEffect(uid, requestId, command, 'escaped_quote_unknown_no_recreation', observation, getOnly); return;}
      rates = await engine.readReturnPurchaseRates(quoteContext as ReturnShipmentContext);
    } else {
      if (!await authorizeProviderStep(request, uid, requestId, command, 'reserved')) return;
      rates = command.leg === 'return' ? await engine.getReturnPurchaseRates(quoteContext as ReturnShipmentContext) :
        await engine.getPurchaseRates(quoteContext.shipFrom, quoteContext.shipTo, quoteContext.parcel,quoteContext.transport);
      await engine.readLifecycleShipment(rates.shipmentId, quoteContext);
    }
    if (!hasCurrentRateQualification(rates, quoteContext)) throw new Error('replacement_quote_response_unknown');
    const expected = p.sourceCapture.identity, matching = rates.rates.filter(r => r.carrierId === expected.carrierId && r.carrierCode === expected.carrierCode && r.serviceCode === expected.serviceCode);
    if (matching.length !== 1 || matching[0].shippingCents < 0 || !Number.isSafeInteger(matching[0].shippingCents) ||
        !HASH.test(p.sourceCapture.routeSourceHash ?? '') || !HASH.test(p.sourceCapture.purchasePolicyHash ?? '')) throw new Error('replacement_same_route_or_cost_unknown');
    const total = exactCents(p.sourceCapture.order.totalAmount); if (total === null) throw new Error('original_price_unknown');
    await finishProviderEffect(uid, requestId, command, {providerObservation: observation, replacementQuote: {protocol: 'label_replacement_quote_v1',
      oldLabelId: expected.labelId, semanticSourceHash: p.sourceCapture.semanticSourceHash, routeSourceHash: p.sourceCapture.routeSourceHash,
      purchasePolicyHash: p.sourceCapture.purchasePolicyHash, costCents: matching[0].shippingCents, currency: 'CAD', rateId: matching[0].rateId,
      originalBuyerTotalCents: total, additionalBuyerChargeCents: 0, platformAuthorizationRequired: true, platformFundingGuaranteed: false,
      providerShipmentSourceVerified: true, context: quoteContext, rates}}, getOnly);
  } catch (error) {if (error instanceof FinancialRecoveryBlocked) throw error; await holdProviderEffect(uid, requestId, command, 'replacement_quote_outcome_unknown', observation, getOnly);}
}
async function serviceReplacementPurchase(request: any, uid: string, requestId: string, command: Command, p: any, observation: LabelLifecycleObservation, getOnly: boolean) {
  const engine = getShipEngine(), quote: ReplacementQuote | undefined = p.replacementQuoteCapture;
  if (!engine || !quote || !command.quoteReference) return;
  const rate = quote.rates.rates.find(r => r.rateId === quote.rateId), externalId = 'sr_' + supportHash([uid, requestId, 'purchase']).slice(0, 40);
  if (!rate) {await holdProviderEffect(uid, requestId, command, 'replacement_purchase_quote_unknown', observation, getOnly); return;}
  const expected = {shipmentId: quote.rates.shipmentId, carrierId: rate.carrierId, carrierCode: rate.carrierCode, serviceCode: rate.serviceCode,
    ...(quote.context.transport!==undefined?{shipmentContext:quote.context}:{})};
  let label: ShipEngineLabel | null = null;
  // Real exact GET evidence is serviced FIRST, even after authority/source
  // changes. Empty/failed lookup is never proof of absence or a retry grant.
  try {label = command.leg === 'return' ? await engine.readReturnPurchasedLabel(quote.context as ReturnShipmentContext, quote.rateId, externalId) :
    await engine.readPurchasedLabel(quote.rates.shipmentId, quote.rateId, expected);} catch (error) {if (error instanceof FinancialRecoveryBlocked) throw error; /* No new permission from failed GET. */ }
  if (!label) {
    if (getOnly) {await holdProviderEffect(uid, requestId, command, 'recovery_get_only_no_new_purchase_permission', observation, getOnly); return;}
    if (p.providerOperationState !== 'reserved') {await holdProviderEffect(uid, requestId, command, 'replacement_purchase_unknown_get_only', observation, getOnly); return;}
    if (!observation.identityQualified || observation.providerVoided !== true) {await holdProviderEffect(uid, requestId, command, 'previous_label_void_not_qualified', observation, getOnly); return;}
    try {
      const nowRates = command.leg === 'return' ? await engine.readReturnPurchaseRates(quote.context as ReturnShipmentContext, quote.rates.shipmentId) :
        await engine.getPurchaseRatesForShipment(quote.rates.shipmentId, quote.context);
      if (!hasCurrentRateQualification(nowRates, quote.context) || !nowRates.rates.some(r => r.rateId === quote.rateId && supportHash(r) === supportHash(rate)))
        throw new Error('replacement_rate_changed');
      await engine.readLifecycleShipment(quote.rates.shipmentId, quote.context);
      const authorization = await authorizeProviderStep(request, uid, requestId, command, 'reserved');
      if (!authorization) return;
      await assertFinancialRecoveryEffect('shipengine_label_mutation', {...authorization, providerOperation: 'labelLifecycle.purchaseReplacement'});
      label = command.leg === 'return' ? await engine.createReturnLabel(quote.context as ReturnShipmentContext, quote.rateId, externalId) : await engine.createLabel(quote.rateId, expected);
    } catch (error) {if (error instanceof FinancialRecoveryBlocked) throw error; await holdProviderEffect(uid, requestId, command, 'replacement_purchase_outcome_unknown', observation, getOnly); return;}
  }
  const qualification = label.qualification;
  if (!qualification || qualification.currency !== 'CAD' || !Number.isSafeInteger(qualification.totalCents) || qualification.totalCents < 0 ||
      qualification.requestedRateId !== quote.rateId || label.carrierId !== rate.carrierId || label.carrierCode !== rate.carrierCode || label.serviceCode !== rate.serviceCode ||
      command.leg === 'forward' && label.shipmentId !== quote.rates.shipmentId || qualification.totalCents !== exactCents(label.shipmentCost + label.insuranceCost)) {
    await holdProviderEffect(uid, requestId, command, 'replacement_purchase_identity_or_cost_unknown', observation, getOnly); return;
  }
  await finishProviderEffect(uid, requestId, command, {providerObservation: observation, labelPurchaseResult: {label,
    quoteReference: command.quoteReference, costCents: qualification.totalCents, externalShipmentId: command.leg === 'return' ? externalId : null}}, getOnly);
}

/** Operational reminder clock only: the base is the committed purchase receipt,
 * not a claim about the provider creation time. An omitted provider date remains
 * unknown; a present date must be qualified by the reader before this helper.
 * A POST request time or an old order date is never a clock. */
export function labelReminderAcquisitionClock(purchaseRecordedAt:unknown, providerCreatedAtMs:unknown, nowMs:number):number|null {
  if(typeof purchaseRecordedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(purchaseRecordedAt)||
    !Number.isSafeInteger(nowMs)||nowMs<1)return null;
  const at=Date.parse(purchaseRecordedAt);
  if(!Number.isSafeInteger(at)||at<1||at>nowMs||new Date(at).toISOString()!==purchaseRecordedAt||
    providerCreatedAtMs!==null&&(!Number.isSafeInteger(providerCreatedAtMs)||(providerCreatedAtMs as number)<0||(providerCreatedAtMs as number)>at))return null;
  return at;
}
