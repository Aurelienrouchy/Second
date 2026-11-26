/** Moderation evidence stays private to its authorized audience. */
import type {AdminMessageReportEvidence} from './messageReportEvidence';
import type {ProductReviewEvidenceReference} from './productReviewEvidence';
import type {ProductReviewWorkflowPreviewV2} from './productReview';
export type ArticleModerationAction = 'hold' | 'reject';
export type ReportOutcome = 'reviewed' | 'resolved' | 'dismissed';
export interface OwnerArticleDecision {
  id: string; action: ArticleModerationAction | 'approve'; status: string; ownerMessage: string;
  decidedAt: string | null; appealStatus: string | null; appealReceivedAt: string | null;
  favorableRecorded?: boolean; listingReactivated?: boolean; availabilityPermissionGranted?: false; availabilityBlockers?: string[];
  reviewedAppealId?: string | null; remainingRestrictionCount?: number | null;
  liftedDecision?: {id: string; action: ArticleModerationAction; ownerMessage: string | null; decidedAt: string | null; sourceQualified: boolean} | null;
  currentListingState?: {isActive: boolean | null; isSold: boolean | null; moderationStatus: string | null};
}
export interface OwnerDecisionResponse { ok: true; articleId: string; decision: OwnerArticleDecision | null }
export interface ArticleAppealInput {
  operation: 'contestArticleDecision'; articleId: string; decisionId: string; requestId: string; reason: string;
}
export interface ArticleAppealResponse extends OwnerDecisionResponse {
  appealId: string; recorded: true; replay: boolean;
}
export interface ArticleAppealAttempt { uid: string; articleId: string; payload: ArticleAppealInput; receipt?: ArticleAppealResponse }
export interface AdminArticleReview {
  articleId: string; ownerId: string | null; revision: string; moderationStatus: string | null;
  isActive: boolean | null; decisionSource: string | null;
  currentDecision: { id: string; action: ArticleModerationAction | 'approve'; ownerMessage: string; evidenceReferences: string[]; appealStatus: string | null } | null;
}
export interface AdminModerationReport {
  id: string; revision: string; reporterId: string | null; reporterName: string | null;
  targetType: string | null; targetId: string | null; targetOwnerId: string | null; reason: string | null;
  description: string | null; status: string; createdAt: string | null; articleReview: AdminArticleReview | null;
  ownerAppeal: { appealId: string; ownerId: string; reason: string; decisionId: string; receivedAt: string | null } | null;
  messageEvidence?: AdminMessageReportEvidence | null;
}
export interface AdminReportsResponse { ok: true; reports: AdminModerationReport[]; count: number }
export interface ArticleReportDecision {
  action: ArticleModerationAction; expectedArticleRevision: string; expectedReportRevision: string;
  expectedOwnerId: string; ownerMessage: string; evidenceReferences: string[];
}
export interface TriageReportInput { reportId: string; outcome: ReportOutcome; resolution?: string; articleDecision?: ArticleReportDecision }
export interface TriageReportResponse {
  ok: true; reportId: string; status: string; decisionId: string | null; replay: boolean; superseded: boolean; currentStatus: string;
  noticesPending?: boolean;
}
export interface OwnerModerationArticle { id: string; title: string; isActive: boolean; moderationStatus: string | null; moderationSource: string | null }
export interface OwnerModerationArticlePage { items: OwnerModerationArticle[]; cursor: string | null; hasMore: boolean }

