import type { CommercialClaimReviewReference } from './commercialClaimReview';
export const LATE_COMMERCIAL_CAPABILITY = 'late_commercial_recourse_v1' as const;
export type LateCommercialTopic = 'authenticity' | 'nonconformity';
export interface LateCommercialReference {capability: typeof LATE_COMMERCIAL_CAPABILITY; admissionId: string; contentHash: string}
export interface LateCommercialLink {
  protocol: 'late_commercial_support_link_v1'; transactionId: string; caseId: string; topic: LateCommercialTopic;
  contributionId: string; contributionHash: string; sourceHash: string;
  materialCapability?: 'product_review_material_v1'; parcelCapability?: 'product_review_parcel_v1';
}
export interface LateCommercialEffects {
  financialEffectAuthorized: false; fundsRecovered: false; faultEstablished: false;
  defectVerified: false; legalDeadlineExtended: false; inventoryPermissionGranted: false;
}
export interface LateCommercialSupportView {
  link: LateCommercialLink | null; qualification: 'native_support_link' | 'unknown';
  admissionGranted: false; financialEffectAuthorized: false;
}
export interface LateCommercialLinkSource extends LateCommercialEffects {
  protocol: 'late_commercial_link_source_v1'; actorId: string; link: LateCommercialLink; newAdmissionAllowed: false;
}
export type LateCommercialDecision = 'admit_examination' | 'retain_review' | 'refuse_admission';
export interface LateCommercialFinancialSituation {
  releaseQualification: 'native_release_movement' | 'unknown'; releasedAt: string | null; releasedAmountCents: number | null;
  currency: 'CAD' | null; amountBasis: 'historical_release_movement'; currentHeldAmountCents: null;
  currentAvailableAmountCents: null; withdrawalAttribution: 'unknown'; bankReceiptVerified: false;
}
export interface LateCommercialFinancialBasis {
  reference: LateCommercialReference; sourceHash: string; initialReceivedAtMs: number; financialSituation: LateCommercialFinancialSituation;
}
export interface LateCommercialSource {
  protocol: 'late_commercial_source_v1'; transactionId: string; supportRequestId: string; buyerId: string; sellerId: string;
  ticketRevision: string; ticketSourceHash: string; ticketVersion: number; initialReceivedAtMs: number;
  clockOriginSupportRequestId: string; discoveryDeclaredAt: string | null; link: LateCommercialLink;
  caseVersion: number | null; caseHash: string; membersHash: string; ledgerCoverage: 'bounded_complete' | 'unknown';
  ledgerHash: string; ledgerHashBasis: 'attributed_release_movements'; financialSituation: LateCommercialFinancialSituation; orderSemanticHash: string;
}
export interface LateCommercialPreview extends LateCommercialEffects {
  protocol: 'late_commercial_preview_v1'; actorId: string; transactionId: string; supportRequestId: string; sourceHash: string; source: LateCommercialSource;
  currentAdmission: LateCommercialReference | null; currentAdmissionQualification: 'unrecorded' | 'native_admission' | 'unknown';
  ticket: {version: number; narrative: string; latestClarification: string | null; discoveredAt: string | null};
  contributionReferences: {id: string; contentHash: string | null; qualification: 'native_contribution' | 'unknown'}[];
  options: LateCommercialDecision[];
}
interface LateCommercialCommandFields {
  transactionId: string; sourceHash: string; currentAdmission: LateCommercialReference | null;
  decision: LateCommercialDecision; reason: string; partyMessage: string; acknowledged: true;
}
export type LateCommercialCommand = LateCommercialCommandFields & ({supportRequestId: string; claimReexamination?: never} |
  {supportRequestId: null; claimReexamination: CommercialClaimReviewReference});
export interface LateCommercialAttempt {version: 1; uid: string; requestId: string; command: LateCommercialCommand}
export interface LateCommercialReceipt extends LateCommercialEffects {
  protocol: 'late_commercial_command_v1'; actorId: string; requestId: string; command: LateCommercialCommand; payloadHash: string;
  state: 'unrecorded' | 'committed' | 'not_executed'; reason: string | null; reference: LateCommercialReference | null;
  disputeId: string | null; recordedAt: string | null;
}
export interface LateCommercialEntry extends LateCommercialEffects {
  reference: LateCommercialReference; decision: LateCommercialDecision; partyMessage: string; reason?: string;
  supportRequestId: string | null; caseId: string; topic: LateCommercialTopic; contributionReference: {id: string; contentHash: string};
  claimReexamination?: CommercialClaimReviewReference; originalDisputeId?: string;
  initialReceivedAt: string; recordedAt: string; historicalOnly: true;
}
export interface CommercialClaimReexaminationPreview extends LateCommercialEffects {
  protocol: 'commercial_claim_reexamination_preview_v1'; actorId: string; transactionId: string; originalDisputeId: string;
  claimReexamination: CommercialClaimReviewReference; sourceHash: string;
  source: {protocol: 'commercial_claim_reexamination_basis_v1'; transactionId: string; claimId: string; buyerId: string; sellerId: string;
    claimRevision: string; claimHash: string; claimSnapshot: Record<string, unknown>; originClaim: Record<string, unknown>;
    reviewVersion: number; reviewHash: string; caseVersion: number | null; caseHash: string; membersHash: string;
    materialCapability: 'product_review_material_v1'; parcelCapability: 'product_review_parcel_v1'; orderSemanticHash: string;
    reexamination: CommercialClaimReviewReference; withdrawal: CommercialClaimReviewReference; link: LateCommercialLink;
    ledgerCoverage: 'bounded_complete' | 'unknown'; ledgerHash: string; ledgerHashBasis: 'attributed_release_movements';
    financialSituation: LateCommercialFinancialSituation; initialReceivedAtMs: number};
  currentAdmission: LateCommercialReference | null; currentAdmissionQualification: 'unrecorded' | 'native_admission' | 'unknown'; options: LateCommercialDecision[];
}
export interface LateCommercialNoticeReference {admissionId: string; contentHash: string; notificationId: string}
export type LateCommercialHistoryItem = {qualification: 'native_admission'; entry: LateCommercialEntry} | {qualification: 'unknown'; entryId: string; entry: null};
export interface LateCommercialHistory extends LateCommercialEffects {
  protocol: 'late_commercial_history_v1'; actorId: string; scope: 'own' | 'admin'; transactionId: string; items: LateCommercialHistoryItem[];
  nextCursor: {lastId: string} | null; coverage: {inspected: number; limit: 20; hasMore: boolean; exhaustiveHistoryVerified: false};
  notice?: {qualification: 'native_owner_notice'; notificationId: string; entry: LateCommercialEntry};
}
