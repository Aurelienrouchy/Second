export const HOLD_REVIEW_REASONS = [
  'commercial_dispute', 'delivery_correction', 'tracking_reconciliation', 'purchase_policy_reconciliation',
  'return_in_progress', 'bank_dispute', 'refund_reconciliation', 'label_reconciliation',
  'moderation_review', 'financial_source_reconciliation', 'dispute_date_unqualified',
] as const;
export type HoldReviewReason = typeof HOLD_REVIEW_REASONS[number];

export interface HoldReviewCursor {
  schemaVersion: 1;
  ownerId: string;
  scope: 'seller_sales';
  lastId: string;
}

/** An observation of a sale, never a current balance or a permission to release money. */
export interface HoldReview {
  protocol: 'hold_review_v1';
  observationId: string;
  reason: HoldReviewReason;
  observedAt: string;
  currentSourceMatches: boolean;
  amountCents: number | null;
  currency: 'CAD';
  amountBasis: 'observed_sale_hold';
  startedAt: string | null;
  initialDeadlineAt: string | null;
  startQualification: 'native_timestamp' | 'unknown';
  deadlineQualification: 'native_timestamp' | 'unknown';
  agingOpenedAt: string | null;
  operationalAgingThresholdMs: number | null;
  operationalThresholdExceeded: boolean | null;
  legalMaximumDeadlineAt: null;
  resolutionState: 'unknown';
  financialPermission: false;
  message: string;
  action: 'contactSupport';
}

export interface HoldReviewRow {
  transactionId: string;
  reviewQualification: 'observed' | 'absent' | 'unqualified';
  review: HoldReview | null;
}

export interface HoldReviewPage {
  protocol: 'seller_hold_reviews_v1';
  ownerId: string;
  scope: 'seller_sales';
  readAt: string;
  rows: HoldReviewRow[];
  nextCursor: HoldReviewCursor | null;
  coverage: {
    order: 'document_id_asc';
    inspectedCount: number;
    returnedCount: number;
    skippedOwnerSources: number;
    limit: 30;
    hasMore: boolean;
    pageEnded: boolean;
    immutableCapture: false;
    globalCoverage: false;
  };
  resolutionState: 'unknown';
  financialPermission: false;
}
