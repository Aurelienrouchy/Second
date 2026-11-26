export type ManualPaymentPhase = 'prepare_requested' | 'prepared' | 'confirmation_requested'
  | 'authentication_requested' | 'authentication_returned' | 'wallet_requested' | 'reconciliation_required' | 'settled';
/** Durable identity only: no PAN, PaymentMethod or client secret is stored. */
export interface ManualPaymentAttempt {
  version: 1; uid: string; transactionId: string; totalCents: number; walletCents: number;
  mode: 'card' | 'wallet'; phase: ManualPaymentPhase; intentVersion?: number;
  legacyRetirement?: { paymentIntentId: string; retirementVersion: string };
}
export interface ManualCheckout {
  protocol: 'server_manual_v1'; transactionId: string; intentVersion: number;
  preparationState: string; providerStatus: string; totalCents: number; walletCents: number; cardCents: number;
  currency: 'CAD'; paymentPermissionGranted: false; confirmationRequired: boolean; settlementPending: boolean;
  action: 'confirmOnServer' | 'handleNextAction' | 'refreshCheckout' | 'contactSupport' | 'reviewCancellation';
  /** Memory only, qualified for next action; never grants autonomous confirmation. */
  actionClientSecret?: string;
}
export interface LegacyCheckout {
  protocol: 'legacy'; transactionId: string; providerStatus: string; paymentPermissionGranted: false;
  settlementPending: boolean; legacyCardCapabilityOpen: boolean; retirementVersion: string;
  walletCents: number; cardCents: number; currency: 'CAD'; action: 'awaitSettlement' | 'retireLegacyCheckout';
}
export interface WalletPurchaseResult {
  success: true; transactionId: string; replay: boolean; paymentCommitted: true; paymentPermissionGranted: false;
  currentStatus: string; newBalance: number | null; balanceSource: string;
}
export interface LegacyRetirementResult {
  protocol: 'legacy_retirement_v1'; transactionId: string; providerStatus: 'canceled'; paymentPermissionGranted: false;
  cardCapabilityNeutralized: true; walletObligationOpen: boolean; walletCents: number;
  action: 'contactSupport' | 'requestNewQuote'; replay: boolean;
}
export type CheckoutObservation = ManualCheckout | LegacyCheckout | (WalletPurchaseResult & { protocol: 'wallet_receipt' });
