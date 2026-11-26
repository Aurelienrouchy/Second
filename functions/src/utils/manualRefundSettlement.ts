/** Strict classification of an already attested MANUAL bank restitution.
 * No Stripe success, bank API evidence, payment permission or local money. */
import {Timestamp} from 'firebase-admin/firestore';
import {supportHash, supportSourceHash} from './supportRequest';

type Data = FirebaseFirestore.DocumentData;
export type ManualRefundDocuments={preparation?:Data;attestation?:Data;beneficiary?:Data;payment?:Data};
export const MANUAL_REFUND_CAPABILITY = 'purchase_refund_external_manual_v1';
export const MANUAL_REFUND_ATTESTATION = 'manual_bank_transfer_human_v1';
export const MANUAL_REFUND_EFFECTS = {bankArrivalVerified: false, stripeSettlementGranted: false,
  walletCreditAuthorized: false, sellerDebitAuthorized: false, inventoryPermissionGranted: false, shippingPermissionGranted: false} as const;
export const manualHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const manualId = (v: unknown): v is string => typeof v === 'string' && /^manual_[a-f0-9]{64}$/.test(v);
export const manualEvidenceId = (v: unknown): v is string => typeof v === 'string' && /^me_[a-f0-9]{64}$/.test(v);
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const cents = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
export function manualObligationHash(id: string, order: Data, intent: Data): string {
  return supportSourceHash([id, order.buyerId, order.sellerId, order.stripePaymentIntentId, order.stripeChargeId,
    intent.intentId, intent.attemptId, intent.stripeRefundId, intent.paymentIntentId, intent.currency,
    intent.cardAmountCents, intent.walletAmountCents, intent.sellerDebitCents, intent.fundsAppliedAt,
    intent.allocation?.reservationHash, intent.allocation?.basisHash]);
}
export function manualEvidenceContent(value: Data): Data {
  return Object.fromEntries(['protocol','evidenceId','actorId','requestId','transactionId','refundIntentId','beneficiaryId',
    'sellerId','amountCents','currency','purpose','instructionId','instructionHash','obligationHash','sourceHash','sourceRevision','inputHash','file',
    'privatePath','storageProof','execution'].map(k => [k, value[k] ?? null]));
}
export function qualifiedManualEvidence(value: Data | undefined, id: string, intentId: string, buyerId: string,
  amountCents: number, purpose: string) {
  const p = value?.storageProof, f = value?.file;
  return !!value && value.protocol === 'purchase_refund_manual_evidence_record_v1' && value.state === 'stored' &&
    manualEvidenceId(value.evidenceId) && value.transactionId === id && value.refundIntentId === intentId &&
    typeof value.requestId==='string'&&value.requestId.length>=16&&value.evidenceId==='me_'+supportHash([value.actorId,value.requestId])&&
    value.beneficiaryId === buyerId && value.amountCents === amountCents && value.currency === 'CAD' && value.purpose === purpose &&
    value.privatePath===`refund_manual_evidence/${supportHash([id,intentId])}/${value.evidenceId}.jpg`&&
    typeof value.actorId === 'string' && !!value.actorId && manualHash(value.inputHash) && manualHash(value.obligationHash) && native(value.recordedAt) &&
    p?.protocol === 'native_manual_refund_evidence_storage_v1' && typeof p.generation === 'string' && /^\d{1,30}$/.test(p.generation) &&
    typeof p.crc32c === 'string' && !!p.crc32c && manualHash(p.sha256) && p.sha256 === f?.sha256 &&
    !!f && p.byteLength === f.byteLength && Number.isSafeInteger(f.byteLength) && f.byteLength > 0 && f.byteLength <= 2 * 1024 * 1024 &&
    p.contentType === 'image/jpeg' && f.contentType === 'image/jpeg' && p.temporaryHold===true&&
    ['width','height'].every(k=>Number.isSafeInteger(f[k])&&f[k]>0&&f[k]<=1200)&&native(p.observedAt) &&
    (purpose==='beneficiary_verification'?value.instructionId===null&&value.instructionHash===null&&value.execution===null:
      manualId(value.instructionId)&&manualHash(value.instructionHash)&&manualHash(value.execution?.referenceHash)&&
      typeof value.execution.executedDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.execution.executedDate))&&
    manualHash(value.contentHash) && value.contentHash === supportSourceHash(manualEvidenceContent(value));
}
export function manualEvidenceReference(value: Data) {
  return {evidenceId: value.evidenceId as string, generation: value.storageProof.generation as string,
    sha256: value.storageProof.sha256 as string, contentHash: value.contentHash as string};
}
export function manualReferenceMatches(value: Data | undefined, reference: any): boolean {
  return !!value?.storageProof && reference != null && supportHash(manualEvidenceReference(value)) === supportHash(reference);
}
export function qualifiedManualCommand(value: Data | undefined, id: string, intentId: string, action: string): boolean {
  return !!value && value.protocol === 'purchase_refund_external_manual_command_v1' && value.state === 'committed' &&
    value.command?.transactionId === id && value.command.refundIntentId === intentId && value.command.action === action &&
    value.payloadHash === supportHash(value.command) && manualId(value.instructionId) && native(value.recordedAt) &&
    typeof value.requestId==='string'&&value.requestId.length>=16&&
    (action==='prepare_manual_bank_transfer'?value.instructionId==='manual_'+supportHash([value.actorId,value.requestId]):value.command.instructionId===value.instructionId)&&
    typeof value.actorId === 'string' && !!value.actorId && value.authority?.privateRoleAtCommit === true &&
    Number.isSafeInteger(value.authority.authTime) && value.authority.authTime > 0 &&
    value.authority.authTime * 1000 <= value.recordedAt.toMillis() && value.recordedAt.toMillis() - value.authority.authTime * 1000 <= 300000;
}
export function qualifiedManualRefundSettlement(id: string, order: Data, intent: Data, documents: {
  preparation?: Data; attestation?: Data; beneficiary?: Data; payment?: Data;
}): boolean {
  const marker = intent.manualBankSettlement, {preparation: p, attestation: a, beneficiary: b, payment: e} = documents;
  if (!marker || marker.protocol !== 'purchase_refund_manual_settlement_v1' || marker.verificationBasis !== 'human_operator_attestation' ||
      !manualId(marker.instructionId) || !manualId(marker.attestationId) || !cents(marker.amountCents) || marker.amountCents !== intent.cardAmountCents ||
      marker.beneficiaryId !== order.buyerId || marker.obligationHash !== manualObligationHash(id, order, intent) || !native(marker.recordedAt) ||
      !qualifiedManualCommand(p, id, intent.intentId, 'prepare_manual_bank_transfer') ||
      !qualifiedManualCommand(a, id, intent.intentId, 'attest_manual_bank_transfer') ||
      p!.instructionId !== marker.instructionId || a!.instructionId !== marker.instructionId || a!.command.instructionId !== marker.instructionId ||
      a!.command.amountCents !== marker.amountCents || a!.command.beneficiaryId !== order.buyerId ||
      a!.command.attestation?.version !== MANUAL_REFUND_ATTESTATION || a!.command.attestation.beneficiaryIdentityAndDestinationVerified !== true ||
      a!.command.attestation.transferExecutedAndReceiptVerified !== true || a!.command.attestation.neverExecuted !== false ||
      !qualifiedManualEvidence(b, id, intent.intentId, order.buyerId, marker.amountCents, 'beneficiary_verification') ||
      !qualifiedManualEvidence(e, id, intent.intentId, order.buyerId, marker.amountCents, 'payment_execution') ||
      !manualReferenceMatches(b, p!.command.beneficiaryEvidence) || !manualReferenceMatches(b, a!.command.beneficiaryEvidence) ||
      !manualReferenceMatches(e, a!.command.paymentEvidence) || e!.instructionId !== marker.instructionId ||
      marker.beneficiaryEvidenceHash !== b!.contentHash || marker.paymentEvidenceHash !== e!.contentHash ||
      marker.transferReferenceHash !== e!.execution?.referenceHash || !manualHash(marker.transferReferenceHash) ||
      marker.executedDate !== e!.execution.executedDate || marker.attestationHash !== a!.payloadHash ||
      marker.preparationHash !== p!.payloadHash || !marker.recordedAt.isEqual(a!.recordedAt)||
      marker.attestationId!=='manual_'+supportHash([a!.actorId,a!.requestId])) return false;
  const rail=(r:Data)=>{
    const x=r.provider;
    if(x?.qualification!=='current_original_method_capacity'||x.paymentIntentId!==intent.paymentIntentId||x.chargeId!==order.stripeChargeId||
      !Array.isArray(x.refunds)||x.refunds.length>300||!Array.isArray(r.targetRefundIds)||r.targetRefundIds.length<1||r.targetRefundIds.length>21||
      new Set(r.targetRefundIds).size!==r.targetRefundIds.length||!r.targetRefundIds.includes(intent.stripeRefundId)||
      x.proofHash!==supportHash({paymentIntentId:x.paymentIntentId,chargeId:x.chargeId,amountCapturedCents:x.amountCapturedCents,
        amountRefundedCents:x.amountRefundedCents,capacityCents:x.capacityCents,refunds:x.refunds}))return false;
    return r.targetRefundIds.every((rid:string)=>x.refunds.some((f:Data)=>f.id===rid&&f.paymentIntentId===intent.paymentIntentId&&f.chargeId===order.stripeChargeId&&
      ['failed','canceled'].includes(f.status)&&f.failureFundsReturnedToStripe===true&&/^txn_[A-Za-z0-9]+$/.test(f.failureBalanceTransactionId??'')));
  };
  return rail(p!)&&rail(a!)&&supportHash(p!.targetRefundIds)===supportHash(a!.targetRefundIds)&&
    b!.obligationHash === marker.obligationHash && e!.obligationHash === marker.obligationHash && e!.instructionHash === p!.payloadHash &&
    a!.obligationHash === marker.obligationHash && p!.obligationHash === marker.obligationHash &&
    marker.recordHash === supportSourceHash(Object.fromEntries(Object.entries(marker).filter(([k]) => k !== 'recordHash')));
}
