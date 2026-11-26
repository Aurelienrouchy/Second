import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { runtimeEnvironment } from '@/config/firebaseEnvironment';
import { captureTradeSession, assertTradeSessionCurrent, isDefinitiveTradeRefusal } from '@/services/tradeOperation';
import { getCallableErrorCode } from '@/utils/callableError';
import { hasBankObligation, hasUnsettledRefund } from '@/utils/refundPresentation';
import {hasCurrentOrdinaryShippingDeclaration, isOrdinaryShippingAddressUse, ordinaryPhysicalAddress} from '@/utils/ordinaryShippingAddress';
import type { Transaction, PendingCancellationResult } from '@/types/transaction';
import type { ShippingPurchaseAddress, ShippingPurchaseQuote, ShippingPurchaseRate, ShippingReservationAttempt,
  ShippingReservationInput, ShippingReservationReceipt, ShippingPurchasePolicy, ShippingPurchasePolicyTimeline,
  ShippingPurchasePolicyObservation, ShippingPurchasePreparationTerms, ShippingPurchasePreparationObservation,
  ShippingTransportLegTerms, ShippingTransportTerms, ShippingTransportTermsObservation } from '@/types/shippingPurchase';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 200 && !value.includes('/');
const cents = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
  Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001 ? Math.round(value * 100) : null;
