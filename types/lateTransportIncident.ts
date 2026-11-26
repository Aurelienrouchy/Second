export type LateTransportScope = 'owner' | 'admin';
export interface LateTransportIncidentReference {
  kind: 'late_transport_incident'; transactionId: string; incidentId: string; incidentRevision: string; incidentHash: string;
  financialSourceHash: string; orderRevision: string;
}
export interface LateTransportRefundObservation {
  qualification: 'native_intent' | 'historical_unknown'; state: 'engaged' | 'unknown' | 'confirmed';
  intentId: string | null; requestedAt: string | null; fundsAppliedAt: string | null;
}
export interface LateTransportIncident {
  incidentId: string; leg: 'forward'; captureId: string; displayHash: string; trackingSourceHash: string;
  incidentRevision: string | null; incidentHash: string; financialSourceHash: string | null;
  providerStatusCode: 'IT' | 'DE'; providerObservedAt: string; providerOccurredAt: string | null; recordedAt: string;
  refund: LateTransportRefundObservation; temporalRelation: 'after_refund_request' | 'before_or_at_refund_request' | 'unknown';
  currentCapture: boolean; financialSourceCurrent: boolean; recipientReceiptVerified: false; bankReceiptVerified: false;
  financialEffectAuthorized: false; inventoryReleaseAuthorized: false; humanReviewRequired: true;
}
export interface LateTransportIncidentPage {
  protocol: 'late_transport_incident_v1'; ownerId: string; transactionId: string; sourceRevision: string | null;
  items: LateTransportIncident[]; cursor: string | null; hasMore: boolean;
}
