export interface AutomatedDecisionEntry {
  id: string; revision: string; sourceHash: string; transactionId: string | null; decisionType: string | null;
  criteria: Record<string, unknown>; result: string; executedAt: string | null; financialExecutionVerified: false;
}
export interface PurchaseAutomaticRefundDecision extends AutomatedDecisionEntry {
  protocol: 'purchase_automatic_refund_v1'; sourceKind: 'purchase'; automated: true;
  phase: 'reservation' | 'local_settlement'; refundIntentId: string;
  financialOutcome: {refundState: 'requested' | 'succeeded'; providerStatus: string | null;
    cardAmountCents: number | null; walletAmountCents: number | null; sellerDebitCents: number | null; reservedSellerCents: number;
    localSettlementRecorded: boolean; bankArrivalVerified: false};
}
export interface AutomatedDecisionLogPage { ok: true; protocol: 'automated_decision_log_v1'; ownerId: string; transactionId: string;
  entries: AutomatedDecisionEntry[]; count: number; hasMore: boolean; cursor: string | null;
  coverage: 'recorded_entries_only'; financialExecutionCoverageVerified: false; absenceOfDecisionVerified: false; completeHistory: false }

export interface OwnerAdmissionDecision extends Omit<AutomatedDecisionEntry, 'revision' | 'decisionType' | 'criteria'> {
  protocol: 'admission_refused_v1'; revision: string | null; transactionId: null; decisionType: 'admission_refused'; ownerId: string; userId: string;
  operation: 'acceptMeetupOffer' | 'proposeMultiSwap' | 'acceptSwap' | 'createArticle' | 'updateArticle' | 'relistArticle'; scope: 'buy' | 'sell' | 'swap'; policyVersion: string;
  reasons: string[]; messages: string[];
  criteria: { minimumAge: 18; ageSource: 'declared_profile'; ageVerified: false; ageCondition: 'missing' | 'invalid' | 'under18' | 'adult_declared';
    residenceRequirement: 'not_applied' | 'quebec_owner_declaration'; residenceVerified: false; restrictionDetailsDisclosed: false } & (
      {activityRequirement: 'not_required' | 'personal'; sellerRestriction?: never} |
      {activityRequirement: 'not_required'; sellerRestriction: 'no_declared_professionals'});
  sourceContext: {kind: 'meetup_offer'; chatId: string; messageId: string; articleId: string; offerSourceHash: string} |
    {kind: 'swap_proposal'; agreementSourceHash: string; ownArticleIds: string[]} | {kind: 'swap'; swapId: string; agreementSourceHash: string} |
    {kind: 'article_publication'; articleId: string; publicationRequestId: string; inputHash: string} |
    {kind: 'article_edit'; articleId: string; articleRevision: string; inputHash: string} |
    {kind: 'article_relist'; articleId: string; articleRevision: string; requestId: string; inputHash: string};
  automated: true; financialEffect: 'none'; admissionGranted: false;
}
export interface OwnerAdmissionRefusalsPage {
  ok: true; protocol: 'owner_admission_refusals_v1'; ownerId: string; entries: OwnerAdmissionDecision[];
  hasMore: boolean; cursor: string | null; unknownEntries: number; inspectedCount: number;
  coverage: 'recorded_entries_only'; financialExecutionCoverageVerified: false; absenceOfDecisionVerified: false; completeHistory: false; admissionGranted: false;
}
