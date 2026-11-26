/** Native return-request witness shared by authorization and held-funds release. */
import { createHash } from 'node:crypto';
import { qualifiedShippingParcelSnapshot } from './automaticShippingParcel';
import { nativeTime } from './stripeCheckoutProof';
import { exactCents, providerId, hasCurrentRateQualification } from './shippingPurchaseRate';
import { normalizeCanadianAddress } from '../shared/canadianAddress';
import type { ReturnShipmentContext, ShipEngineAddress } from '../config/shipEngine';
import { savedLifecycleLabelIdentity } from '../config/shipEngine';
import {attachOrderTransport} from '../config/shippingTransportPolicy';
import { hasActiveBankDispute } from './bankDispute';
import { hasUnsettledRefund } from './refundState';
import { deliveryCorrectionBlocksProgress } from './orderModeration';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
import { deliveryCorrectionWindowMatches, effectivePurchaseReleaseAt } from './purchasePolicy';
import {costTermsHash, qualifiedConvenienceReturnCostTerms, qualifiedConvenienceReturnCostResolution,
  convenienceReturnCostResolutionSummary} from './convenienceReturnFinancial';

const text = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const time = (v: any) => nativeTime(v) ? v instanceof Date ? v.getTime() : v.toMillis() : null;
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function returnHash(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? nativeTime(v) ? {timestampMs: time(v)} : Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
const contact = (raw: any): ShipEngineAddress | null => {
  const address = normalizeCanadianAddress(raw);
  if (!address || raw.country !== 'CA' || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 100) return null;
  for (const key of ['phone','email']) if (raw[key] != null && (typeof raw[key] !== 'string' || !raw[key].trim() || raw[key].length > (key === 'phone' ? 50 : 254))) return null;
  return {name: raw.name, addressLine1: address.street, cityLocality: address.city, stateProvince: address.province,
    postalCode: address.postalCode, countryCode: 'CA', ...(address.line2 ? {addressLine2: address.line2} : {}),
    ...(raw.phone ? {phone: raw.phone} : {}), ...(raw.email ? {email: raw.email} : {})};
};
/** Existing contracted source only: deleted/edited listings and profiles have
 * no bearing on this return. Missing legacy sources require instruction. */
export function frozenReturnContext(id: string, data: FirebaseFirestore.DocumentData): ReturnShipmentContext | null {
  const capture = data.returnRequest?.routeAmendmentCapture;
  if (capture !== undefined) {
    const c = capture?.context;
    // A frozen native capture is historical; NEW effects additionally re-read
    // its private proposal and both permanent acceptance receipts under TX.
    return capture?.protocol === 'label_route_amendment_capture_v1' && capture.transactionId === id && capture.leg === 'return' &&
      capture.requestId === data.returnRequest?.requestId && capture.buyerId === data.buyerId && capture.sellerId === data.sellerId && nativeTime(capture.recordedAt) &&
      /^[a-f0-9]{64}$/.test(capture.baseHash ?? '') && /^lr_[a-f0-9]{64}$/.test(capture.proposal?.id ?? '') && /^[a-f0-9]{64}$/.test(capture.proposal?.contentHash ?? '') &&
      Array.isArray(capture.acceptances) && capture.acceptances.length === 2 && c?.isReturn === true && providerId(c.outboundLabelId) &&
      providerId(c.carrierId) && typeof c.carrierCode === 'string' && typeof c.serviceCode === 'string' && text(c.externalShipmentId) &&
      c.shipFrom?.stateProvince === 'QC' && c.shipTo?.stateProvince === 'QC' && c.shipFrom?.countryCode === 'CA' && c.shipTo?.countryCode === 'CA' &&
      c.parcel?.weight?.unit === 'kilogram' && c.parcel?.dimensions?.unit === 'centimeter' &&
      [c.parcel.weight.value,c.parcel.dimensions.length,c.parcel.dimensions.width,c.parcel.dimensions.height].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)
      ? (()=>{try{return attachOrderTransport(data,c,'return');}catch{return null;}})() : null;
  }
  const s = data.shippingSnapshot, parcel = s?.parcel, rate = s?.rate;
  const from = contact(s?.destination), to = contact(s?.origin), r = data.returnRequest;
  if (s?.schemaVersion !== 1 || s.provider !== 'shipengine' || s.currency !== 'CAD' || s.priceAcceptedBy !== data.buyerId ||
      !nativeTime(s.validatedAt) || !nativeTime(s.acceptanceValidatedAt) || !qualifiedShippingParcelSnapshot(s) ||
      !Number.isSafeInteger(s.parcelVersion) || s.parcelVersion < 1 ||
      !providerId(s.shipmentId) || rate?.shipmentId !== s.shipmentId || rate.rateId !== data.shipEngineRateId ||
      !providerId(rate.carrierId) || typeof rate.carrierCode !== 'string' || !/^[a-z0-9_]{1,100}$/.test(rate.carrierCode) ||
      typeof rate.serviceCode !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(rate.serviceCode) ||
      !providerId(data.shipEngineLabelId) || !from || !to || !text(r?.requestId) ||
      parcel?.weight?.unit !== 'kilogram' || parcel?.dimensions?.unit !== 'centimeter' ||
      ![parcel.weight.value, parcel.dimensions.length, parcel.dimensions.width, parcel.dimensions.height]
        .every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null;
  const context={isReturn: true as const, shipFrom: from, shipTo: to, parcel, carrierId: rate.carrierId,
    carrierCode: rate.carrierCode, serviceCode: rate.serviceCode, outboundLabelId: data.shipEngineLabelId,
    externalShipmentId: `sr_${returnHash([id, r.requestId, 'quote']).slice(0,40)}`};
  try{return attachOrderTransport(data,context,'return');}catch{return null;}
}
export function returnPreparationCanAmend(data: FirebaseFirestore.DocumentData): boolean {
  const r = data.returnRequest;
  return !!r && (r.state === 'reserved' && (r.version === 1 || r.routeAmendmentCapture?.protocol === 'label_route_amendment_capture_v1' && nativeTime(r.routeAmendmentCapture.recordedAt)) || r.state === 'unknown' && (r.lastFailureReason === 'return_frozen_source_requires_instruction' || r.routeAmendmentCapture?.protocol === 'label_route_amendment_capture_v1' && nativeTime(r.routeAmendmentCapture.recordedAt))) &&
    !['preparationAuthorizedAt','labelContext','quote','authorizedAt','purchaseExternalId','observedLabel','lastObservation','labelProof'].some(k => Object.prototype.hasOwnProperty.call(r,k)) &&
    data.returnLabelId == null && data.returnTrackingNumber == null;
}
export function qualifiedReturnQuote(id: string, data: FirebaseFirestore.DocumentData): boolean {
  const r = data.returnRequest, q = r?.quote, context = frozenReturnContext(id, data);
  const convenience = r?.schemaVersion === 2 && r.reason === 'change_of_mind';
  const financing = q?.convenienceReturnFinancialTerms;
  return !!context && q?.schemaVersion === (convenience ? 2 : 1) && text(q.quoteId) && q.requestId === r.requestId && q.transactionId === id &&
    q.ownerId === data.buyerId && q.sourceHash === r.sourceHash && returnHash(q.context) === returnHash(context) &&
    q.currency === 'CAD' && nativeTime(q.issuedAt) && hasCurrentRateQualification(q.rates, context) && q.rates.rates.length === 1 &&
    q.rates.rates[0].carrierId === context.carrierId && q.rates.rates[0].carrierCode === context.carrierCode &&
    q.rates.rates[0].serviceCode === context.serviceCode && q.rateId === q.rates.rates[0].rateId &&
    q.expectedCostCents === q.rates.rates[0].shippingCents && cents(q.expectedCostCents) &&
    (!convenience || qualifiedConvenienceReturnCostTerms(financing) && financing.transactionId === id &&
      financing.buyerId === data.buyerId && financing.sellerId === data.sellerId && financing.requestId === r.requestId &&
      returnHash(financing.agreement) === returnHash(r.convenienceReturn) && financing.returnLabelCostCents === q.expectedCostCents &&
      q.convenienceReturnFinancialTermsHash === costTermsHash(financing));
}
export function returnRequestSourceHash(id: string, data: FirebaseFirestore.DocumentData,
  effectiveWindowSourceHash: unknown = data.returnRequest?.effectiveDeliveryWindowSourceHash): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? nativeTime(v) ? {timestampMs: time(v)} : Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical({id, buyerId: data.buyerId, sellerId: data.sellerId,
    articleId: data.articleId, currency: data.currency, amount: data.amount, totalAmount: data.totalAmount, sellerPayout: data.sellerPayout,
    shippingAddress: data.shippingAddress, shippingSnapshot: data.shippingSnapshot,
    deliveredAt: data.deliveredAt, fundsReleaseAt: data.fundsReleaseAt,
    ...(data.returnRequest?.commercialReturn ? {commercialReturn: data.returnRequest.commercialReturn, commercialReturnBasis: data.returnRequest.commercialReturnBasis} : {}),
    ...(data.returnRequest?.convenienceReturn ? {convenienceReturn: data.returnRequest.convenienceReturn,
      convenienceReturnBasis: data.returnRequest.convenienceReturnBasis} : {}),
    ...(effectiveWindowSourceHash === undefined ? {} : {effectiveDeliveryWindowSourceHash: effectiveWindowSourceHash})}))).digest('hex');
}
function nativeReturnDeposit(id: string, data: FirebaseFirestore.DocumentData): boolean {
  const r = data.returnRequest;
  const requested = time(r?.requestedAt), deadline = time(r?.fundsReleaseAt);
  const b = r?.commercialReturnBasis;
  const commercialClock = r?.commercialReturn && b?.protocol === 'product_commercial_return_basis_v1' && b.transactionId === id &&
    (b.parcelCapability === undefined || b.parcelCapability === 'product_review_parcel_v1' && ['delivered', 'disputed'].includes(b.commercialStatusAtInstruction)) &&
    b.buyerId === data.buyerId && b.sellerId === data.sellerId && text(b.disputeId) &&
    /^pri_[a-f0-9]{64}$/.test(r.commercialReturn.instructionId ?? '') && /^[a-f0-9]{64}$/.test(r.commercialReturn.contentHash ?? '') &&
    b.instructionId === r.commercialReturn.instructionId && b.contentHash === r.commercialReturn.contentHash && /^[a-f0-9]{64}$/.test(b.semanticSourceHash ?? '') &&
    time(b.initialReleaseAt) === deadline && time(b.reportedAt) !== null && time(b.instructedAt) !== null &&
    deadline !== null && time(b.reportedAt)! < deadline && time(b.reportedAt)! <= time(b.instructedAt)! && requested !== null && time(b.instructedAt)! <= requested;
  const c = r?.convenienceReturnBasis, reference = r?.convenienceReturn;
  const convenience = r?.schemaVersion === 2 && r.reason === 'change_of_mind';
  const convenienceClock = convenience && !r.commercialReturn && reference?.termsProtocol === 'convenience_return_terms_v2' &&
    /^cr_[a-f0-9]{64}$/.test(reference.proposalId ?? '') && /^[a-f0-9]{64}$/.test(reference.contentHash ?? '') &&
    c?.protocol === 'convenience_return_basis_v1' && c.transactionId === id && c.buyerId === data.buyerId && c.sellerId === data.sellerId &&
    c.proposalId === reference.proposalId && c.agreementContentHash === reference.contentHash &&
    /^[a-f0-9]{64}$/.test(c.agreementSourceHash ?? '') && /^[a-f0-9]{64}$/.test(c.termsHash ?? '') &&
    time(c.acceptedAt) !== null && requested !== null && time(c.acceptedAt)! <= requested && time(c.initialReleaseAt) === deadline;
  return !!r && (r.schemaVersion === 1 && r.convenienceReturn === undefined && r.convenienceReturnBasis === undefined || convenience) &&
    text(r.requestId) && r.transactionId === id && r.actorUid === data.buyerId &&
    r.buyerId === data.buyerId && r.sellerId === data.sellerId && r.buyerId !== r.sellerId && text(r.buyerId) && text(r.sellerId) &&
    Number.isSafeInteger(r.version) && r.version > 0 && r.version < Number.MAX_SAFE_INTEGER &&
    (convenience ? r.reason === 'change_of_mind' : ['not_as_described', 'damaged', 'wrong_item', 'other'].includes(r.reason)) &&
    cents(r.totalCents) && r.totalCents > 0 && cents(r.sellerPayoutCents) && r.currency === 'CAD' &&
    requested !== null && deadline !== null && (convenience ? convenienceClock : r.commercialReturn ? commercialClock : requested < deadline) && typeof r.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(r.sourceHash) &&
    ['reserved', 'preparing', 'quoted', 'requested', 'unknown', 'reconciliation_required', 'committed'].includes(r.state);
}
export function qualifiedReturnRequest(id: string, data: FirebaseFirestore.DocumentData): boolean {
  const r = data.returnRequest;
  if (r?.effectiveDeliveryWindowSourceHash !== undefined) {
    const resolution = data.deliveryCorrection?.resolution, deadline = effectivePurchaseReleaseAt(data, id);
    if (!/^[a-f0-9]{64}$/.test(r.effectiveDeliveryWindowSourceHash) || resolution?.effectiveDeliveryWindow?.sourceHash !== r.effectiveDeliveryWindowSourceHash ||
        !deliveryCorrectionWindowMatches(data, id, data.trackingObservation, resolution.effectiveDeliveryWindow) ||
        !deadline || typeof r.fundsReleaseAt?.isEqual !== 'function' || !r.fundsReleaseAt.isEqual(deadline)) return false;
  }
  return nativeReturnDeposit(id, data) && data.currency === 'CAD' && r.totalCents === exactCents(data.totalAmount) &&
    r.sellerPayoutCents === exactCents(data.sellerPayout ?? data.amount) && r.sourceHash === returnRequestSourceHash(id, data);
}
/** Unknown or legacy witnesses also block release. A timeout never closes a claim. */
export function hasUnsettledReturnRequest(data: FirebaseFirestore.DocumentData): boolean {
  return Object.prototype.hasOwnProperty.call(data, 'returnRequest') || Object.prototype.hasOwnProperty.call(data, 'returnLabelPending') ||
    Object.prototype.hasOwnProperty.call(data, 'returnRequestedAt') || data.returnLabelId != null || data.returnTrackingNumber != null ||
    data.returnReconciliationRequired === true;
}
function originalReturnReceipt(id: string, data: FirebaseFirestore.DocumentData): boolean {
  const r = data.returnRequest, p = r?.labelProof;
  const convenience = r?.schemaVersion === 2 && r.reason === 'change_of_mind', financing = data.convenienceReturnFinancialReservation;
  const resolution = convenience ? qualifiedConvenienceReturnCostResolution(id, data) : null;
  const actualCostCents = resolution ? resolution.document.actualCostCents : r?.quote?.expectedCostCents;
  return qualifiedReturnRequest(id, data) && r.state === 'committed' && nativeTime(r.committedAt) &&
    p?.schemaVersion === 2 && qualifiedReturnQuote(id, data) && p.currency === 'CAD' &&
    providerId(p.shipmentId) && providerId(p.carrierId) && p.carrierId === r.quote.context.carrierId &&
    p.carrierCode === r.quote.context.carrierCode && p.serviceCode === r.quote.context.serviceCode &&
    p.outboundLabelId === r.quote.context.outboundLabelId && cents(p.shipmentCents) && cents(p.insuranceCents) &&
    p.totalCents === p.shipmentCents + p.insuranceCents && p.totalCents === actualCostCents &&
    r.acceptance?.quoteId === r.quote.quoteId && r.acceptance?.rateId === r.quote.rateId && r.acceptance?.actorUid === data.buyerId &&
    r.acceptance?.expectedCostCents === r.quote.expectedCostCents && nativeTime(r.acceptance?.acceptedAt) &&
    (!convenience || financing?.protocol === 'convenience_return_financing_v1' && nativeTime(financing.reservedAt) &&
      qualifiedConvenienceReturnCostTerms(financing.terms) && financing.termsHash === costTermsHash(financing.terms) &&
      financing.termsHash === r.quote.convenienceReturnFinancialTermsHash &&
      r.acceptance.convenienceReturnFinancialTermsHash === financing.termsHash &&
      r.acceptance.expectedNetRefundCents === financing.terms.netRefundCents &&
      time(financing.reservedAt)! <= time(r.committedAt)! && nativeTime(r.authorizedAt) &&
      r.purchaseExternalId === `sr_${returnHash([id, r.requestId, r.quote.quoteId, 'label']).slice(0,40)}`) &&
    typeof p?.labelId === 'string' && p.labelId.length > 0 && p.labelId === data.returnLabelId &&
    typeof p.trackingNumber === 'string' && p.trackingNumber.length > 0 && p.trackingNumber === data.returnTrackingNumber &&
    typeof p.cost === 'number' && Number.isFinite(p.cost) && p.cost === p.totalCents / 100 && p.cost === data.returnLabelCost &&
    (typeof p.labelUrl === 'string' && p.labelUrl.startsWith('https://') && p.labelUrl === data.returnLabelUrl ||
      !!resolution && resolution.document.documentFurnishing === 'buyer_read_required' && p.labelUrl === null && data.returnLabelUrl === null);
}
function historicalReturnLabelData(data: FirebaseFirestore.DocumentData) {
  const p = data.returnRequest?.labelProof;
  return {...data, returnLabelId: p?.labelId, returnTrackingNumber: p?.trackingNumber, returnLabelUrl: p?.labelUrl, returnLabelCost: p?.cost};
}
/** A current replacement does not rewrite the original return receipt/cost.
 * Native lifecycle callers separately requalify its immutable chain under TX. */
