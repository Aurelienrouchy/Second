import type { ProductRoutingStatementDraft } from './productRoutingReview';
import type {ProductMixedOrderDraft} from './productMixedOrders';
import type { ProductMaterialDateDraft } from './productMaterialReview';
export type ProductParcelLeg = 'forward' | 'return';
export type ProductParcelReason = 'loss_document' | 'parcel_damage' | 'return_parcel_integrity' | 'delivery_not_received' | 'delivery_location' | 'third_party_delivery' | 'deposit_disappearance' | 'mixed_order_observation';
export interface ProductParcelWeight {value: string | null; unit: 'g' | 'kg' | 'lb' | 'oz' | 'unknown'; method: string | null; source: 'actor_measurement' | 'carrier_document' | 'other_document' | 'unknown'; occurredAt: string | null; phase: 'before_shipping' | 'at_handover' | 'at_receipt' | 'after_opening' | 'unknown'}
export interface ProductParcelHandover {from: 'sender' | 'carrier' | 'recipient' | 'third_party' | 'unknown'; to: ProductParcelHandover['from']; occurredAt: string | null; observation: string | null; reference: string | null}
export interface ProductParcelStatement {
  protocol: 'product_parcel_statement_v1'; reason: ProductParcelReason; leg: ProductParcelLeg; labelId: string | null;
  receipt: 'received' | 'not_received' | 'unknown'; packaging: string | null; parcel: string | null; contents: string | null;
  seal: 'intact_declared' | 'broken_declared' | 'absent_declared' | 'unknown'; opening: 'opened_declared' | 'unopened_declared' | 'unknown';
  weights: ProductParcelWeight[]; handover: ProductParcelHandover[]; location: string | null;
  thirdParty: {recipient: 'declared_third_party' | 'unknown'; authorization: 'affirmed' | 'denied' | 'unknown'; signature: 'declared_present' | 'declared_absent' | 'unknown'; reference: string | null};
  deposit: {state: 'admitted' | 'contested' | 'unknown'; location: string | null; disappearanceAt: string | null};
  chronology: Record<'shippedAt' | 'deliveredAt' | 'receivedAt' | 'openedAt' | 'observedAt' | 'reportedAt', string | null>;
  lossDocument: {issuer: string | null; issuerRole: 'carrier' | 'insurer' | 'other' | 'unknown'; reference: string | null; issuedAt: string | null; labelId: string | null; conclusion: 'loss_declared' | 'investigation_pending' | 'other' | 'unknown'} | null;
  evidenceAvailability: 'available' | 'unavailable' | 'unknown'; evidenceLimitations: string | null;
}
export interface ProductParcelAssessment {
  protocol: 'product_parcel_assessment_v1'; leg: ProductParcelLeg; labelId: string | null;
  deliveryFinding: 'receipt_declared' | 'nonreceipt_declared' | 'contested' | 'unknown'; locationComparison: 'difference_documented' | 'no_difference_documented' | 'unknown';
  lossDocumentFinding: 'document_examined' | 'not_provided' | 'unknown'; parcelContentsFinding: 'observations_examined' | 'contested' | 'unknown';
  responsibility: 'not_determined' | 'separate_assessment_required'; costTreatment: 'no_cost_decision' | 'separate_financial_decision_required' | 'unknown';
  motivation: string; evidenceLimitations: string; availableSourcesOnlyAcknowledged: true;
}
export interface ProductParcelCorpusReview {protocol: 'product_parcel_corpus_review_v1'; integrityQualified: boolean; availableEvidenceComplete: boolean;
  evidenceAvailability: {contributionId: string; declared: ProductParcelStatement['evidenceAvailability']; nativeFileReceived: boolean}[];
  photoAbsenceDoesNotProveNonreceipt: true; observationsRemainUnverified: true}
