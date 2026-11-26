export const EXCEPTIONAL_RESTITUTION_CAPABILITY = 'exceptional_financial_restitution_v1' as const;
export type ExceptionalRestitutionContext=
 |{kind:'withdrawal_misdirection';withdrawalRequestId:string}
 |{kind:'wallet_restitution';ownerId:string;supportRequestId:string}
 |{kind:'refund_error';transactionId:string;refundIntentId:string;harm:'buyer_shortfall'|'buyer_wrong_attribution'|'seller_undue_debit'|'seller_debt_compensation'};
export type ExceptionalRestitutionAction='prepare'|'attest'|'void_never_executed';
export type ExceptionalRestitutionEvidencePurpose='identity_destination'|'harm_or_authority'|'execution';
export type ExceptionalRestitutionEvidenceReference={evidenceId:string;generation:string;sha256:string;contentHash:string};
export type ExceptionalRestitutionSource={protocol:'exceptional_restitution_source_v1';context:ExceptionalRestitutionContext;caseId:string;sourceHash:string;sourceRevision:string;
 ownerId:string|null;beneficiaryId:string|null;currency:'CAD';maximumCents:number|null;amountCents:number|null;
 funding:'seconde_compensation'|'existing_wallet'|'original_refund_allocation'|'seconde_wallet_compensation'|null;
 state:'unqualified'|'available'|'prepared'|'operator_attested'|'voided'|'reconciliation_required';
 instructionId:string|null;identityEvidence:ExceptionalRestitutionEvidenceReference|null;authorityEvidence:ExceptionalRestitutionEvidenceReference|null;executionEvidence:ExceptionalRestitutionEvidenceReference|null;
 canPrepare:boolean;canAttest:boolean;canVoid:boolean;reason:string|null;
 bankArrivalVerified:false;stripeSettlementGranted:false;accountAccessGranted:false;nativeWalletCredit?:ExceptionalRestitutionWalletCredit|null};
export type ExceptionalRestitutionPreview={protocol:'exceptional_restitution_preview_v1';actorId:string;action:ExceptionalRestitutionAction;previewId:string;source:ExceptionalRestitutionSource};
export type ExceptionalRestitutionCommand={context:ExceptionalRestitutionContext;action:ExceptionalRestitutionAction;previewId:string;sourceHash:string;sourceRevision:string;instructionId:string|null;
 amountCents:number;currency:'CAD';beneficiaryId:string;identityEvidence:ExceptionalRestitutionEvidenceReference;authorityEvidence:ExceptionalRestitutionEvidenceReference;executionEvidence:ExceptionalRestitutionEvidenceReference|null;
 attestation:{version:'exceptional_restitution_human_v1';nativeBeneficiaryAndDestinationVerified:true;harmOrLegalAuthorityVerified:true;
 transferExecutedAndReceiptVerified:boolean;neverExecuted:boolean;nativeCompensationCreditVerified?:true};note:string;partyMessage:string;acknowledged:true};
export type ExceptionalRestitutionReceipt={protocol:'exceptional_restitution_command_v1';actorId:string;requestId:string;caseId:string;inputHash:string;
 state:'unrecorded'|'committed'|'not_executed';reason:string|null;instructionId:string|null;
 outcome:'prepared'|'operator_attested'|'voided'|'reconciliation_required'|null;recordedAt:string|null;
 bankArrivalVerified:false;stripeSettlementGranted:false;accountAccessGranted:false;nativeWalletCredit?:ExceptionalRestitutionWalletCredit|null};
export type ExceptionalRestitutionEvidenceReceipt={protocol:'exceptional_restitution_evidence_v1';actorId:string;requestId:string;caseId:string;
 inputHash:string;state:'unrecorded'|'upload_unknown'|'stored'|'stored_requires_review'|'not_executed';reason:string|null;
 purpose:ExceptionalRestitutionEvidencePurpose|null;beneficiaryId:string|null;amountCents:number|null;evidence:ExceptionalRestitutionEvidenceReference|null;recordedAt:string|null;
 bankArrivalVerified:false;externalAuthenticityVerified:false};

export interface ExceptionalRestitutionFile {sha256: string; byteLength: number; contentType: 'image/jpeg'; width: number; height: number}
/** Present only for seller_debt_compensation; all older DTOs omit this field. */
export interface ExceptionalRestitutionWalletCredit {debtOffsetCents:number;balanceCreditCents:number;recordedAt:string}
/** Persist only this opaque reference. Bodies, notes, bank references and pixels are volatile. */
export interface ExceptionalRestitutionReference {version: 3; uid: string; requestId: string; kind: 'command' | 'evidence'; context: ExceptionalRestitutionContext; caseId: string; inputHash: string; slotHash: string}
export interface ExceptionalRestitutionExecution {transferReference: string; executedDate: string}
export interface ExceptionalRestitutionEvidenceBody {context: ExceptionalRestitutionContext; previewId: string; sourceHash: string; sourceRevision: string; purpose: ExceptionalRestitutionEvidencePurpose; instructionId: string | null; file: ExceptionalRestitutionFile; bytes: Uint8Array; execution: ExceptionalRestitutionExecution | null}
export interface ExceptionalRestitutionPixels {protocol: 'exceptional_restitution_evidence_file_v1'; actorId: string; caseId: string; evidence: ExceptionalRestitutionEvidenceReference; purpose: ExceptionalRestitutionEvidencePurpose; dataUrl: string; bankArrivalVerified: false}
