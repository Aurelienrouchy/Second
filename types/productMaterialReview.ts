export type ProductMaterialReason = 'wrong_item' | 'size_or_label' | 'attribute_mismatch' | 'undisclosed_defect' |
  'disclosed_wear_difference' | 'post_receipt_intervention' | 'contradictory_evidence';
export type ProductMaterialSizeSystem = 'EU' | 'US' | 'unknown';
export type ProductMaterialMeasurementUnit = 'cm' | 'mm' | 'in' | 'unknown';
export type ProductMaterialInterventionKind = 'washing' | 'cleaning' | 'repair' | 'alteration' | 'use' | 'other';
export type ProductMaterialReceivedScope = 'purchase_received' | 'return_received' | 'offered_item' | 'unknown';
export type ProductMaterialObservationKey = 'identity' | 'brand' | 'model' | 'sizeLabel' | 'labelText' |
  'condition' | 'defects' | 'alterations' | 'odour' | 'fitObserved';
export interface ProductMaterialMeasurement {name: string; value: string; unit: ProductMaterialMeasurementUnit; method: string | null}
export interface ProductMaterialObservation extends Record<ProductMaterialObservationKey, string | null> {
  sizeSystem: ProductMaterialSizeSystem | null; colors: string[] | null; materials: string[] | null;
  measurements: ProductMaterialMeasurement[] | null;
}
export interface ProductMaterialStatement {
  protocol: 'product_material_statement_v1'; reason: ProductMaterialReason;
  promised: ProductMaterialObservation; received: ProductMaterialObservation;
  chronology: {receivedAt: string | null; inspectedAt: string | null; complainedAt: string | null};
  interventions: {state: 'none_declared' | 'declared' | 'unknown'; entries: {kind: ProductMaterialInterventionKind;
    description: string; occurredAt: string | null; beforeObservation: string | null; afterObservation: string | null}[]};
  receivedScope?: ProductMaterialReceivedScope;
}
export interface ProductMaterialAttributes {
  brand: string | null; brandStatus: string | null; model: string | null;
  size: {value: string | null; system: 'US' | 'EU' | null; conversionVerified: false};
  colors: string[] | null; materials: string[] | null; hasKnownDefects: boolean | null; defectsDescription: string | null;
  hasAlterations: boolean | null; alterationsDescription: string | null; physicalFactsVerified: false;
}
export interface ProductMaterialSources {
  protocol: 'product_material_sources_v1';
  contract: {qualification: 'native_order_snapshot_recorded' | 'unknown'; content: ProductMaterialAttributes};
  currentListing: {qualification: 'current_listing_recorded' | 'unknown'; content: ProductMaterialAttributes};
  received: {qualification: 'unknown'; source: 'separate_participant_declaration'; physicalFactsVerified: false};
  currentListingSuppliesMissingContract: false; comparisonsCertified: false;
}
/** Draft IDs are private UI keys; they are omitted from native statement bodies. */
export interface ProductMaterialDateDraft {precision: 'unknown' | 'civil_day' | 'instant' | null; value: string}
export interface ProductMaterialMeasurementDraft {draftId: string; name: string; value: string; unit: ProductMaterialMeasurementUnit | null; method: string}
export interface ProductMaterialObservationDraft extends Record<ProductMaterialObservationKey, string> {
  sizeSystem: ProductMaterialSizeSystem | null; colors: string; materials: string; measurements: ProductMaterialMeasurementDraft[];
}
export interface ProductMaterialStatementDraft {
  reason: ProductMaterialReason | null; statement: string; promised: ProductMaterialObservationDraft; received: ProductMaterialObservationDraft;
  chronology: {receivedAt: ProductMaterialDateDraft; inspectedAt: ProductMaterialDateDraft; complainedAt: ProductMaterialDateDraft};
  interventions: {state: ProductMaterialStatement['interventions']['state'] | null; entries: {draftId: string;
    kind: ProductMaterialInterventionKind | null; description: string; date: ProductMaterialDateDraft;
    beforeObservation: string; afterObservation: string}[]};
  receivedScope?: ProductMaterialReceivedScope | null;
}