export function committedReturnReceipt(id: string, data: FirebaseFirestore.DocumentData): boolean {
  if (Object.prototype.hasOwnProperty.call(data.labelLifecycleCurrent ?? {}, 'return'))
    return !!savedLifecycleLabelIdentity(id, data, 'return') && originalReturnReceipt(id, historicalReturnLabelData(data));
  return originalReturnReceipt(id, data);
}
/** The receipt is historical. A current permission requires the same held
 * return, no independent stop and no evidence the parcel was already sent. */
function returnShippingPermission(id: string, data: FirebaseFirestore.DocumentData, moderationAllowsReturn: boolean, commercialBuyerReportQualified: boolean, lifecycleCurrentQualified = false, convenienceFinancingQualified = false): boolean {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(data, key);
  const inactiveFreeze = (value: unknown) => value === undefined || cents(value) && value === 0;
  return (!Object.prototype.hasOwnProperty.call(data.labelLifecycleCurrent ?? {}, 'return') || lifecycleCurrentQualified) &&
    (data.returnRequest?.reason !== 'change_of_mind' || convenienceFinancingQualified) &&
    !returnToSenderBlocksProgress(data) && moderationAllowsReturn && committedReturnReceipt(id, data) && data.status === 'return_requested' &&
    data.deliveryType === 'shipping' && data.disputed === true && data.fundsReleasedAt == null &&
    data.returnLabelPending === null && data.returnReconciliationRequired === false &&
    !has('returnDeliveredAt') && !has('returnDeliveryProof') && !has('returnEscalatedAt') && (!has('buyerReport') || commercialBuyerReportQualified) &&
    !has('refund') && !hasUnsettledRefund(data) && !hasActiveBankDispute(data) &&
    !(has('bankDispute') && data.bankDispute == null) && data.bankDispute?.outcome !== 'lost' &&
    inactiveFreeze(data.bankDispute?.freezeCents) && inactiveFreeze(data.disputeFreezeCents) &&
    data.labelReconciliationRequired !== true && data.deliveryCorrectionBlocked !== true && !deliveryCorrectionBlocksProgress(data) &&
    (!has('returnTrackingStatus') || data.returnTrackingStatus === 'UNKNOWN') &&
    ['returnTrackingObservation','returnTrackingSnapshot'].every(key => !has(key) || data[key]?.schemaVersion === 1 &&
      data[key].transactionId === id && data[key].leg === 'return' && ['NY','UN'].includes(data[key].statusCode) &&
      (data[key].labelId === data.returnLabelId || lifecycleCurrentQualified &&
        data[key].labelId === data.labelLifecycleCurrent?.return?.activation?.previousLabelId && nativeTime(data[key].recordedAt) &&
        time(data[key].recordedAt)! <= time(data.labelLifecycleCurrent.return.recordedAt)!));
}
/** Internal current-label opt-in only, after the lifecycle chain is qualified
 * under TX. Old V1 readers continue to describe the original document. */
