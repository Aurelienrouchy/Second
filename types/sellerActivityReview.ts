import type {SellerActivityDateFact, SellerActivityFactsPage, SellerActivityItem} from './sellerActivityFacts';
export const SELLER_ACTIVITY_REVIEW_CAPABILITY = 'seller_activity_review_v1';
export const SELLER_ACTIVITY_REVIEW_CRITERIA_VERSION = 'seller_activity_human_examination_v1';
export const SELLER_ACTIVITY_REVIEW_CRITERIA_CODES = ['recorded_activity_clarification', 'declaration_consistency', 'source_unknowns_clarification', 'account_age_clarification'] as const;
export type SellerActivityCriterion = typeof SELLER_ACTIVITY_REVIEW_CRITERIA_CODES[number];
export interface SellerActivityAnchor {kind: 'order' | 'article'; id: string}
export interface SellerActivityPeriod {fromInclusive: string; toExclusive: string}
export interface SellerActivityReviewEffects {fraudEstablished: false; professionalClassification: null; taxRegistrationEstablished: false; financialEffect: 'none'; inventoryEffect: 'none'; automaticThresholdApplied: false}
export interface SellerActivityReviewedSource {
  anchor: SellerActivityAnchor & {sellerId: string; revision: string; sourceHash: string}; period: SellerActivityPeriod; cursor: string | null; eligibilityVersion: string;
  facts: {profile: {source: SellerActivityFactsPage['profile']['source']; recordedCreatedAt: SellerActivityDateFact;
    authCreatedAt: {qualification: 'native_auth_metadata' | 'unknown'; at: string | null; reason: string | null; source: 'firebase_auth'}};
    items: (SellerActivityItem & {periodMembership: 'inside' | 'outside' | 'unknown'})[]; pagination: SellerActivityFactsPage['pagination'];
    coverage: SellerActivityFactsPage['coverage'] & {period: SellerActivityPeriod; periodDateField: 'transactions.createdAt'; unknownDatesIncluded: true; periodCoverageVerified: false};
    activityDeclaration: {kind: 'personal' | 'professional' | null; qualification: 'recorded_declaration_only' | 'unknown'; legallyVerified: false; source: SellerActivityFactsPage['profile']['source']}};
}
export interface SellerActivityReviewPreview extends SellerActivityReviewedSource, SellerActivityReviewEffects {
  protocol: typeof SELLER_ACTIVITY_REVIEW_CAPABILITY; actorId: string; sellerId: string; readAt: string; sourceHash: string; criteriaVersion: typeof SELLER_ACTIVITY_REVIEW_CRITERIA_VERSION;
  criteria: {code: SellerActivityCriterion; label: string}[]; reviewScope: 'sell'; reviewRequiredByOperator: true;
}
export interface SellerActivityReviewCommand {anchor: SellerActivityAnchor; period: SellerActivityPeriod; cursor: string | null; expectedSourceHash: string; expectedEligibilityVersion: string;
  criteriaVersion: string; criteriaCodes: SellerActivityCriterion[]; ownerReason: string; internalNote: string | null}
export interface SellerActivityReviewAttempt {version: 1; uid: string; requestId: string; payloadHash: string}
export interface SellerActivityReviewReceipt extends SellerActivityReviewEffects {protocol: typeof SELLER_ACTIVITY_REVIEW_CAPABILITY; actorId: string; requestId: string; payloadHash: string;
  state: 'unrecorded' | 'committed' | 'not_executed'; committed: boolean; replay: boolean; reviewId: string | null; signalId: string | null; reason: string | null; recordedAt: string | null;
  notice: null | {notificationId: string; committedAt?: string; inAppCommitted: true; deviceDeliveryVerified: false; readingVerified: false}}
export interface SellerActivityAdminOrigin {protocol: typeof SELLER_ACTIVITY_REVIEW_CAPABILITY; sourceHash: string; criteriaVersion: string; criteriaCodes: string[]; signalIds: string[]; openedBy: string; reviewedSource: SellerActivityReviewedSource}
