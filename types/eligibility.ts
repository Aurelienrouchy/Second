/** Private callable DTOs. Foundations never grant final commerce permission. */
export type EligibilityScope = 'buy' | 'sell' | 'new_paid_shipping';
export type SellerActivityKind = 'personal' | 'professional';
export type EligibilityReviewKind = 'review' | 'date_of_birth_correction';
export type EligibilityReviewStatus = 'submitted' | 'needs_information' | 'approved' | 'rejected';
export type EligibilityOutcome = 'request_information' | 'reject' | 'approve_correction' | 'complete_review';
export interface DateOfBirthCopy { type: string; value: unknown; context?: 'sdk_observed_reference' }
export interface EligibilityDecision {
  scope: EligibilityScope; allowed: boolean;
  status: 'allowed' | 'incomplete' | 'blocked' | 'review_required';
  reasons: string[]; messages: string[]; policyVersion: string;
  civilDate: string | null; evaluationStage: 'foundations';
}
export interface OwnerEligibility {
  swapLaunch?: { policyVersion: '2026-10-17.v1'; allowed: boolean; reasons: string[]; messages: string[]; civilDate: string; residenceVerified: false };
  quebecResidenceStatementVersion?: '2026-10-17.v1';
  quebecResidenceStatement?: string;
  quebecResidenceDeclaration?: { version: string; ownerId: string; country: 'CA' | null; province: 'QC' | null;
    accepted: boolean | null;
    source: 'owner_declaration' | null; recordedAt: string | null; statement: string; residenceVerified: false } | null;
  accountClosure?: { newOperationsBlocked: boolean; deletionComplete: boolean;
    status: 'paused' | 'incomplete' | 'complete'; action: string | null } | null;
  version: string; policyVersion: string; statementVersion: string;
  statements: Record<SellerActivityKind, string>;
  dateOfBirth: string | null; dateOfBirthCopy: DateOfBirthCopy;
  dateOfBirthSource: 'declared_profile' | 'missing'; dateOfBirthVerified: false;
  firstDateOfBirthAction: 'recordSignupConsent'; initialDateRequiresTermsAndPrivacy: true;
  activityDeclaration: { kind: SellerActivityKind; statementVersion: string | null;
    statement: string | null; recordedAt: string | null; declarationVersion: number | null; legallyVerified: false } | null;
  sellerQuebecEvidence: { status: string; source: 'stripe_account_observed'; residenceVerified: false; observedAtMs: number | null } | null;
  /** Listing-only admission, independent of the activity declaration required by a sale agreement. */
  publication?: EligibilityDecision;
  decisions: Record<EligibilityScope, EligibilityDecision>;
}
export interface EligibilityReview {
  id: string; kind: EligibilityReviewKind; scope: EligibilityScope; status: EligibilityReviewStatus;
  requestVersion: number; policyVersion: string | null; reason: string | null;
  proposedDateOfBirth: string | null; originalDateOfBirth: string | null;
  originalDateOfBirthCopy: DateOfBirthCopy | null; correctedDateOfBirth: string | null;
  receivedAt: string | null; receivedCivilDate: string | null; statutoryDueDate: string | null;
  deadlineState: 'overdue' | 'answered' | 'pending' | 'not_applicable'; silenceEffect: 'refusal_not_permission' | null;
  ownerResponse: { text: string | null; legalBasis: string | null; recourse: string | null;
    respondedAt: string | null; respondedCivilDate: string | null; recordedAfterDueDate: boolean } | null;
  latestOwnerDetails: string | null; ownerDecisionReason: string | null;
  createdAt: string | null; updatedAt: string | null; decidedAt: string | null;
}
export interface AdminEligibilityReviewSummary extends EligibilityReview { ownerId: string }
export interface AdminEligibilityReview extends EligibilityReview { ownerId: string; internalNote: string | null; priorReviewId: string | null; sellerActivityReview?: import('./sellerActivityReview').SellerActivityAdminOrigin | null }
export interface AdminEligibilitySignal { scope: EligibilityScope | null; active: boolean | null; internalNote: string | null;
  actorUid: string | null; recordedAt: string | null; clearedBy: string | null; clearedAt: string | null; reviewId: string | null }