const journalKey = (uid: string, articleId: string) => `shipping-reservation:v1:${encodeURIComponent(uid)}:${encodeURIComponent(articleId)}`;
const queues = new Map<string, Promise<unknown>>();
const stable = (value: unknown) => JSON.stringify(value, (_key, nested: unknown) => record(nested) ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right))) : nested);
const same = (left: unknown, right: unknown) => stable(left) === stable(right);
const policyFields = ['purchasePolicyAccepted', 'expectedPurchasePolicyVersion', 'expectedPurchasePolicyHash', 'purchasePolicy'];
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const knownPolicyVersion = (value: unknown) => value === 'shipping_purchase_2026_01' || value === 'shipping_purchase_2026_02';
const transportText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const transportCents = (value: unknown, positive = false): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= (positive ? 1 : 0);
function transportUrl(value: unknown): value is string {
  if (!transportText(value, 2000)) return false;
  try {const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash;} catch {return false;}
}
function transportInstruction(value: unknown): boolean {
  return record(value) && exact(value, ['instructions', 'officialUrl']) && transportText(value.instructions, 3000) && transportUrl(value.officialUrl);
}
function transportLeg(value: unknown): value is ShippingTransportLegTerms {
  if (!record(value) || !exact(value, ['confirmation', 'handoff']) ||
    !['none', 'delivery', 'signature', 'adult_signature', 'direct_signature', 'delivery_mailed', 'verbal_confirmation'].includes(String(value.confirmation)) || !record(value.handoff)) return false;
  const h = value.handoff;
  return exact(h, ['mode', 'instructions', 'officialUrl', 'alternative', 'siteAvailabilityVerified', 'bookingVerified']) &&
    ['ordinary_dropoff', 'member_arranged_collection'].includes(String(h.mode)) && transportText(h.instructions, 3000) && transportUrl(h.officialUrl) &&
    (h.alternative === null || transportInstruction(h.alternative)) && h.siteAvailabilityVerified === false && h.bookingVerified === false;
}
function transportTerms(value: unknown): value is ShippingTransportTerms {
  if (!record(value)) return false;
  const sandbox = value.testMode === 'seconde_dev_commerce_v1' && runtimeEnvironment.name === 'development' &&
    runtimeEnvironment.projectId === 'seconde-dev' && !runtimeEnvironment.useEmulators;
  if (!exact(value, ['protocol', 'termsHash', 'policyVersion', 'coverage', 'forward', 'return', 'accountIdentityApiVerified', ...(sandbox ? ['testMode'] : [])]) ||
    value.protocol !== 'shipping_transport_terms_v1' || !hash(value.termsHash) || !transportText(value.policyVersion, 100) ||
    value.accountIdentityApiVerified !== false || !record(value.coverage) || !transportLeg(value.forward) || !transportLeg(value.return)) return false;
  const c = value.coverage;
  return exact(c, ['currency', 'declaredValueCents', 'coveredValueCents', 'maxCents', 'deductibleCents', 'beneficiary', 'exclusions', 'insuranceProvider', 'effectiveCoverageBasis', 'providerCoverageApiVerified']) &&
    c.currency === 'CAD' && transportCents(c.declaredValueCents, true) && c.coveredValueCents === (sandbox ? 0 : c.declaredValueCents) && transportCents(c.maxCents, true) &&
    c.maxCents >= c.declaredValueCents && transportCents(c.deductibleCents) && c.deductibleCents <= c.maxCents &&
    ['seconde_operator', 'seller', 'buyer'].includes(String(c.beneficiary)) && transportText(c.exclusions, 3000) &&
    (sandbox ? c.insuranceProvider === 'none' && c.effectiveCoverageBasis === 'sandbox_simulation'
      : ['carrier', 'third_party'].includes(String(c.insuranceProvider)) && c.effectiveCoverageBasis === (c.insuranceProvider === 'carrier' ? 'carrier_contract' : 'external_automatic_policy')) &&
    c.providerCoverageApiVerified === false;
}
/** Public canonical hash is independent of private documentary admission; the server binds both. */
export async function qualifiedShippingTransportTerms(value: unknown, assertContext: () => void): Promise<ShippingTransportTerms> {
  assertContext();
  if (!transportTerms(value)) throw new Error('Les conditions figées de ce transport doivent être relues.');
  const {termsHash, ...body} = value;
  const serialized = JSON.stringify(body, (_key, nested: unknown) => record(nested)
    ? Object.fromEntries(Object.keys(nested).sort().map(key => [key, nested[key]])) : nested);
  const expected = await digestStringAsync(CryptoDigestAlgorithm.SHA256, serialized); assertContext();
  if (termsHash !== expected) throw new Error('Les conditions affichées ne correspondent pas à leur empreinte enregistrée.');
  return value;
}
function preparationTerms(value: unknown): value is ShippingPurchasePreparationTerms {
  return record(value) && exact(value, ['pendingPayment', 'labelAbandonment']) && record(value.pendingPayment) &&
    exact(value.pendingPayment, ['durationMs', 'startEvent']) && value.pendingPayment.durationMs === 3600000 &&
    value.pendingPayment.startEvent === 'native_shipping_acceptance_validated_at' && record(value.labelAbandonment) &&
    exact(value.labelAbandonment, ['definitiveRejections', 'countBasis']) && value.labelAbandonment.definitiveRejections === 4 &&
    value.labelAbandonment.countBasis === 'attributed_native_provider_rejections';
}
function policyShape(value: unknown): value is ShippingPurchasePolicy {
  if (record(value) && value.policyVersion === 'shipping_purchase_2026_02') return exact(value, ['schemaVersion', 'policyVersion', 'quoteId', 'articleId', 'buyerId', 'sellerId', 'sourceHash', 'parameters', 'preparationTerms', 'hash']) &&
    value.schemaVersion === 1 && [value.quoteId, value.articleId, value.buyerId, value.sellerId].every(id) && value.buyerId !== value.sellerId &&
    hash(value.sourceHash) && hash(value.hash) && record(value.parameters) && exact(value.parameters, ['fundsHoldMs', 'deliveryProtectionMs', 'nonShipmentMs']) &&
    value.parameters.fundsHoldMs === 604800000 && value.parameters.deliveryProtectionMs === 604800000 && value.parameters.nonShipmentMs === 604800000 && preparationTerms(value.preparationTerms);
  return record(value) && value.schemaVersion === 1 && value.policyVersion === 'shipping_purchase_2026_01' &&
    [value.quoteId, value.articleId, value.buyerId, value.sellerId].every(id) && value.buyerId !== value.sellerId &&
    hash(value.sourceHash) && hash(value.hash) && record(value.parameters) && value.parameters.fundsHoldMs === 604800000 &&
    value.parameters.deliveryProtectionMs === 604800000 && value.parameters.nonShipmentMs === 604800000;
}
async function qualifiedPolicy(value: unknown, uid: string, articleId: string, quoteId: string, assertContext: () => void): Promise<ShippingPurchasePolicy> {
  if (!policyShape(value) || value.buyerId !== uid || value.articleId !== articleId || value.quoteId !== quoteId) throw new Error('La politique de ce devis et son acceptation doivent être vérifiées.');
  if (value.policyVersion === 'shipping_purchase_2026_02') {
    // V2 appends its terms after the unchanged three parameters. V1's body below is untouched.
    const body = {schemaVersion: 1 as const, policyVersion: value.policyVersion, quoteId: value.quoteId, articleId: value.articleId,
      buyerId: value.buyerId, sellerId: value.sellerId, sourceHash: value.sourceHash, parameters: {
        fundsHoldMs: value.parameters.fundsHoldMs, deliveryProtectionMs: value.parameters.deliveryProtectionMs, nonShipmentMs: value.parameters.nonShipmentMs},
      preparationTerms: {pendingPayment: {durationMs: value.preparationTerms.pendingPayment.durationMs, startEvent: value.preparationTerms.pendingPayment.startEvent},
        labelAbandonment: {definitiveRejections: value.preparationTerms.labelAbandonment.definitiveRejections, countBasis: value.preparationTerms.labelAbandonment.countBasis}}};
    const expected = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(body)); assertContext();
    if (expected !== value.hash) throw new Error('L’empreinte de la politique doit être rapprochée avant toute nouvelle réservation.');
    return {...body, hash: expected};
  }
  // Native buildPurchasePolicy order, including the nested parameter order.
  const body = {schemaVersion: 1 as const, policyVersion: value.policyVersion, quoteId: value.quoteId, articleId: value.articleId,
    buyerId: value.buyerId, sellerId: value.sellerId, sourceHash: value.sourceHash, parameters: {
      fundsHoldMs: value.parameters.fundsHoldMs, deliveryProtectionMs: value.parameters.deliveryProtectionMs, nonShipmentMs: value.parameters.nonShipmentMs}};
  const expected = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(body)); assertContext();
  if (expected !== value.hash) throw new Error('L’empreinte de la politique doit être rapprochée avant toute nouvelle réservation.');
  return {...body, hash: expected};
}
function policyInput(value: Record<string, unknown>, uid: string, articleId: string): boolean {
  if (!policyFields.some(field => Object.prototype.hasOwnProperty.call(value, field))) return true;
  return value.purchasePolicyAccepted === true && policyShape(value.purchasePolicy) && value.expectedPurchasePolicyHash === value.purchasePolicy.hash &&
    value.expectedPurchasePolicyVersion === value.purchasePolicy.policyVersion && value.purchasePolicy.buyerId === uid &&
    value.purchasePolicy.articleId === articleId && value.purchasePolicy.quoteId === value.quoteId;
}
const millis = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 &&
  Number.isFinite(new Date(value).getTime());
