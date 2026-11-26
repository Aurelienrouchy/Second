import type {SwapHoldSource} from '@/types/swapHoldReview';
export const SWAP_DISPUTE_REVIEW_CAPABILITY = 'swap_dispute_review_v1' as const;
export interface SwapDisputeReviewEffects {documentaryOnly:true;financialEffectAuthorized:false;stockEffectAuthorized:false;disputeClosed:false;refundConfirmed:false;fundsReleased:false;deviceDeliveryVerified:false;readingVerified:false}
export interface SwapDisputeReviewSourceReference {sourceHash:string;episodeHash:string;version:number}
export interface SwapDisputeReviewReference {swapId:string;id:string;contentHash:string;version:number}
export interface SwapDisputeReviewCommand {action:'record_review';source:SwapDisputeReviewSourceReference;recommendation:'retain_frozen'|'refund_review_required'|'payee_release_review_required'|'physical_resolution_review_required';motivation:string;partyMessages:{userId:string;message:string}[];acknowledged:true}
export interface SwapDisputeDocumentCommitment {path:string;revision:string|null;sourceHash:string;exists:boolean}
export interface SwapDisputeReviewCapture extends SwapDisputeReviewEffects {
 protocol:'swap_dispute_review_source_v1';swapId:string;swap:SwapDisputeDocumentCommitment;
 episode:{swapId:string;parties:string[];openedAt:string|null;openedBy:string|null;reason:string|null;qualification:'native_dispute_episode'|'unknown'};
 episodeHash:string;version:number|null;root:SwapDisputeDocumentCommitment;
 history:(SwapDisputeDocumentCommitment&{noticesQualified:boolean})[];
 linked:SwapDisputeDocumentCommitment[];wallets:SwapDisputeDocumentCommitment[];ledger:SwapDisputeDocumentCommitment[];articles:SwapDisputeDocumentCommitment[];inventory:SwapDisputeDocumentCommitment[];
 relationship:{qualification:'unknown'|'current_native_guard_observed';releaseAllowed:boolean|null;pairId:string|null;root:SwapDisputeDocumentCommitment|null};
 coverage:{historyQualified:boolean;historyCount:number;historyLimit:100;ledgerComplete:boolean;itemCoverage:boolean;selectedSwapOnly:true;providerObserved:false;globalFinancialHistoryExhaustive:false};
 facts:{status:string|null;topup:{amountCents:number|null;currency:'CAD';amountQualification:'native_topup_cents'|'unknown';payerId:string|null;paymentIntentId:string|null;paidAt:string|null;holdSource:SwapHoldSource|null;
 checkout:{protocol:string|null;intentId:string|null;version:number|null;state:string|null;nativeReceiptQualified:false;financialSettlementVerified:false};providerCurrentState:'not_observed';settlementPermissionGranted:false};
 movements:{ownerId:string;id:string;type:string|null;amountCents:number|null;currency:string|null;recordedAt:string|null;qualification:'native_swap_linked_movement'|'unknown'}[];
 articles:{id:string;exists:boolean;sellerId:string|null;isSold:boolean|null;isActive:boolean|null;reservationQualification:'no_permission_inferred'}[];
 obligations:{qualification:'selected_native_witnesses_only';refundWitnessHash:string;refundId:string|null;refundedAt:string|null;reconciledAt:string|null;exhaustiveFinancialObligationsVerified:false;physicalReturnRuleQualified:false;itemReavailabilityRuleQualified:false};
 receptions:{initiatorAt:string|null;receiverAt:string|null};priorLegacyDecision:boolean;legacyFinancialOutcomeVerified:false};
}
export interface SwapDisputeReviewAdmission {currentPrivateAdminQualified:true;recentAuthenticationQualified:true}
export interface SwapDisputeReviewPreview extends SwapDisputeReviewEffects {protocol:'swap_dispute_review_preview_v1';swapId:string;source:SwapDisputeReviewSourceReference;capture:SwapDisputeReviewCapture;canRecord:boolean;stageEnabled:boolean;admission:SwapDisputeReviewAdmission}
export interface SwapDisputeReviewHistoryEntry extends SwapDisputeReviewEffects {actorId:string;requestId:string;recordedAt:string;command:SwapDisputeReviewCommand;sourceHash:string;episodeHash:string;notificationIds:string[]}
export type SwapDisputeReviewHistoryRow={reference:SwapDisputeReviewReference;qualification:'native_documentary_entry';entry:SwapDisputeReviewHistoryEntry}|{reference:Omit<SwapDisputeReviewReference,'version'>&{version:null};qualification:'unknown';entry:null};
export interface SwapDisputeReviewHistory extends SwapDisputeReviewEffects {protocol:'swap_dispute_review_history_v1';swapId:string;sourceHash:string;cursor:string|null;entries:SwapDisputeReviewHistoryRow[];hasMore:boolean;nextCursor:string|null;admission:SwapDisputeReviewAdmission}
export interface SwapDisputeReviewReceipt extends SwapDisputeReviewEffects {protocol:'swap_dispute_review_receipt_v1';swapId:string;actorId:string;requestId:string;payloadHash:string;state:'committed'|'not_executed'|'unrecorded';recordedAt:string|null;reason:string|null;reference:SwapDisputeReviewReference|null;commandCommitted:boolean;notificationCommitted:boolean;nonExecutionVerified:boolean}
export interface SwapDisputeReviewAttempt {version:1;uid:string;swapId:string;requestId:string;capability:typeof SWAP_DISPUTE_REVIEW_CAPABILITY;payloadHash:string;command:SwapDisputeReviewCommand}
