import type { AdminProductFinancialReference } from '@/types/adminProductFinancial';
import type { AdminReturnToSenderFinancialReference, AdminReturnToSenderFinancialResume } from '@/types/adminReturnToSenderFinancial';
import type { AdminTransportFinancialReference } from '@/types/adminTransportFinancial';
import type {ConvenienceReturnFinancialTerms, ConvenienceReturnFinancialReference, ConvenienceReturnVarianceResolution} from '@/types/convenienceReturn';

export const PURCHASE_REFUND_COMPONENTS = ['articleCents', 'buyerFeeCents', 'shippingCents', 'gstCents', 'qstCents'] as const;
export type PurchaseRefundComponents = Record<typeof PURCHASE_REFUND_COMPONENTS[number], number>;
interface PurchaseRefundTermsBase {
  currency: 'CAD'; settlementKind: 'full_remaining' | 'partial' | 'retain_remaining';
  refund: PurchaseRefundComponents; retained: PurchaseRefundComponents; cardCents: number; walletCents: number;
  sellerDebitCents: number; platformArticleCostCents: number;
  articleHandling: 'keep_article' | 'return_separately'; caseHandling: 'settle_selected_case' | 'retain_review';
  paymentDeadline: {qualification: 'unknown'; date: null} | {qualification: 'declared_calendar_date'; date: string};
  provenance: {kind: 'in_app' | 'external_declared'; statement: string | null; evidenceReferences: {evidenceId: string; contentHash: string}[]};
}
export interface PurchaseRefundTermsV1 extends PurchaseRefundTermsBase {protocol: 'purchase_refund_terms_v1'}
export interface PurchaseRefundTermsV2 extends PurchaseRefundTermsBase {
  protocol: 'purchase_refund_terms_v2'; returnLabelDeduction: {protocol: 'buyer_return_label_deduction_v1'; financingTermsHash: string; requestId: string; amountCents: number};
}
export type PurchaseRefundTerms = PurchaseRefundTermsV1 | PurchaseRefundTermsV2;
export interface PurchaseRefundAgreementReference {agreementId: string; version: number; termsHash: string; acceptanceHash: string}
export interface PurchaseRefundReturnContext {protocol: 'purchase_refund_return_context_v1'; qualification: 'not_applicable' | 'unknown' | 'native_committed_return'; requestId: string | null; version: number | null; sourceHash: string | null}
export interface PurchaseRefundReturnDisposition {
  protocol: 'purchase_return_financial_review_v1'; requestId: string; sourceHash: string; caseId: string; issueId: string; issueHash: string; membersHash: string; authorizationSourceHash: string;
  arrivalAssessment: 'not_arrived_declared' | 'unknown'; motivation: string; financialTreatment: 'settle_return_commercially'; physicalContentsVerified: false; faultEstablished: false; costDecisionGranted: false;
}
export type PurchaseRefundAllocation = {protocol: 'purchase_refund_allocation_v1'; terms: PurchaseRefundTermsV1; basisHash: string; cumulativeHash: string; agreement: PurchaseRefundAgreementReference | null; returnDisposition?: PurchaseRefundReturnDisposition; reviewedDisputeId?: string} |
  {protocol: 'purchase_refund_allocation_v2'; terms: PurchaseRefundTermsV2; basisHash: string; cumulativeHash: string; agreement: null; convenienceReturn: ConvenienceReturnFinancialReference; returnDisposition?: never; reviewedDisputeId?: never};
