import type { TransactionProblemReason } from './transactionProblem';
import type { ReactNode } from 'react';

export const COMMERCIAL_CLAIM_REVIEW_CAPABILITY = 'commercial_claim_review_v1' as const;
export interface CommercialClaimReviewEffects {
  financialEffectAuthorized: false; claimClosed: false; fundsReleased: false;
  inventoryPermissionGranted: false; legalDeadlineExtended: false; originalDecisionReversed: false;
}
export interface CommercialClaimReviewReference {entryId: string; contentHash: string}
export interface CommercialClaimReviewSourceReference {
  sourceHash: string; claimRevision: string; claimHash: string; reviewVersion: number;
  reviewHash: string; corpusHash: string; membersHash: string;
}
export interface CommercialClaimNewContribution {
  id: string; contentHash: string; topic: 'authenticity' | 'nonconformity';
  materialCapability?: 'product_review_material_v1'; parcelCapability?: 'product_review_parcel_v1';
}
export interface CommercialClaimReviewCommand {
  transactionId: string; claimId: string; action: 'withdraw_claim' | 'request_reexamination'; source: CommercialClaimReviewSourceReference;
  narrative: string; withdrawal: CommercialClaimReviewReference | null; newContribution: CommercialClaimNewContribution | null; acknowledged: true;
}
export interface CommercialClaimReviewAttempt {
  version: 1; uid: string; requestId: string; capability: typeof COMMERCIAL_CLAIM_REVIEW_CAPABILITY; command: CommercialClaimReviewCommand;
}
export interface CommercialClaimReviewReceipt extends CommercialClaimReviewEffects {
  protocol: 'commercial_claim_review_command_v1'; actorId: string; requestId: string; command: CommercialClaimReviewCommand;
  payloadHash: string; state: 'unrecorded' | 'committed' | 'not_executed'; reason: string | null;
  reference: CommercialClaimReviewReference | null; recordedAt: string | null;
}
export interface CommercialClaimReviewEntry extends CommercialClaimReviewEffects {
  reference: CommercialClaimReviewReference; claimId: string; action: CommercialClaimReviewCommand['action']; narrative: string;
  withdrawal: CommercialClaimReviewReference | null; newContribution: CommercialClaimNewContribution | null;
  recordedAt: string; originalClaimStatus: 'open' | 'resolved'; historicalOnly: true;
}
export interface CommercialClaimReviewCoverage {inspected: number; limit: 20; hasMore: boolean; exhaustiveHistoryVerified: false}
export type CommercialClaimSelection = {qualification: 'native_original_claim'; claimId: string; status: 'open' | 'resolved'; reason: TransactionProblemReason; createdAt: string} |
  {qualification: 'unknown'; claimId: string; status: null; reason: null; createdAt: null};
export interface CommercialClaimSelectionPage extends CommercialClaimReviewEffects {
  protocol: 'commercial_claim_review_claims_v1'; actorId: string; scope: 'own' | 'admin'; transactionId: string; items: CommercialClaimSelection[];
  nextCursor: {lastId: string} | null; coverage: CommercialClaimReviewCoverage;
}
export type CommercialClaimReviewHistoryItem = {qualification: 'native_recorded_entry'; entry: CommercialClaimReviewEntry} |
  {qualification: 'unknown'; entryId: string; entry: null};
export interface CommercialClaimReviewHistory extends CommercialClaimReviewEffects {
  protocol: 'commercial_claim_review_history_v1'; actorId: string; scope: 'own' | 'admin'; transactionId: string;
  items: CommercialClaimReviewHistoryItem[]; nextCursor: {lastId: string} | null; coverage: CommercialClaimReviewCoverage;
}
export interface CommercialClaimReviewSource extends CommercialClaimReviewEffects {
  protocol: 'commercial_claim_review_source_v1'; actorId: string; scope: 'own' | 'admin'; transactionId: string; claimId: string;
  qualification: 'native_original_claim' | 'unknown'; source: {
    reference: CommercialClaimReviewSourceReference; originalDisputeId: string; originalCreatedAt: string; currentStatus: 'open' | 'resolved';
    caseId: string; documentarySourceHash: string; materialCapability: 'product_review_material_v1'; parcelCapability: 'product_review_parcel_v1';
    initialResolution: {resolution: 'dismissed' | 'refunded' | 'buyer_upheld' | null; resolvedAt: string | null} | null;
    reviewState: 'unrecorded' | 'withdrawn' | 'reexamination_requested'; latestReference: CommercialClaimReviewReference | null;
    newContributionCandidates: CommercialClaimNewContribution[]; documentaryComplete: boolean; operatorAdmissionRequired: true;
  } | null;
}
export type CommercialClaimReauthentication = (props: {uid: string; sourceKey: string; disabled: boolean; onVerified: () => void; parcel?: boolean}) => ReactNode;
