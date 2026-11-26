import type { AdminProductFinancialReference } from './adminProductFinancial';
import type { ProductParcelAssessment, ProductParcelReason, ProductParcelStatement } from './productParcelReview';
import type { ProductReviewOutcome } from './productReview';
export const PARCEL_CLAIM_HISTORY_CAPABILITY = 'parcel_claim_history_v1' as const;
export interface ParcelClaimHistoryReference {
    transactionId: string;
    disputeId: string;
    sourceHash: string;
}
export interface ParcelClaimHistorySource extends ParcelClaimHistoryReference {
    protocol: 'parcel_claim_history_source_v1';
    orderRevision: string;
    orderSourceHash: string;
    claimRevision: string;
    claimSourceHash: string;
    qualification: 'native_selected_order_claim';
}
export interface ParcelClaimHistoryLimits {
    fraudEstablished: false;
    physicalReceiptVerified: false;
    rejectionPermissionGranted: false;
    financialPermissionGranted: false;
    inventoryPermissionGranted: false;
    bankArrivalVerified: false;
}
export type ParcelClaimOriginQualification = 'native_parcel_report_receipt' | 'native_order_report_receipt';
export interface ParcelClaimOrigin {
    qualification: ParcelClaimOriginQualification;
    kind: 'product_contribution' | 'report_intent';
    key: string;
    contributionId: string | null;
    contributionHash: string | null;
    requestId: string;
    recourseScope: 'parcel_investigation' | 'buyer_delivery' | 'seller_return_parcel' | 'order_problem';
    reportedAt: string;
    sameOriginAsSelected: boolean | null;
    retriesAreDistinctClaims: false;
}
export interface ParcelClaimProductIssue {
    qualification: 'unknown' | 'native_historical_issue';
    caseId: string;
    caseVersion: number | null;
    caseSourceHash: string | null;
    currentCorpusQualified: false;
    financialPermissionGranted: false;
    issue: {
        eventId: string;
        contentHash: string;
        caseVersion: number;
        result: ProductReviewOutcome;
        motivation: string | null;
        sourceHash: string;
        recordedAt: string | null;
        parcelAssessment: ProductParcelAssessment | null;
        scope: 'order_product_case';
        claimOriginIncluded: boolean | null;
        physicalFindingVerified: false;
    } | null;
}
export interface ParcelClaimDecision {
    decisionId: string;
    qualification: 'unknown' | 'native_historical_decision';
    kind: 'refund' | 'commercial_classification' | null;
    outcome: string | null;
    recordedAt: string | null;
    motivation: string | null;
    productReference: AdminProductFinancialReference | null;
    financialEffect: {
        qualification: 'native_refund_effect' | 'unknown';
        currency: 'CAD';
        totalCents: number | null;
        cardCents: number | null;
        walletCents: number | null;
        sellerDebitCents: number | null;
        refundIntentId: string | null;
        bankArrivalVerified: false;
    } | null;
}
export interface ParcelClaimHistoryEntry extends ParcelClaimHistoryLimits {
    disputeId: string;
    transactionId: string | null;
    qualification: ParcelClaimOriginQualification | 'unknown';
    source: {
        claimRevision: string;
        claimSourceHash: string;
        orderRevision: string | null;
        orderSourceHash: string | null;
    };
    claimOwnershipQualification: 'native_buyer_report' | 'unknown';
    reason: 'not_received_despite_delivered' | null;
    recordedAt: string | null;
    recordedAtQualification: 'native_timestamp' | 'unknown';
    origin: ParcelClaimOrigin | null;
    declaration: {
        qualification: 'native_actor_statement';
        contributionId: string;
        contentHash: string;
        receiptDeclared: ProductParcelStatement['receipt'];
        reasonDeclared: ProductParcelReason;
        observedAtDeclared: string | null;
        recordedAt: string | null;
        declarationIsPhysicalProof: false;
    } | null;
    carrierObservation: {
        qualification: 'native_current_observation' | 'unknown';
        labelId: string | null;
        statusCode: string | null;
        providerEventAtMs: number | null;
        observationIsPhysicalReceipt: false;
    };
    productReview: ParcelClaimProductIssue | null;
    decisions: {
        entries: ParcelClaimDecision[];
        coverage: {
            inspected: number;
            limit: 3;
            hasMore: boolean;
            legacyWithoutTargetField: 'unknown';
            exhaustiveDecisionsVerified: false;
        };
    };
    bank: {
        qualification: 'unknown';
        nativeMarkerPresent: boolean;
        commercialDecisionIsBankOutcome: false;
        bankSettlementVerified: false;
    };
}
export interface ParcelClaimHistoryPage extends ParcelClaimHistoryLimits {
    protocol: 'parcel_claim_history_page_v1';
    actorId: string;
    source: ParcelClaimHistorySource;
    selectedOrigin: {
        key: string;
        qualification: ParcelClaimOriginQualification;
    } | null;
    entries: ParcelClaimHistoryEntry[];
    nextCursor: {
        lastId: string;
    } | null;
    readAt: string;
    coverage: {
        inspected: number;
        limit: 10;
        hasMore: boolean;
        association: 'native_buyer_field_only';
        historicalWithoutBuyerField: 'unknown';
        reasonFilter: 'nonreceipt_or_unqualified';
        unknownRowsIncluded: true;
        exhaustiveHistoryVerified: false;
        totalClaims: null;
    };
    repetitionIsFraudEvidence: false;
}
