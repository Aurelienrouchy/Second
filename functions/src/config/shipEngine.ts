import { exactCents, parsePurchaseRates, providerId, purchaseShipmentMatches, type PurchaseRates, type PurchaseRateContext } from '../utils/shippingPurchaseRate';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import {assertTransportAccountBinding,assertTransportCurrentForNewPost,qualifiedShippingTransportLeg,shipmentTransportOptions,
  transportServiceAllowed,shippingTransportHash,type ShippingTransportLeg} from './shippingTransportPolicy';
import { assertFinancialRecoveryEffect, preserveFinancialRecoveryEffectResponse, FinancialRecoveryBlocked } from '../utils/financialRecoveryInterlock';
import { shipEngineKeyAllowed, isDevCommerceShippingTestRuntime } from './runtimeEnvironment';
import { devShippingRequest, devShippingOrder, devShippingId, DEV_SHIPPING_PROTOCOL } from './devShippingSimulation';
/**
 * ShipEngine API client
 * Multi-carrier shipping: Intelcom (Dragonfly) + Canada Post
 * Documentation: https://www.shipengine.com/docs/
 *
 * ShipEngine wraps multiple carriers behind a single API.
 * We use it for: rate shopping, label creation, tracking, PUDO locations.
 */

// =============================================================================
// TYPES
// =============================================================================

interface ShipEngineConfig {
  apiKey: string;
  baseUrl: string;
}

export interface ShipEngineAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  cityLocality: string;
  stateProvince: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
  email?: string;
}

export interface ShipEngineParcel {
  weight: { value: number; unit: 'kilogram' };
  dimensions: {
    length: number;
    width: number;
    height: number;
    unit: 'centimeter';
  };
}
export interface ReturnShipmentContext extends PurchaseRateContext {
  isReturn: true;
  externalShipmentId: string;
  carrierId: string;
  carrierCode: string;
  serviceCode: string;
  outboundLabelId: string;
}

export interface ShipEngineRate {
  rateId: string;
  carrierId: string;
  carrierCode: string;
  carrierFriendlyName: string;
  serviceCode: string;
  serviceType: string;
  shippingAmount: { amount: number; currency: string };
  estimatedDeliveryDays: number;
  deliveryType: 'home' | 'pickup_point';
  pickupPointId?: string;
  pickupPointName?: string;
}

export type ShipEngineRateEstimate = Omit<ShipEngineRate, 'rateId'>;
export interface ShipEngineEstimateZone {
  country: 'CA'; postalCode: string; city: string; province: string;
}

export interface ShipEngineLabel {
  labelId: string;
  shipmentId?: string;
  rateId?: string;
  carrierId?: string;
  serviceCode?: string;
  qualification?: {
    schemaVersion: 1; currency: 'CAD'; simulation?: {protocol: 'seconde_dev_shipping_simulation_v1'; realShipment: false}; shipmentCents: number; insuranceCents: number; totalCents: number;
    requestedRateId: string; rateIdentitySource: 'request_path' | 'filtered_lookup' | 'return_shipment'; providerCreatedAt: string;
    rateDetails: { type: string; cents: number }[] | null;
  };
  trackingNumber: string;
  labelDownload: { href: string };
  trackingUrl: string;
  carrierCode: string;
  /**
   * Real cost ShipEngine charged the platform for this label, in dollars.
   * Used by the cost-reconciliation pass (compare with the estimated
   * shippingCost billed to the buyer). Forward purchases never default an
   * omitted amount to zero; the legacy return path remains separately qualified.
   */
  shipmentCost: number;
  /** Forward labels require an explicit CAD zero when no insurance is charged. */
  insuranceCost: number;
}

export interface ShipEngineTracking {
  trackingNumber: string;
  statusCode: string;
  statusDescription: string;
  estimatedDeliveryDate?: string;
  actualDeliveryDate?: string;
  events: {
    occurredAt: string;
    description: string;
    cityLocality?: string;
    stateProvince?: string;
    statusCode?: string;
  }[];
}

export type TrackingLeg = 'forward' | 'return';
/** A GET of one saved label identifies a document, never a new purchase or
 * carrier acceptance. A missing document/404 is not a void witness. */
export interface CurrentLabelDocumentIdentity {
  labelId: string; direction: TrackingLeg; trackingNumber: string; carrierCode: string;
  shipmentId: string | null; carrierId: string | null; serviceCode: string | null;
  outboundLabelId: string | null; rateId: string | null; providerCreatedAtMs: number | null;
}
export interface CurrentLabelDocument {
  observation: 'document_available' | 'provider_voided' | 'unknown' | 'needs_review';
  providerStatus: string | null; providerVoided: boolean | null; providerRevision: null;
  providerCreatedAtMs: number | null; observedAtMs: number; documentUrl: string | null;
  reason: string | null;
}
/** Lifecycle evidence is separate from document usability and from any buyer
 * reimbursement. Provider approval never proves a settled account credit. */
export interface LabelLifecycleIdentity {
  labelId: string; direction: TrackingLeg; shipmentId: string; carrierId: string;
  carrierCode: string; serviceCode: string; rateId: string; trackingNumber: string | null;
  outboundLabelId: string | null; providerCreatedAtMs: number | null;
}
export interface LabelLifecycleObservation {
  protocol: 'shipengine_label_lifecycle_observation_v1'; labelId: string; identityQualified: boolean;
  requestedAtMs: number; observedAtMs: number; source: 'exact_label_get';
  documentState: 'available' | 'voided' | 'unknown'; documentUrl: string | null;
  providerStatus: string | null; providerVoided: boolean | null; providerCreatedAtMs: number | null;
  trackingNumber: string | null; refundStatus: 'request_scheduled' | 'pending' | 'approved' | 'rejected' | 'excluded' | null;
  providerRefundStatus: string | null; costCents: number | null; currency: 'CAD' | null;
  effectiveRefundCents: null; remainingCostCents: null; settledBillingProof: null; reason: string | null;
}
export interface LabelVoidObservation {
  protocol: 'shipengine_label_void_response_v1'; labelId: string; requestedAtMs: number; observedAtMs: number;
  source: 'exact_label_void_put'; outcome: 'approved' | 'refused' | 'unknown'; approved: boolean | null;
  message: string | null; reasonCode: string | null; refundStatus: null; effectiveRefundCents: null;
}
/** Server-only current-label pointer. Lifecycle readers additionally qualify
 * its immutable purchase/adoption receipts under TX. This pure projection
 * lets tracking retain the original contractual snapshot and label history. */