export interface EligibilityPage<T> { items: T[]; cursor: string | null; hasMore: boolean }
export interface EligibilityReviewDetail { request: EligibilityReview; eligibility: OwnerEligibility }
export interface AdminEligibilityRelatedSale {
  id: string; status: string | null; deliveryType: 'meetup' | 'shipping' | null; createdAt: string | null;
  sellerActivityAdmission?: SellerActivityAdmission;
}
export interface SellerActivityPageCursors {
  cursor?: string | null; relatedSalesCursor?: string | null; initiatedSwapsCursor?: string | null; receivedSwapsCursor?: string | null;
}
export interface GetAdminEligibilityReviewInput {
  reviewId: string; relatedSalesCursor?: string | null; activityHistoryCursor?: string | null;
  initiatedSwapsCursor?: string | null; receivedSwapsCursor?: string | null;
}
export interface AdminEligibilitySalesPage {
  cursor: string; ownerId: string; expectedVersion: string; expectedRequestVersion: number;
}
export interface AdminEligibilityReviewDetail {
  request: AdminEligibilityReview; eligibility: OwnerEligibility; signals: Record<string, AdminEligibilitySignal>;
  relatedSales: EligibilityPage<AdminEligibilityRelatedSale>;
  history?: SellerActivityHistoryPage;
  relatedSwaps?: {initiated: EligibilityPage<SellerActivityRelatedSwap>; received: EligibilityPage<SellerActivityRelatedSwap>};
}
export interface EligibilityRecorded { recorded: true; alreadyRecorded: boolean; eligibility: OwnerEligibility }
export interface SellerActivityReference {collection: 'eligibility_audit' | 'eligibility_profiles'; id: string}
export type SellerActivityOriginalCommand = Omit<DeclareSellerActivityInput, 'personalDeclarationAccepted'> & {personalDeclarationAccepted?: boolean | null};
export interface SellerActivityReceipt {
  protocol: 'seller_activity_declaration_v1'; qualification: 'native_original' | 'historical_incomplete';
  id: string; ownerId: string; actorUid: string | null; requestId: string | null; inputHash: string | null; receiptHash: string | null;
  command: SellerActivityOriginalCommand | null; statement: string | null; statementVersion: string | null; accepted: boolean | null;
  resultingDeclaration: {kind: SellerActivityKind; statementVersion: string; statement: string; ownerId: string; actorUid: string;
    accepted: true; personalDeclarationAccepted: boolean | null; recordedAt: string; recordedAtMs: number; declarationVersion: number;
    legalEffectiveDate: null; legallyVerified: false} | null;
  previous: {qualification: string; reference: SellerActivityReference | null; hash: string | null} | null;
  recordedAt: string | null; legalEffectiveDate: null; legallyVerified: false;
}
export interface SellerActivityAdmission {
  qualification: 'native_capture' | 'historical_incomplete'; protocol: 'seller_activity_admission_capture_v1';
  agreement: {kind: 'purchase' | 'swap'; id: string; phase?: 'shipping_reservation' | 'cash_agreement' | 'proposal' | 'acceptance'; sourceHash?: string | null};
  capturedAt: string | null; captureHash: string | null;
  parties: Array<{ownerId: string; activity: {kind: 'personal'; statementVersion: string | null; declarationVersion: number | null; recordedAt: string | null;
    qualification: string; reference: SellerActivityReference | null; hash: string | null; legalEffectiveDate: null; legallyVerified: false};
    admission: {scope: 'sell' | 'new_paid_shipping' | 'swap'; allowed: true; policyVersion: string}}>; legalEffectiveDate: null; legallyVerified: false;
}
export interface SellerActivityRelatedSwap {id: string; status: string | null; createdAt: string | null; acceptedAt: string | null;
  proposal: SellerActivityAdmission; acceptance: SellerActivityAdmission}
export interface SellerActivityHistoryPage extends EligibilityPage<SellerActivityReceipt> {coverage: 'owner_audit_page'}
export interface SellerActivityHistory {
  protocol: 'seller_activity_history_page_v1'; history: SellerActivityHistoryPage;
  relatedSales: EligibilityPage<AdminEligibilityRelatedSale>;
  relatedSwaps: {initiated: EligibilityPage<SellerActivityRelatedSwap>; received: EligibilityPage<SellerActivityRelatedSwap>};
  currentEligibility: OwnerEligibility;
}
export interface SellerActivityRecorded extends EligibilityRecorded {declarationReceipt: SellerActivityReceipt; currentEligibility: OwnerEligibility}
export interface EligibilityReviewRecorded extends EligibilityRecorded { request: EligibilityReview }
export interface DeclareSellerActivityInput { kind: SellerActivityKind; statementVersion: string;
  personalDeclarationAccepted: boolean; expectedVersion: string; requestId: string;
  expectedUid?: string;
  quebecResidenceDeclaration?: { version: '2026-10-17.v1'; country: 'CA'; province: 'QC'; accepted: boolean } }
export interface RequestEligibilityReviewInput { kind: EligibilityReviewKind; scope: EligibilityScope;
  proposedDateOfBirth?: string; reason: string; expectedVersion: string; requestId: string; priorReviewId?: string }
export interface AddEligibilityReviewDetailsInput { reviewId: string; details: string;
  expectedRequestVersion: number; expectedVersion: string; requestId: string }
export interface FlagEligibilityInput { ownerId: string; scope: EligibilityScope; internalNote: string; expectedVersion: string; requestId: string }
export interface DecideEligibilityReviewInput { reviewId: string; outcome: EligibilityOutcome; ownerReason: string;
  internalNote?: string; expectedVersion: string; expectedRequestVersion: number; clearSignalIds?: string[];
  requestId: string; legalBasis?: string; recourse?: string }
