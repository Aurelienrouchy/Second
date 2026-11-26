export type TrackingHistoryLeg = 'forward' | 'return';
export interface ObservedTrackingEvent {
  index: number; occurredAtUtc: string | null; occurredAtQualified: boolean; occurrenceSource: 'provider_occurred_at' | 'member_test_action' | null;
  statusCode: string | null; description: string | null; city: string | null; province: string | null;
  textTruncated: boolean; originalTextHash: string;
}
export interface ObservedTrackingCapture {
  captureId: string; sourceHash: string; readId: string; readVersion: number; displayHash: string; recordedAt: string; currentCapture: boolean;
  providerReadAt: string; providerEventAt: string | null; providerStatusCode: string; trackingStatus: string; statusDescription: string | null;
  statusDescriptionTruncated: boolean; estimatedDeliveryAtUtc: string | null; totalEvents: number;
  suppliedHistoryOnly: true; exhaustiveHistoryVerified: false; pickupAddress: null; pickupHours: null; pickupDeadline: null;
  pickupInstructions: null; pickupDetailsSource: 'not_provided_by_tracking_capture'; recipientReceiptVerified: false; financialEffectAuthorized: false;
}
export interface TrackingHistoryCursor {captureId: string; offset: number}
export interface TrackingHistoryPageReference {
  captureId: string; expectedSourceHash: string; expectedReadVersion: number; expectedDisplayHash: string; cursor: TrackingHistoryCursor;
}
export interface TrackingHistoryPage {
  protocol: 'tracking_history_v1'; ownerId: string; transactionId: string; leg: TrackingHistoryLeg;
  capture: ObservedTrackingCapture | null; reason: 'unrecorded' | null;
  events: {items: ObservedTrackingEvent[]; hasMore: boolean; cursor: TrackingHistoryCursor | null};
}
