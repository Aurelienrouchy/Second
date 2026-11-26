export const ACCOUNT_ACCESS_INTAKE_PROTOCOL = 'account_access_intake_v1' as const;
export const ACCOUNT_ACCESS_INTAKE_STORAGE_NOTICE = 'Cette installation conserve l’intention et sa clé de consultation dans le stockage local de l’application, sans chiffrement supplémentaire par l’application. La clé ne donne accès qu’au reçu, jamais à un compte. Ne saisissez aucune information sensible ; ces données locales seront supprimées après reconnaissance du reçu.';
export interface AccountAccessIntakeCommand { replyEmail: string; narrative: string }
/** Anonymous device context only; never an account identifier or identity proof. */
export interface AccountAccessPublicContext { guestId: string; generation: number }
/** Internal local journal. Never put this object in UI state, logs or URLs. */
export interface AccountAccessIntakeJournal {
  schemaVersion: 1;
  guestId: string;
  requestId: string;
  recoverySecret: string;
  command: AccountAccessIntakeCommand;
  payloadHash: string;
}
export interface AccountAccessIntakeIntentView {
  requestId: string;
  command: AccountAccessIntakeCommand;
  payloadHash: string;
}
export interface AccountAccessIntakeReceipt {
  protocol: typeof ACCOUNT_ACCESS_INTAKE_PROTOCOL;
  requestId: string;
  reference: string;
  payloadHash: string;
  state: 'unrecorded' | 'received' | 'neutralized';
  recordedAt: string | null;
  contactVerified: false;
  identityVerified: false;
  recoveryGranted: false;
}
export interface AccountAccessIntakeObservation {
  intent: AccountAccessIntakeIntentView | null;
  receipt: AccountAccessIntakeReceipt | null;
  acknowledged: boolean;
}