export interface ProductParcelSources {
  protocol: 'product_parcel_sources_v1'; contractRoute: ProductParcelRoute; returnRoute: ProductParcelRoute;
  legs: {leg: ProductParcelLeg; qualification: 'native_current_label' | 'unknown'; identity: {leg: ProductParcelLeg; labelId: string; sourceHash: string; trackingNumber: string; carrierCode: string; shipmentId: string | null; carrierId: string | null; serviceCode: string | null} | null;
    labelHistoryReference: {caseId: string | null; entryId: string | null; contentHash: string | null} | null;
    tracking: {qualification: 'unknown'} | {qualification: 'native_current_capture'; captureId: string; displayHash: string; sourceHash: string; readVersion: number; providerStatusCode: string; providerEventAtMs: number | null; observedAt: string; suppliedHistoryOnly: true; recipientReceiptVerified: false};
    observation: {qualification: 'unknown'} | {qualification: 'native_current_observation'; statusCode: string; sourceHash: string; observedContentHash: string; providerEventAtMs: number | null}}[];
  parcelPossessionVerified: false; packageContentsVerified: false; massVerified: false; weightConversionApplied: false; recipientAuthorizationVerified: false;
  signatureIsAgreement: false; officialLossVerified: false; responsibilityEstablished: false; insurancePaymentPromised: false; recoveryOrInventoryPermissionGranted: false;
}
export interface ProductParcelRoute {qualification: 'native_contract_snapshot' | 'native_frozen_return_source' | 'unknown';
  origin: {city: string | null; province: string | null; country: string | null} | null; destination: ProductParcelRoute['origin']; sourceHash: string | null;
  parcel: {weight: {value: number | null; unit: 'gram' | 'kilogram' | 'ounce' | 'pound' | null}; dimensions: {length: number | null; width: number | null; height: number | null; unit: 'centimeter' | 'inch' | null}; measurementVerified: false} | null;
  exactAddressPrivate: true; profileAddressUsed: false}
export interface ProductParcelOperatorRoutes {protocol: 'product_parcel_operator_routes_v1'; sourceHash: string; corpusHash: string;
  contractRoute: ProductParcelPrivateRoute; returnRoute: ProductParcelPrivateRoute; destinationQualification: Record<ProductParcelLeg, 'native_exact_destination' | 'unknown'>;
  currentRoutes?: {leg: ProductParcelLeg; route: (Omit<ProductParcelPrivateRoute, 'qualification'> & {qualification: 'native_current_label_route' | 'unknown'; labelId: string | null}) | null; legacyContractSuppliesCurrentRoute: false}[];
  exactAddressSource: 'private_native_route_capture'; profileAddressUsed: false; thirdPartyContactsSupplied: false; comparisonPermissionGranted: false;
  financialEffectAuthorized: false; inventoryEffectAuthorized: false; shippingPermissionGranted: false}
export interface ProductParcelPrivateRoute extends Omit<ProductParcelRoute, 'origin' | 'destination' | 'exactAddressPrivate' | 'profileAddressUsed'> {
  origin: {street: string | null; line2: string | null; city: string | null; province: string | null; postalCode: string | null; country: string | null} | null;
  destination: ProductParcelPrivateRoute['origin']}
type NullableChoices<T> = {[K in keyof T]: T[K] extends string ? T[K] | null : T[K]};
export interface ProductParcelStatementDraft extends Omit<NullableChoices<ProductParcelStatement>, 'protocol' | 'weights' | 'handover' | 'chronology' | 'deposit' | 'thirdParty' | 'lossDocument'> {
  statement: string;
  routingStatement?: ProductRoutingStatementDraft;
  mixedOrderStatement?: ProductMixedOrderDraft;
  weights: (Omit<NullableChoices<ProductParcelWeight>, 'occurredAt'> & {draftId: string; occurredAt: ProductMaterialDateDraft})[];
  handover: (Omit<NullableChoices<ProductParcelHandover>, 'occurredAt'> & {draftId: string; occurredAt: ProductMaterialDateDraft})[];
  chronology: Record<keyof ProductParcelStatement['chronology'], ProductMaterialDateDraft>;
  thirdParty: NullableChoices<ProductParcelStatement['thirdParty']>;
  deposit: Omit<NullableChoices<ProductParcelStatement['deposit']>, 'disappearanceAt'> & {disappearanceAt: ProductMaterialDateDraft};
  lossDocument: (Omit<NullableChoices<NonNullable<ProductParcelStatement['lossDocument']>>, 'issuedAt'> & {issuedAt: ProductMaterialDateDraft}) | null;
}
