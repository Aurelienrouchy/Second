/** Canonical quote/reservation DTOs. Prices are dollars; componentsCents are cents. */
export type OrdinaryShippingAddressKind = 'ordinary_residential' | 'ordinary_business';
export interface OrdinaryShippingAddressDeclaration {
  schemaVersion: 1; policyVersion: 'ordinary_address_2026_01'; kind: OrdinaryShippingAddressKind; accepted: true; addressHash: string;
}
export interface OrdinaryShippingAddressUse {
  protocol: 'ordinary_shipping_address_use_v1'; policyVersion: 'ordinary_address_2026_01';
  origin: {kind: OrdinaryShippingAddressKind; source: 'seller_declared'; physicalSiteVerified: false; deliverabilityVerified: false};
  destination: {kind: OrdinaryShippingAddressKind; source: 'buyer_declared'; physicalSiteVerified: false; deliverabilityVerified: false};
}
export interface SellerShippingAddressObservation {
  protocol: 'seller_shipping_address_observation_v1'; ownerId: string; sourceHash: string; selectedIndex: number | null;
  qualification: 'not_recorded' | 'native_selected_address' | 'malformed_selected_address' | 'malformed_address_collection';
  selected: Record<string, unknown> | null; canEdit: boolean;
}
export interface ShippingPurchaseAddress {
  name: string; street: string; city: string; province: 'QC'; postalCode: string; country: 'CA'; line2?: string;
  /** NEW quote input only. Native canonical quote destinations omit this declaration. */
  shippingUseDeclaration?: OrdinaryShippingAddressDeclaration;
}
export interface ShippingPurchaseParcel {
  weight: { value: number; unit: 'kilogram' };
  dimensions: { length: number; width: number; height: number; unit: 'centimeter' };
}
export interface ShippingPurchaseRate {
  rateId: string; shipmentId: string; carrierId: string; carrierCode: string;
  carrierFriendlyName: string; serviceCode: string; serviceType: string;
  componentsCents: { shipping: number; insurance: number; confirmation: number; other: number };
  shippingCents: number; estimatedDeliveryDays: number | null; currency: 'CAD';
  shippingCost: number; amount: number; serviceFee: number; taxTotal: number; totalAmount: number;
}
export type ShippingTransportConfirmation = 'none' | 'delivery' | 'signature' | 'adult_signature' | 'direct_signature' | 'delivery_mailed' | 'verbal_confirmation';
export interface ShippingTransportInstruction {instructions: string; officialUrl: string}
export interface ShippingTransportLegTerms {
  confirmation: ShippingTransportConfirmation;
  handoff: ShippingTransportInstruction & {
    mode: 'ordinary_dropoff' | 'member_arranged_collection'; alternative: ShippingTransportInstruction | null;
    siteAvailabilityVerified: false; bookingVerified: false;
  };
}
/** Only the safe frozen clauses are public; documentary account/key/contract references are private. */
export interface ShippingTransportTerms {
  protocol: 'shipping_transport_terms_v1'; termsHash: string; policyVersion: string;
  testMode?: 'seconde_dev_commerce_v1';
  coverage: {
    currency: 'CAD'; declaredValueCents: number; coveredValueCents: number; maxCents: number; deductibleCents: number;
    beneficiary: 'seconde_operator' | 'seller' | 'buyer'; exclusions: string;
    insuranceProvider: 'carrier' | 'third_party' | 'none'; effectiveCoverageBasis: 'carrier_contract' | 'external_automatic_policy' | 'sandbox_simulation';
    providerCoverageApiVerified: false;
  };
  forward: ShippingTransportLegTerms; return: ShippingTransportLegTerms; accountIdentityApiVerified: false;
}
export interface ShippingTransportTermsObservation {
  protocol: 'shipping_transport_terms_observation_v1'; transactionId: string; ownerId: string;
  qualification: 'accepted_snapshot' | 'historical_terms_not_recorded' | 'unknown';
  terms: ShippingTransportTerms | null; purchasePolicyHash: string | null;
}
/** Native technical capture in CAD dollars; registration/exemption is not certified. */
export interface ServiceFeeTaxSnapshot {
  schemaVersion: 1; protocol: 'service_fee_tax_v1'; currency: 'CAD';
  taxableServiceFee: number; gst: number; qst: number; taxTotal: number;
  technicalConfiguration: {enabled: boolean; gstRate: number; qstRate: number}; registrationStatusVerified: false;
}
export interface ShippingPurchasePolicyV1 {
  schemaVersion: 1; policyVersion: 'shipping_purchase_2026_01'; quoteId: string; articleId: string;
  buyerId: string; sellerId: string; sourceHash: string;
  parameters: {fundsHoldMs: 604800000; deliveryProtectionMs: 604800000; nonShipmentMs: 604800000}; hash: string;
}
export interface ShippingPurchasePreparationTerms {
  pendingPayment: {durationMs: 3600000; startEvent: 'native_shipping_acceptance_validated_at'};
  labelAbandonment: {definitiveRejections: 4; countBasis: 'attributed_native_provider_rejections'};
}
export interface ShippingPurchasePolicyV2 extends Omit<ShippingPurchasePolicyV1, 'policyVersion'> {
  policyVersion: 'shipping_purchase_2026_02';
  preparationTerms: ShippingPurchasePreparationTerms;
}
export type ShippingPurchasePolicy = ShippingPurchasePolicyV1 | ShippingPurchasePolicyV2;
export interface ShippingPurchasePreparationObservation {
  protocol: 'purchase_preparation_policy_observation_v1'; transactionId: string; ownerId: string;
  qualification: 'accepted_v2_source' | 'historical_terms_not_recorded' | 'unknown';
  policyVersion: ShippingPurchasePolicy['policyVersion'] | null; policyHash: string | null;
  terms: ShippingPurchasePreparationTerms | null;
  pendingPayment: null | {clockBasis: 'native_shipping_acceptance_validated_at'; startsAtMs: number; expiresAtMs: number;
    windowHash: string; sourceHash: string; state: 'elapsed' | 'open'};
  labelAbandonment: null | {requiredDefinitiveRejections: 4; countBasis: 'attributed_native_provider_rejections';
    recordedDefinitiveRejections: number | null; latestAttemptId: string | null; rejectionSourceHash: string | null;
    rejectionsQualification: 'native_attributed_rejections' | 'not_qualified'};
  automatedEffectAuthorized: false; providerObserved: false; financialResolutionVerified: false;
}

