export const ACCOUNT_SECURITY_STATEMENT_VERSION = 'account_security_containment_v1' as const;
export const ACCOUNT_SECURITY_STATEMENT = 'Je demande de bloquer les nouvelles opérations de ce compte et de révoquer ses sessions. Le rétablissement nécessitera un examen par l’équipe.';

export interface AccountSecurityIntent {
  schemaVersion: 1;
  expectedUid: string;
  requestId: string;
  statementVersion: typeof ACCOUNT_SECURITY_STATEMENT_VERSION;
  accepted: true;
  statement: typeof ACCOUNT_SECURITY_STATEMENT;
  inputHash: string;
}
export interface AccountSecurityJournalEntry {
  intent: AccountSecurityIntent;
  acknowledged: boolean;
}
export type AccountSecurityState = 'unrecorded' | 'neutralized' | 'revocation_pending' | 'revocation_unknown' | 'contained';
/** Optional additive observation; absent legacy receipts do not qualify media protection. */
export interface AccountSecurityMediaProtection {
  protocol: 'account_security_media_v1';
  state: 'pending' | 'in_progress' | 'observed_for_scanned_references' | 'review_required' | 'unknown' | 'not_requested';
  cutoffAt: string | null;
  nativeReferencesInspected: number | null;
  objectsQueued: number | null;
  privatelyPreservedCount: number | null;
  observedRevokedCount: number | null;
  scanReachedEnd: boolean;
  referenceCoverage: 'native_references_only' | 'unknown';
  globalCoverageVerified: false;
  historicalCopiesErased: false;
  newMediaPermissionGranted: false;
  lastObservedAt: string | null;
}
export interface AccountSecurityReceipt {
  protocol: typeof ACCOUNT_SECURITY_STATEMENT_VERSION;
  ownerId: string;
  requestId: string;
  commandId: string;
  state: AccountSecurityState;
  newEffectsBlocked: boolean;
  authRevocationObserved: boolean;
  authTokensValidAfter: string | null;
  receivedAt: string | null;
  action: 'contactSupport' | 'acknowledgeNeutralized' | 'reauthenticateAndContactSupport' |
    'resumeSameRequestOrContactSupport' | 'resumeOrNeutralizeSameRequest';
  identityRecoveryGranted: false;
  newOperationsPermissionGranted: false;
  mediaProtection?: AccountSecurityMediaProtection;
}
export interface AccountSecurityObservation {
  journal: AccountSecurityJournalEntry | null;
  receipt: AccountSecurityReceipt;
  /** False for a pure account-state consultation without a local intention. */
  linkedToLocalIntent: boolean;
}

export const ACCOUNT_SECURITY_RECOVERY_VERSION = 'account_security_recovery_v1' as const;
export const ACCOUNT_SECURITY_RECOVERY_STATEMENT = 'Je confirme avoir sécurisé les moyens de connexion liés à mon compte et demande de reprendre les nouvelles opérations. Cette déclaration ne prouve pas un changement de mot de passe chez Google ou Apple.';
export type AccountSecurityRecoveryReason = 'ready' | 'no_episode' | 'baseline_unknown' | 'revocation_unknown' |
  'reauthentication_required' | 'linked_method_required' | 'source_unqualified' | 'already_restored';
export interface AccountSecurityRecoveryPreview {
  protocol: typeof ACCOUNT_SECURITY_RECOVERY_VERSION;
  ownerId: string;
  kind: 'preview';
  episodeId: string | null;
  sourceHash: string | null;
  canRestore: boolean;
  canStartNewContainment: boolean;
  reason: AccountSecurityRecoveryReason;
  statementVersion: typeof ACCOUNT_SECURITY_RECOVERY_VERSION;
  statement: typeof ACCOUNT_SECURITY_RECOVERY_STATEMENT;
  newEffectsBlocked: boolean;
  restorationRecorded: boolean;
  identityRecoveryGranted: false;
  otherRestrictionsLifted: false;
}
/** Opaque command metadata only; credentials and private baseline proofs never enter storage. */
export interface AccountSecurityRecoveryIntent {
  schemaVersion: 1;
  expectedUid: string;
  requestId: string;
  expectedEpisodeId: string;
  expectedSourceHash: string;
  statementVersion: typeof ACCOUNT_SECURITY_RECOVERY_VERSION;
  accepted: true;
  inputHash: string;
}
export interface AccountSecurityRecoveryJournalEntry {
  intent: AccountSecurityRecoveryIntent;
  acknowledged: boolean;
}
export interface AccountSecurityRecoveryReceipt {
  protocol: typeof ACCOUNT_SECURITY_RECOVERY_VERSION;
  kind: 'receipt';
  ownerId: string;
  requestId: string;
  commandId: string;
  episodeId: string;
  sourceHash: string;
  inputHash: string;
  statementVersion: typeof ACCOUNT_SECURITY_RECOVERY_VERSION;
  accepted: true;
  state: 'unrecorded' | 'neutralized' | 'restored';
  receivedAt: string | null;
  receiptHash: string | null;
  restorationRecorded: boolean;
  newOperationsPermissionGranted: false;
  identityRecoveryGranted: false;
  otherRestrictionsLifted: false;
}
export interface AccountSecurityRecoveryObservation {
  journal: AccountSecurityRecoveryJournalEntry | null;
  receipt: AccountSecurityRecoveryReceipt | null;
}
