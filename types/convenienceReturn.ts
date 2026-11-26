export const CONVENIENCE_RETURN_CAPABILITY = 'convenience_return_v1' as const;
export const PRICED_CONVENIENCE_RETURN_CAPABILITY = 'convenience_return_v2' as const;
export type ConvenienceReturnCapability = typeof CONVENIENCE_RETURN_CAPABILITY | typeof PRICED_CONVENIENCE_RETURN_CAPABILITY;
export interface ConvenienceReturnEffects {
  fundsFrozen: false; financialEffectAuthorized: false; refundDecisionGranted: false;
  shippingPermissionGranted: false; costAllocation: 'instruction_required' | 'buyer_return_article_only';
}
export interface ConvenienceReturnAddress {
  name: string; addressLine1: string; addressLine2?: string; cityLocality: string;
  stateProvince: string; postalCode: string; countryCode: string; phone?: string; email?: string;
}
interface ConvenienceReturnTermsBase {
  transactionId: string; buyerId: string; sellerId: string;
  reason: 'change_of_mind'; articleId: string;
  article: {title: string; description: string} &
    ({saleUnit: 'single_article' | 'set_as_one'} | {listingContentVersion: 'listing_content_v1' | 'listing_content_v2'});
  route: {isReturn: true; shipFrom: ConvenienceReturnAddress; shipTo: ConvenienceReturnAddress;
    parcel: {weight: {value: number; unit: 'kilogram'}; dimensions: {length: number; width: number; height: number; unit: 'centimeter'}};
    carrierId: string; carrierCode: string; serviceCode: string; outboundLabelId: string};
  scope: 'whole_transaction';
  itemConformity: 'buyer_declared_conforming'; physicalConditionVerified: false;
}
export interface ConvenienceReturnTermsV1 extends ConvenienceReturnTermsBase {
  protocol: 'convenience_return_terms_v1'; costs: 'instruction_required'; refund: 'not_decided';
}
export interface ConvenienceReturnTermsV2 extends ConvenienceReturnTermsBase {
  protocol: 'convenience_return_terms_v2'; costs: 'buyer_pays_return';
  refund: {basis: 'article_price_only'; currency: 'CAD'; originalArticleCents: number;
    alreadyAllocatedArticleCents: number; maximumRemainingArticleCents: number;
    excluded: {outboundShippingCents: number; serviceFeeCents: number; serviceTaxCents: number};
    paymentAllocation: 'original_payment_sources_required'; execution: 'separate_native_instruction_required'};
  financing: 'instruction_required'; sellerReturnLabelDebitAuthorized: false;
}
export type ConvenienceReturnTerms = ConvenienceReturnTermsV1 | ConvenienceReturnTermsV2;
export interface ConvenienceReturnReference {
  proposalId: string; contentHash: string; termsProtocol: 'convenience_return_terms_v2';
}
/** A distinct, native quote fixes the deduction; the documentary V2 agreement is unchanged. */
export interface ConvenienceReturnFinancialTerms {
  protocol: 'convenience_return_cost_terms_v1'; transactionId: string; buyerId: string; sellerId: string; requestId: string;
  agreement: ConvenienceReturnReference; basisHash: string; cumulativeHash: string; grossArticleCents: number;
  returnLabelCostCents: number; netRefundCents: number; currency: 'CAD';
}
export const CONVENIENCE_RETURN_INCIDENT_CAPABILITY = 'convenience_return_incident_v1' as const;
export type ConvenienceReturnCloseBasis = 'native_before_purchase' | 'native_post_validation_rejected' | 'operator_platform_risk_assumption';
export interface ConvenienceReturnTerminal {
  kind: 'closed'; terminalId: string; returnRequestId: string; basis: ConvenienceReturnCloseBasis | 'owner_intent_not_deposited';
  providerOutcome: 'not_invoked' | 'validation_rejected' | 'unknown' | 'purchased_unfurnished'; platformAssumedRisk: boolean;
}
export interface ConvenienceReturnVariance {
  qualification: 'exact_provider_label'; actualProofHash: string; acceptedCostCents: number; actualCostCents: number;
  deductionCents: number; grossArticleCents: number; netRefundCents: number; platformVarianceCents: number; currency: 'CAD';
}
export interface ConvenienceReturnVarianceResolution extends Omit<ConvenienceReturnVariance, 'qualification'> {
  kind: 'variance_adopted'; resolutionId: string; financingTermsHash: string;
}
export interface ConvenienceReturnIncidentCommand {
  action: 'close_unfurnished_return' | 'adopt_label_cost_variance'; sourceHash: string; expectedVersion: number;
  returnRequestId: string; purchaseExternalId: string | null; quoteId: string | null; financingTermsHash: string | null;
  basis: ConvenienceReturnCloseBasis | null; actualProofHash: string | null; platformRiskAccepted: boolean; note: string; acknowledged: true;
}
export interface ConvenienceReturnIncidentAttempt {
  version: 1; uid: string; transactionId: string; requestId: string; capability: typeof CONVENIENCE_RETURN_INCIDENT_CAPABILITY;
  scope: 'operator'; payloadHash: string; command: ConvenienceReturnIncidentCommand;
}
export interface ConvenienceReturnIncidentEffects {financialEffectAuthorized: false; refundDecisionGranted: false; shippingPermissionGranted: false}
export interface ConvenienceReturnIncidentPreview extends ConvenienceReturnIncidentEffects {
  protocol: 'convenience_return_incident_preview_v1'; transactionId: string; ownerId: string; role: 'buyer' | 'seller' | 'operator';
  state: 'unfurnished' | 'label_ready' | 'closed' | 'unknown';
  source: {sourceHash: string; version: number; returnRequestId: string; purchaseExternalId: string | null; quoteId: string | null; financingTermsHash: string | null} | null;
  closeBasis: {nativeBeforePurchase: boolean; nativePostValidationRejected: boolean; operatorPlatformRiskAssumption: boolean};
  variance: ConvenienceReturnVariance | null; canClose: boolean; canAdopt: boolean; terminal: ConvenienceReturnTerminal | null;
}
export interface ConvenienceReturnIncidentReceipt extends ConvenienceReturnIncidentEffects {
  protocol: 'convenience_return_incident_receipt_v1'; transactionId: string; ownerId: string; requestId: string;
  command: ConvenienceReturnIncidentCommand; payloadHash: string; state: 'absent' | 'committed' | 'not_executed' | 'neutralized';
  recordedAt: string | null; reason: string | null; result: ConvenienceReturnTerminal | ConvenienceReturnVarianceResolution | null;
}
export interface ConvenienceReturnFinancialReference {
  protocol: 'convenience_return_financial_review_v1'; proposalId: string; agreementContentHash: string;
  requestId: string; financingTermsHash: string; receptionRequestId: string; receptionHash: string;
}
export interface ConvenienceReturnReceptionCommand {
  action: 'confirm_return_received'; sourceHash: string; returnRequestId: string; labelId: string; financingTermsHash: string;
  agreement: ConvenienceReturnReference; contentConforming: true; conditionsAcknowledged: true;
}
export interface ConvenienceReturnReceptionAttempt {
  version: 1; uid: string; transactionId: string; requestId: string; capability: typeof PRICED_CONVENIENCE_RETURN_CAPABILITY;
  command: ConvenienceReturnReceptionCommand; payloadHash: string;
}
export interface ConvenienceReturnReceptionEffects {financialEffectAuthorized: false; refundDecisionGranted: false; physicalContentsVerified: false}
export interface ConvenienceReturnReceptionPreview extends ConvenienceReturnReceptionEffects {
  protocol: 'convenience_return_reception_preview_v1'; transactionId: string; ownerId: string; role: 'buyer' | 'seller';
  state: 'none' | 'recorded' | 'unknown'; canConfirm: boolean;
  source: {sourceHash: string; returnRequestId: string; labelId: string; financingTermsHash: string; agreement: ConvenienceReturnReference} | null;
  reception: ConvenienceReturnFinancialReference | null;
}
export interface ConvenienceReturnReceptionReceipt extends ConvenienceReturnReceptionEffects {
  protocol: 'convenience_return_reception_receipt_v1'; transactionId: string; ownerId: string; requestId: string;
  command: ConvenienceReturnReceptionCommand; payloadHash: string; state: 'absent' | 'committed' | 'not_executed' | 'neutralized';
  recordedAt: string | null; reason: string | null; reception: ConvenienceReturnFinancialReference | null;
}
interface ConvenienceReturnCommandBase {
  action: 'request' | 'accept' | 'refuse'; sourceHash: string; expectedVersion: number;
  proposalId: string | null; conditionsAcknowledged: true;
}
export type ConvenienceReturnCommand = ConvenienceReturnCommandBase & ({termsProtocol?: never} | {termsProtocol: 'convenience_return_terms_v2'});
export interface ConvenienceReturnPreview extends ConvenienceReturnEffects {
  protocol: 'convenience_return_preview_v1' | 'convenience_return_preview_v2'; transactionId: string; ownerId: string; role: 'buyer' | 'seller';
  source: {sourceHash: string; version: number | null} | null;
  state: 'none' | 'pending' | 'accepted' | 'refused' | 'unknown'; sourceCurrentlyMatches: boolean;
  proposal: {proposalId: string; contentHash: string; terms: ConvenienceReturnTerms; requestedAt: string; respondedAt: string | null} | null;
  terms: ConvenienceReturnTerms | null; canRequest: boolean; canRespond: boolean;
}
export interface ConvenienceReturnReceipt extends ConvenienceReturnEffects {
  protocol: 'convenience_return_receipt_v1' | 'convenience_return_receipt_v2'; transactionId: string; ownerId: string; requestId: string;
  command: ConvenienceReturnCommand; payloadHash: string; state: 'absent' | 'committed' | 'not_executed' | 'neutralized';
  recordedAt: string | null; reason: string | null;
}
export interface ConvenienceReturnAttempt {
  version: 1; uid: string; transactionId: string; requestId: string;
  capability: ConvenienceReturnCapability; payloadHash: string; command: ConvenienceReturnCommand;
}