export function lifecycleLabelIdentityHash(transactionId: string, leg: TrackingLeg, marker: any, identity: LabelLifecycleIdentity): string {
  return createHash('sha256').update(JSON.stringify([transactionId, leg, marker.buyerId, marker.sellerId, marker.caseId, marker.entryId, marker.contentHash,
    identity.labelId, identity.direction, identity.shipmentId, identity.carrierId, identity.carrierCode, identity.serviceCode, identity.rateId,
    identity.trackingNumber, identity.outboundLabelId, identity.providerCreatedAtMs])).digest('hex');
}
export function savedLifecycleLabelIdentity(transactionId: string, data: FirebaseFirestore.DocumentData, leg: TrackingLeg): LabelLifecycleIdentity | null {
  const marker = data.labelLifecycleCurrent?.[leg], i = marker?.identity;
  if (marker?.protocol !== 'label_lifecycle_current_label_v1' || marker.transactionId !== transactionId || marker.leg !== leg ||
      marker.buyerId !== data.buyerId || marker.sellerId !== data.sellerId || data.buyerId === data.sellerId ||
      !/^ll_[a-f0-9]{64}$/.test(marker.caseId ?? '') || !/^le_[a-f0-9]{64}$/.test(marker.entryId ?? '') || !/^[a-f0-9]{64}$/.test(marker.contentHash ?? '') ||
      !(marker.recordedAt instanceof Timestamp) || marker.recordedAt.toMillis() > Date.now() || !i || i.direction !== leg ||
      ![i.labelId, i.shipmentId, i.carrierId, i.rateId].every(providerId) || typeof i.trackingNumber !== 'string' || !i.trackingNumber || i.trackingNumber.length > 200 ||
      typeof i.carrierCode !== 'string' || !/^[a-z0-9_-]{1,100}$/.test(i.carrierCode) || typeof i.serviceCode !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(i.serviceCode) ||
      !Number.isSafeInteger(i.providerCreatedAtMs) || i.providerCreatedAtMs < 0 || i.providerCreatedAtMs > marker.recordedAt.toMillis() ||
      (leg === 'return' ? !providerId(i.outboundLabelId) : i.outboundLabelId !== null) ||
      i.labelId !== (leg === 'forward' ? data.shipEngineLabelId : data.returnLabelId) || i.trackingNumber !== (leg === 'forward' ? data.trackingNumber : data.returnTrackingNumber) ||
      i.carrierCode !== (leg === 'forward' ? data.carrierCode : data.returnCarrierCode) || marker.identityHash !== lifecycleLabelIdentityHash(transactionId, leg, marker, i)) return null;
  return i;
}
export interface QualifiedTracking extends ShipEngineTracking {
  proof: { schemaVersion: 1; provider: 'shipengine' | 'seconde_dev_simulation'; transactionId: string; leg: TrackingLeg;
    identitySource: 'saved_label_get_and_label_track' | 'member_test_action'; sourceHash: string; labelId: string; shipmentId: string;
    trackingNumber: string; carrierCode: string; statusCode: string; requestedAtMs: number; observedAtMs: number;
    readId: string; readVersion: number;
    providerLabelCreatedAtMs: number; providerEventAtMs: number | null; providerEventTimeSource: 'actual_delivery_date' | 'normalized_event' | null;
    providerRevision: null; observedContentHash: string };
}
export function providerUtc(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const civil = new Date(0); civil.setUTCFullYear(year, month - 1, day); civil.setUTCHours(0, 0, 0, 0);
  if (civil.getUTCFullYear() !== year || civil.getUTCMonth() !== month - 1 || civil.getUTCDate() !== day ||
      Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
  const zone = value.match(/[+-](\d{2}):(\d{2})$/);
  if (zone && (Number(zone[1]) > 23 || Number(zone[2]) > 59)) return null;
  const time = Date.parse(value); return Number.isSafeInteger(time) && time >= 0 ? time : null;
}
export function trackingObservationDisposition(data: FirebaseFirestore.DocumentData, proof: QualifiedTracking['proof'], leg: TrackingLeg):
  'accept' | 'replay' | 'snapshot' | 'stale' | 'ambiguous' {
  if (!Number.isSafeInteger(proof.providerLabelCreatedAtMs) || proof.providerLabelCreatedAtMs < 0 ||
      !/^[a-f0-9]{64}$/.test(proof.observedContentHash) || proof.providerRevision !== null) return 'ambiguous';
  // The documented response may omit normalized status codes on its events.
  // A winning native read still proves a current snapshot, not a scan epoch.
  if (proof.providerEventAtMs == null) return proof.providerEventTimeSource == null ? 'snapshot' : 'ambiguous';
  if (!Number.isSafeInteger(proof.providerEventAtMs) || proof.providerEventAtMs < proof.providerLabelCreatedAtMs ||
      proof.providerEventAtMs > proof.observedAtMs || proof.providerEventTimeSource == null) return 'ambiguous';
  const previous = leg === 'forward' ? data.trackingObservation : data.returnTrackingObservation;
  if (!previous) {
    // An old local deliveredAt is not a carrier scan timestamp. Preserve that
    // known delivery until the missing chronology is explicitly reconciled.
    if ((leg === 'forward' ? data.deliveredAt : data.returnDeliveredAt) && proof.statusCode !== 'DE') return 'ambiguous';
    return 'accept';
  }
  // The immutable adoption chain is qualified by the TX caller. A native
  // pre-scan observation of its exact predecessor is history, not chronology
  // for the replacement. IT/DE/unknown histories never gain this exception.
  const replacement = data.labelLifecycleCurrent?.[leg];
  if (savedLifecycleLabelIdentity(proof.transactionId, data, leg) && replacement.identity.labelId === proof.labelId &&
      previous.schemaVersion === 1 && trackingProviderMatches(data, previous) && previous.leg === leg && previous.transactionId === proof.transactionId &&
      previous.labelId === replacement.activation?.previousLabelId && ['NY', 'UN'].includes(previous.statusCode) &&
      previous.recordedAt instanceof Timestamp && previous.recordedAt.toMillis() > 0 && previous.recordedAt.toMillis() <= replacement.recordedAt.toMillis() &&
      /^[a-f0-9]{64}$/.test(previous.sourceHash ?? '') && /^[a-f0-9]{64}$/.test(previous.observedContentHash ?? '') &&
      !(leg === 'forward' ? data.deliveredAt : data.returnDeliveredAt)) return 'accept';
  if (previous.schemaVersion !== 1 || !trackingProviderMatches(data, previous) || previous.labelId !== proof.labelId ||
      previous.sourceHash !== proof.sourceHash || previous.leg !== leg || !(previous.recordedAt instanceof Timestamp) ||
      !Number.isSafeInteger(previous.providerEventAtMs) || !/^[a-f0-9]{64}$/.test(previous.observedContentHash ?? '')) return 'ambiguous';
  if (proof.providerEventAtMs! < previous.providerEventAtMs) return 'stale';
  if (proof.providerEventAtMs === previous.providerEventAtMs) return proof.statusCode === previous.statusCode ? 'replay' : 'ambiguous';
  return 'accept';
}
export function trackingIdentity(transactionId: string, data: FirebaseFirestore.DocumentData, leg: TrackingLeg) {
  if (data.labelLifecycleCurrent != null && Object.prototype.hasOwnProperty.call(data.labelLifecycleCurrent, leg)) {
    const identity = savedLifecycleLabelIdentity(transactionId, data, leg), marker = data.labelLifecycleCurrent[leg];
    if (!identity) return null;
    const sourceHash = createHash('sha256').update(JSON.stringify([transactionId, leg, data.buyerId, data.sellerId, marker.entryId, marker.contentHash, marker.identityHash])).digest('hex');
    return {labelId: identity.labelId, trackingNumber: identity.trackingNumber!, carrierCode: identity.carrierCode, shipmentId: identity.shipmentId,
      carrierId: identity.carrierId, serviceCode: identity.serviceCode, sourceHash, leg};
  }
  const labelId = leg === 'forward' ? data.shipEngineLabelId : data.returnLabelId;
  const trackingNumber = leg === 'forward' ? data.trackingNumber : data.returnTrackingNumber;
  const carrierCode = leg === 'forward' ? data.carrierCode : data.returnCarrierCode;
  if (!transactionId || transactionId.includes('/') || !providerId(labelId) || typeof trackingNumber !== 'string' ||
      !trackingNumber.trim() || trackingNumber.length > 200 || typeof carrierCode !== 'string' || !/^[a-z0-9_]{1,100}$/.test(carrierCode) ||
      typeof data.buyerId !== 'string' || !data.buyerId || typeof data.sellerId !== 'string' || !data.sellerId || data.buyerId === data.sellerId) return null;
  const purchase = data.labelPurchase, request = data.returnRequest, snapshot = data.shippingSnapshot;
  if (leg === 'forward' && (!(data.labelCreatedAt instanceof Timestamp) || purchase != null &&
      (purchase.schemaVersion !== 1 || purchase.state !== 'committed' || purchase.transactionId !== transactionId ||
       purchase.buyerId !== data.buyerId || purchase.sellerId !== data.sellerId || purchase.providerLabelId !== labelId ||
       !(purchase.committedAt instanceof Timestamp) || purchase.shipmentId !== snapshot?.shipmentId || purchase.rateId !== data.shipEngineRateId))) return null;
  const convenienceFinancing = data.convenienceReturnFinancialReservation;
  const nativeConvenience = request?.schemaVersion === 2 && request.reason === 'change_of_mind' &&
    request.convenienceReturn?.termsProtocol === 'convenience_return_terms_v2' &&
    request.convenienceReturnBasis?.protocol === 'convenience_return_basis_v1' &&
    convenienceFinancing?.protocol === 'convenience_return_financing_v1' &&
    convenienceFinancing.terms?.protocol === 'convenience_return_cost_terms_v1' &&
    convenienceFinancing.terms.transactionId === transactionId && convenienceFinancing.terms.requestId === request.requestId &&
    convenienceFinancing.terms.buyerId === data.buyerId && convenienceFinancing.terms.sellerId === data.sellerId &&
    /^[a-f0-9]{64}$/.test(convenienceFinancing.termsHash ?? '') &&
    request.quote?.convenienceReturnFinancialTermsHash === convenienceFinancing.termsHash &&
    request.acceptance?.convenienceReturnFinancialTermsHash === convenienceFinancing.termsHash &&
    convenienceFinancing.reservedAt instanceof Timestamp;
  if (leg === 'return' && (!request || request.schemaVersion !== 1 && !nativeConvenience || request.state !== 'committed' ||
      request.transactionId !== transactionId || request.buyerId !== data.buyerId || request.sellerId !== data.sellerId ||
      !(request.committedAt instanceof Timestamp) || request.labelProof?.labelId !== labelId || request.labelProof?.trackingNumber !== trackingNumber)) return null;
  const shipmentId = leg === 'forward' && snapshot?.schemaVersion === 1 ? snapshot.shipmentId :
    leg === 'return' && request?.labelProof?.schemaVersion === 2 ? request.labelProof.shipmentId : null;
  if (shipmentId != null && !providerId(shipmentId)) return null;
  const carrierId = leg === 'forward' ? snapshot?.rate?.carrierId ?? null :
    request?.labelProof?.schemaVersion === 2 ? request.labelProof.carrierId : null;
  const serviceCode = leg === 'forward' ? snapshot?.rate?.serviceCode ?? null :
    request?.labelProof?.schemaVersion === 2 ? request.labelProof.serviceCode : null;
  if (leg === 'return' && request?.labelProof?.schemaVersion === 2 &&
      (!providerId(shipmentId) || !providerId(carrierId) || typeof serviceCode !== 'string' || !serviceCode)) return null;
  const sourceHash = createHash('sha256').update(JSON.stringify([transactionId, leg, data.buyerId, data.sellerId,
    labelId, trackingNumber, carrierCode, shipmentId, carrierId, serviceCode, purchase?.attemptId ?? null,
    leg === 'return' ? request.requestId : null, leg === 'return' ? request.version : null,
    ...(leg === 'return' && nativeConvenience ? ['convenience_return_shipping_v1', convenienceFinancing.termsHash] : [])])).digest('hex');
  return {labelId, trackingNumber, carrierCode, shipmentId, carrierId, serviceCode, sourceHash, leg};
}
export function trackingProviderMatches(data: FirebaseFirestore.DocumentData, proof: {provider?: unknown; identitySource?: unknown}): boolean {
  return proof.provider === 'shipengine' && proof.identitySource === 'saved_label_get_and_label_track' && data.carrierCode !== 'seconde_dev' ||
    proof.provider === 'seconde_dev_simulation' && proof.identitySource === 'member_test_action' && devShippingOrder(data);
}
export function trackingProofMatches(transactionId: string, data: FirebaseFirestore.DocumentData,
  proof: QualifiedTracking['proof'] | undefined, leg: TrackingLeg): boolean {
  const identity = trackingIdentity(transactionId, data, leg);
  const read = leg === 'forward' ? data.trackingRead : data.returnTrackingRead;
  return !!identity && proof?.schemaVersion === 1 && trackingProviderMatches(data, proof) && proof.transactionId === transactionId &&
    proof.leg === leg && proof.sourceHash === identity.sourceHash &&
    proof.labelId === identity.labelId && proof.trackingNumber === identity.trackingNumber && proof.carrierCode === identity.carrierCode &&
    providerId(proof.shipmentId) && (identity.shipmentId == null || identity.shipmentId === proof.shipmentId) &&
    read?.schemaVersion === 1 && read.readId === proof.readId && read.version === proof.readVersion &&
    read.sourceHash === identity.sourceHash && read.labelId === identity.labelId && read.leg === leg && read.authorizedAt instanceof Timestamp &&
    Number.isSafeInteger(proof.readVersion) && proof.readVersion > 0 && proof.requestedAtMs >= read.authorizedAt.toMillis() &&
    Number.isSafeInteger(proof.requestedAtMs) && Number.isSafeInteger(proof.observedAtMs) && proof.requestedAtMs <= proof.observedAtMs &&
    proof.observedAtMs <= Date.now();
}

export interface PUDOLocation {
  locationId: string;
  name: string;
  address: {
    addressLine1: string;
    cityLocality: string;
    stateProvince: string;
    postalCode: string;
    countryCode: 'CA';
  };
  carrierCode: string;
  serviceCodes: string[];
  type: 'pudo' | 'locker' | null;
  features: string[] | null;
  // Provider-reported schedule, not a current opening/availability guarantee.
  reportedHours: Record<string, {open: string; close: string}[] | null> | null;
  distanceKm: number | null;
}

export type ServicePointLookupInput = {carrierId: string; serviceCode: string; countryCode: 'CA'} &
  ({mode: 'list'; postalCode: string; radiusKm: number} | {mode: 'detail'; servicePointId: string});
export type ServicePointLookupReason = 'selection_required' | 'provider_not_configured' | 'carrier_source_unknown' |
  'carrier_service_not_available' | 'provider_request_failed' | 'provider_response_unknown' | 'result_limit_reached' | null;
export interface ServicePointLookupResult {
  protocol: 'service_point_lookup_v1';
  status: 'qualified_results' | 'qualified_empty' | 'unsupported' | 'unknown';
  reason: ServicePointLookupReason;
  success: boolean;
  locations: PUDOLocation[];
  observedAt: string;
  providerObservedAt: string | null;
  carrierServiceObservedAt: string | null;
  source: {carrierId: string; carrierCode: string; serviceCode: string; countryCode: 'CA'} | null;
  capability: {carrierService: 'native_observed' | 'unknown'; lookup: 'observed_response' | 'unknown';
    requiredAccountPlan: 'advanced_or_higher'; accountPlan: 'unknown'};
  limits: {resultLimit: 20; radiusKm: number | null; completeness: 'within_response_bound' | 'unknown'};
  currentOpeningState: 'unknown';
  usableForPurchase: false;
}
export function unqualifiedServicePointLookup(reason: Exclude<ServicePointLookupReason, null>, radiusKm: number | null = null): ServicePointLookupResult {
  return {protocol: 'service_point_lookup_v1', status: 'unknown', reason, success: false, locations: [],
    observedAt: new Date().toISOString(), providerObservedAt: null, carrierServiceObservedAt: null, source: null,
    capability: {carrierService: 'unknown', lookup: 'unknown', requiredAccountPlan: 'advanced_or_higher', accountPlan: 'unknown'},
    limits: {resultLimit: 20, radiusKm, completeness: 'unknown'}, currentOpeningState: 'unknown', usableForPurchase: false};
}
const servicePointCode = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const servicePointText = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v === v.trim() &&
  v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const servicePointFeatures = new Set(['drop_off_point', 'pick_up_point', 'print_services', 'after_hours_locker', 'after_hours_dropbox']);
const servicePointDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
function publicServicePoint(raw: any, input: ServicePointLookupInput, carrierCode: string): PUDOLocation | null {
  if (!raw || raw.carrier_code !== carrierCode || raw.country_code !== input.countryCode ||
      !servicePointText(raw.service_point_id, 200) || (input.mode === 'detail' && raw.service_point_id !== input.servicePointId) ||
      !servicePointText(raw.company_name, 200) || !servicePointText(raw.address_line1, 200) ||
      !servicePointText(raw.city_locality, 100) || !servicePointText(raw.state_province, 100) ||
      !servicePointText(raw.postal_code, 20) || !Array.isArray(raw.service_codes) || !raw.service_codes.length || raw.service_codes.length > 100 ||
      !raw.service_codes.every(servicePointCode) || new Set(raw.service_codes).size !== raw.service_codes.length ||
      !raw.service_codes.includes(input.serviceCode) || (raw.type != null && raw.type !== 'pudo' && raw.type !== 'locker') ||
      (raw.features != null && (!Array.isArray(raw.features) || raw.features.length > 5 ||
        !raw.features.every((v: unknown) => typeof v === 'string' && servicePointFeatures.has(v)) || new Set(raw.features).size !== raw.features.length)) ||
      (raw.distance_in_meters != null && (typeof raw.distance_in_meters !== 'number' || !Number.isFinite(raw.distance_in_meters) || raw.distance_in_meters < 0))) return null;
  let reportedHours: PUDOLocation['reportedHours'] = null;
  if (raw.hours_of_operation != null) {
    if (typeof raw.hours_of_operation !== 'object' || Array.isArray(raw.hours_of_operation) ||
        Object.keys(raw.hours_of_operation).some(day => !servicePointDays.includes(day))) return null;
    reportedHours = {};
    for (const day of servicePointDays) {
      const intervals = raw.hours_of_operation[day];
      if (intervals === undefined) { reportedHours[day] = null; continue; }
      if (!Array.isArray(intervals) || intervals.length > 4 || !intervals.every(interval => interval &&
          typeof interval.open === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(interval.open) &&
          typeof interval.close === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(interval.close))) return null;
      reportedHours[day] = intervals.map(interval => ({open: interval.open, close: interval.close}));
    }
  }
  return {locationId: raw.service_point_id, name: raw.company_name, carrierCode, serviceCodes: raw.service_codes,
    address: {addressLine1: raw.address_line1, cityLocality: raw.city_locality, stateProvince: raw.state_province,
      postalCode: raw.postal_code, countryCode: 'CA'}, type: raw.type ?? null, features: raw.features ?? null, reportedHours,
    distanceKm: raw.distance_in_meters == null ? null : raw.distance_in_meters / 1000};
}

// =============================================================================
// CLIENT
// =============================================================================

// Per-attempt network timeout. ShipEngine rate/label calls are normally well
// under a second; 15s is a generous ceiling that still lets the webhook handler
// respond before Stripe's retry window — a hung fetch would otherwise block the
// 200 response and trigger duplicate Stripe webhook deliveries (P1-17/P1-27).
const REQUEST_TIMEOUT_MS = 15_000;
// Retries share one transport budget; Retry-After never extends it. Two GETs
// used by a tracking observation have configured transport budgets totalling 60 seconds.
const REQUEST_TOTAL_BUDGET_MS = 30_000;

// Exponential backoff schedule (ms) for transient failures. The number of
// entries also caps the number of RETRIES (so 3 here => up to 4 attempts).
const RETRY_BACKOFF_MS = [500, 1000, 2000];

// HTTP statuses worth retrying: 429 (rate limited) + 5xx (server-side).
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Error carrying the HTTP status so callers / the retry loop can branch on it.
 */
class ShipEngineHttpError extends Error {
  readonly status: number;
  readonly responseBody: unknown;
  constructor(status: number, message: string, responseBody?: unknown) {
    super(message);
    this.name = 'ShipEngineHttpError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

/** A timeout or malformed response is never proof that a paid POST failed. */
export class ShipEngineLabelPurchaseError extends Error {
  constructor(readonly outcome: 'rejected' | 'unknown', readonly evidence: Record<string, unknown>) {
    super(outcome === 'rejected' ? 'Label request rejected before carrier purchase' : 'Label purchase outcome requires reconciliation');
    this.name = 'ShipEngineLabelPurchaseError';
  }
}
/** Stable native purchase attempt identity; it is not provider idempotency. */
export function returnLabelPurchaseContextHash(context: ReturnShipmentContext, rateId: string, purchaseExternalId: string): string {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return createHash('sha256').update(JSON.stringify(canonical([context, rateId, purchaseExternalId]))).digest('hex');
}

interface LabelPurchaseContext { shipmentId: string; carrierId?: string; serviceCode?: string; carrierCode?: string; isReturnLabel?: boolean;
  shipmentContext?:PurchaseRateContext; }
const labelText = (value: unknown, max: number): string | null => typeof value === 'string' && value.trim() && value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
function labelHttps(value: unknown): string | null {
  const text = labelText(value, 2000); if (!text) return null;
  try { const url = new URL(text); return url.protocol === 'https:' && !url.username && !url.password ? text : null; } catch { return null; }
}

/** Preserve a bounded contradictory response as evidence after a paid POST. */
function labelResponseEvidence(raw: any): Record<string, unknown> {
  const money = (value: any) => ({ currency: typeof value?.currency === 'string' ? value.currency.substring(0, 20) : null,
    amount: typeof value?.amount === 'number' && Number.isFinite(value.amount) ? value.amount :
      typeof value?.amount === 'string' ? value.amount.substring(0, 100) : null });
  return { labelId: labelText(raw?.label_id, 200), shipmentId: labelText(raw?.shipment_id, 200), rateId: labelText(raw?.rate_id, 200),
    status: labelText(raw?.status, 100), carrierId: labelText(raw?.carrier_id, 200), carrierCode: labelText(raw?.carrier_code, 100),
    serviceCode: labelText(raw?.service_code, 100), trackingNumber: labelText(raw?.tracking_number, 200),
    downloadHref: labelText(raw?.label_download?.href, 2000), labelFormat: labelText(raw?.label_format, 20),
    createdAt: labelText(raw?.created_at, 100), voided: typeof raw?.voided === 'boolean' ? raw.voided : null,
    isReturnLabel: typeof raw?.is_return_label === 'boolean' ? raw.is_return_label : null,
    shipmentCost: money(raw?.shipment_cost), insuranceCost: money(raw?.insurance_cost),
    rateDetails: Array.isArray(raw?.rate_details) ? raw.rate_details.slice(0, 50).map((detail: any) =>
      ({ type: labelText(detail?.rate_detail_type, 100), amount: money(detail?.amount) })) : null };
}

function labelPurchaseError(error: unknown): ShipEngineLabelPurchaseError {
  if(error instanceof FinancialRecoveryBlocked)throw error;
  if (error instanceof ShipEngineLabelPurchaseError) return error;
  const body = error instanceof ShipEngineHttpError ? error.responseBody as any : null;
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  // Only ShipEngine request validation (not carrier/network/business failure)
  // proves this request was rejected before a carrier purchase was attempted.
  const rejected = error instanceof ShipEngineHttpError && error.status === 400 && typeof body?.request_id === 'string' &&
    body.request_id.trim().length > 0 && body.request_id.length <= 200 &&
    errors.length > 0 && errors.every((entry: any) => entry?.error_source === 'shipengine' && entry.error_type === 'validation' &&
      typeof entry.error_code === 'string' && !!entry.error_code);
  return new ShipEngineLabelPurchaseError(rejected ? 'rejected' : 'unknown', {
    httpStatus: error instanceof ShipEngineHttpError ? error.status : null,
    requestId: typeof body?.request_id === 'string' ? body.request_id.substring(0, 200) : null,
    errors: errors.slice(0, 20).map((entry: any) => ({ source: typeof entry?.error_source === 'string' ? entry.error_source.substring(0, 50) : null,
      type: typeof entry?.error_type === 'string' ? entry.error_type.substring(0, 50) : null,
      code: typeof entry?.error_code === 'string' ? entry.error_code.substring(0, 100) : null })),
    error: error instanceof Error ? error.message.substring(0, 300) : 'Unqualified provider response',
  });
}

class ShipEngineClient {
  private config: ShipEngineConfig;

  constructor(config: ShipEngineConfig) {
    this.config = config;
  }

  /**
   * Performs a single HTTP attempt with an AbortController timeout. Throws
   * `ShipEngineHttpError` on a non-OK response (carrying the status) and a
   * generic timeout/network Error otherwise.
   */
  private async requestOnce<T>(
    method: string,
    url: string,
    body: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<{ result: T; retryAfterMs: number | null }> {
    if (process.env.FINANCIAL_RECOVERY_ENVIRONMENT === 'unconfigured') throw new FinancialRecoveryBlocked('financial_provider_unconfigured');
    const path = new URL(url).pathname;
    const financialMutation = method !== 'GET' && /^\/v1\/labels(?:\/|$)/.test(path);
    if (financialMutation) await assertFinancialRecoveryEffect('shipengine_label_mutation', {providerOperation: `${method}:${path}`});
    const controller = new AbortController();
    const attemptDeadlineMs = Date.now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (isDevCommerceShippingTestRuntime()) {
        const simulationResult = await devShippingRequest(method, new URL(url).pathname + new URL(url).search, body);
        if (financialMutation) await preserveFinancialRecoveryEffectResponse('shipengine', `${method}:${path}`, simulationResult,
          createHash('sha256').update(JSON.stringify({method,path,body:body ?? null})).digest('hex'));
        return { result: simulationResult as T, retryAfterMs: null };
      }
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'API-Key': this.config.apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      // Keep the same controller alive while reading/parsing the body too.
      // Receiving headers is not completion of this transport attempt.
      if (!response.ok) {
        const errorBody = await response.text();
        if (controller.signal.aborted || Date.now() >= attemptDeadlineMs) throw new Error('ShipEngine response body transport budget exhausted');
        let structuredError: unknown = null;
        try { structuredError = JSON.parse(errorBody); } catch { /* Unstructured errors remain unknown for purchases. */ }
        if (financialMutation) await preserveFinancialRecoveryEffectResponse('shipengine', `${method}:${path}`,
          {status:'provider_error',http_status:response.status}, createHash('sha256').update(JSON.stringify({method,path,body:body ?? null})).digest('hex'));
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterValue = retryAfterHeader?.trim();
        const retryAfterDateMs = retryAfterValue ? Date.parse(retryAfterValue) : NaN;
        // Retry-After permits delta-seconds or an HTTP-date. A large requested
        // wait remains large; request() refuses it instead of retrying early.
        const retryAfterMs = retryAfterValue && /^\d+$/.test(retryAfterValue)
          ? Number(retryAfterValue) * 1000
          : Number.isFinite(retryAfterDateMs) ? Math.max(0, retryAfterDateMs - Date.now()) : null;
        throw Object.assign(
          new ShipEngineHttpError(
            response.status,
            `ShipEngine API error (${response.status}): ${errorBody}`,
            structuredError
          ),
          { retryAfterMs }
        );
      }
      const result = (await response.json()) as T;
      if (controller.signal.aborted || Date.now() >= attemptDeadlineMs) throw new Error('ShipEngine response body transport budget exhausted');
      if (financialMutation) await preserveFinancialRecoveryEffectResponse('shipengine', `${method}:${path}`, result,
        createHash('sha256').update(JSON.stringify({method,path,body:body ?? null})).digest('hex'));
      return { result, retryAfterMs: null };
    } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
      // Preserve the HTTP status; a non-retryable response must not become a
      // generic network failure merely because its body is now inside try.
      if (err instanceof ShipEngineHttpError) throw err;
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? `ShipEngine request timed out after ${timeoutMs}ms`
          : `ShipEngine network error: ${err instanceof Error ? err.message : String(err)}`;
      throw new Error(message);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Issues a request with bounded timeout and exponential backoff.
   *
   * Retries ONLY on transient failures (429, 5xx, network/timeout) and honours
   * the `Retry-After` header. Non-retryable failures (4xx other than 429)
   * bubble up immediately.
   *
   * `allowRetry` defaults to true. `createLabel` MUST pass `false`: ShipEngine
   * label creation is NOT idempotent here (no client-supplied idempotency key),
   * so a retry after a timeout could purchase a second paid label. Stuck labels
   * are instead recovered by the `sweepPendingLabels` job.
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    allowRetry = true
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const maxRetries = allowRetry ? RETRY_BACKOFF_MS.length : 0;
    const deadlineMs = Date.now() + REQUEST_TOTAL_BUDGET_MS;

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) throw lastError instanceof Error ? lastError : new Error('ShipEngine request transport budget exhausted');
      try {
        const { result } = await this.requestOnce<T>(method, url, body, Math.min(REQUEST_TIMEOUT_MS, remainingMs));
        return result;
      } catch (err) {
        lastError = err;
        if (err instanceof FinancialRecoveryBlocked) throw err;

        const isHttp = err instanceof ShipEngineHttpError;
        const status = isHttp ? err.status : null;
        // Network/timeout errors have no status → treated as retryable.
        const isRetryable = status === null || RETRYABLE_STATUSES.has(status);

        if (!allowRetry || attempt === maxRetries || !isRetryable) {
          throw err;
        }

        const retryAfterMs = (err as { retryAfterMs?: number | null })?.retryAfterMs;
        const delayMs =
          typeof retryAfterMs === 'number' && retryAfterMs > 0
            ? retryAfterMs
            : RETRY_BACKOFF_MS[attempt];

        // A longer requested wait cannot be shortened into an early retry.
        // Defer the original operation to its native recovery path instead.
        if (delayMs >= deadlineMs - Date.now()) throw err;
        // Intentionally not using functions/logger here to avoid a circular
        // import; this is a config-layer module. Callers log domain context.
        await sleep(delayMs);
      }
    }

    // Unreachable in practice (loop either returns or throws), but satisfies TS.
    throw lastError instanceof Error
      ? lastError
      : new Error('ShipEngine request failed');
  }

  // ===========================================================================
  // RATE SHOPPING — Compare Intelcom + Canada Post rates
  // ===========================================================================

  async getRates(
    shipFrom: ShipEngineAddress,
    shipTo: ShipEngineAddress,
    parcel: ShipEngineParcel
  ): Promise<ShipEngineRate[]> {
    const response = await this.request<{
      rate_response: {
        rates: {
          rate_id: string;
          carrier_id: string;
          carrier_code: string;
          carrier_friendly_name: string;
          service_code: string;
          service_type: string;
          shipping_amount: { amount: number; currency: string };
          estimated_delivery_days: number;
        }[];
      };
    }>('POST', '/v1/rates', {
      // Omit rate_options.carrier_ids to use ALL connected carriers in the
      // ShipEngine account. An empty array [] means "no carriers" and returns
      // zero rates — the opposite of what we want.
      shipment: {
        ship_from: {
          name: shipFrom.name,
          address_line1: shipFrom.addressLine1,
          address_line2: shipFrom.addressLine2,
          city_locality: shipFrom.cityLocality,
          state_province: shipFrom.stateProvince,
          postal_code: shipFrom.postalCode,
          country_code: shipFrom.countryCode,
          phone: shipFrom.phone,
        },
        ship_to: {
          name: shipTo.name,
          address_line1: shipTo.addressLine1,
          address_line2: shipTo.addressLine2,
          city_locality: shipTo.cityLocality,
          state_province: shipTo.stateProvince,
          postal_code: shipTo.postalCode,
          country_code: shipTo.countryCode,
          phone: shipTo.phone,
        },
        packages: [
          {
            weight: parcel.weight,
            dimensions: parcel.dimensions,
          },
        ],
      },
    });

    return (response.rate_response?.rates || []).map((rate) => ({
      rateId: rate.rate_id,
      carrierId: rate.carrier_id,
      carrierCode: rate.carrier_code,
      carrierFriendlyName: rate.carrier_friendly_name,
      serviceCode: rate.service_code,
      serviceType: rate.service_type,
      shippingAmount: rate.shipping_amount,
      estimatedDeliveryDays: rate.estimated_delivery_days,
      deliveryType: 'home' as const,
    }));
  }

  // ===========================================================================
  // LABEL CREATION — Purchase a shipping label from the selected rate
  // ===========================================================================

  /** /rates/estimate requires real localities; no label-purchasable rate ID.
   * shipDate is the explicit estimation date, not a promised pickup date. */
  async getRateEstimates(from: ShipEngineEstimateZone, to: ShipEngineEstimateZone,
    parcel: { weight: ShipEngineParcel['weight']; dimensions?: ShipEngineParcel['dimensions'] }, shipDate: string): Promise<ShipEngineRateEstimate[]> {
    const carriers = await this.request<{ carriers: { carrier_id: string }[] }>('GET', '/v1/carriers');
    const ids = (carriers.carriers ?? []).map(c => c.carrier_id).filter(id => typeof id === 'string' && /^se-[a-z0-9-]+$/.test(id));
    if (!ids.length) return [];
    const rates = await this.request<any[]>('POST', '/v1/rates/estimate', {
      carrier_ids: ids, from_country_code: from.country, from_postal_code: from.postalCode,
      from_city_locality: from.city, from_state_province: from.province,
      to_country_code: to.country, to_postal_code: to.postalCode, to_city_locality: to.city, to_state_province: to.province,
      weight: parcel.weight, ...(parcel.dimensions ? { dimensions: parcel.dimensions } : {}), ship_date: shipDate,
    });
    return (Array.isArray(rates) ? rates : []).filter(rate => typeof rate.shipping_amount?.amount === 'number' &&
      Number.isFinite(rate.shipping_amount.amount) && rate.shipping_amount.amount >= 0 && rate.shipping_amount.currency?.toLowerCase() === 'cad')
      .map(rate => ({ carrierId: rate.carrier_id, carrierCode: rate.carrier_code ?? '',
        carrierFriendlyName: rate.carrier_friendly_name ?? '', serviceCode: rate.service_code ?? '', serviceType: rate.service_type ?? '',
        shippingAmount: { amount: rate.shipping_amount.amount, currency: 'cad' },
        estimatedDeliveryDays: Number.isFinite(rate.estimated_delivery_days) ? rate.estimated_delivery_days : 0, deliveryType: 'home' as const }));
  }

  /** Strict payable rail only. Legacy getRates/estimates retain their contract. */
  async getPurchaseRates(shipFrom: ShipEngineAddress, shipTo: ShipEngineAddress, parcel: ShipEngineParcel,transport?:ShippingTransportLeg): Promise<PurchaseRates> {
    const context:PurchaseRateContext={shipFrom,shipTo,parcel,...(transport!==undefined?{transport}:{})};
    const leg=transport!==undefined?qualifiedShippingTransportLeg(transport,context):null;
    if(leg)assertTransportCurrentForNewPost(leg);
    const options=leg?shipmentTransportOptions(leg,context):null;
    const address = (a: ShipEngineAddress) => ({ name: a.name, address_line1: a.addressLine1,
      ...(a.addressLine2 ? { address_line2: a.addressLine2 } : {}), city_locality: a.cityLocality,
      state_province: a.stateProvince, postal_code: a.postalCode, country_code: a.countryCode,
      ...(a.phone ? { phone: a.phone } : {}), ...(a.email ? { email: a.email } : {}) });
    // The rates guide requires explicit carrier_ids. The deprecated OpenAPI
    // makes rate_options optional; choose the explicit guide-compatible shape.
    // These IDs come from this account, never client input or an invented default.
    const connections = await this.request<any>('GET', '/v1/carriers');
    if (!Array.isArray(connections?.carriers)) throw new Error('Unqualified carrier list');
    const carrierIds = [...new Set<string>(connections.carriers.filter((c: any) => providerId(c?.carrier_id) &&
      (!leg||leg.admission.services.some(s=>s.carrierId===c.carrier_id&&s.carrierCode===c.carrier_code))&&
      (c.connection_status === undefined || c.connection_status === 'approved')).map((c: any) => c.carrier_id))];
    if (!carrierIds.length) throw new Error('No qualified connected carrier');
    if(leg)assertTransportCurrentForNewPost(leg);
    const response = await this.request<unknown>('POST', '/v1/rates', { rate_options: { carrier_ids: carrierIds,
      ...(leg?{service_codes:[...new Set(leg.admission.services.map(s=>s.serviceCode))]}:{}) }, shipment: {
      ship_from: address(shipFrom), ship_to: address(shipTo),
      ...(options?{insurance_provider:options.insurance_provider,confirmation:options.confirmation}:{}),
      packages: [{ weight: parcel.weight, dimensions: parcel.dimensions,...(options?{insured_value:options.insured_value}:{}) }],
    } }, !leg);
    const parsed = parsePurchaseRates(response, undefined, context);
    parsed.rates = parsed.rates.filter(rate => carrierIds.includes(rate.carrierId)&&(!leg||transportServiceAllowed(leg,rate)));
    if (!parsed.rates.length) throw new Error('No rate from the requested connected carriers');
    parsed.qualification.details = parsed.qualification.details.filter(detail => parsed.rates.some(rate => rate.rateId === detail.rateId));
    if(leg)await this.observeShipmentTransport(parsed,context);
    return parsed;
  }
  /** GET retrieves rates stored for the original shipment. It checks their
   * recorded identity/components, not current carrier pricing; only POST rates
   * requests new rates, which need not reproduce the original IDs. */
  async getPurchaseRatesForShipment(shipmentId: string, context?: PurchaseRateContext): Promise<PurchaseRates> {
    const response = await this.request<unknown>('GET', `/v1/shipments/${encodeURIComponent(shipmentId)}/rates`);
    const rates=parsePurchaseRates(response, shipmentId, context);
    if(context?.transport!==undefined)await this.observeShipmentTransport(rates,context);
    return rates;
  }
  private async observeShipmentTransport(rates:PurchaseRates,context:PurchaseRateContext) {
    const leg=qualifiedShippingTransportLeg(context.transport,context);assertTransportAccountBinding(leg);
    await this.readLifecycleShipment(rates.shipmentId,context);
    rates.rates=rates.rates.filter(r=>transportServiceAllowed(leg,r));
    rates.qualification.details=rates.qualification.details.filter(d=>rates.rates.some(r=>r.rateId===d.rateId));
    if(!rates.rates.length)throw new Error('shipment_transport_service_changed');
    rates.transport={protocol:'shipment_transport_observation_v1',shipmentId:rates.shipmentId,captureHash:leg.hash,
      optionsHash:shippingTransportHash([leg.admission.coverage.insuranceProvider,leg.admission.coverage.declaredValueCents,leg.admission[leg.leg].confirmation])};
  }

  /** Lifecycle quotes requalify the exact new shipment, not a document URL or
   * an omitted optional address echo in the rate response. */
  async readLifecycleShipment(shipmentId: string, context: PurchaseRateContext): Promise<void> {
    if (!providerId(shipmentId)) throw new Error('lifecycle_shipment_identity_unknown');
    if(context.transport!==undefined)assertTransportAccountBinding(qualifiedShippingTransportLeg(context.transport,context));
    const raw = await this.request<any>('GET', `/v1/shipments/${encodeURIComponent(shipmentId)}`, undefined, false);
    if (raw?.shipment_id !== shipmentId || !purchaseShipmentMatches(raw, context)) throw new Error('lifecycle_shipment_source_contradictory');
  }

  /** Runtime qualification of a purchased forward label. Missing/contradictory
   * fields are an unknown PURCHASE result, never a failed retryable request. */
  private labelTransportEchoMatches(raw:any,context:PurchaseRateContext):boolean {
    try {
      const options=shipmentTransportOptions(context.transport,context),own=(k:string)=>Object.prototype.hasOwnProperty.call(raw??{},k);
      // The original shipment GET is mandatory even when a label omits these
      // optional echoes. An echo actually present must never contradict it.
      if(own('confirmation')&&raw.confirmation!==options.confirmation||own('insurance_provider')&&raw.insurance_provider!==options.insurance_provider)return false;
      if(own('packages')) {
        if(!Array.isArray(raw.packages)||raw.packages.length!==1)return false;
        const value=raw.packages[0]?.insured_value;
        if(typeof value?.currency!=='string'||value.currency.toLowerCase()!=='cad'||exactCents(value.amount)!==exactCents(options.insured_value.amount))return false;
      }
      return true;
    }catch{return false;}
  }
  private qualifyPurchasedLabel(raw: any, rateId: string, binding: 'request_path' | 'filtered_lookup' | 'return_shipment',
    expected?: LabelPurchaseContext): ShipEngineLabel {
    const evidence = labelResponseEvidence(raw);
    const simulated = raw?.carrier_code === 'seconde_dev';
    const invalid = (): never => { throw new ShipEngineLabelPurchaseError('unknown', { reason: 'label_response_unqualified', providerResponse: evidence }); };
    if ((simulated || raw?.simulation != null || devShippingId(raw?.label_id)) &&
        (!simulated || !isDevCommerceShippingTestRuntime() || !devShippingId(raw?.label_id) ||
          raw.simulation?.protocol !== DEV_SHIPPING_PROTOCOL || raw.simulation.realShipment !== false)) return invalid();
    if(expected?.shipmentContext?.transport!==undefined&&!this.labelTransportEchoMatches(raw,expected.shipmentContext))return invalid();
    const labelId = labelText(raw?.label_id, 200), shipmentId = labelText(raw?.shipment_id, 200),
      trackingNumber = labelText(raw?.tracking_number, 200), carrierCode = labelText(raw?.carrier_code, 100),
      carrierId = labelText(raw?.carrier_id, 200), serviceCode = labelText(raw?.service_code, 100), href = labelHttps(raw?.label_download?.href);
    if (!labelId || !providerId(labelId) || !shipmentId || !providerId(shipmentId) || !providerId(rateId) ||
        !trackingNumber || !carrierCode || !/^[a-z0-9_-]+$/.test(carrierCode) || !carrierId || !providerId(carrierId) || !serviceCode ||
        !href || raw.status !== 'completed' || raw.voided !== false || raw.is_return_label !== (expected?.isReturnLabel === true) || raw.label_format !== 'pdf' ||
        (binding !== 'return_shipment' && raw.rate_id != null && raw.rate_id !== rateId) || (raw.label_download.pdf != null && !labelHttps(raw.label_download.pdf)) ||
        (expected && (shipmentId !== expected.shipmentId || (expected.carrierId != null && carrierId !== expected.carrierId) ||
          (expected.serviceCode != null && serviceCode !== expected.serviceCode) || (expected.carrierCode != null && carrierCode !== expected.carrierCode)))) return invalid();
    const createdAt = labelText(raw.created_at, 100);
    if (!createdAt || !Number.isFinite(Date.parse(createdAt)) || expected?.isReturnLabel === true &&
        (providerUtc(createdAt) == null || providerUtc(createdAt)! > Date.now())) return invalid();
    const cadCents = (value: any): number | null => typeof value?.currency === 'string' && value.currency.toUpperCase() === 'CAD'
      ? exactCents(value.amount) : null;
    const shipmentCents = cadCents(raw.shipment_cost), insuranceCents = cadCents(raw.insurance_cost);
    if (shipmentCents === null || insuranceCents === null) return invalid();
    const totalCents = shipmentCents + insuranceCents;
    if (!Number.isSafeInteger(totalCents)) return invalid();
    let rateDetails: { type: string; cents: number }[] | null = null;
    if (raw.rate_details != null) {
      if (!Array.isArray(raw.rate_details) || raw.rate_details.length > 50) return invalid();
      rateDetails = [];
      let sum = 0;
      for (const detail of raw.rate_details) {
        const type = labelText(detail?.rate_detail_type, 100), amount = detail?.amount;
        if (!type || typeof amount?.currency !== 'string' || amount.currency.toUpperCase() !== 'CAD' ||
            typeof amount.amount !== 'number' || !Number.isFinite(amount.amount)) return invalid();
        const cents = Math.round(amount.amount * 100);
        if (!Number.isSafeInteger(cents) || Math.abs(amount.amount * 100 - cents) >= 1e-7) return invalid();
        sum += cents; if (!Number.isSafeInteger(sum)) return invalid();
        rateDetails.push({ type, cents });
      }
      if (rateDetails.length && sum !== totalCents) return invalid();
    }
    return { labelId, shipmentId, ...(typeof raw.rate_id === 'string' ? { rateId: raw.rate_id } : {}),
      carrierId, serviceCode, trackingNumber, labelDownload: { href }, trackingUrl: this.getTrackingUrl(carrierCode, trackingNumber),
      carrierCode, shipmentCost: shipmentCents / 100, insuranceCost: insuranceCents / 100,
      qualification: { schemaVersion: 1, currency: 'CAD', ...(simulated ? {simulation: {protocol: DEV_SHIPPING_PROTOCOL, realShipment: false as const}} : {}), shipmentCents, insuranceCents, totalCents,
        requestedRateId: rateId, rateIdentitySource: binding, providerCreatedAt: createdAt, rateDetails } };
  }

  async createLabel(rateId: string, expected?: LabelPurchaseContext): Promise<ShipEngineLabel> {
    try {
    if(expected?.shipmentContext?.transport!==undefined) {
      const leg=qualifiedShippingTransportLeg(expected.shipmentContext.transport,expected.shipmentContext);assertTransportCurrentForNewPost(leg);
      if(!transportServiceAllowed(leg,expected))throw new Error('label_transport_service_changed');
      await this.readLifecycleShipment(expected.shipmentId,expected.shipmentContext);
      assertTransportCurrentForNewPost(leg);
    }
    const response = await this.request<unknown>(
      'POST',
      `/v1/labels/rates/${encodeURIComponent(rateId)}`,
      {
        label_format: 'pdf',
        label_layout: '4x6',
      },
      // allowRetry = false: label creation is NOT idempotent (no idempotency
      // key supported here). A retry after a timeout could buy a 2nd paid
      // label. Recovery reads the same existing purchase, never retries POST.
      false
    );

    const label=this.qualifyPurchasedLabel(response, rateId, 'request_path', expected);
    if(expected?.shipmentContext?.transport!==undefined)await this.readLifecycleShipment(label.shipmentId!,expected.shipmentContext);
    return label;
    } catch (error) { throw labelPurchaseError(error); }
  }

  /** Read an existing purchase only. Empty/multiple results do not authorize a
   * second POST. Filters and the individual GET are from the official API. */
  async readPurchasedLabel(shipmentId: string, rateId: string, expected?: LabelPurchaseContext): Promise<ShipEngineLabel> {
    try {
      if (!providerId(shipmentId) || !providerId(rateId)) throw new Error('Unqualified label purchase identity');
      const list = await this.request<any>('GET', `/v1/labels?shipment_id=${encodeURIComponent(shipmentId)}&rate_id=${encodeURIComponent(rateId)}&page_size=2&page=1`);
      if (!Array.isArray(list?.labels) || list.labels.length !== 1 || list.total !== 1 || list.pages !== 1 ||
          !providerId(list.labels[0]?.label_id) || list.labels[0].shipment_id !== shipmentId) throw new Error('No unique existing label purchase');
      const response = await this.request<any>('GET', `/v1/labels/${encodeURIComponent(list.labels[0].label_id)}?label_download_type=url`);
      if (response?.label_id !== list.labels[0].label_id || response.shipment_id !== shipmentId) {
        throw new ShipEngineLabelPurchaseError('unknown', { reason: 'existing_label_identity_contradictory', providerResponse: labelResponseEvidence(response) });
      }
      const label=this.qualifyPurchasedLabel(response, rateId, 'filtered_lookup', { ...expected, shipmentId });
      if(expected?.shipmentContext?.transport!==undefined)await this.readLifecycleShipment(shipmentId,expected.shipmentContext);
      return label;
    } catch (error) { throw new ShipEngineLabelPurchaseError('unknown', labelPurchaseError(error).evidence); }
  }

  // ===========================================================================
  // RETURN LABEL — Purchase a label for the reverse leg (buyer -> seller)
  // ===========================================================================

  /** Frozen private return identity; external ID is a lookup key, never an
   * idempotency guarantee. Native authorization allows at most one POST. */
  private returnShipment(context: ReturnShipmentContext, externalId = context.externalShipmentId) {
    if (!/^sr_[a-f0-9]{40}$/.test(externalId) || !providerId(context.carrierId) ||
        !providerId(context.outboundLabelId) || !context.serviceCode || context.isReturn !== true)
      throw new Error('return_shipment_identity_unqualified');
    const address = (a: ShipEngineAddress) => ({name: a.name, address_line1: a.addressLine1,
      ...(a.addressLine2 ? {address_line2: a.addressLine2} : {}), city_locality: a.cityLocality,
      state_province: a.stateProvince, postal_code: a.postalCode, country_code: a.countryCode,
      ...(a.phone ? {phone: a.phone} : {}), ...(a.email ? {email: a.email} : {})});
    const options=context.transport!==undefined?shipmentTransportOptions(context.transport,context):null;
    return {external_shipment_id: externalId, carrier_id: context.carrierId, service_code: context.serviceCode,
      is_return: true, ship_from: address(context.shipFrom), ship_to: address(context.shipTo),
      ...(options?{insurance_provider:options.insurance_provider,confirmation:options.confirmation}:{}),
      packages: [{weight: context.parcel.weight, dimensions: context.parcel.dimensions,...(options?{insured_value:options.insured_value}:{})}]};
  }

  /** This POST creates a quote/shipment only, never a paid label. Only the
   * original approved service is returned; absence requires instruction. */
  async getReturnPurchaseRates(context: ReturnShipmentContext): Promise<PurchaseRates> {
    if(context.transport!==undefined) {const leg=qualifiedShippingTransportLeg(context.transport,context);assertTransportCurrentForNewPost(leg);if(!transportServiceAllowed(leg,context))throw new Error('return_transport_service_changed');}
    const response = await this.request<unknown>('POST', '/v1/rates', {
      rate_options: {carrier_ids: [context.carrierId], service_codes: [context.serviceCode], is_return: true},
      shipment: this.returnShipment(context),
    }, false);
    const rates = parsePurchaseRates(response, undefined, context);
    rates.rates = rates.rates.filter(r => r.carrierId === context.carrierId && r.carrierCode === context.carrierCode && r.serviceCode === context.serviceCode);
    rates.qualification.details = rates.qualification.details.filter(d => rates.rates.some(r => r.rateId === d.rateId));
    if (rates.rates.length !== 1) throw new Error('return_service_requires_instruction');
    // Mandatory separate identity/context GET, not an omitted optional echo.
    await this.readReturnShipment(context, rates.shipmentId);
    if(context.transport!==undefined)await this.observeShipmentTransport(rates,context);
    return rates;
  }

  private async readReturnShipment(context: ReturnShipmentContext, expectedShipmentId?: string) {
    if(context.transport!==undefined)assertTransportAccountBinding(qualifiedShippingTransportLeg(context.transport,context));
    const shipment = await this.request<any>('GET', `/v1/shipments/external_shipment_id/${encodeURIComponent(context.externalShipmentId)}`);
    if (shipment?.external_shipment_id !== context.externalShipmentId || !providerId(shipment.shipment_id) ||
        expectedShipmentId != null && shipment.shipment_id !== expectedShipmentId ||
        shipment.carrier_id !== context.carrierId || shipment.service_code !== context.serviceCode || !purchaseShipmentMatches(shipment, context))
      throw new Error('return_shipment_response_unqualified');
    return shipment;
  }

  /** Recovery of the same native quote uses GET only. 404 is unknown, never
   * permission to recreate this shipment or buy another label. */
  async readReturnPurchaseRates(context: ReturnShipmentContext, expectedShipmentId?: string): Promise<PurchaseRates> {
    const shipment = await this.readReturnShipment(context, expectedShipmentId);
    const response = await this.request<unknown>('GET', `/v1/shipments/${encodeURIComponent(shipment.shipment_id)}/rates`);
    const rates = parsePurchaseRates(response, shipment.shipment_id, context);
    rates.rates = rates.rates.filter(r => r.carrierId === context.carrierId && r.carrierCode === context.carrierCode && r.serviceCode === context.serviceCode);
    rates.qualification.details = rates.qualification.details.filter(d => rates.rates.some(r => r.rateId === d.rateId));
    if (rates.rates.length !== 1) throw new Error('return_service_requires_instruction');
    if(context.transport!==undefined)await this.observeShipmentTransport(rates,context);
    return rates;
  }

  /** The documented return flag only applies to POST /labels, not /labels/rates.
   * Buy the explicit service/context accepted by the owner, with no retry. The
   * quote is evidence, not a carrier guarantee of the final label charge. */
  async createReturnLabel(context: ReturnShipmentContext, rateId: string, purchaseExternalId: string): Promise<ShipEngineLabel> {
    if(context.transport!==undefined){const leg=qualifiedShippingTransportLeg(context.transport,context);assertTransportCurrentForNewPost(leg);if(!transportServiceAllowed(leg,context))throw new Error('return_transport_service_changed');}
    const witness = {stage: 'return_label_post', purchaseExternalId, requestedRateId: rateId,
      contextHash: returnLabelPurchaseContextHash(context, rateId, purchaseExternalId)};
    let raw: any;
    try {
      raw = await this.request<any>('POST', '/v1/labels', {shipment: this.returnShipment(context, purchaseExternalId),
        label_format: 'pdf', label_layout: '4x6', label_download_type: 'url', is_return_label: true,
        outbound_label_id: context.outboundLabelId}, false);
    } catch (error) {
      const qualified = labelPurchaseError(error);
      throw new ShipEngineLabelPurchaseError(qualified.outcome, {...qualified.evidence, ...witness});
    }
    try {
      if (!providerId(raw?.label_id)) throw new Error('return_label_identity_missing');
      if(context.transport!==undefined&&!this.labelTransportEchoMatches(raw,context))throw new Error('return_label_transport_contradictory');
      // A GET of the purchase identity proves the response belongs to the
      // frozen addresses/parcel, even when the label omits their echoes.
      return await this.readReturnPurchasedLabel(context, rateId, purchaseExternalId, raw.label_id);
    } catch (error) { throw new ShipEngineLabelPurchaseError('unknown', {...labelPurchaseError(error).evidence,
      ...witness, stage: 'return_label_post_success_followup'}); }
  }

  async readReturnPurchasedLabel(context: ReturnShipmentContext, rateId: string, purchaseExternalId: string,
    expectedLabelId?: string): Promise<ShipEngineLabel> {
    try {
      const purchaseContext = {...context, externalShipmentId: purchaseExternalId};
      const shipment = await this.readReturnShipment(purchaseContext);
      const listed = await this.request<any>('GET', `/v1/labels?shipment_id=${encodeURIComponent(shipment.shipment_id)}&page_size=2&page=1`);
      if (!Array.isArray(listed?.labels) || listed.labels.length !== 1 || listed.total !== 1 || listed.pages !== 1 ||
          !providerId(listed.labels[0]?.label_id) || listed.labels[0].shipment_id !== shipment.shipment_id ||
          expectedLabelId != null && listed.labels[0].label_id !== expectedLabelId) throw new Error('return_label_not_unique');
      const raw = await this.request<any>('GET', `/v1/labels/${encodeURIComponent(listed.labels[0].label_id)}?label_download_type=url`);
      if (raw?.label_id !== listed.labels[0].label_id || raw.outbound_label_id !== context.outboundLabelId)
        throw new Error('return_label_origin_contradictory');
      return this.qualifyPurchasedLabel(raw, rateId, 'return_shipment', {shipmentId: shipment.shipment_id,
        carrierId: context.carrierId, carrierCode: context.carrierCode, serviceCode: context.serviceCode, isReturnLabel: true,
        ...(context.transport!==undefined?{shipmentContext:context}:{})});
    } catch (error) { throw new ShipEngineLabelPurchaseError('unknown', labelPurchaseError(error).evidence); }
  }

  // ===========================================================================
  // TRACKING — Get shipment tracking info
  // ===========================================================================

  /** Exactly this saved label ID, with no list/search/purchase fallback and no
   * tracking transition. Provider responses only describe this observation. */
  async readCurrentLabelDocument(identity: CurrentLabelDocumentIdentity): Promise<CurrentLabelDocument> {
    const unavailable = (observation: 'unknown' | 'needs_review', reason: string): CurrentLabelDocument => ({
      observation, providerStatus: null, providerVoided: null, providerRevision: null,
      providerCreatedAtMs: null, observedAtMs: Date.now(), documentUrl: null, reason,
    });
    if (!providerId(identity.labelId) || !labelText(identity.labelId, 200) || !['forward', 'return'].includes(identity.direction) ||
        !labelText(identity.trackingNumber, 200) || !/^[a-z0-9_]{1,100}$/.test(identity.carrierCode) ||
        [identity.shipmentId, identity.carrierId, identity.outboundLabelId, identity.rateId].some(id => id !== null && (!providerId(id) || !labelText(id, 200))) ||
        identity.serviceCode !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(identity.serviceCode)) {
      return unavailable('needs_review', 'saved_label_identity_unqualified');
    }
    try {
      const raw = await this.request<any>('GET', `/v1/labels/${encodeURIComponent(identity.labelId)}?label_download_type=url`, undefined, false);
      const observedAtMs = Date.now(), createdAtMs = providerUtc(raw?.created_at);
      if (raw?.label_id !== identity.labelId || raw.is_return_label !== (identity.direction === 'return') ||
          raw.tracking_number !== identity.trackingNumber || raw.carrier_code !== identity.carrierCode ||
          !providerId(raw.shipment_id) || identity.shipmentId !== null && raw.shipment_id !== identity.shipmentId ||
          identity.carrierId !== null && raw.carrier_id !== identity.carrierId ||
          identity.serviceCode !== null && raw.service_code !== identity.serviceCode ||
          identity.outboundLabelId !== null && raw.outbound_label_id !== identity.outboundLabelId ||
          identity.rateId !== null && raw.rate_id != null && raw.rate_id !== identity.rateId ||
          createdAtMs === null || createdAtMs > observedAtMs ||
          identity.providerCreatedAtMs !== null && createdAtMs !== identity.providerCreatedAtMs) {
        return unavailable('needs_review', 'current_label_identity_contradictory');
      }
      const status = labelText(raw.status, 100), voided = typeof raw.voided === 'boolean' ? raw.voided : null;
      const base = { providerStatus: status, providerVoided: voided, providerRevision: null,
        providerCreatedAtMs: createdAtMs, observedAtMs };
      // Only an explicit boolean on the qualified SAME label proves voiding.
      if (voided === true) return { ...base, observation: 'provider_voided', documentUrl: null, reason: 'provider_label_voided' };
      const url = labelHttps(raw.label_download?.href);
      if (status !== 'completed' || voided !== false || raw.label_format !== 'pdf' || !url ||
          raw.label_download?.pdf != null && !labelHttps(raw.label_download.pdf)) {
        return { ...base, observation: 'unknown', documentUrl: null, reason: 'current_label_document_unavailable' };
      }
      return { ...base, observation: 'document_available', documentUrl: url, reason: null };
    } catch (error) {
      return unavailable('unknown', error instanceof ShipEngineHttpError && error.status === 404
        ? 'current_label_not_found_unproven' : 'current_label_read_unavailable');
    }
  }

  /** Official GET label by ID. 404, missing fields and expired download links
   * remain unknown; none of them authorizes a replacement purchase. */
  async readLabelLifecycle(identity: LabelLifecycleIdentity): Promise<LabelLifecycleObservation> {
    const requestedAtMs = Date.now();
    const unknown = (reason: string): LabelLifecycleObservation => ({protocol: 'shipengine_label_lifecycle_observation_v1',
      labelId: identity.labelId, identityQualified: false, requestedAtMs, observedAtMs: Date.now(), source: 'exact_label_get',
      documentState: 'unknown', documentUrl: null, providerStatus: null, providerVoided: null, providerCreatedAtMs: null,
      trackingNumber: null, refundStatus: null, providerRefundStatus: null, costCents: null, currency: null,
      effectiveRefundCents: null, remainingCostCents: null, settledBillingProof: null, reason});
    if (![identity.labelId, identity.shipmentId, identity.carrierId, identity.rateId].every(providerId) ||
        !['forward', 'return'].includes(identity.direction) || !labelText(identity.carrierCode, 100) || !labelText(identity.serviceCode, 100) ||
        identity.direction === 'return' && !providerId(identity.outboundLabelId)) return unknown('native_label_identity_incomplete');
    try {
      const raw = await this.request<any>('GET', `/v1/labels/${encodeURIComponent(identity.labelId)}?label_download_type=url`, undefined, false);
      const observedAtMs = Date.now(), createdAt = providerUtc(raw?.created_at);
      if (raw?.label_id !== identity.labelId || raw.shipment_id !== identity.shipmentId || raw.carrier_id !== identity.carrierId ||
          raw.carrier_code !== identity.carrierCode || raw.service_code !== identity.serviceCode || raw.is_return_label !== (identity.direction === 'return') ||
          raw.rate_id != null && raw.rate_id !== identity.rateId || identity.trackingNumber !== null && raw.tracking_number !== identity.trackingNumber ||
          identity.outboundLabelId !== null && raw.outbound_label_id !== identity.outboundLabelId ||
          createdAt === null || createdAt > observedAtMs || identity.providerCreatedAtMs !== null && createdAt !== identity.providerCreatedAtMs)
        return unknown('provider_label_identity_contradictory');
      const voided = typeof raw.voided === 'boolean' ? raw.voided : null, status = labelText(raw.status, 100);
      const url = labelHttps(raw.label_download?.href), refund = labelText(raw.refund_status, 100);
      const shipmentCents = typeof raw.shipment_cost?.currency === 'string' && raw.shipment_cost.currency.toUpperCase() === 'CAD' ? exactCents(raw.shipment_cost.amount) : null;
      const insuranceCents = typeof raw.insurance_cost?.currency === 'string' && raw.insurance_cost.currency.toUpperCase() === 'CAD' ? exactCents(raw.insurance_cost.amount) : null;
      const total = shipmentCents === null || insuranceCents === null ? null : shipmentCents + insuranceCents;
      return {protocol: 'shipengine_label_lifecycle_observation_v1', labelId: identity.labelId, identityQualified: true,
        requestedAtMs, observedAtMs, source: 'exact_label_get', documentState: voided === true ? 'voided' :
          voided === false && status === 'completed' && raw.label_format === 'pdf' && url ? 'available' : 'unknown',
        documentUrl: voided === false && status === 'completed' && raw.label_format === 'pdf' ? url : null,
        providerStatus: status, providerVoided: voided, providerCreatedAtMs: createdAt, trackingNumber: labelText(raw.tracking_number, 200),
        refundStatus: ['request_scheduled', 'pending', 'approved', 'rejected', 'excluded'].includes(refund ?? '') ? refund as LabelLifecycleObservation['refundStatus'] : null,
        providerRefundStatus: refund, costCents: total !== null && Number.isSafeInteger(total) ? total : null,
        currency: total !== null && Number.isSafeInteger(total) ? 'CAD' : null,
        effectiveRefundCents: null, remainingCostCents: null, settledBillingProof: null, reason: null};
    } catch (error) {return unknown(error instanceof ShipEngineHttpError && error.status === 404 ? 'provider_label_not_found_unknown' : 'provider_read_unknown');}
  }

  /** PUT /v1/labels/{label_id}/void, once only. No advertised idempotency key
   * or automatic retry. The native caller reserves and marks escaped first. */
  async voidLabelForLifecycle(labelId: string): Promise<LabelVoidObservation> {
    const requestedAtMs = Date.now();
    const unknown = (): LabelVoidObservation => ({protocol: 'shipengine_label_void_response_v1', labelId, requestedAtMs,
      observedAtMs: Date.now(), source: 'exact_label_void_put', outcome: 'unknown', approved: null,
      message: null, reasonCode: null, refundStatus: null, effectiveRefundCents: null});
    if (!providerId(labelId)) return unknown();
    try {
      const raw = await this.request<any>('PUT', `/v1/labels/${encodeURIComponent(labelId)}/void`, undefined, false);
      const observedAtMs = Date.now();
      if (typeof raw?.approved !== 'boolean') return unknown();
      return {protocol: 'shipengine_label_void_response_v1', labelId, requestedAtMs, observedAtMs, source: 'exact_label_void_put',
        outcome: raw.approved ? 'approved' : 'refused', approved: raw.approved, message: labelText(raw.message, 2000),
        reasonCode: labelText(raw.reason_code, 200), refundStatus: null, effectiveRefundCents: null};
    } catch(error) {if(error instanceof FinancialRecoveryBlocked)throw error;return unknown();}
  }

  /** Read the saved label and track that same label. Never follow a webhook's
   * resource_url or infer an order identity from a tracking number alone. */
  async getQualifiedTracking(transactionId: string, data: FirebaseFirestore.DocumentData, leg: TrackingLeg,
    read: {readId: string; version: number}): Promise<QualifiedTracking> {
    const identity = trackingIdentity(transactionId, data, leg);
    if (!identity) throw new Error('tracking_saved_identity_unqualified');
    const requestedAtMs = Date.now();
    const simulated = devShippingOrder(data);
    if (identity.carrierCode === 'seconde_dev' && (!simulated || !devShippingId(identity.labelId))) throw new Error('tracking_simulation_source_unqualified');
    const label = await this.request<any>('GET', `/v1/labels/${encodeURIComponent(identity.labelId)}?label_download_type=url`);
    if (label?.label_id !== identity.labelId || label.status !== 'completed' || label.voided !== false ||
        label.is_return_label !== (leg === 'return') || label.tracking_number !== identity.trackingNumber ||
        label.carrier_code !== identity.carrierCode || !providerId(label.shipment_id) ||
        identity.shipmentId != null && label.shipment_id !== identity.shipmentId ||
        identity.carrierId != null && label.carrier_id !== identity.carrierId || identity.serviceCode != null && label.service_code !== identity.serviceCode)
      throw new Error('tracking_label_identity_contradictory');
    const raw = await this.request<any>('GET', `/v1/labels/${encodeURIComponent(identity.labelId)}/track`);
    if (simulated && (label.simulation?.protocol !== DEV_SHIPPING_PROTOCOL || raw.simulation?.protocol !== DEV_SHIPPING_PROTOCOL))
      throw new Error('tracking_simulation_source_unqualified');
    if (raw?.tracking_number !== identity.trackingNumber || raw.carrier_code != null && raw.carrier_code !== identity.carrierCode ||
        !['UN', 'AC', 'IT', 'DE', 'EX', 'AT', 'NY', 'SP'].includes(raw.status_code) || !Array.isArray(raw.events) || raw.events.length > 1000 ||
        raw.events.some((event: any) => !event || typeof event.occurred_at !== 'string')) throw new Error('tracking_response_unqualified');
    const labelCreatedAtMs = providerUtc(label.created_at);
    if (labelCreatedAtMs == null || labelCreatedAtMs > Date.now()) throw new Error('tracking_label_time_unqualified');
    if (raw.events.some((event: any) => providerUtc(event.occurred_at) == null || providerUtc(event.occurred_at)! > Date.now()) ||
        raw.status_code === 'DE' && raw.actual_delivery_date != null && providerUtc(raw.actual_delivery_date) == null)
      throw new Error('tracking_response_time_unqualified');
    const normalized = raw.events.filter((event: any) => event.status_code === raw.status_code)
      .map((event: any) => providerUtc(event.occurred_at));
    const actualDelivery = raw.status_code === 'DE' ? providerUtc(raw.actual_delivery_date) : null;
    const matchingTimes = normalized.filter((time: number | null): time is number => time != null);
    let providerEventAtMs: number | null = actualDelivery ?? (matchingTimes.length ? Math.max(...matchingTimes) : null);
    let providerEventTimeSource: QualifiedTracking['proof']['providerEventTimeSource'] = actualDelivery != null ? 'actual_delivery_date' : providerEventAtMs != null ? 'normalized_event' : null;
    // An event's description/local carrier time cannot supply the missing code
    // or UTC timestamp. A conflicting later normalized status is ambiguous.
    if (normalized.some((time: number | null) => time == null) || actualDelivery != null && matchingTimes.length && Math.max(...matchingTimes) !== actualDelivery ||
        raw.events.some((event: any) => typeof event.status_code === 'string' && event.status_code !== raw.status_code &&
          (providerUtc(event.occurred_at) ?? -1) >= (providerEventAtMs ?? Infinity))) {
      providerEventAtMs = null; providerEventTimeSource = null;
    }
    if (providerEventAtMs == null && ['AC', 'IT', 'AT', 'SP', 'EX'].includes(raw.status_code) &&
        !raw.events.some((event: any) => providerUtc(event.occurred_at)! >= labelCreatedAtMs))
      throw new Error('tracking_current_history_unqualified');
    const observedContentHash = createHash('sha256').update(JSON.stringify([raw.tracking_number, raw.status_code,
      raw.actual_delivery_date ?? null, raw.events.map((event: any) => [event.occurred_at, event.status_code ?? null,
        event.event_code ?? null, event.carrier_status_code ?? null])])).digest('hex');
    return {trackingNumber: raw.tracking_number, statusCode: raw.status_code,
      statusDescription: typeof raw.status_description === 'string' ? raw.status_description : '',
      ...(typeof raw.actual_delivery_date === 'string' ? {actualDeliveryDate: raw.actual_delivery_date} : {}),
      ...(typeof raw.estimated_delivery_date === 'string' ? {estimatedDeliveryDate: raw.estimated_delivery_date} : {}),
      events: raw.events.map((event: any) => ({occurredAt: event.occurred_at,
        description: typeof event.description === 'string' ? event.description : '',
        ...(typeof event.city_locality === 'string' ? {cityLocality: event.city_locality} : {}),
        ...(typeof event.state_province === 'string' ? {stateProvince: event.state_province} : {}),
        ...(typeof event.status_code === 'string' ? {statusCode: event.status_code} : {})})),
      proof: {schemaVersion: 1, provider: simulated ? 'seconde_dev_simulation' : 'shipengine', transactionId, leg,
        identitySource: simulated ? 'member_test_action' : 'saved_label_get_and_label_track',
        sourceHash: identity.sourceHash, labelId: identity.labelId, shipmentId: label.shipment_id, trackingNumber: identity.trackingNumber,
        carrierCode: identity.carrierCode, statusCode: raw.status_code, requestedAtMs, observedAtMs: Date.now(),
        providerLabelCreatedAtMs: labelCreatedAtMs, providerEventAtMs, providerEventTimeSource, providerRevision: null, observedContentHash,
        readId: read.readId, readVersion: read.version}};
  }

  async getTracking(
    carrierCode: string,
    trackingNumber: string
  ): Promise<ShipEngineTracking> {
    const response = await this.request<{
      tracking_number: string;
      status_code: string;
      status_description: string;
      estimated_delivery_date?: string;
      events: {
        occurred_at: string;
        description: string;
        city_locality?: string;
        state_province?: string;
      }[];
    }>('GET', `/v1/tracking?carrier_code=${carrierCode}&tracking_number=${trackingNumber}`);

    return {
      trackingNumber: response.tracking_number,
      statusCode: response.status_code,
      statusDescription: response.status_description,
      estimatedDeliveryDate: response.estimated_delivery_date,
      events: (response.events || []).map((e) => ({
        occurredAt: e.occurred_at,
        description: e.description,
        cityLocality: e.city_locality,
        stateProvince: e.state_province,
      })),
    };
  }

  // ===========================================================================
  // PUDO — Find nearby pickup/drop-off locations
  // ===========================================================================

  async findPUDOLocations(input: ServicePointLookupInput): Promise<ServicePointLookupResult> {
    const result = unqualifiedServicePointLookup('carrier_source_unknown', input.mode === 'list' ? input.radiusKm : null);
    // A postal code alone cannot select a carrier account or a service. This is
    // service-point discovery, not a directory of ordinary postal drop-off offices.
    if (!providerId(input.carrierId) || input.carrierId.length > 100 || !servicePointCode(input.serviceCode) || input.countryCode !== 'CA' ||
        (input.mode === 'detail' ? !servicePointText(input.servicePointId, 200) : input.mode !== 'list' ||
          !/^[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJKLMNPRSTVWXYZ]\d[ABCEGHJKLMNPRSTVWXYZ]\d$/.test(input.postalCode) ||
          !Number.isInteger(input.radiusKm) || input.radiusKm < 1 || input.radiusKm > 100)) return result;
    try {
      const carrier = await this.request<any>('GET', `/v1/carriers/${encodeURIComponent(input.carrierId)}`);
      result.carrierServiceObservedAt = new Date().toISOString();
      result.observedAt = result.carrierServiceObservedAt;
      if (!carrier || carrier.carrier_id !== input.carrierId || !servicePointCode(carrier.carrier_code) ||
          (carrier.connection_status !== undefined && carrier.connection_status !== 'approved') ||
          (carrier.errors !== undefined && (!Array.isArray(carrier.errors) || carrier.errors.length > 0)) ||
          !Array.isArray(carrier.services) || carrier.services.length >= 300 || !carrier.services.every((service: any) =>
            service?.carrier_id === input.carrierId && service.carrier_code === carrier.carrier_code && servicePointCode(service.service_code)) ||
          new Set(carrier.services.map((service: any) => service.service_code)).size !== carrier.services.length) return result;
      result.source = {carrierId: input.carrierId, carrierCode: carrier.carrier_code, serviceCode: input.serviceCode, countryCode: 'CA'};
      if (!carrier.services.some((service: any) => service.service_code === input.serviceCode)) {
        return {...result, status: 'unsupported', reason: 'carrier_service_not_available'};
      }
      result.capability.carrierService = 'native_observed';
      result.reason = 'provider_request_failed';
      // Official lookup: POST is read-only search, never a label purchase. A
      // successful endpoint response observes lookup access, not plan entitlement
      // or permission to use this point on an ordinary/pudo/FlexDelivery label.
      const response = input.mode === 'list' ? await this.request<any>('POST', '/v1/service_points/list', {
        address: {postal_code: input.postalCode, country_code: 'CA'},
        providers: [{carrier_id: input.carrierId, service_code: [input.serviceCode]}], radius: input.radiusKm, max_results: 20,
      }) : await this.request<any>('GET', `/v1/service_points/${encodeURIComponent(carrier.carrier_code)}/CA/${encodeURIComponent(input.servicePointId)}`);
      result.providerObservedAt = new Date().toISOString();
      result.observedAt = result.providerObservedAt;
      result.reason = 'provider_response_unknown';
      // No pagination/continuation contract is documented here. Never silently
      // turn a bounded or partial response into a complete or empty result.
      if (!response || typeof response !== 'object' || Array.isArray(response) ||
          ['total', 'total_count', 'total_pages', 'page', 'pages', 'links', 'pagination', 'next_cursor', 'has_more'].some(key =>
            Object.prototype.hasOwnProperty.call(response, key)) ||
          (input.mode === 'list' ? !Array.isArray(response.errors) || response.errors.length > 0 :
            response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length > 0))) return result;
      const points = input.mode === 'list' ? response.service_points : [response.service_point];
      if (!Array.isArray(points)) return result;
      if (points.length >= 20) return {...result, reason: 'result_limit_reached'};
      const locations = points.map(point => publicServicePoint(point, input, carrier.carrier_code));
      if (locations.some(location => location === null) || new Set(locations.map(location => location?.locationId)).size !== locations.length) return result;
      return {...result, status: locations.length ? 'qualified_results' : 'qualified_empty', success: true, reason: null,
        locations: locations as PUDOLocation[], capability: {...result.capability, lookup: 'observed_response'},
        limits: {...result.limits, completeness: 'within_response_bound'}, observedAt: new Date().toISOString()};
    } catch {
      // A refusal (including plan restrictions), 404, timeout, or parse failure
      // proves neither unsupported service nor absence of nearby points.
      return {...result, observedAt: new Date().toISOString()};
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Build a public tracking URL for the customer
   */
  private getTrackingUrl(carrierCode: string, trackingNumber: string): string {
    const urls: Record<string, (tn: string) => string> = {
      intelcom_ca: (tn) =>
        `https://www.intelcom.ca/en/tracking?tracking-number=${tn}`,
      canada_post: (tn) =>
        `https://www.canadapost-postescanada.ca/track-colis/en#/search?searchFor=${tn}`,
      ups_ca: (tn) =>
        `https://www.ups.com/track?tracknum=${tn}&loc=en_CA`,
    };

    const builder = urls[carrierCode];
    const encodedTracking = encodeURIComponent(trackingNumber);
    return builder
      ? builder(encodedTracking)
      : `https://track.shipengine.com/${encodedTracking}`;
  }

  /**
   * Map ShipEngine status codes to our internal status codes
   */
  static mapStatus(shipEngineStatus: string): string {
    const map: Record<string, string> = {
      UN: 'UNKNOWN',
      AC: 'TRANSIT',
      IT: 'IN_TRANSIT',
      DE: 'DELIVERED',
      // Provider EX is Exception, not a terminal failure or a lost parcel.
      EX: 'EXCEPTION',
      AT: 'DELIVERY_ATTEMPT',
      SP: 'DELIVERED_TO_SERVICE_POINT',
      // Not Yet in System provides no qualified carrier acceptance/scan.
      NY: 'UNKNOWN',
    };
    return map[shipEngineStatus] || 'UNKNOWN';
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let shipEngineClient: ShipEngineClient | null = null;
let shipEngineClientIdentity: string | null = null;

export const getShipEngine = (): ShipEngineClient | null => {
  if (process.env.FINANCIAL_RECOVERY_ENVIRONMENT === 'unconfigured') return null;
  const apiKey = process.env.SHIPENGINE_API_KEY;
  const baseUrl =
    process.env.SHIPENGINE_BASE_URL || 'https://api.shipengine.com';

  if (!apiKey || !shipEngineKeyAllowed(apiKey)) return null;
  const identity = `${apiKey}:${baseUrl}`;
  if (!shipEngineClient || shipEngineClientIdentity !== identity) {
    shipEngineClient = new ShipEngineClient({ apiKey, baseUrl });
    shipEngineClientIdentity = identity;
  }

  return shipEngineClient;
};

export { ShipEngineClient };
