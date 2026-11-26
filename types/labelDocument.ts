export type LabelDocumentDirection = 'forward' | 'return';
export interface LabelDocumentObservation {
  protocol: 'label_document_observation_v1'; ownerId: string; transactionId: string; direction: LabelDocumentDirection;
  labelId: string | null; sourceRevision: string | null; sourceHash: string;
  purchaseQualification: 'native_committed' | 'historical_unknown' | 'unqualified';
  observation: 'document_available' | 'provider_voided' | 'unknown' | 'needs_review';
  providerStatus: string | null; providerVoided: boolean | null; providerRevision: null;
  observedAtMs: number; providerCreatedAtMs: number | null; documentUrl: string | null; reason: string | null;
  labelUsability: 'not_certified' | 'provider_voided'; newPurchaseAuthorized: false;
}
export interface LabelDocumentSourceCheck {
  protocol: 'label_document_source_check_v1'; ownerId: string; transactionId: string; direction: LabelDocumentDirection;
  labelId: string | null; sourceRevision: string | null; sourceHash: string;
  purchaseQualification: 'native_committed' | 'historical_unknown' | 'unqualified';
  observation: 'source_matches' | 'source_changed'; documentUrl: null; newPurchaseAuthorized: false;
}