function policyTimeline(value: unknown): value is ShippingPurchasePolicyTimeline {
  if (!record(value) || value.schemaVersion !== 1 || !['accepted_snapshot', 'historical_deadline_unknown_acceptance', 'review_required'].includes(String(value.qualification)) ||
    value.externalRightsPreserved !== true || typeof value.reviewRequired !== 'boolean' ||
    !(value.reviewReason === null || typeof value.reviewReason === 'string' && value.reviewReason.trim().length > 0) ||
    !['acceptedAtMs', 'nonShipmentStartsAtMs', 'nonShipmentExpiresAtMs', 'deliveryEventAtMs', 'deliveryRecordedAtMs', 'fundsReleaseAtMs', 'deliveryProtectionEndsAtMs']
      .every(field => value[field] === null || millis(value[field]))) return false;
  const policyKnown = value.policyVersion !== null || value.policyHash !== null || value.parameters !== null || value.acceptedAtMs !== null;
  if (policyKnown ? !knownPolicyVersion(value.policyVersion) || !hash(value.policyHash) || !record(value.parameters) ||
    value.parameters.fundsHoldMs !== 604800000 || value.parameters.deliveryProtectionMs !== 604800000 || value.parameters.nonShipmentMs !== 604800000 ||
    !millis(value.acceptedAtMs) : value.policyVersion !== null || value.policyHash !== null || value.parameters !== null || value.acceptedAtMs !== null) return false;
  if (value.qualification === 'accepted_snapshot' && (!policyKnown || value.reviewRequired) ||
    value.qualification === 'historical_deadline_unknown_acceptance' && (policyKnown || value.reviewRequired || !millis(value.fundsReleaseAtMs)) ||
    value.qualification === 'review_required' && !value.reviewRequired) return false;
  const paidKnown = value.nonShipmentStartsAtMs !== null || value.nonShipmentExpiresAtMs !== null || value.paymentClockBasis !== null;
  if (paidKnown && (!policyKnown || value.paymentClockBasis !== 'qualified_payment_recorded_at' || !millis(value.nonShipmentStartsAtMs) ||
    !millis(value.nonShipmentExpiresAtMs) || value.nonShipmentExpiresAtMs - value.nonShipmentStartsAtMs !== 604800000 ||
    value.nonShipmentStartsAtMs < Number(value.acceptedAtMs)) || !paidKnown && value.paymentClockBasis !== null) return false;
  const deliveryKnown = value.deliveryEventAtMs !== null || value.deliveryRecordedAtMs !== null || value.deliveryProtectionEndsAtMs !== null;
  if (deliveryKnown && (!policyKnown || !millis(value.deliveryEventAtMs) || !millis(value.deliveryRecordedAtMs) ||
    !millis(value.fundsReleaseAtMs) || !millis(value.deliveryProtectionEndsAtMs) || value.deliveryRecordedAtMs < value.deliveryEventAtMs ||
    value.fundsReleaseAtMs - value.deliveryEventAtMs !== 604800000 || value.deliveryProtectionEndsAtMs - value.deliveryEventAtMs !== 604800000 ||
    value.deliveryRecordedAtMs >= value.fundsReleaseAtMs && !value.reviewRequired)) return false;
  return true;
}

function preparationObservation(value: unknown, uid: string, transactionId: string): value is ShippingPurchasePreparationObservation {
  if (!record(value) || !exact(value, ['protocol', 'transactionId', 'ownerId', 'qualification', 'policyVersion', 'policyHash', 'terms', 'pendingPayment', 'labelAbandonment', 'automatedEffectAuthorized', 'providerObserved', 'financialResolutionVerified']) ||
    value.protocol !== 'purchase_preparation_policy_observation_v1' || value.transactionId !== transactionId || value.ownerId !== uid ||
    !['accepted_v2_source', 'historical_terms_not_recorded', 'unknown'].includes(String(value.qualification)) ||
    value.automatedEffectAuthorized !== false || value.providerObserved !== false || value.financialResolutionVerified !== false) return false;
  if (value.policyVersion === 'shipping_purchase_2026_02') {if (!hash(value.policyHash) || !preparationTerms(value.terms)) return false;}
  else if (value.policyVersion === 'shipping_purchase_2026_01') {if (!hash(value.policyHash) || value.terms !== null || value.qualification !== 'historical_terms_not_recorded') return false;}
  else if (value.policyVersion !== null || value.policyHash !== null || value.terms !== null) return false;
  if (value.qualification !== 'accepted_v2_source') return value.pendingPayment === null && value.labelAbandonment === null &&
    (value.qualification === 'historical_terms_not_recorded' ? value.policyVersion === 'shipping_purchase_2026_01' : value.policyVersion !== 'shipping_purchase_2026_01');
  const window = value.pendingPayment, rejections = value.labelAbandonment;
  return value.policyVersion === 'shipping_purchase_2026_02' && record(window) && exact(window, ['clockBasis', 'startsAtMs', 'expiresAtMs', 'windowHash', 'sourceHash', 'state']) &&
    window.clockBasis === 'native_shipping_acceptance_validated_at' && millis(window.startsAtMs) && window.startsAtMs > 0 && millis(window.expiresAtMs) &&
    window.expiresAtMs - window.startsAtMs === 3600000 && hash(window.windowHash) && hash(window.sourceHash) && ['open', 'elapsed'].includes(String(window.state)) &&
    record(rejections) && exact(rejections, ['requiredDefinitiveRejections', 'countBasis', 'recordedDefinitiveRejections', 'latestAttemptId', 'rejectionSourceHash', 'rejectionsQualification']) &&
    rejections.requiredDefinitiveRejections === 4 && rejections.countBasis === 'attributed_native_provider_rejections' &&
    (rejections.rejectionsQualification === 'native_attributed_rejections' ? Number.isSafeInteger(rejections.recordedDefinitiveRejections) && Number(rejections.recordedDefinitiveRejections) >= 1 &&
      id(rejections.latestAttemptId) && hash(rejections.rejectionSourceHash) : rejections.rejectionsQualification === 'not_qualified' && rejections.recordedDefinitiveRejections === null && rejections.latestAttemptId === null && rejections.rejectionSourceHash === null);
}