export interface ShippingPurchaseQuote {
  quoteId: string; schemaVersion: 1; articleId: string; currency: 'CAD'; payable: true; negotiationSupported: boolean;
  /** Native accepted offer identity; absent on a catalog-price quote. */
  offer?: {messageId: string; chatId: string; amount: number};
  pricingVersion: 'shipping_purchase_pricing_v2'; taxSnapshot: ServiceFeeTaxSnapshot;
  destination: ShippingPurchaseAddress; item: Record<string, unknown>; originZone: { country: 'CA'; province: 'QC' };
  parcel: ShippingPurchaseParcel; measurementVerified: false; rates: ShippingPurchaseRate[];
  purchasePolicy: ShippingPurchasePolicy;
  /** New quote provenance; absent historical receipts/journals are never rewritten. */
  addressUse?: OrdinaryShippingAddressUse;
  /** Absent historical quotes remain absent; never reconstructed from a current carrier policy. */
  transport?: ShippingTransportTerms;
  acceptancePolicyVersion: 1; validityScope: 'new_reservation'; localValidityMs: 900000;
  issuedAt: number; validUntil: number; serverTime: number;
  expirationKnown: false; providerFreshnessVerified: false; labelPurchaseGuaranteed: false; requiresCurrentValidation: true;
}
export interface ShippingReservationInput {
  deliveryType: 'shipping'; quoteId: string; rateId: string; expectedTotal: number;
  /** Optional only for unchanged historical recovery tuples. A new request requires all four fields. */
  purchasePolicyAccepted?: true; expectedPurchasePolicyVersion?: ShippingPurchasePolicy['policyVersion']; expectedPurchasePolicyHash?: string;
  /** Present only when the accepted quote records public transport terms. Absent V1 stays absent. */
  expectedTransportTermsHash?: string;
  /** Exact local journal snapshot. This field is excluded from the callable payload. */
  purchasePolicy?: ShippingPurchasePolicy;
}
export interface ShippingReservationReceipt {
  success: true; transactionId: string; replay: boolean; paymentPermissionGranted: false; existingOrderOnly?: true;
  transportTermsHash?: string;
}
export interface ShippingReservationAttempt {
  version: 1; uid: string; articleId: string; destination: ShippingPurchaseAddress;
  input: ShippingReservationInput; receipt?: ShippingReservationReceipt;
}
export interface ShippingPurchasePolicyTimeline {
  schemaVersion: 1; qualification: 'accepted_snapshot' | 'historical_deadline_unknown_acceptance' | 'review_required';
  policyVersion: ShippingPurchasePolicy['policyVersion'] | null; policyHash: string | null; parameters: ShippingPurchasePolicy['parameters'] | null;
  acceptedAtMs: number | null; nonShipmentStartsAtMs: number | null; nonShipmentExpiresAtMs: number | null;
  paymentClockBasis: 'qualified_payment_recorded_at' | null; deliveryEventAtMs: number | null; deliveryRecordedAtMs: number | null;
  fundsReleaseAtMs: number | null; deliveryProtectionEndsAtMs: number | null;
  reviewRequired: boolean; reviewReason: string | null; externalRightsPreserved: true;
}
export interface ShippingPurchasePolicyObservation {transactionId: string; ownerId: string; purchasePolicy: ShippingPurchasePolicyTimeline}
