import type { LateTransportRefundObservation, LateTransportScope } from './lateTransportIncident';
import type { SupportTransportSource } from './supportRequest';
import type { ProductReviewEvidenceReference } from './productReviewEvidence';
export const LATE_TRANSPORT_RECOVERY_CAPABILITY = 'late_transport_recovery_v1' as const;
export const RECOVERY_CRITERIA = ['article_identity', 'physical_availability', 'contradictions', 'restitution_context'] as const;
export type RecoveryCriterion = typeof RECOVERY_CRITERIA[number];
export type RecoveryPossession = 'held_by_me' | 'not_held_by_me' | 'unknown';
export type RecoveryRestitution = 'returned_to_seller_declared' | 'retained_by_buyer_declared' | 'not_returned_declared' | 'unknown';
export interface RecoveryEffects {
    financialEffectAuthorized: false;
    inventoryReleaseAuthorized: false;
    relistAuthorized: false;
    physicalPossessionCertified: false;
    legalOwnershipCertified: false;
}
export interface RecoverySourceTuple {
    sourceHash: string;
    semanticHash: string;
    orderRevision: string;
    incidentRevision: string;
    incidentHash: string;
    financialSourceHash: string;
    stateVersion: number;
    corpusHash: string | null;
    membersHash: string | null;
}
interface RecoveryCommon {
    transactionId: string;
    incidentId: string;
    source: RecoverySourceTuple;
}
export interface RecoveryStatement extends RecoveryCommon {
    action: 'statement';
    possession: RecoveryPossession;
    restitution: RecoveryRestitution;
    narrative: string;
    occurredAt: string | null;
}
export interface RecoveryAssessment {
    criterion: RecoveryCriterion;
    qualification: 'examined' | 'unknown';
    summary: string;
}
export interface RecoveryReview extends RecoveryCommon {
    action: 'retain_review' | 'complete_own_review';
    assessments: RecoveryAssessment[];
    privateReason: string;
    partyMessage: string;
    examinedCorpus: true;
}
export type RecoveryCommand = RecoveryStatement | RecoveryReview;
export interface RecoveryAttempt {
    version: 1;
    uid: string;
    scope: LateTransportScope;
    requestId: string;
    command: RecoveryCommand;
}
export interface RecoveryReceipt extends RecoveryEffects {
    protocol: 'late_transport_recovery_command_v1';
    actorId: string;
    requestId: string;
    command: RecoveryCommand;
    payloadHash: string;
    state: 'unrecorded' | 'committed' | 'not_executed';
    reason: string | null;
    entryId: string | null;
    entryHash: string | null;
    recordedAt: string | null;
}
export interface RecoveryDecision extends RecoveryEffects {
    entryId: string;
    contentHash: string;
    action: RecoveryReview['action'];
    partyMessage: string;
    recordedAt: string;
    qualification: 'native_current' | 'historical_or_changed';
    ownReviewComplete: boolean;
}
export interface RecoverySource extends RecoveryEffects {
    protocol: 'late_transport_recovery_source_v1';
    ownerId: string;
    transactionId: string;
    incidentId: string;
    articleId: string;
    source: RecoverySourceTuple;
    qualification: 'native_context' | 'unknown';
    statements: {
        role: 'buyer' | 'seller';
        actorId: string;
        entryId: string;
        contentHash: string;
        possession: RecoveryPossession;
        restitution: RecoveryRestitution;
        occurredAt: string | null;
        narrative: string | null;
        recordedAt: string;
        currentBusinessContext: boolean;
        statementVerified: false;
    }[];
    statementSetComplete: boolean;
    documentaryComplete: boolean;
    productReviewContext: {
        kind: 'order';
        id: string;
    };
    productReviewCaseId: string | null;
    evidenceReferences: ProductReviewEvidenceReference[];
    incident: SupportTransportSource;
    refundCurrentlyRecorded: LateTransportRefundObservation;
    canRecordStatementNow: boolean;
    canCompleteOwnReviewNow: boolean;
    criteria: RecoveryCriterion[];
    currentDecision: RecoveryDecision | null;
}
export type RecoveryHistoryEntry = {
    entryId: string;
    qualification: 'historical_unknown';
} | (RecoveryEffects & {
    entryId: string;
    contentHash: string;
    qualification: 'native_record';
    actorId: string;
    action: RecoveryCommand['action'];
    command: RecoveryCommand | null;
    partyMessage: string | null;
    recordedAt: string;
    currentPermissionGranted: false;
});
export interface RecoveryHistory extends RecoveryEffects {
    protocol: 'late_transport_recovery_history_v1';
    ownerId: string;
    transactionId: string;
    incidentId: string;
    source: RecoverySource;
    items: RecoveryHistoryEntry[];
    cursor: string | null;
}
export interface RecoveryPreview extends RecoveryEffects {
    protocol: 'late_transport_recovery_preview_v1';
    actorId: string;
    previewId: string;
    payloadHash: string;
    source: RecoverySource;
}