export interface ConvenienceReturnFinancialSource {
  protocol: 'convenience_return_financial_source_v1'; qualification: 'native_received_return' | 'unknown';
  reference: ConvenienceReturnFinancialReference | null; financingTerms: ConvenienceReturnFinancialTerms | null; newRefundPermissionGranted: false;
  effectiveFinancingTerms?: ConvenienceReturnFinancialTerms | null; costResolution?: ConvenienceReturnVarianceResolution | null;
}
export interface PurchaseRefundEffects {financialEffectAuthorized: false; inventoryReleaseAuthorized: false; shippingPermissionGranted: false; physicalPossessionVerified: false; externalAuthenticityVerified: false; bankArrivalVerified: false}
export interface PurchaseRefundAgreementView extends PurchaseRefundEffects {
  protocol: 'purchase_refund_agreement_view_v1'; agreementId: string; contentHash: string; version: number; terms: PurchaseRefundTerms; termsHash: string;
  state: 'proposed' | 'refused' | 'withdrawn'; expiresAt: string | null; proposedAt: string; sourceHash: string; basisHash: string; cumulativeHash: string;
  sourceCurrentlyMatches: boolean; expired: boolean; buyerAcceptedRecorded: boolean; sellerAcceptedRecorded: boolean;
  consumption: {refundIntentId: string; decisionId: string; allocationReserved: true; moneyAppliedVerified: false} | null;
}
export interface PurchaseRefundReservedSource {
  protocol: 'purchase_refund_reserved_source_v1'; refundIntentId: string; refundAttemptId: string; terms: PurchaseRefundTerms;
  basisHash: string | null; cumulativeHash: string | null; sourceQualification: 'native_allocation_reservation' | 'unknown'; state: string;
  fundsAppliedRecorded: boolean; newRefundPermissionGranted: false; originalReservationPreserved: true; bankArrivalVerified: false;
  contexts: {returnToSender: AdminReturnToSenderFinancialReference | null; transportReview: AdminTransportFinancialReference | null; productReview: AdminProductFinancialReference | null};
  fixedMoney: {cardCents: number; walletCents: number; sellerDebitCents: number};
  allocation: PurchaseRefundAllocation; expectedDisputeId: string; authorizationDecisionId: string; bilateralAcceptance: PurchaseRefundAgreementReference | null; bilateralAgreementVerified: boolean;
}
export interface PurchaseRefundReturnReviewSource {protocol: 'purchase_refund_return_review_source_v1'; expectedDisputeId: string; qualification: 'native_current_documentary_source' | 'unknown'; returnContext: PurchaseRefundReturnContext; productReview: AdminProductFinancialReference | null; newRefundPermissionGranted: false; physicalPossessionVerified: false; faultEstablished: false; costDecisionGranted: false}
export interface PurchaseRefundSource extends PurchaseRefundEffects {
  protocol: 'purchase_refund_source_v1'; actorId: string; transactionId: string; sourceRevision: string | null; sourceHash: string | null;
  qualification: 'native_initial_and_cumulative' | 'unknown'; basisHash: string | null; cumulativeHash: string | null;
  initial: PurchaseRefundComponents | null; remaining: PurchaseRefundComponents | null; remainingCardCents: number | null; remainingWalletCents: number | null; remainingSellerCents: number | null;
  returnContext: PurchaseRefundReturnContext; agreement: PurchaseRefundAgreementView | null; bilateralAcceptance: PurchaseRefundAgreementReference | null;
  bilateralAgreementVerified: boolean; reservedRefund: PurchaseRefundReservedSource | null; returnReviewSource: PurchaseRefundReturnReviewSource | null;
  convenienceReturnSource?: ConvenienceReturnFinancialSource;
  allocationHistory: {qualification: 'native_bounded_set' | 'unknown'; entries: {refundIntentId: string; termsHash: string; terms: PurchaseRefundTerms; reservationRecorded: true; localMovementsVerified: boolean; settlementState: string; providerObservationState: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled' | null; bankArrivalVerified: false}[]; limit: 100; completeSet: boolean};
}
export interface PurchaseRefundAgreementPage extends Omit<PurchaseRefundSource, 'protocol'> {
  protocol: 'purchase_refund_agreements_page_v1'; entries: {id: string; view: PurchaseRefundAgreementView | null}[];
  nextCursor: {lastId: string} | null; inspected: number; hasMore: boolean;
}
export interface PurchaseRefundAgreementCommand {
  transactionId: string; action: 'propose' | 'accept' | 'refuse' | 'withdraw'; sourceHash: string; sourceRevision: string;
  agreementId: string | null; expectedVersion: number; termsHash: string; terms: PurchaseRefundTerms | null; expiresAt: string | null; acknowledged: true;
}
export interface PurchaseRefundAgreementAttempt {version: 1; uid: string; requestId: string; command: PurchaseRefundAgreementCommand}
export interface PurchaseRefundAgreementReceipt extends PurchaseRefundEffects {
  protocol: 'purchase_refund_agreement_command_v1'; actorId: string; requestId: string; command: PurchaseRefundAgreementCommand; payloadHash: string;
  state: 'unrecorded' | 'committed' | 'not_executed'; reason: string | null; agreementId: string | null; version: number | null; recordedAt: string | null;
}
export interface PurchaseRefundAllocationSource {
  reference: PurchaseRefundAllocation; basisHash: string; cumulativeHash: string; remaining: PurchaseRefundComponents;
  remainingCardCents: number; remainingWalletCents: number; remainingSellerCents: number; bilateralAgreementVerified: boolean;
  returnContext: PurchaseRefundReturnContext; returnFinanciallyExamined: boolean;
}
export interface PurchaseRefundPreviewContext {decisionContext: 'purchase_refund_allocation' | 'product_review' | 'return_to_sender_cases' | 'transport_review'; productReview?: AdminProductFinancialReference; transportReviewId?: string; resume?: AdminReturnToSenderFinancialResume}
