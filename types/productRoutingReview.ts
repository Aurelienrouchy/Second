import type { ProductMaterialDateDraft } from './productMaterialReview';
import type { ProductParcelLeg, ProductParcelOperatorRoutes } from './productParcelReview';
import type { ProductReviewEffects, ProductReviewScope, ProductReviewSourceV4, ProductReviewWorkflowPreviewV2 } from './productReview';
export const PRODUCT_ROUTING_CAPABILITY = 'product_review_routing_v1' as const;
export interface ProductRoutingPlace {
    country: string | null;
    province: string | null;
    city: string | null;
    postalCode: string | null;
    detail: string | null;
}
export interface ProductRoutingStatement {
    protocol: 'product_routing_statement_v1';
    leg: ProductParcelLeg;
    labelId: string | null;
    kind: 'transit_observation_only' | 'correction_reported' | 'destination_disputed' | 'unknown';
    phase: 'intermediate_transit' | 'delivery_attempt' | 'final_delivery' | 'unknown';
    correctionReported: 'declared_yes' | 'declared_no' | 'unknown';
    issuer: string | null;
    source: 'participant_observation' | 'carrier_message' | 'document_reference' | 'unknown';
    occurredAt: string | null;
    reference: string | null;
    previousPlace: ProductRoutingPlace | null;
    observedPlace: ProductRoutingPlace | null;
    evidenceAvailability: 'available' | 'unavailable' | 'unknown';
    evidenceLimitations: string | null;
}
export interface ProductRoutingStatementDraft {
    kind: ProductRoutingStatement['kind'] | null;
    phase: ProductRoutingStatement['phase'] | null;
    correctionReported: ProductRoutingStatement['correctionReported'] | null;
    issuer: string | null;
    source: ProductRoutingStatement['source'] | null;
    occurredAt: ProductMaterialDateDraft;
    reference: string | null;
    previousPlace: ProductRoutingPlace | null;
    observedPlace: ProductRoutingPlace | null;
    evidenceAvailability: ProductRoutingStatement['evidenceAvailability'] | null;
    evidenceLimitations: string | null;
}
export interface ProductRoutingQualification {
    routingFactsVerified: false;
    carrierCorrectionVerified: false;
    contractAddressChanged: false;
    interceptionPromised: false;
    physicalRecoveryVerified: false;
    routingReviewDoesNotApproveMoney: true;
}
export interface ProductRoutingCommand {
    context: {
        kind: 'order';
        id: string;
    };
    sourceHash: string;
    semanticSourceHash: string;
    corpusHash: string;
    membersHash: string;
    caseVersion: number;
    action: 'maintain_review' | 'routing_resolved_for_current_sources';
    routingFinding: 'correction_examined' | 'no_destination_error_established' | 'unresolved';
    destinationFinding: 'native_destination_examined' | 'unknown';
    contradictions: 'resolved_for_reviewed_sources' | 'unresolved' | 'unknown';
    privateNote: string;
    partyMessage: string;
    evidenceLimitations: string;
    acknowledged: true;
}
export interface ProductRoutingDecision extends ProductReviewEffects, ProductRoutingQualification {
    decisionId: string;
    contentHash: string;
    action: ProductRoutingCommand['action'];
    partyMessage: string;
    recordedAt: string;
    command?: ProductRoutingCommand;
    operatorId?: string;
}
export interface ProductRoutingPreview extends ProductReviewEffects, ProductRoutingQualification {
    protocol: 'product_routing_preview_v1';
    actorId: string;
    context: {
        kind: 'order';
        id: string;
    };
    scope: ProductReviewScope;
    caseId: string;
    source: ProductReviewSourceV4;
    sourceHash: string;
    semanticSourceHash: string;
    corpusHash: string;
    membersHash: string;
    caseVersion: number;
    guardQualification: 'native_current_routing_signals' | 'unknown';
    observations: {
        contributionId: string;
        contentHash: string;
        statement: ProductRoutingStatement;
    }[];
    nativeRoutes: ProductParcelOperatorRoutes | null;
    coverage: ProductReviewWorkflowPreviewV2['coverage'];
    canConsiderRoutingResolution: boolean;
    options: ProductRoutingCommand['action'][];
    currentDecision: {
        qualification: 'native_current_decision' | 'historical_sources_changed' | 'unknown' | 'unrecorded';
        decision: ProductRoutingDecision | null;
    };
    releaseAllowedByRoutingOnly: boolean;
}
export interface ProductRoutingReceipt extends ProductReviewEffects, ProductRoutingQualification {
    protocol: 'product_routing_command_v1';
    actorId: string;
    requestId: string;
    command: ProductRoutingCommand;
    payloadHash: string;
    caseId: string;
    decisionId: string | null;
    state: 'unrecorded' | 'committed' | 'not_executed';
    reason: 'requester_neutralized' | 'source_changed' | 'incomplete_routing_sources' | 'document_capacity_requires_review' | null;
    recordedAt: string | null;
    currentDecisionVerified: false;
}
export interface ProductRoutingAttempt {
    version: 1;
    uid: string;
    requestId: string;
    context: {
        kind: 'order';
        id: string;
    };
    command: ProductRoutingCommand;
    routingCapability: typeof PRODUCT_ROUTING_CAPABILITY;
    parcelCapability: 'product_review_parcel_v1';
}
export interface ProductRoutingHistory extends ProductReviewEffects, ProductRoutingQualification {
    protocol: 'product_routing_decisions_page_v1';
    actorId: string;
    scope: ProductReviewScope;
    caseId: string;
    entries: ({
        qualification: 'native_recorded_decision';
        decision: ProductRoutingDecision;
    } | {
        qualification: 'unknown';
        decisionId: string;
        decision: null;
    })[];
    nextCursor: {
        lastId: string;
    } | null;
    coverage: {
        inspected: number;
        limit: 20;
        hasMore: boolean;
        exhaustiveHistoryVerified: false;
    };
    currentDecisionVerified: false;
}