export function currentLifecycleReturnPermission(id: string, data: FirebaseFirestore.DocumentData, nativeLifecycleQualified: boolean,
  moderationAllowsReturn: boolean, commercialBuyerReportQualified: boolean): boolean {
  return nativeLifecycleQualified && returnShippingPermission(id, data, moderationAllowsReturn, commercialBuyerReportQualified, true);
}
export function returnRequestView(id: string, data: FirebaseFirestore.DocumentData, replay: boolean, moderationAllowsReturn = false, commercialBuyerReportQualified = false, documentFurnished = true, newDepositAllowed = true, convenienceFinancingQualified = false) {
  const recorded = nativeReturnDeposit(id, data), qualified = qualifiedReturnRequest(id, data), committed = committedReturnReceipt(id, data), r = data.returnRequest;
  const quote = qualified && qualifiedReturnQuote(id, data) && r.state === 'quoted' ? r.quote : null;
  const convenience = r?.schemaVersion === 2 && r.reason === 'change_of_mind';
  const resolution = convenience ? qualifiedConvenienceReturnCostResolution(id, data) : null;
  const shippingPermissionGranted = documentFurnished && newDepositAllowed && returnShippingPermission(id, data, moderationAllowsReturn, commercialBuyerReportQualified, false, convenienceFinancingQualified);
  const needsReview = !qualified || ['unknown', 'reconciliation_required', 'committed'].includes(r?.state);
  const labelHistory = Object.prototype.hasOwnProperty.call(data.labelLifecycleCurrent ?? {}, 'return') ? historicalReturnLabelData(data) : data;
  return {protocol: convenience ? 'return_request_v2' as const : 'return_request_v1' as const, transactionId: id, success: committed, replay,
    requestId: recorded ? r.requestId as string : null, version: recorded ? r.version as number : null,
    requestRecorded: recorded, fundsFrozen: recorded && !data.fundsReleasedAt && data.disputed === true,
    labelCommitted: committed, status: committed ? 'committed' as const : qualified && r.state !== 'committed' ? r.state as string : 'reconciliation_required',
    actionRequired: !committed && (needsReview || quote != null) || committed && !shippingPermissionGranted,
    shippingPermissionGranted,
    quote: quote ? {protocol: convenience ? 'return_quote_v2' : 'return_quote_v1', quoteId: quote.quoteId, requestId: r.requestId, version: r.version,
      rateId: quote.rateId, currency: 'CAD', costCents: quote.expectedCostCents,
      ...(quote.depositTerms ? {depositTerms: quote.depositTerms, depositTermsHash: quote.depositTermsHash} : {}),
      ...(convenience ? {convenienceReturnFinancialTerms: quote.convenienceReturnFinancialTerms,
        convenienceReturnFinancialTermsHash: quote.convenienceReturnFinancialTermsHash} : {}),
      carrierName: quote.rates.rates[0].carrierFriendlyName, serviceName: quote.rates.rates[0].serviceType,
      estimatedDeliveryDays: quote.rates.rates[0].estimatedDeliveryDays, issuedAtMs: time(quote.issuedAt),
      parcel: quote.context.parcel, measurementVerified: false, refundDecisionGranted: false} : null,
    currentOrderStatus: typeof data.status === 'string' ? data.status : 'unknown',
    returnTrackingNumber: committed ? labelHistory.returnTrackingNumber as string : null,
    returnLabelUrl: committed && documentFurnished ? labelHistory.returnLabelUrl as string : null,
    returnLabelCost: committed && typeof labelHistory.returnLabelCost === 'number' ? labelHistory.returnLabelCost : null,
    ...(resolution ? {costResolution: convenienceReturnCostResolutionSummary(resolution)} : {}),
    reason: typeof data.returnReconciliationReason === 'string' ? data.returnReconciliationReason : null};
}
