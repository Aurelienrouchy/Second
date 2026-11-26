import type { RelationshipReference, RelationshipReauthentication } from './accountRelationshipReview';

export const SWAP_TOPUP_MANUAL_CAPABILITY = 'swap_topup_manual_v1' as const;
export type SwapTopUpScope = 'own' | 'admin';
export interface SwapTopUpAmounts {baseCents: number; serviceFeeCents: number; taxCents: number; totalCents: number; currency: 'CAD'}
export type SwapTopUpProviderStatus = 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'requires_capture' | 'canceled' | 'succeeded' | 'unknown';
export interface SwapTopUpCommand {
  action: 'prepare' | 'confirm' | 'retire_legacy'; scope: SwapTopUpScope; sourceHash: string;
  intentId: string | null; intentVersion: number | null; paymentIntentId: string | null; paymentMethodId: string | null;
  totalCents: number; relationshipReference: RelationshipReference | null; acknowledged: true;
}
export interface SwapTopUpAttempt {
  version: 1; uid: string; swapId: string; requestId: string; capability: typeof SWAP_TOPUP_MANUAL_CAPABILITY; command: SwapTopUpCommand;
}
/** Volatile only. actionClientSecret never belongs in the persistent command journal. */
export interface SwapTopUpPayment {
  protocol: 'swap_topup_payment_v1'; swapId: string; paymentIntentId: string; intentId: string | null; intentVersion: number | null;
  amounts: SwapTopUpAmounts; providerStatus: SwapTopUpProviderStatus; confirmationMethod: 'manual' | 'automatic' | 'unknown';
  action: 'awaitSettlement' | 'reviewCancellation' | 'handleNextAction' | 'confirmOnServer' | 'reviewLegacyExposure';
  legacyExternalConfirmationPrevented: boolean; settlementReceiptVerified: boolean; paymentPermissionGranted: false; actionClientSecret?: string;
}
export interface SwapTopUpPreview {
  protocol: 'swap_topup_preview_v1'; actorId: string; scope: SwapTopUpScope; swapId: string; sourceHash: string;
  amounts: SwapTopUpAmounts; payment: SwapTopUpPayment | null; manualEnabled: boolean;
  preparation: {qualification: 'native_unstarted' | 'native_manual_intention' | 'native_legacy_exposure' | 'native_legacy_neutralized' | 'unknown'; canPrepareNow: boolean};
  legacyCoverage: 'selected_swap_only'; exhaustivePairSwapHistoryVerified: false; paymentPermissionGranted: false;
}
export interface SwapTopUpReceipt {
  protocol: 'swap_topup_command_v1'; actorId: string; swapId: string; requestId: string; command: SwapTopUpCommand; payloadHash: string;
  state: 'unrecorded' | 'received' | 'not_executed' | 'unknown' | 'engaged'; reason: string | null;
  result: {providerStatus: SwapTopUpProviderStatus; paymentIntentId: string; intentId: string | null;
    financialSettlementVerified: false; legacyExternalConfirmationPrevented: boolean} | null;
  futureEffectsNeutralized: boolean; recordedAt: string | null; paymentPermissionGranted: false; payment?: SwapTopUpPayment;
}
export type SwapTopUpReauthentication = RelationshipReauthentication;