function address(value: unknown): value is ShippingPurchaseAddress {
  if (!record(value) || value.province !== 'QC' || value.country !== 'CA') return false;
  return ['name', 'street', 'city', 'postalCode'].every(field => typeof value[field] === 'string' && !!String(value[field]).trim()) &&
    /^[GHJ]\d[ABCEGHJKLMNPRSTVWXYZ] ?\d[ABCEGHJKLMNPRSTVWXYZ]\d$/.test(String(value.postalCode)) &&
    (value.line2 === undefined || typeof value.line2 === 'string');
}
function rate(value: unknown): value is ShippingPurchaseRate {
  if (!record(value) || value.currency !== 'CAD' || !record(value.componentsCents) ||
      !['rateId', 'shipmentId', 'carrierId'].every(field => id(value[field])) ||
      !['carrierCode', 'carrierFriendlyName', 'serviceCode', 'serviceType'].every(field => typeof value[field] === 'string' && !!String(value[field]).trim()) ||
      String(value.rateId).startsWith('fallback_')) return false;
  const components = value.componentsCents;
  const parts = ['shipping', 'insurance', 'confirmation', 'other'].map(field => components[field]);
  if (!parts.every(part => Number.isSafeInteger(part) && Number(part) >= 0) ||
      !Number.isSafeInteger(value.shippingCents) || parts.reduce<number>((total, part) => total + Number(part), 0) !== value.shippingCents ||
      cents(value.shippingCost) !== value.shippingCents ||
      !(value.estimatedDeliveryDays === null || (Number.isSafeInteger(value.estimatedDeliveryDays) && Number(value.estimatedDeliveryDays) >= 0))) return false;
  const amounts = [value.amount, value.serviceFee, value.taxTotal, value.shippingCost].map(cents);
  return amounts.every(amount => amount !== null) && cents(value.amount)! > 0 &&
    amounts.reduce<number>((total, amount) => total + amount!, 0) === cents(value.totalAmount);
}
/** Use only the captured rates/flag, never current client tax settings. */
function taxSnapshot(value: unknown, rates: ShippingPurchaseRate[]): boolean {
  if (!record(value) || !exact(value, ['schemaVersion', 'protocol', 'currency', 'taxableServiceFee', 'gst', 'qst', 'taxTotal', 'technicalConfiguration', 'registrationStatusVerified']) ||
    value.schemaVersion !== 1 || value.protocol !== 'service_fee_tax_v1' || value.currency !== 'CAD' || value.registrationStatusVerified !== false ||
    !record(value.technicalConfiguration) || !exact(value.technicalConfiguration, ['enabled', 'gstRate', 'qstRate']) || typeof value.technicalConfiguration.enabled !== 'boolean') return false;
  const money = (raw: unknown) => {
    const result = cents(raw);
    return result !== null && typeof raw === 'number' && Math.abs(raw * 100 - result) < 1e-7 ? result : null;
  };
  const fee = money(value.taxableServiceFee), gst = money(value.gst), qst = money(value.qst), total = money(value.taxTotal);
  if (fee === null || gst === null || qst === null || total === null || !Number.isSafeInteger(gst + qst) || gst + qst !== total) return false;
  const c = value.technicalConfiguration;
  const expectedTax = (rawRate: unknown): number | null => {
    if (typeof rawRate !== 'number' || !Number.isFinite(rawRate) || rawRate < 0 || rawRate > 1 || !/^(?:0|1)(?:\.\d{1,6})?$/.test(String(rawRate))) return null;
    if (!c.enabled) return 0;
    const [whole, decimal = ''] = String(rawRate).split('.'), denominator = 10 ** decimal.length, numerator = fee * Number(whole + decimal);
    if (!Number.isSafeInteger(numerator)) return null;
    return Math.floor(numerator / denominator) + (numerator % denominator >= Math.ceil(denominator / 2) ? 1 : 0);
  };
  return expectedTax(c.gstRate) === gst && expectedTax(c.qstRate) === qst &&
    rates.every(item => money(item.serviceFee) === fee && money(item.taxTotal) === total);
}
function quote(value: unknown, articleId: string, destination: ShippingPurchaseAddress,
  agreement?: {chatId: string; offerMessageId: string}): value is ShippingPurchaseQuote {
  const physical = ordinaryPhysicalAddress(destination);
  const canonicalDestination = physical ? {...physical, name: destination.name.trim()} : null;
  if (!record(value) || !id(value.quoteId) || value.articleId !== articleId || value.schemaVersion !== 1 ||
      value.currency !== 'CAD' || value.payable !== true || value.negotiationSupported !== !!agreement || value.pricingVersion !== 'shipping_purchase_pricing_v2' ||
      value.measurementVerified !== false || value.expirationKnown !== false || value.providerFreshnessVerified !== false ||
      value.labelPurchaseGuaranteed !== false || value.requiresCurrentValidation !== true ||
      value.acceptancePolicyVersion !== 1 || value.validityScope !== 'new_reservation' || value.localValidityMs !== 900000 ||
      !record(value.originZone) || value.originZone.country !== 'CA' || value.originZone.province !== 'QC' ||
      !address(value.destination) || !same(value.destination, canonicalDestination) || !record(value.item) ||
      !isOrdinaryShippingAddressUse(value.addressUse) || value.addressUse.destination.kind !== destination.shippingUseDeclaration?.kind ||
      !record(value.parcel) || !record(value.parcel.weight) || !record(value.parcel.dimensions) ||
      value.parcel.weight.unit !== 'kilogram' || value.parcel.dimensions.unit !== 'centimeter') return false;
  if (![value.issuedAt, value.validUntil, value.serverTime].every(time => typeof time === 'number' && Number.isSafeInteger(time) &&
      time > 0 && Number.isFinite(new Date(time).getTime())) ||
      Number(value.validUntil) - Number(value.issuedAt) !== value.localValidityMs || Number(value.serverTime) < Number(value.issuedAt)) return false;
  if (![value.parcel.weight.value, value.parcel.dimensions.length, value.parcel.dimensions.width, value.parcel.dimensions.height]
    .every(number => typeof number === 'number' && Number.isFinite(number) && number > 0)) return false;
  if (agreement ? !record(value.offer) || value.offer.messageId !== agreement.offerMessageId || value.offer.chatId !== agreement.chatId ||
    cents(value.offer.amount) === null || cents(value.offer.amount)! <= 0 : Object.prototype.hasOwnProperty.call(value, 'offer')) return false;
  const transport = value.transport;
  return Array.isArray(value.rates) && value.rates.length > 0 && value.rates.every(rate) &&
    (!agreement || value.rates.every(item => cents(item.amount) === cents((value.offer as Record<string, unknown>).amount))) &&
    new Set(value.rates.map(item => item.rateId)).size === value.rates.length && taxSnapshot(value.taxSnapshot, value.rates) &&
    (!Object.prototype.hasOwnProperty.call(value, 'transport') || transportTerms(transport) &&
      value.rates.every(item => cents(item.amount) === transport.coverage.declaredValueCents));
}
function receipt(value: unknown): value is ShippingReservationReceipt {
  return record(value) && value.success === true && id(value.transactionId) && typeof value.replay === 'boolean' &&
    value.paymentPermissionGranted === false && (value.existingOrderOnly === undefined || value.existingOrderOnly === true) &&
    (!Object.prototype.hasOwnProperty.call(value, 'transportTermsHash') || hash(value.transportTermsHash));
}
function attempt(value: unknown, uid: string, articleId: string): value is ShippingReservationAttempt {
  return record(value) && value.version === 1 && value.uid === uid && value.articleId === articleId && address(value.destination) &&
    record(value.input) && value.input.deliveryType === 'shipping' && id(value.input.quoteId) && id(value.input.rateId) &&
    cents(value.input.expectedTotal) !== null && cents(value.input.expectedTotal)! > 0 && policyInput(value.input, uid, articleId) &&
    (!Object.prototype.hasOwnProperty.call(value.input, 'expectedTransportTermsHash') || hash(value.input.expectedTransportTermsHash)) &&
    (value.receipt === undefined || receipt(value.receipt) &&
      (!Object.prototype.hasOwnProperty.call(value.input, 'expectedTransportTermsHash') || value.receipt.transportTermsHash === value.input.expectedTransportTermsHash));
}
function definitive(error: unknown): boolean {
  const details = record(error) && record(error.details) ? error.details : null;
  return isDefinitiveTradeRefusal(error) || (getCallableErrorCode(error) === 'aborted' &&
    ['shipping_quote_stale', 'shipping_quote_expired'].includes(String(details?.reason)));
}
export function isShippingQuoteExpiredError(error: unknown): boolean {
  return getCallableErrorCode(error) === 'aborted' && record(error) && record(error.details) && error.details.reason === 'shipping_quote_expired';
}
export function shippingLaunchErrorMessage(error: unknown): string | null {
  if (!record(error) || !record(error.details)) return null;
  if (typeof error.details.reason === 'string' && error.details.reason.startsWith('shipping_transport_')) return 'Les conditions de couverture et de dépôt de ce transport ne peuvent pas être confirmées. Demandez un nouveau devis après leur qualification ou contactez notre équipe. Les commandes et étiquettes déjà engagées restent consultables ; aucune annulation ni aucun remboursement ne sont déduits de ce refus.';
  if (error.details.reason === 'shipping_coverage_qualification_required') return 'La couverture du transport reste à qualifier. Aucune nouvelle livraison payante ne peut être réservée pour le moment. Les commandes et paiements déjà engagés restent consultables dans leur dossier.';
  if (error.details.reason === 'ordinary_shipping_address_declaration_required') return 'Confirmez le type ordinaire de l’adresse exacte. Pour une nouvelle livraison, le vendeur doit aussi avoir enregistré sa propre déclaration.';
  return null;
}

