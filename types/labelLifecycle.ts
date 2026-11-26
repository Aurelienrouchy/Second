export type LabelLifecycleLeg = 'forward' | 'return';
export type LabelLifecycleScope = 'own' | 'admin';
export interface LabelLifecycleContext {transactionId: string; leg: LabelLifecycleLeg}
export interface LabelLifecycleNotificationContext extends LabelLifecycleContext {routeAmendmentNotice?: {entryId: string; contentHash: string; notificationId: string}; parcelAmendmentCapability?: 'label_parcel_amendment_v1'}
export type LabelLifecycleAction = 'request_review' | 'stop_use' | 'maintain_review' | 'observe_provider' | 'void_label' | 'replacement_quote' | 'accept_replacement' | 'purchase_replacement' | 'adopt_replacement';
export interface LabelLifecycleEffects {
  shippingPermissionGranted: false; inventoryReleaseAuthorized: false; buyerFinancialEffectAuthorized: false;
  carrierRefundSettled: false; carrierPossessionVerified: false; interceptionGuaranteed: false;
}
export interface LabelLifecycleIdentity {
  labelId: string; direction: LabelLifecycleLeg; shipmentId: string; carrierId: string; carrierCode: string; serviceCode: string;
  rateId: string; trackingNumber: string | null; outboundLabelId: string | null; providerCreatedAtMs: number | null;
}
export interface LabelLifecycleSource extends LabelLifecycleContext, LabelLifecycleEffects {
  protocol: 'label_lifecycle_source_v1'; caseId: string; sourceHash: string; sourceRevision: string; semanticSourceHash: string;
  caseVersion: number | null; qualification: 'native_saved_label' | 'native_purchase_reconciliation' | 'unknown'; identity: LabelLifecycleIdentity | null;
  reconciliation: {labelPurchaseRequired: boolean; returnRequired: boolean; purchaseState: string | null};
  routeSourceHash: string | null; purchasePolicyHash: string | null; stopUse: boolean; latestInstructionId: string | null; currentLabelId: string | null;
}
export interface LabelReplacementReference {id: string; contentHash: string}
export interface LabelReplacementQuote extends LabelReplacementReference {
  costCents: number; currency: 'CAD'; rateId: string; shipmentId: string; routeSourceHash: string; purchasePolicyHash: string;
  oldLabelId: string; originalBuyerTotalCents: number; additionalBuyerChargeCents: 0; platformAuthorizationRequired: true; platformFundingGuaranteed: false;
}
export interface LabelLifecycleReplacement {
  qualification: 'unknown' | 'native_current_quote'; quote: LabelReplacementQuote | null; bothParticipantsAccepted: boolean; platformFundingGuaranteed: false;
}
export interface LabelLifecycleCurrentUse {
  qualification: 'unknown' | 'blocked' | 'native_current_sources'; canUseCurrentLabelNow: false; documentCurrentlyAvailable: false;
  nativeGuardsAllowUse: boolean; providerCurrentAvailability: 'unknown';
  lastRecordedDocumentObservation: null | {entryId: string; contentHash: string; labelId: string; observedAt: string; documentState: 'available'; providerVoided: false};
}
export interface LabelLifecycleCurrentInstruction {
  qualification: 'unrecorded' | 'unknown' | 'native_current_instruction' | 'historical_sources_changed';
  instruction: null | (LabelLifecycleEffects & {protocol: 'label_lifecycle_current_instruction_v1'; entryId: string; contentHash: string;
    action: 'stop_use' | 'maintain_review' | 'void_label' | 'adopt_replacement'; scopeAtRecording: LabelLifecycleScope; message: string; privateNote: string | null;
    recordedAt: string; appliesToCurrentSources: boolean});
}
export interface LabelLifecycleAvailability extends LabelLifecycleEffects {
  protocol: 'label_lifecycle_action_availability_v1'; preparationOnly: true; canRequestReviewNow: boolean; canStopUseNow: boolean;
  canMaintainReviewNow: boolean; canObserveProviderNow: boolean; canPrepareVoidCommandNow: boolean; canPrepareReplacementQuoteNow: boolean;
  canAcceptReplacementNow: boolean; canPreparePurchaseCommandNow: boolean; canPrepareAdoptionCommandNow: boolean;
  recentReauthenticationRequiredForProviderEffect: boolean; pendingProviderOperationRequiresReconciliation: boolean;
  platformCostCentsForPurchase: number | null; platformCostCentsForAdoption: number | null; platformAuthorizationStillRequired: true; providerApprovalGuaranteed: false;
}
export interface LabelLifecycleNoticeReference {entryId: string; noticeState: 'intent_reserved' | 'entry_recorded'}
export interface LabelLifecycleNotice extends LabelLifecycleEffects, LabelLifecycleNoticeReference {
  qualification: 'native_entry_recorded' | 'native_intent_reserved' | 'unknown';
  entry: null | {action: LabelLifecycleAction; message: string; recordedAt: string}; currentInstructionVerified: false;
}
export interface LabelLifecycleObservation extends LabelLifecycleEffects {
  protocol: 'label_lifecycle_source_observation_v1'; actorId: string; scope: LabelLifecycleScope; source: LabelLifecycleSource;
  replacement: LabelLifecycleReplacement; currentLabelUse: LabelLifecycleCurrentUse; currentInstruction: LabelLifecycleCurrentInstruction;
  notice: LabelLifecycleNotice | null; readAt: string;
}
export interface LabelLifecyclePreview extends LabelLifecycleEffects {
  protocol: 'label_lifecycle_preview_v1'; actorId: string; scope: LabelLifecycleScope; source: LabelLifecycleSource;
  options: LabelLifecycleAction[]; replacement: LabelLifecycleReplacement; commandPermissionGranted: false; additionalBuyerChargeAuthorized: false;
  currentLabelUse: LabelLifecycleCurrentUse; currentInstruction: LabelLifecycleCurrentInstruction; actionAvailability: LabelLifecycleAvailability;
}
export interface LabelPlatformAuthorization {approved: true; payer: 'platform'; currency: 'CAD'; amountCents: number; authorityReference: string; cause: string}
export interface LabelLifecycleCommand extends LabelLifecycleContext {
  scope: LabelLifecycleScope; sourceHash: string; sourceRevision: string; caseVersion: number; action: LabelLifecycleAction; message: string; privateNote: string | null;
  quoteReference: LabelReplacementReference | null; platformAuthorization: LabelPlatformAuthorization | null; acknowledged: true;
}
export interface LabelLifecycleAttempt {version: 1; uid: string; requestId: string; context: LabelLifecycleContext; command: LabelLifecycleCommand}
export interface LabelLifecycleReceipt extends LabelLifecycleEffects {
  protocol: 'label_lifecycle_command_v1'; actorId: string; requestId: string; command: LabelLifecycleCommand; payloadHash: string; caseId: string;
  entryId: string | null; state: 'unrecorded' | 'reserved' | 'reconciliation_required' | 'committed' | 'not_executed'; reason: string | null;
  recordedAt: string | null; providerOperationState: 'reserved' | 'requested' | 'observation_recorded' | null; caseVersionAtCommit: number | null;
}
export interface LabelProviderObservation {
  protocol: 'shipengine_label_lifecycle_observation_v1'; labelId: string; identityQualified: boolean; requestedAtMs: number; observedAtMs: number;
  source: 'exact_label_get'; documentState: 'available' | 'voided' | 'unknown'; documentUrl: null; providerStatus: string | null;
  providerVoided: boolean | null; providerCreatedAtMs: number | null; trackingNumber: string | null;
  refundStatus: 'request_scheduled' | 'pending' | 'approved' | 'rejected' | 'excluded' | null; providerRefundStatus: string | null;
  costCents: number | null; currency: 'CAD' | null; effectiveRefundCents: null; remainingCostCents: null; settledBillingProof: null; reason: string | null;
}
export interface LabelLifecycleEntry extends LabelLifecycleEffects {
  protocol: 'label_lifecycle_entry_view_v1'; contentHash: string; action: LabelLifecycleAction; message: string; privateNote: string | null; recordedAt: string;
  providerObservation: LabelProviderObservation | null;
  voidResponse: null | {approved: boolean | null; outcome: 'approved' | 'refused' | 'unknown'; message: string | null; reasonCode: string | null; source: 'exact_label_void_put'};
  carrierRefund: {state: 'requested' | 'pending' | 'approved' | 'refused' | 'excluded' | 'unknown'; labelId: string | null; platformVoidRequestRecorded: boolean; voidApproved: boolean | null; providerStatus: string | null;
    reasonCode: string | null; reasonMessage: string | null; costCents: number | null; currency: 'CAD' | null; effectiveRefundCents: null; remainingCostCents: null; settledBillingProof: null};
  replacementExpense: null | {labelId: string; costCents: number; currency: 'CAD'; fundingAuthorizationRecorded: boolean; matchesAuthorizedCost: boolean; buyerChargeAuthorized: false; settledBillingProof: null};
  replacementQuote: null | {id: string; contentHash: string; costCents: number; currency: 'CAD'; rateId: string; routeSourceHash: string;
    purchasePolicyHash: string; labelReplacedId: string; additionalBuyerChargeCents: null; platformFundingGuaranteed: false};
  sourceCurrentlyMatches: boolean;
}
export interface LabelLifecycleCoverage {inspected: number; limit: 20; hasMore: boolean; exhaustiveHistoryVerified: false}
export interface LabelLifecycleCursor {lastId: string}
export interface LabelLifecycleHistory extends LabelLifecycleContext, LabelLifecycleEffects {
  protocol: 'label_lifecycle_history_page_v1'; actorId: string; scope: LabelLifecycleScope; source: LabelLifecycleSource;
  entries: ({qualification: 'unknown'; entryId: string; entry: null} | {qualification: 'native_lifecycle_entry'; entryId: string; entry: LabelLifecycleEntry})[];
  nextCursor: LabelLifecycleCursor | null; coverage: LabelLifecycleCoverage;
}
export interface LabelLifecycleQueue extends LabelLifecycleEffects {
  protocol: 'label_lifecycle_admin_queue_v1'; actorId: string; stream: 'orders' | 'orphan_alerts';
  entries: {transactionId: string | null; leg: LabelLifecycleLeg; qualification: LabelLifecycleSource['qualification']; source: LabelLifecycleSource | null;
    orphanAlert: null | {id: string; sourceRevision: string; sourceHash: string; labelId: string | null; reason: string | null; qualification: 'native_alert_partial'}}[];
  nextCursor: LabelLifecycleCursor | null; coverage: LabelLifecycleCoverage;
}
