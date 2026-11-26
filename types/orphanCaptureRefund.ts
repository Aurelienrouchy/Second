export const ORPHAN_CAPTURE_REFUND_CAPABILITY = 'orphan_capture_original_refund_v1' as const;

export interface OrphanCaptureRefundEffects {
  originalPaymentMethodOnly: true;
  orderCreated: false;
  walletEffect: false;
  stockEffect: false;
  bankArrivalVerified: false;
}
export interface OrphanCaptureRefundSource extends OrphanCaptureRefundEffects {
  protocol: 'orphan_capture_refund_source_v1'; operationId: string;
  paymentIntentId: string | null; chargeId: string | null; accountId: string | null; livemode: boolean | null;
  currency: 'CAD'; capturedCents: number | null; refundableCents: number | null;
  sourceHash: string; sourceRevision: string;
  state: 'available' | 'reserved' | 'outcome_unknown' | 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled' | 'unqualified';
  reason: string | null; canRefund: boolean; canResume: boolean;
}
export interface OrphanCaptureRefundPreview {
  protocol: 'orphan_capture_refund_preview_v1'; actorId: string; previewId: string; source: OrphanCaptureRefundSource;
}
export interface OrphanCaptureRefundCommand {
  operationId: string; previewId: string; sourceHash: string; sourceRevision: string;
  paymentIntentId: string; chargeId: string; amountCents: number; currency: 'CAD';
  statementVersion: typeof ORPHAN_CAPTURE_REFUND_CAPABILITY; acknowledged: true; note: string;
}
/** Opaque and separate from every older refund slot. No command or note survives locally. */
export interface OrphanCaptureRefundReference {uid: string; requestId: string; operationId: string; inputHash: string}
export interface OrphanCaptureRefundReceipt extends OrphanCaptureRefundEffects {
  protocol: 'orphan_capture_refund_receipt_v1'; actorId: string; requestId: string; commandId: string;
  operationId: string; inputHash: string;
  state: 'unrecorded' | 'not_executed' | 'reserved' | 'outcome_unknown' | 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';
  paymentIntentId: string | null; chargeId: string | null; refundId: string | null; amountCents: number | null;
  currency: 'CAD'; recordedAt: string | null; providerStatus: string | null; reason: string | null; nativeRecordPresent: boolean;
}
