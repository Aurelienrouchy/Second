export const ACCOUNT_CONTROL_CAPABILITY = 'account_control_proof_v1' as const;
export const ACCOUNT_CONTROL_STATEMENT_VERSION = 'account_control_keep_and_pause_v1' as const;
export const ACCOUNT_CONTROL_STATEMENT = 'Je confirme contrôler ce compte Firebase. Je souhaite conserver le premier compte et mettre le second en pause, sans fusion, transfert de fonds ou de contrats, ni accès aux données de l’autre compte. Les obligations du compte mis en pause restent accessibles avec sa propre connexion.';
interface Base {supportRequestId: string; statementVersion: typeof ACCOUNT_CONTROL_STATEMENT_VERSION; accepted: true}
export type AccountControlCommand = Base & ({action: 'prepare'; expectedCaseVersion: number; declaredOtherUid: string} |
  {action: 'consent_second'; proofId: string; sourceHash: string; invitationCode: string} |
  {action: 'pause'; proofId: string; sourceHash: string} |
  {action: 'finalize_pause'; proofId: string; sourceHash: string; pauseRequestId: string});
export interface AccountControlReference {supportRequestId: string; proofId: string; sourceHash: string}
export interface AccountControlInvitation {supportRequestId: string; proofId: string; invitationCode: string}
export interface AccountControlDescriptor {supportRequestId: string; action: AccountControlCommand['action']; inputHash: string}
export interface AccountControlAttempt {uid: string; requestId: string; descriptor: AccountControlDescriptor}
export interface AccountControlJournalState {version: 1; uid: string; reference: AccountControlReference | null; pending: AccountControlAttempt | null}
export interface AccountControlProof extends AccountControlReference {
  keepUid: string; pauseUid: string; stage: 'awaiting_second_consent' | 'both_consented' | 'paused' | 'finalized' | 'source_changed' | 'historical_unknown';
  statementVersion: typeof ACCOUNT_CONTROL_STATEMENT_VERSION; statement: typeof ACCOUNT_CONTROL_STATEMENT; invitationCode: string | null;
  expiresAt: string; pauseRequestId: string | null; pauseSourceQualification: 'created_pause' | 'observed_existing_pause' | 'unknown' | 'not_recorded';
  controlOfBothFirebaseSessionsObserved: boolean; pauseObserved: boolean; inAppNoticeRecorded: boolean;
  samePhysicalIdentityVerified: false; fraudEstablished: false; accountsMerged: false; fundsMoved: false; otherAccountDataAccessGranted: false; restrictionsLifted: false;
}
export interface AccountControlReceipt {
  id: string; requestId: string; inputHash: string; action: AccountControlCommand['action']; state: 'completed' | 'not_executed'; recordedAt: string; receiptHash: string;
}
export interface AccountControlResponse {
  protocol: typeof ACCOUNT_CONTROL_CAPABILITY; actorUid: string; requestId: string | null; inputHash: string | null;
  state: 'completed' | 'not_executed' | 'unrecorded' | 'available' | 'unavailable'; replayed: boolean; receipt: AccountControlReceipt | null; proof: AccountControlProof | null;
}