export class ShippingPurchaseService {
  static async readTransportTerms(uid: string, transactionId: string, assertContext: () => void): Promise<ShippingTransportTermsObservation> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); assertContext();}; current();
    if (!id(transactionId)) throw new Error('Référence de commande invalide.');
    const response = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({transactionId, expectedUid: uid,
      mode: 'policy_observe', capability: 'shipping_transport_terms_v1'}); current();
    const value = response.data;
    if (!record(value) || !exact(value, ['protocol', 'transactionId', 'ownerId', 'qualification', 'terms', 'purchasePolicyHash']) ||
      value.protocol !== 'shipping_transport_terms_observation_v1' || value.transactionId !== transactionId || value.ownerId !== uid ||
      !['accepted_snapshot', 'historical_terms_not_recorded', 'unknown'].includes(String(value.qualification)) ||
      !(value.purchasePolicyHash === null || hash(value.purchasePolicyHash))) throw new Error('Les conditions historiques de ce transport doivent être relues.');
    if (value.qualification === 'accepted_snapshot') {
      if (!hash(value.purchasePolicyHash)) throw new Error('Le lien avec l’acceptation de cette vente doit être qualifié.');
      const terms = await qualifiedShippingTransportTerms(value.terms, current); current();
      return {protocol: value.protocol, transactionId, ownerId: uid, qualification: value.qualification, terms, purchasePolicyHash: value.purchasePolicyHash};
    }
    if (value.terms !== null) throw new Error('Une condition non qualifiée ne peut pas être adoptée depuis la politique actuelle.');
    return {protocol: value.protocol, transactionId, ownerId: uid,
      qualification: value.qualification === 'historical_terms_not_recorded' ? 'historical_terms_not_recorded' : 'unknown', terms: null, purchasePolicyHash: value.purchasePolicyHash};
  }
  static async readPolicyTimeline(uid: string, transactionId: string, assertContext: () => void): Promise<ShippingPurchasePolicyObservation> {
    const session = captureTradeSession(uid); assertContext();
    if (!id(transactionId)) throw new Error('Référence de commande invalide.');
    const response = await httpsCallable<{transactionId: string; expectedUid: string; mode: 'policy_observe'}, unknown>(functions, 'checkTrackingStatus')(
      {transactionId, expectedUid: session.uid, mode: 'policy_observe'});
    assertTradeSessionCurrent(session); assertContext();
    if (!record(response.data) || response.data.transactionId !== transactionId || response.data.ownerId !== session.uid ||
      !policyTimeline(response.data.purchasePolicy)) throw new Error('La politique et les échéances de cette commande doivent être relues.');
    return response.data as unknown as ShippingPurchasePolicyObservation;
  }
  static async readPreparationPolicy(uid: string, transactionId: string, assertContext: () => void): Promise<ShippingPurchasePreparationObservation> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); assertContext();}; current();
    if (!id(transactionId)) throw new Error('Référence de commande invalide.');
    const result = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({transactionId, expectedUid: uid, mode: 'policy_observe', capability: 'purchase_preparation_policy_v1'});
    current();
    if (!preparationObservation(result.data, uid, transactionId)) throw new Error('Les termes et l’échéance de préparation doivent être relus.');
    return result.data;
  }
  static requiresPreparationPolicy(order: unknown): boolean {
    return record(order) && record(order.purchasePolicy) && order.purchasePolicy.policyVersion === 'shipping_purchase_2026_02';
  }
  /** A fresh native clock gates new V2 authorization only; callers service existing money first. */
  static async assertNewPreparationPolicy(uid: string, order: Transaction, assertContext: () => void): Promise<void> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); assertContext();}; current();
    const source: unknown = order;
    if (!this.requiresPreparationPolicy(source)) return;
    if (!record(source) || !record(source.purchasePolicy) || !id(order.shippingQuoteId) || order.buyerId !== uid) throw new Error('La politique de cette commande doit être rapprochée.');
    const policy = await qualifiedPolicy(source.purchasePolicy, uid, order.articleId, order.shippingQuoteId, current); current();
    const fresh = await this.readPreparationPolicy(uid, order.id, current); current();
    if (fresh.qualification !== 'accepted_v2_source' || fresh.policyHash !== policy.hash || fresh.policyVersion !== policy.policyVersion || fresh.pendingPayment?.state !== 'open')
      throw new Error('Le délai de préparation enregistré est dépassé ou reste inconnu. Consultez la commande ; les reçus et paiements déjà engagés restent à vérifier séparément.');
  }
  static hasCommittedCancellation(order: Transaction | null, saved: ShippingReservationAttempt): boolean {
    return !!saved.receipt && this.hasConfirmedCancellation(order, saved.uid, saved.articleId, saved.receipt.transactionId);
  }

  /** The native cancellation proof is also usable when starting a different
   * offer. This read never acknowledges or clears the earlier local journal. */
  static hasConfirmedCancellation(order: Transaction | null, uid: string, articleId: string, transactionId: string): boolean {
    const proof = order?.pendingCancellation;
    if (!order || order.id !== transactionId || order.articleId !== articleId ||
        order.buyerId !== uid || order.deliveryType !== 'shipping' || order.status !== 'cancelled' ||
        hasBankObligation(order) || hasUnsettledRefund(order) || !proof || proof.schemaVersion !== 1 ||
        proof.state !== 'committed' || proof.transactionId !== order.id || proof.buyerId !== order.buyerId ||
        proof.sellerId !== order.sellerId || !id(proof.sellerId) || proof.cardCapabilityNeutralized !== true ||
        !(proof.committedAt instanceof Date) || !Number.isFinite(proof.committedAt.getTime()) ||
        !Number.isSafeInteger(proof.walletRefundCents) || Number(proof.walletRefundCents) < 0) return false;
    if (proof.source === 'participant_cancel_pending') {
      if (proof.requestedBy !== order.buyerId && proof.requestedBy !== order.sellerId) return false;
    } else if (proof.source !== 'expiry_pending_1h' || proof.requestedBy !== null) return false;
    return proof.walletRefundCents === 0 ? proof.purchaseDebitLedgerId === null && proof.walletRefundLedgerId === null
      : id(proof.purchaseDebitLedgerId) && proof.walletRefundLedgerId === `pending_cancel_${order.id}`;
  }

  /** Explicit new-purchase action only. Unknown and unqualified orders retain their exact active tuple. */
  static async startNewAfterCancellation(uid: string, articleId: string, transactionId: string,
    assertContext: () => void, readCurrentOrder: () => Promise<Transaction | null>): Promise<void> {
    const session = captureTradeSession(uid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    const key = journalKey(uid, articleId);
    const operation = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      assertCurrent();
      const saved = await this.readAttempt(uid, articleId, assertCurrent);
      if (!saved || saved.receipt?.transactionId !== transactionId) throw new Error('La réservation précédente ne correspond plus à ce dossier.');
      let order = await readCurrentOrder(); assertCurrent();
      if (!this.hasCommittedCancellation(order, saved)) throw new Error('L’annulation doit être rapprochée avant un nouvel achat. Consultez la commande ou contactez notre équipe.');
      // In cancelled state this callable recovers the server receipt and checks
      // both ledger movements; it does not initiate another cancellation.
      const response = await httpsCallable<{ transactionId: string; expectedUid: string }, PendingCancellationResult>(functions, 'cancelPendingTransaction')({ transactionId, expectedUid: session.uid });
      assertCurrent();
      if (response.data?.success !== true || response.data.replay !== true || response.data.currentStatus !== 'cancelled' ||
          response.data.cancellationCommitted !== true || response.data.walletRefundCommitted !== true ||
          response.data.refundedCents !== order!.pendingCancellation!.walletRefundCents) throw new Error('Le reçu de l’annulation n’a pas pu être confirmé. La tentative reste conservée.');
      order = await readCurrentOrder(); assertCurrent();
      if (!this.hasCommittedCancellation(order, saved) || order!.pendingCancellation!.walletRefundCents !== response.data.refundedCents) {
        throw new Error('La commande a changé. Aucun nouveau devis n’a été demandé.');
      }
      const p = order!.pendingCancellation!;
      const closed = JSON.stringify({ version: 1, uid, articleId, attempt: saved, cancellation: {
        schemaVersion: p.schemaVersion, state: p.state, transactionId: p.transactionId, buyerId: p.buyerId, sellerId: p.sellerId,
        source: p.source, requestedBy: p.requestedBy, walletRefundCents: p.walletRefundCents,
        purchaseDebitLedgerId: p.purchaseDebitLedgerId, walletRefundLedgerId: p.walletRefundLedgerId,
        cardCapabilityNeutralized: p.cardCapabilityNeutralized, committedAt: p.committedAt,
      } });
      const completedKey = `shipping-reservation:closed:v1:${encodeURIComponent(uid)}:${encodeURIComponent(articleId)}:${encodeURIComponent(transactionId)}:${saved.receipt.replay ? 'replay' : 'initial'}`;
      const previous = await AsyncStorage.getItem(completedKey); assertCurrent();
      if (previous !== null && previous !== closed) throw new Error('Le reçu conservé doit être examiné avant une nouvelle réservation.');
      await AsyncStorage.setItem(completedKey, closed); assertCurrent();
      const latest = await this.readAttempt(uid, articleId, assertCurrent);
      order = await readCurrentOrder(); assertCurrent();
      if (!same(latest, saved) || !this.hasCommittedCancellation(order, saved)) throw new Error('Le dossier a changé ; la tentative précédente est conservée.');
      await AsyncStorage.removeItem(key); assertCurrent();
    });
    queues.set(key, operation);
    try { await operation; } finally { if (queues.get(key) === operation) queues.delete(key); }
  }
  static async quote(uid: string, articleId: string, destination: ShippingPurchaseAddress, assertContext: () => void,
    agreement?: {chatId: string; offerMessageId: string}): Promise<ShippingPurchaseQuote> {
    const session = captureTradeSession(uid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent();
    if (!id(articleId) || !address(destination)) throw new Error('Indiquez une destination complète et cohérente au Québec.');
    if (agreement && (!id(agreement.chatId) || !id(agreement.offerMessageId))) throw new Error('L’identité de cette offre doit être vérifiée.');
    if (!await hasCurrentOrdinaryShippingDeclaration(destination)) throw new Error('Choisissez et confirmez le type ordinaire de cette adresse exacte avant de demander un devis.');
    assertCurrent();
    const input = { articleId, shippingAddress: JSON.parse(JSON.stringify(destination)) as ShippingPurchaseAddress,
      ...(agreement ? {chatId: agreement.chatId, offerMessageId: agreement.offerMessageId} : {}) };
    const response = await httpsCallable<typeof input, unknown>(functions, 'quoteShippingPurchase')(input);
    assertCurrent();
    if (!quote(response.data, articleId, input.shippingAddress, agreement)) throw new Error('Le devis de livraison ne peut pas être confirmé. Votre saisie est conservée. Réessayez.');
    const purchasePolicy = await qualifiedPolicy(response.data.purchasePolicy, uid, articleId, response.data.quoteId, assertCurrent); assertCurrent();
    if (!Object.prototype.hasOwnProperty.call(response.data, 'transport')) return {...response.data, purchasePolicy};
    const transport = await qualifiedShippingTransportTerms(response.data.transport, assertCurrent); assertCurrent();
    return {...response.data, purchasePolicy, transport};
  }

  static async readAttempt(uid: string, articleId: string, assertContext: () => void): Promise<ShippingReservationAttempt | null> {
    const session = captureTradeSession(uid); assertContext();
    const raw = await AsyncStorage.getItem(journalKey(uid, articleId));
    assertTradeSessionCurrent(session); assertContext();
    if (raw === null) return null;
    const saved: unknown = JSON.parse(raw);
    if (!attempt(saved, uid, articleId)) throw new Error('La tentative précédente doit être examinée avant une nouvelle réservation.');
    if (saved.input.purchasePolicy) await qualifiedPolicy(saved.input.purchasePolicy, uid, articleId, saved.input.quoteId, () => {assertTradeSessionCurrent(session); assertContext();});
    return saved;
  }

  /** Same stored tuple on every unknown-outcome verification; no new quote, payment or cancellation. */
  static async reserve(uid: string, articleId: string, destination: ShippingPurchaseAddress, input: ShippingReservationInput,
    assertContext: () => void, recoveryOnly = false): Promise<ShippingReservationReceipt> {
    const session = captureTradeSession(uid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    const key = journalKey(uid, articleId);
    const pending = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      assertCurrent();
      const old = await this.readAttempt(uid, articleId, assertCurrent);
      assertCurrent();
      if (Object.prototype.hasOwnProperty.call(input, 'expectedTransportTermsHash') && !hash(input.expectedTransportTermsHash))
        throw new Error('L’empreinte exacte des conditions de transport doit être conservée avant envoi.');
      if (old && (!same(old.input, input) || !same(old.destination, destination))) throw new Error('Vérifiez la tentative précédente avant de choisir un autre devis.');
      if (!old && recoveryOnly) throw new Error('Aucune tentative précédente à vérifier dans ce dossier.');
      const purchasePolicy = !old ? await qualifiedPolicy(input.purchasePolicy, uid, articleId, input.quoteId, assertCurrent) : null;
      if (!old && (input.purchasePolicyAccepted !== true || input.expectedPurchasePolicyVersion !== purchasePolicy!.policyVersion ||
        input.expectedPurchasePolicyHash !== purchasePolicy!.hash)) throw new Error('Acceptez la politique exacte de ce devis avant de réserver.');
      const saved: ShippingReservationAttempt = old ?? { version: 1, uid, articleId,
        destination: JSON.parse(JSON.stringify(destination)) as ShippingPurchaseAddress,
        input: { deliveryType: 'shipping', quoteId: input.quoteId, rateId: input.rateId, expectedTotal: input.expectedTotal,
          purchasePolicyAccepted: true, expectedPurchasePolicyVersion: purchasePolicy!.policyVersion,
          expectedPurchasePolicyHash: purchasePolicy!.hash, purchasePolicy: purchasePolicy!,
          ...(Object.prototype.hasOwnProperty.call(input, 'expectedTransportTermsHash') ? {expectedTransportTermsHash: input.expectedTransportTermsHash} : {}) } };
      if (!attempt(saved, uid, articleId)) throw new Error('La réservation doit être vérifiée avant envoi.');
      await AsyncStorage.setItem(key, JSON.stringify(saved));
      assertCurrent();
      try {
        const rpcInput = {deliveryType: saved.input.deliveryType, quoteId: saved.input.quoteId, rateId: saved.input.rateId, expectedTotal: saved.input.expectedTotal,
          ...(Object.prototype.hasOwnProperty.call(saved.input, 'expectedTransportTermsHash') ? {expectedTransportTermsHash: saved.input.expectedTransportTermsHash} : {}),
          ...(saved.input.purchasePolicy ? {purchasePolicyAccepted: saved.input.purchasePolicyAccepted,
            expectedPurchasePolicyVersion: saved.input.expectedPurchasePolicyVersion, expectedPurchasePolicyHash: saved.input.expectedPurchasePolicyHash} : {})};
        const response = await httpsCallable<Omit<ShippingReservationInput, 'purchasePolicy'>, unknown>(functions, 'createTransaction')(rpcInput);
        if (!receipt(response.data) || response.data.existingOrderOnly === true ||
            Object.prototype.hasOwnProperty.call(saved.input, 'expectedTransportTermsHash') && response.data.transportTermsHash !== saved.input.expectedTransportTermsHash ||
            (saved.receipt && saved.receipt.transactionId !== response.data.transactionId)) throw new Error('La réception de cette réservation doit être vérifiée.');
        // Persist the witness even if the screen closed while the server committed.
        await AsyncStorage.setItem(key, JSON.stringify({ ...saved, receipt: response.data }));
        assertCurrent();
        return response.data;
      } catch (error) {
        // A later refusal does not erase an earlier unknown request. Claimed
        // receipts are recovered server-side before its new-reservation clock.
        if (definitive(error) && !saved.receipt && !old) { assertCurrent(); await AsyncStorage.removeItem(key); }
        throw error;
      }
    });
    queues.set(key, pending);
    try { return await pending; }
    finally { if (queues.get(key) === pending) queues.delete(key); }
  }

  static async readExisting(uid: string, existingTransactionId: string, assertContext: () => void): Promise<ShippingReservationReceipt> {
    const session = captureTradeSession(uid); assertContext();
    if (!id(existingTransactionId)) throw new Error('Référence de commande invalide.');
    const response = await httpsCallable<{ existingTransactionId: string }, unknown>(functions, 'createTransaction')({ existingTransactionId });
    assertTradeSessionCurrent(session); assertContext();
    if (!receipt(response.data) || response.data.existingOrderOnly !== true || response.data.transactionId !== existingTransactionId) throw new Error('La commande existante doit être vérifiée.');
    return response.data;
  }
}