export interface PartyOrderModeration {
  articleId: string; decisionId: string | null; action: 'pause' | 'continue'; message: string;
  instructionId: string | null; decidedAt: string | null; progressAllowed: boolean; additionalReviewRequired: boolean;
}
export interface PartyOrderModerationResponse { ok: true; transactionId: string; moderation: PartyOrderModeration | null }
export interface AdminOrderModeration {
  articleId: string; decisionId: string | null; sourceQualified: boolean; action: 'pause' | 'continue';
  message: string; instructionId: string | null; decidedAt: string | null; otherBlockers: string[];
}
export interface ModeratedOrder {
  id: string; revision: string; articleId: string; buyerId: string | null; sellerId: string | null;
  status: string | null; deliveryType: string | null; paymentEvidence: boolean; fundsReleased: boolean;
  hasLabel: boolean; moderation: AdminOrderModeration | null;
}
export interface ModeratedOrdersPage {
  ok: true; articleId: string; decisionId: string; orders: ModeratedOrder[]; nextCursor: string | null; noticesPending: boolean;
}
export interface LegacyOrderModerationInput {
  operation: 'reviewOrderModeration'; expectedAdminUid: string; transactionId: string; requestId: string;
  expectedOrderRevision: string; expectedArticleDecisionId: string; action: 'pause' | 'continue';
  message: string; authorityNote: string; evidenceReferences: string[];
}
export interface LegacyOrderModerationReceipt {
  ok: true; transactionId: string; instructionId: string; replay: boolean; superseded: boolean; moderation: AdminOrderModeration | null;
}
export interface OrderContinuationProof {
  protocol: 'order_moderation_continuation_proof_v1'; sourceHash: string; stableOrderHash: string;
  caseId: string; caseVersion: number; caseSourceHash: string; corpusHash: string; technicalQualificationOnly: true;
}
export interface OrderContinuationPreview {
  protocol: 'order_moderation_continuation_preview_v1'; ownerId: string; transactionId: string; articleId: string;
  expectedOrderRevision: string; expectedArticleDecisionId: string | null; source: OrderContinuationProof | null;
  evidenceReferences: ProductReviewEvidenceReference[]; coverage: ProductReviewWorkflowPreviewV2['coverage'] | null; canContinue: boolean;
  humanCompetenceVerified: false; expertiseVerified: false; legalAuthorityVerified: false;
}
export interface OrderContinuationInput extends Omit<LegacyOrderModerationInput, 'evidenceReferences'> {
  capability: 'order_moderation_continuation_v1'; expectedUid: string; articleId: string;
  evidenceReferences: ProductReviewEvidenceReference[]; continuationProof: OrderContinuationProof | null;
}
export interface OrderContinuationReceipt {
  protocol: 'order_moderation_continuation_receipt_v1'; ownerId: string; transactionId: string; articleId: string; requestId: string;
  inputHash: string; instructionId: string; state: 'absent' | 'committed' | 'not_executed' | 'neutralized';
  recordedAt: string | null; reason: string | null; action: 'pause' | 'continue'; sourceBoundAtCommit: boolean;
  humanCompetenceVerified: false; expertiseVerified: false; legalAuthorityVerified: false;
}
export type OrderModerationInput = LegacyOrderModerationInput | OrderContinuationInput;
export type OrderModerationReceipt = LegacyOrderModerationReceipt | OrderContinuationReceipt;
export interface OrderModerationAttempt {
  uid: string; articleId: string; payload: OrderModerationInput; receipt?: OrderModerationReceipt; refusal?: { code: string };
}
export interface OrderNoticeContinuation { ok: true; articleId: string; decisionId: string; noticesPending: boolean; superseded: boolean }
export interface AdminModerationReference { articleId: string; decisionId: string }

export interface FavorableArticleInput {
  articleId: string; reportId: string; expectedOwnerId: string; expectedDecisionId: string; expectedModerationDecisionId: string;
  expectedArticleRevision: string; expectedReportRevision: string; expectedModerationRevision: string;
  expectedAppealId: string | null; expectedAppealRevision: string | null; requestId: string; action: 'approve';
  ownerMessage: string; authorityNote: string; evidenceReferences: string[];
}
export interface FavorableArticleSource extends Omit<FavorableArticleInput, 'requestId' | 'action' | 'ownerMessage' | 'authorityNote' | 'evidenceReferences'> {
  protocol: 'article_moderation_review_v1'; actorUid: string; restrictionEvidenceQualified: boolean;
  restriction: {action: ArticleModerationAction; ownerMessage: string | null; evidenceReferences: string[]; decidedAt: string | null};
  appeal: {id: string; status: string; reason: string | null; receivedAt: string | null} | null;
  listingReactivated: false; availabilityPermissionGranted: false;
}
export interface FavorableArticleReceipt {
  protocol: 'article_moderation_favorable_v1'; actorUid: string; articleId: string; reportId: string; ownerId: string;
  requestId: string; decisionId: string; payloadHash: string; outcome: 'approved' | 'not_executed' | 'unrecorded';
  favorableRecorded: boolean; decisionCommitted: boolean; intentionNeutralized: boolean; lateRequestBlocked: boolean;
  sourceExamined: boolean; listingReactivated: boolean; availabilityPermissionGranted: false; financialEffectsCommitted: false;
  orderProgressPermissionGranted: false; authenticityVerified: false; rightsVerified: false;
  notificationCommitted?: boolean; deviceDeliveryVerified?: false; readingVerified?: false;
  reason?: string | null; liftedDecisionId?: string | null; reviewedAppealId?: string | null; availabilityBlockers?: string[];
  remainingRestrictionDecisionIds?: string[]; ownerMessage?: string; decidedAt?: string | null; replay?: boolean; superseded?: boolean;
}
export interface FavorableArticleAttempt {version: 1; uid: string; payload: FavorableArticleInput}
