export const CONNECT_IDENTITY_RECOVERY_CAPABILITY = 'connect_identity_recovery_v1';
export interface ConnectIdentityRecoveryContext {scope: 'own' | 'admin'; ownerId: string; action: 'create' | 'delete'; recoveryReference: string | null}
export interface ConnectIdentityRecoveryResponse extends ConnectIdentityRecoveryContext {
  protocol: typeof CONNECT_IDENTITY_RECOVERY_CAPABILITY; actorId: string; state: 'claim_recorded_outcome_unqualified' | 'no_external_claim_observed';
  claim: null | {commandId: string; epoch: string; action: 'create' | 'delete'; accountId: string | null; parentHash: string; requestHash: string};
  newEffectAuthorized: false; sourceQualification: 'independent_qualification_required'; financialSettlement: 'not_asserted'; absenceProvesNoProviderEffect: false; readAt: string;
}
