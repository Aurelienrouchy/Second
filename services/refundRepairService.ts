import { File } from 'expo-file-system';
import { prepareImageForUpload } from '@/utils/imageUtils';
import { productReviewByteHash, productReviewEncodeBytes, productReviewJpegDimensions } from '@/services/productReviewEvidenceService';
import { REFUND_REPAIR_MANUAL_CAPABILITY, type RefundRepairAction, type RefundRepairAttempt, type RefundRepairCommand, type RefundRepairReceipt, type RefundRepairSource, type RefundRepairObservation, type RefundRepairPreview, type RefundRepairManualAction, type RefundRepairManualAttempt, type RefundRepairManualCommand, type RefundRepairManualEvidenceAttempt,
  type RefundRepairManualEvidenceContext, type RefundRepairManualEvidencePixels, type RefundRepairManualEvidenceReceipt, type RefundRepairManualEvidenceReference,
  type RefundRepairManualFile, type RefundRepairManualObservation, type RefundRepairManualPreview, type RefundRepairManualReceipt, type RefundRepairManualSource } from '@/types/refundRepair';
import { httpsCallable } from 'firebase/functions';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { auth, functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent, staleTradeOperation } from '@/services/tradeOperation';
import { purchaseRefundRecord as record, purchaseRefundExact as exact, purchaseRefundHash as hash, purchaseRefundCents as cents, purchaseRefundId as id, purchaseRefundIso as iso, purchaseRefundEqual as equal, purchaseRefundCanonical as canonical, isPurchaseRefundTerms } from '@/utils/purchaseRefundContract';
const effectFields = ['walletCreditAuthorized', 'sellerDebitAuthorized', 'newReserveAuthorized', 'inventoryPermissionGranted', 'shippingPermissionGranted', 'bankArrivalVerified', 'externalPaymentAuthorized'];
const noEffects = (v: Record<string, unknown>) => effectFields.every(k => v[k] === false);
const refundId = (v: unknown): v is string => typeof v === 'string' && /^re_[A-Za-z0-9]+$/.test(v);
const repairId = (v: unknown): v is string => typeof v === 'string' && /^rr_[a-f0-9]{64}$/.test(v);
const fail = () => new Error('La réparation et ses références exactes doivent être relues. Votre intention d’origine reste conservée.');
const hashValue = (v: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(v)));
const nullableCents = (v: unknown) => v === null || cents(v);
const revision = (v: unknown) => v === null || typeof v === 'string' && /^\d+:\d+$/.test(v);
const action = (v: unknown) => v === 'repair_original_method' || v === 'record_external_instruction';
const providerStatus = (v: unknown) => v === null || ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(String(v));
const cursor = (v: unknown) => v === null || record(v) && exact(v, ['lastId']) && typeof v.lastId === 'string' && v.lastId.length > 0 && v.lastId.length <= 1500 && !v.lastId.includes('/');
async function parseSource(v: unknown, transactionId: string, intentId: string): Promise<RefundRepairSource> {
  if (!record(v) || !exact(v, ['protocol', 'transactionId', 'refundIntentId', 'sourceRevision', 'sourceHash', 'qualification', 'historical', 'refundAttemptId', 'originalRefundId', 'paymentIntentId', 'allocation', 'currency', 'obligationCardCents', 'remainingCardCents', 'cardAmountQualification', 'localMovementsVerified', 'localWalletCreditCents', 'localSellerDebitCents', 'localSellerDebtCents', 'localReconciliationRequired', 'originalReservationPreserved', 'bankReviewRequired', 'riskReviewRequired', 'historyComplete', 'terminalRefundId', 'terminalAttemptId', 'provider', 'repairHistory', 'canRepairOriginalMethodNow', 'canRecordExternalInstructionNow', 'externalChannelQualification', ...effectFields]) || v.protocol !== 'purchase_refund_repair_source_v1' || v.transactionId !== transactionId || v.refundIntentId !== intentId || !revision(v.sourceRevision) || !hash(v.sourceHash) || !['native_reserved_obligation', 'unknown'].includes(String(v.qualification)) || typeof v.historical !== 'boolean' || !id(v.refundAttemptId) || !refundId(v.originalRefundId) || typeof v.paymentIntentId !== 'string' || !/^pi_[A-Za-z0-9]+$/.test(v.paymentIntentId) || v.currency !== 'CAD' || !cents(v.obligationCardCents) || v.obligationCardCents < 1 || !nullableCents(v.remainingCardCents) || !['current_provider_set', 'unknown'].includes(String(v.cardAmountQualification)) || !['localMovementsVerified', 'localReconciliationRequired', 'bankReviewRequired', 'riskReviewRequired', 'historyComplete', 'canRepairOriginalMethodNow', 'canRecordExternalInstructionNow'].every(k => typeof v[k] === 'boolean') || !['localWalletCreditCents', 'localSellerDebitCents', 'localSellerDebtCents'].every(k => nullableCents(v[k])) || v.originalReservationPreserved !== true || v.terminalRefundId !== null && !refundId(v.terminalRefundId) || !id(v.terminalAttemptId) || v.externalChannelQualification !== 'not_defined' || !noEffects(v)) throw fail();
  const a = v.allocation;
  if (!record(a) || !exact(a, ['refundIntentId', 'reservationHash', 'basisHash', 'termsHash', 'terms']) || a.refundIntentId !== intentId || !hash(a.reservationHash) || !hash(a.basisHash) || !hash(a.termsHash) || !isPurchaseRefundTerms(a.terms) || a.termsHash !== await hashValue(a.terms) || a.terms.cardCents !== v.obligationCardCents || v.localReconciliationRequired !== !v.localMovementsVerified || (v.localMovementsVerified ? v.localWalletCreditCents !== a.terms.walletCents || v.localSellerDebitCents !== a.terms.sellerDebitCents || !cents(v.localSellerDebtCents) : v.localWalletCreditCents !== null || v.localSellerDebitCents !== null || v.localSellerDebtCents !== null)) throw fail();
  const p = v.provider;
  if (p !== null && (!record(p) || !exact(p, ['qualification', 'reason', 'paymentIntentId', 'chargeId', 'amountCapturedCents', 'amountRefundedCents', 'capacityCents', 'refunds', 'proofHash', 'observedAt']) || !['current_original_method_capacity', 'unknown'].includes(String(p.qualification)) || p.reason !== null && typeof p.reason !== 'string' || p.paymentIntentId !== v.paymentIntentId || typeof p.chargeId !== 'string' || !/^ch_[A-Za-z0-9]+$/.test(p.chargeId) || !['amountCapturedCents', 'amountRefundedCents', 'capacityCents'].every(k => nullableCents(p[k])) || !hash(p.proofHash) || !iso(p.observedAt) || !Array.isArray(p.refunds) || p.refunds.length > 300 || new Set(p.refunds.map(r => record(r) ? r.id : null)).size !== p.refunds.length || !p.refunds.every(r => record(r) && exact(r, ['id', 'paymentIntentId', 'chargeId', 'amountCents', 'currency', 'status', 'failureReason', 'failureBalanceTransactionId', 'failureFundsReturnedToStripe']) && refundId(r.id) && r.paymentIntentId === v.paymentIntentId && r.chargeId === p.chargeId && cents(r.amountCents) && r.amountCents > 0 && r.currency === 'cad' && providerStatus(r.status) && r.status !== null && (r.failureReason === null || typeof r.failureReason === 'string') && (r.failureBalanceTransactionId === null || typeof r.failureBalanceTransactionId === 'string' && /^txn_[A-Za-z0-9]+$/.test(r.failureBalanceTransactionId)) && typeof r.failureFundsReturnedToStripe === 'boolean') || (p.qualification === 'unknown' ? p.amountCapturedCents !== null || p.amountRefundedCents !== null || p.capacityCents !== null || p.refunds.length !== 0 : p.reason !== null || !cents(p.amountCapturedCents) || !cents(p.amountRefundedCents) || !cents(p.capacityCents) || p.amountRefundedCents > p.amountCapturedCents || p.capacityCents > p.amountCapturedCents))) throw fail();
  if (!Array.isArray(v.repairHistory) || v.repairHistory.length > 20 || new Set(v.repairHistory.map(r => record(r) ? r.repairId : null)).size !== v.repairHistory.length || !v.repairHistory.every((r, i) => record(r) && exact(r, ['repairId', 'ordinal', 'providerRefundId', 'providerStatus', 'state', 'amountCents', 'reservedAt', 'observedAt']) && repairId(r.repairId) && r.ordinal === i + 1 && (r.providerRefundId === null || refundId(r.providerRefundId)) && providerStatus(r.providerStatus) && typeof r.state === 'string' && !!r.state && cents(r.amountCents) && r.amountCents > 0 && iso(r.reservedAt) && (r.observedAt === null || iso(r.observedAt)))) throw fail();
  if (v.cardAmountQualification === 'unknown' ? v.remainingCardCents !== null : !record(p) || p.qualification !== 'current_original_method_capacity' || !cents(v.remainingCardCents) || v.remainingCardCents > v.obligationCardCents) throw fail();
  if (v.canRepairOriginalMethodNow && (v.qualification !== 'native_reserved_obligation' || !v.sourceRevision || !v.historyComplete || !v.localMovementsVerified || v.bankReviewRequired || v.riskReviewRequired || v.cardAmountQualification !== 'current_provider_set' || !cents(v.remainingCardCents) || v.remainingCardCents < 1 || !refundId(v.terminalRefundId))) throw fail();
  return v as unknown as RefundRepairSource;
}
export function isRefundRepairCommand(v: unknown): v is RefundRepairCommand {return record(v) && exact(v, ['transactionId', 'refundIntentId', 'action', 'previewId', 'sourceHash', 'sourceRevision', 'terminalRefundId', 'terminalAttemptId', 'amountCents', 'currency', 'note', 'partyMessage', 'acknowledged']) && id(v.transactionId) && id(v.refundIntentId) && ['repair_original_method', 'record_external_instruction'].includes(String(v.action)) && hash(v.previewId) && hash(v.sourceHash) && typeof v.sourceRevision === 'string' && /^\d+:\d+$/.test(v.sourceRevision) && refundId(v.terminalRefundId) && id(v.terminalAttemptId) && cents(v.amountCents) && v.amountCents > 0 && v.currency === 'CAD' && typeof v.note === 'string' && v.note.trim() === v.note && v.note.length > 0 && v.note.length <= 2000 && typeof v.partyMessage === 'string' && v.partyMessage.trim() === v.partyMessage && v.partyMessage.length > 0 && v.partyMessage.length <= 2000 && v.acknowledged === true;}
export function isRefundRepairAttempt(v: unknown, uid: string): v is RefundRepairAttempt {return record(v) && exact(v, ['version', 'uid', 'requestId', 'command']) && v.version === 1 && v.uid === uid && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && isRefundRepairCommand(v.command);}
export async function parseRefundRepairReceipt(v: unknown, a: RefundRepairAttempt): Promise<RefundRepairReceipt> {
  if (!record(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'command', 'payloadHash', 'state', 'reason', 'repairId', 'recordedAt', 'financial', ...effectFields]) || v.protocol !== 'purchase_refund_repair_command_v1' || v.actorId !== a.uid || v.requestId !== a.requestId || !equal(v.command, a.command) || v.payloadHash !== await hashValue(a.command) || !noEffects(v) || !['unrecorded', 'reserved', 'committed', 'not_executed'].includes(String(v.state))) throw fail();
  const f = v.financial;
  if (f !== null && (!record(f) || !exact(f, ['repairId', 'attemptId', 'refundId', 'state', 'providerStatus', 'amountCents', 'cardRepairedCents', 'observedAt', 'bankArrivalVerified', 'localMovementsRepeated']) || !repairId(f.repairId) || f.repairId !== v.repairId || f.attemptId !== f.repairId || f.refundId !== null && !refundId(f.refundId) || !['reserved', 'pending', 'requires_action', 'unknown', 'failed', 'reconciliation_required', 'card_repaired', 'not_executed'].includes(String(f.state)) || f.providerStatus !== null && !['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(String(f.providerStatus)) || f.amountCents !== a.command.amountCents || f.cardRepairedCents !== null && (!cents(f.cardRepairedCents) || f.cardRepairedCents > a.command.amountCents) || f.observedAt !== null && !iso(f.observedAt) || f.bankArrivalVerified !== false || f.localMovementsRepeated !== false || f.state === 'card_repaired' && (f.providerStatus !== 'succeeded' || !refundId(f.refundId) || f.cardRepairedCents !== a.command.amountCents || !iso(f.observedAt)))) throw fail();
  // Only the command family and its native effect receipt can qualify success.
  const expectedRepairId = `rr_${await hashValue([a.uid, a.requestId])}`;
  const refusedReservation = a.command.action === 'repair_original_method' && v.repairId === expectedRepairId && record(f) && f.state === 'not_executed' && f.refundId === null && f.providerStatus === null && f.cardRepairedCents === null;
  if (v.state === 'unrecorded' ? v.reason !== null || v.repairId !== null || v.recordedAt !== null || f !== null : !iso(v.recordedAt) || (v.state === 'not_executed' ? typeof v.reason !== 'string' || !v.reason || !refusedReservation && (v.repairId !== null || f !== null) : v.reason !== null || (v.state === 'reserved' ? a.command.action !== 'repair_original_method' || v.repairId !== expectedRepairId || record(f) && f.state === 'not_executed' : a.command.action !== 'record_external_instruction' || v.repairId !== null || f !== null))) throw fail();
  return v as unknown as RefundRepairReceipt;
}
export function canAcknowledgeRefundRepair(r: RefundRepairReceipt): boolean {return r.state === 'not_executed' || r.state === 'committed' || r.state === 'reserved' && !!r.financial && (r.financial.state === 'card_repaired' || r.financial.state === 'failed' && ['failed', 'canceled'].includes(r.financial.providerStatus ?? '') && !!r.financial.refundId && !!r.financial.observedAt);}
export const RefundRepairService = {
  async source(uid: string, transactionId: string, scope: 'own' | 'admin', assertContext: () => void, options: {refundIntentId?: string; cursor?: {lastId: string} | null; instructionCursor?: {lastId: string} | null} = {}): Promise<RefundRepairObservation> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); assertContext();}; current();
    if (!id(transactionId) || options.refundIntentId !== undefined && !id(options.refundIntentId) || !cursor(options.cursor ?? null) || !cursor(options.instructionCursor ?? null)) throw fail();
    const input = {mode: 'purchase_refund_repair_source_observe', capability: 'purchase_refund_repair_v1', expectedUid: uid, transactionId, scope,
      ...(options.refundIntentId !== undefined ? {refundIntentId: options.refundIntentId} : {}), ...(options.cursor !== undefined ? {cursor: options.cursor} : {}), ...(options.instructionCursor !== undefined ? {instructionCursor: options.instructionCursor} : {})};
    const {data: v} = await httpsCallable<typeof input, unknown>(functions, 'adminRefundTransaction')(input); current();
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'scope', 'transactionId', 'sourceRevision', 'selected', 'reason', 'candidates', 'cursor', 'instructions', 'historicalReadOnly', ...effectFields]) || v.protocol !== 'purchase_refund_repair_observation_v1' || v.actorId !== uid || v.scope !== scope || v.transactionId !== transactionId || !revision(v.sourceRevision) || !['repair_native_source_unknown', null].includes(v.reason as string | null) || !cursor(v.cursor) || v.historicalReadOnly !== true || !noEffects(v) || !Array.isArray(v.candidates) || v.candidates.length > 20 || new Set(v.candidates.map(c => record(c) ? c.refundIntentId : null)).size !== v.candidates.length || !v.candidates.every(c => record(c) && exact(c, ['refundIntentId', 'qualification', 'historical']) && id(c.refundIntentId) && ['native_allocation_reference', 'unknown'].includes(String(c.qualification)) && typeof c.historical === 'boolean')) throw fail();
    const i = v.instructions;
    if (!record(i) || !exact(i, ['entries', 'cursor']) || !cursor(i.cursor) || !Array.isArray(i.entries) || i.entries.length > 20 || new Set(i.entries.map(r => record(r) ? r.instructionId : null)).size !== i.entries.length || !i.entries.every(r => record(r) && exact(r, ['instructionId', 'refundIntentId', 'action', 'partyMessage', 'recordedAt', 'externalPaymentAuthorized', 'fundsReceivedVerified']) && hash(r.instructionId) && id(r.refundIntentId) && action(r.action) && typeof r.partyMessage === 'string' && r.partyMessage.trim() === r.partyMessage && r.partyMessage.length > 0 && r.partyMessage.length <= 2000 && iso(r.recordedAt) && r.externalPaymentAuthorized === false && r.fundsReceivedVerified === false)) throw fail();
    if (v.selected !== null) {if (!options.refundIntentId || v.reason !== null) throw fail(); const selected = await parseSource(v.selected, transactionId, options.refundIntentId); current(); if (selected.sourceRevision !== v.sourceRevision) throw fail();} else if (options.refundIntentId ? v.reason !== 'repair_native_source_unknown' : v.reason !== null) throw fail();
    current(); return v as unknown as RefundRepairObservation;
  },
  async preview(uid: string, transactionId: string, refundIntentId: string, chosen: RefundRepairAction, assertContext: () => void): Promise<RefundRepairPreview> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); assertContext();}; current(); if (!id(transactionId) || !id(refundIntentId) || !action(chosen)) throw fail();
    const input = {mode: 'purchase_refund_repair_preview', capability: 'purchase_refund_repair_v1', expectedUid: uid, transactionId, refundIntentId, action: chosen};
    const {data: v} = await httpsCallable<typeof input, unknown>(functions, 'adminRefundTransaction')(input); current();
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'previewId', 'action', 'source', ...effectFields]) || v.protocol !== 'purchase_refund_repair_preview_v1' || v.actorId !== uid || !hash(v.previewId) || v.action !== chosen || !noEffects(v)) throw fail();
    const source = await parseSource(v.source, transactionId, refundIntentId); current(); if (!source.provider || !source.sourceRevision) throw fail();
    return v as unknown as RefundRepairPreview;
  },
  async command(a: RefundRepairAttempt, modeAction: 'execute' | 'observe' | 'neutralize' | 'recover', assertContext: () => void) {
    const session = captureTradeSession(a.uid), current = () => {assertTradeSessionCurrent(session); assertContext();}; current(); if (!isRefundRepairAttempt(a, a.uid)) throw fail();
    const input = {mode: 'purchase_refund_repair_command', capability: 'purchase_refund_repair_v1', expectedUid: a.uid, requestId: a.requestId, modeAction, command: a.command};
    const {data} = await httpsCallable<typeof input, unknown>(functions, 'adminRefundTransaction')(input); current(); const receipt = await parseRefundRepairReceipt(data, a); current(); return receipt;
  },
};


// Manual restitution is deliberately additive: none of the V1 decoders above
// accept this capability or reinterpret an old documentary instruction.
const MANUAL_EFFECTS = ['bankArrivalVerified', 'stripeSettlementGranted', 'walletCreditAuthorized', 'sellerDebitAuthorized', 'inventoryPermissionGranted', 'shippingPermissionGranted'];
const manualNone = (v: Record<string, unknown>) => MANUAL_EFFECTS.every(k => v[k] === false);
const manualState = (v: unknown) => ['none', 'prepared', 'manual_operator_attested', 'voided', 'reconciliation_required', 'unknown'].includes(String(v));
const manualAction = (v: unknown): v is RefundRepairManualAction => ['prepare_manual_bank_transfer', 'attest_manual_bank_transfer', 'void_unexecuted_manual_instruction'].includes(String(v));
const manualInstruction = (v: unknown): v is string => typeof v === 'string' && /^manual_[a-f0-9]{64}$/.test(v);
const manualActor = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 && !v.includes('/');
const manualRequest = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v);
const manualRevision = (v: unknown): v is string => typeof v === 'string' && /^\d+:\d+$/.test(v);
const manualReason = (v: unknown) => v === null || typeof v === 'string' && v.length > 0 && v.length <= 2000;
const manualBasis = (v: unknown) => v === null || v === 'human_operator_attestation';
export const isRefundRepairManualEvidence = (v: unknown): v is RefundRepairManualEvidenceReference => record(v) && exact(v, ['evidenceId', 'generation', 'sha256', 'contentHash']) &&
  typeof v.evidenceId === 'string' && /^me_[a-f0-9]{64}$/.test(v.evidenceId) && typeof v.generation === 'string' && /^\d{1,30}$/.test(v.generation) && hash(v.sha256) && hash(v.contentHash);
const manualFile = (v: unknown): v is RefundRepairManualFile => record(v) && exact(v, ['sha256', 'byteLength', 'contentType', 'width', 'height']) && hash(v.sha256) &&
  cents(v.byteLength) && v.byteLength > 0 && v.byteLength <= 2097152 && v.contentType === 'image/jpeg' && cents(v.width) && v.width > 0 && v.width <= 1200 && cents(v.height) && v.height > 0 && v.height <= 1200;
function manualGuard(uid: string, assertContext: () => void) {
  const owner = auth.currentUser, session = captureTradeSession(uid);
  const current = () => {assertTradeSessionCurrent(session); if (auth.currentUser !== owner) throw staleTradeOperation(); assertContext();};
  current(); return current;
}
function parseManualSource(v: unknown, transactionId: string, intentId: string, scope: 'own' | 'admin'): RefundRepairManualSource {
  if (!record(v) || !exact(v, ['protocol', 'transactionId', 'refundIntentId', 'sourceHash', 'sourceRevision', 'beneficiaryId', 'amountCents', 'currency', 'remainingCents',
    'localMovementsVerified', 'originalRailTerminalVerified', 'bankReviewRequired', 'riskReviewRequired', 'state', 'instructionId', 'instructionHash', 'beneficiaryEvidence', 'paymentEvidence',
    'canPrepare', 'canAttest', 'canVoid', 'reason', 'verificationBasis', ...MANUAL_EFFECTS]) || v.protocol !== 'purchase_refund_external_manual_source_v1' ||
    v.transactionId !== transactionId || v.refundIntentId !== intentId || !hash(v.sourceHash) || !revision(v.sourceRevision) || !manualActor(v.beneficiaryId) ||
    !cents(v.amountCents) || v.amountCents < 1 || v.currency !== 'CAD' || !nullableCents(v.remainingCents) || v.remainingCents !== null && Number(v.remainingCents) > v.amountCents ||
    !manualState(v.state) || v.instructionId !== null && !manualInstruction(v.instructionId) || v.instructionHash !== null && !hash(v.instructionHash) ||
    v.beneficiaryEvidence !== null && !isRefundRepairManualEvidence(v.beneficiaryEvidence) || v.paymentEvidence !== null && !isRefundRepairManualEvidence(v.paymentEvidence) ||
    !['localMovementsVerified', 'originalRailTerminalVerified', 'bankReviewRequired', 'riskReviewRequired', 'canPrepare', 'canAttest', 'canVoid'].every(k => typeof v[k] === 'boolean') ||
    !manualReason(v.reason) || !manualBasis(v.verificationBasis) || !manualNone(v)) throw fail();
  if (scope === 'own' && (v.instructionHash !== null || v.beneficiaryEvidence !== null || v.paymentEvidence !== null || v.canPrepare || v.canAttest || v.canVoid)) throw fail();
  if ((v.canPrepare || v.canAttest) && (!manualRevision(v.sourceRevision) || !v.localMovementsVerified || !v.originalRailTerminalVerified || v.bankReviewRequired || v.riskReviewRequired || !cents(v.remainingCents) || v.remainingCents < 1)) throw fail();
  if (v.canAttest && (v.state !== 'prepared' || !manualInstruction(v.instructionId) || !isRefundRepairManualEvidence(v.beneficiaryEvidence))) throw fail();
  if (v.canVoid && (v.state !== 'prepared' || !manualInstruction(v.instructionId))) throw fail();
  if (v.state === 'manual_operator_attested' && v.verificationBasis !== 'human_operator_attestation') throw fail();
  return v as unknown as RefundRepairManualSource;
}
export function isRefundRepairManualCommand(v: unknown): v is RefundRepairManualCommand {
  if (!record(v) || !exact(v, ['transactionId', 'refundIntentId', 'action', 'previewId', 'sourceHash', 'sourceRevision', 'amountCents', 'currency', 'beneficiaryId', 'instructionId',
    'beneficiaryEvidence', 'paymentEvidence', 'attestation', 'note', 'partyMessage', 'acknowledged']) || !id(v.transactionId) || !id(v.refundIntentId) || !manualAction(v.action) ||
    !hash(v.previewId) || !hash(v.sourceHash) || !manualRevision(v.sourceRevision) || !cents(v.amountCents) || v.amountCents < 1 || v.currency !== 'CAD' || !manualActor(v.beneficiaryId) ||
    typeof v.note !== 'string' || !v.note.length || v.note.length > 2000 || v.note.trim() !== v.note || typeof v.partyMessage !== 'string' || !v.partyMessage.length || v.partyMessage.length > 2000 || v.partyMessage.trim() !== v.partyMessage ||
    v.acknowledged !== true || !record(v.attestation) || !exact(v.attestation, ['version', 'beneficiaryIdentityAndDestinationVerified', 'transferExecutedAndReceiptVerified', 'neverExecuted']) ||
    v.attestation.version !== 'manual_bank_transfer_human_v1' || !['beneficiaryIdentityAndDestinationVerified', 'transferExecutedAndReceiptVerified', 'neverExecuted'].every(k => typeof (v.attestation as Record<string, unknown>)[k] === 'boolean')) return false;
  const a = v.attestation;
  return isRefundRepairManualEvidence(v.beneficiaryEvidence) && a.beneficiaryIdentityAndDestinationVerified === true && (v.action === 'prepare_manual_bank_transfer'
    ? v.instructionId === null && v.paymentEvidence === null && a.transferExecutedAndReceiptVerified === false && a.neverExecuted === false
    : manualInstruction(v.instructionId) && (v.action === 'attest_manual_bank_transfer'
      ? isRefundRepairManualEvidence(v.paymentEvidence) && a.transferExecutedAndReceiptVerified === true && a.neverExecuted === false
      : v.paymentEvidence === null && a.transferExecutedAndReceiptVerified === false && a.neverExecuted === true));
}
export const isRefundRepairManualAttempt = (v: unknown, uid: string): v is RefundRepairManualAttempt => record(v) && exact(v, ['version', 'uid', 'requestId', 'command']) &&
  v.version === 2 && v.uid === uid && manualRequest(v.requestId) && isRefundRepairManualCommand(v.command);
export const isRefundRepairManualEvidenceAttempt = (v: unknown, uid: string): v is RefundRepairManualEvidenceAttempt => record(v) &&
  exact(v, ['version', 'uid', 'requestId', 'context', 'file', 'inputHash', 'beneficiaryId', 'amountCents']) && v.version === 2 && v.uid === uid && manualRequest(v.requestId) && hash(v.inputHash) &&
  manualActor(v.beneficiaryId) && cents(v.amountCents) && v.amountCents > 0 && manualFile(v.file) && record(v.context) &&
  exact(v.context, ['transactionId', 'refundIntentId', 'previewId', 'sourceHash', 'sourceRevision', 'purpose', 'instructionId']) && id(v.context.transactionId) && id(v.context.refundIntentId) &&
  hash(v.context.previewId) && hash(v.context.sourceHash) && manualRevision(v.context.sourceRevision) && ['beneficiary_verification', 'payment_execution'].includes(String(v.context.purpose)) &&
  (v.context.purpose === 'beneficiary_verification' ? v.context.instructionId === null : manualInstruction(v.context.instructionId));
async function manualRpc(uid: string, input: Record<string, unknown>, current: () => void) {
  current(); const response = await httpsCallable<Record<string, unknown>, unknown>(functions, 'adminRefundTransaction')({...input, capability: REFUND_REPAIR_MANUAL_CAPABILITY, expectedUid: uid}); current(); return response.data;
}
export const RefundRepairManualService = {
  async source(uid: string, transactionId: string, refundIntentId: string, scope: 'own' | 'admin', assertContext: () => void): Promise<RefundRepairManualObservation> {
    const current = manualGuard(uid, assertContext); if (!id(transactionId) || !id(refundIntentId)) throw fail();
    const v = await manualRpc(uid, {mode: 'purchase_refund_repair_source_observe', transactionId, refundIntentId, scope}, current);
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'scope', 'transactionId', 'sourceRevision', 'selected', 'reason']) || v.protocol !== 'purchase_refund_external_manual_observation_v1' ||
      v.actorId !== uid || v.scope !== scope || v.transactionId !== transactionId || !revision(v.sourceRevision) || !manualReason(v.reason)) throw fail();
    if (v.selected !== null) {const selected = parseManualSource(v.selected, transactionId, refundIntentId, scope); if (selected.sourceRevision !== v.sourceRevision || v.reason !== null) throw fail();}
    current(); return v as unknown as RefundRepairManualObservation;
  },
  async preview(uid: string, transactionId: string, refundIntentId: string, chosen: RefundRepairManualAction, assertContext: () => void): Promise<RefundRepairManualPreview> {
    const current = manualGuard(uid, assertContext); if (!id(transactionId) || !id(refundIntentId) || !manualAction(chosen)) throw fail();
    const v = await manualRpc(uid, {mode: 'purchase_refund_repair_preview', transactionId, refundIntentId, action: chosen}, current);
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'previewId', 'action', 'source', 'bankArrivalVerified', 'stripeSettlementGranted']) || v.protocol !== 'purchase_refund_external_manual_preview_v1' ||
      v.actorId !== uid || !hash(v.previewId) || v.action !== chosen || v.bankArrivalVerified !== false || v.stripeSettlementGranted !== false) throw fail();
    parseManualSource(v.source, transactionId, refundIntentId, 'admin'); current(); return v as unknown as RefundRepairManualPreview;
  },
  async command(a: RefundRepairManualAttempt, modeAction: 'execute' | 'observe' | 'recover' | 'neutralize', assertContext: () => void): Promise<RefundRepairManualReceipt> {
    const current = manualGuard(a.uid, assertContext); if (!isRefundRepairManualAttempt(a, a.uid)) throw fail();
    const v = await manualRpc(a.uid, {mode: 'purchase_refund_repair_command', requestId: a.requestId, modeAction, command: a.command}, current);
    const expectedHash = await hashValue(a.command); current();
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'command', 'payloadHash', 'state', 'reason', 'instructionId', 'manualState', 'recordedAt', 'verificationBasis', ...MANUAL_EFFECTS]) ||
      v.protocol !== 'purchase_refund_external_manual_command_v1' || v.actorId !== a.uid || v.requestId !== a.requestId || !equal(v.command, a.command) || v.payloadHash !== expectedHash ||
      !['unrecorded', 'committed', 'not_executed'].includes(String(v.state)) || !manualReason(v.reason) || v.instructionId !== null && !manualInstruction(v.instructionId) ||
      !manualState(v.manualState) || !manualBasis(v.verificationBasis) || !manualNone(v) || (v.state === 'unrecorded' ? v.recordedAt !== null : !iso(v.recordedAt)) ||
      v.state === 'committed' && (v.reason !== null || v.manualState !== ({prepare_manual_bank_transfer: 'prepared', attest_manual_bank_transfer: 'manual_operator_attested', void_unexecuted_manual_instruction: 'voided'}[a.command.action])) ||
      v.manualState === 'manual_operator_attested' && v.verificationBasis !== 'human_operator_attestation') throw fail();
    current(); return v as unknown as RefundRepairManualReceipt;
  },
  async prepareImage(uid: string, uri: string, assertContext: () => void): Promise<{file: RefundRepairManualFile; bytes: Uint8Array}> {
    const current = manualGuard(uid, assertContext); if (typeof uri !== 'string' || !/^(file|content|blob):/.test(uri)) throw fail();
    let prepared: File | null = null;
    try {const preparedUri = await prepareImageForUpload(uri, {maxDimension: 1200, quality: 0.75}); current(); prepared = new File(preparedUri);
      if (!prepared.exists || prepared.size < 1 || prepared.size > 2097152) throw fail();
      const bytes = await prepared.bytes(); current(); const dimensions = productReviewJpegDimensions(bytes), sha256 = await productReviewByteHash(bytes); current();
      const file = {sha256, byteLength: bytes.length, contentType: 'image/jpeg' as const, ...dimensions}; if (!manualFile(file)) throw fail(); return {file, bytes};
    } finally {if (prepared && prepared.uri !== uri && prepared.exists) {try {prepared.delete();} catch { /* Only this generated local cache is eligible for cleanup. */ }}}
  },
  async evidenceAttempt(uid: string, requestId: string, context: RefundRepairManualEvidenceContext, file: RefundRepairManualFile, beneficiaryId: string, amountCents: number,
    execution: {transferReference: string; executedDate: string} | null, assertContext: () => void): Promise<RefundRepairManualEvidenceAttempt> {
    const current = manualGuard(uid, assertContext);
    const normalized = execution ? execution.transferReference.trim().normalize('NFC') : null;
    if (execution && (!normalized || normalized.length < 3 || normalized.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized) || !/^\d{4}-\d{2}-\d{2}$/.test(execution.executedDate) ||
      !Number.isFinite(Date.parse(execution.executedDate)) || new Date(execution.executedDate).toISOString().slice(0, 10) !== execution.executedDate)) throw fail();
    if (context.purpose === 'payment_execution' ? !execution : execution !== null) throw fail();
    const referenceHash = normalized ? await hashValue(normalized.toUpperCase()) : null; current();
    const inputHash = await hashValue({...context, file, execution: execution ? {referenceHash, executedDate: execution.executedDate} : null}); current();
    const result: RefundRepairManualEvidenceAttempt = {version: 2, uid, requestId, context, file, inputHash, beneficiaryId, amountCents};
    if (!isRefundRepairManualEvidenceAttempt(result, uid)) throw fail(); return result;
  },
  async evidence(a: RefundRepairManualEvidenceAttempt, modeAction: 'execute' | 'observe' | 'neutralize', assertContext: () => void,
    payload?: {bytes: Uint8Array; execution: {transferReference: string; executedDate: string} | null}): Promise<RefundRepairManualEvidenceReceipt> {
    const current = manualGuard(a.uid, assertContext); if (!isRefundRepairManualEvidenceAttempt(a, a.uid)) throw fail();
    let input: Record<string, unknown> = {mode: 'purchase_refund_manual_evidence_upload', requestId: a.requestId, modeAction, transactionId: a.context.transactionId, refundIntentId: a.context.refundIntentId, expectedInputHash: a.inputHash};
    if (modeAction === 'execute') {
      if (!payload || payload.bytes.length !== a.file.byteLength || await productReviewByteHash(payload.bytes) !== a.file.sha256 ||
        !equal(productReviewJpegDimensions(payload.bytes), {width: a.file.width, height: a.file.height})) throw fail(); current();
      const checked = await this.evidenceAttempt(a.uid, a.requestId, a.context, a.file, a.beneficiaryId, a.amountCents, payload.execution, current);
      if (!equal(checked, a)) throw fail(); current();
      input = {mode: 'purchase_refund_manual_evidence_upload', requestId: a.requestId, modeAction, ...a.context, file: a.file,
        bytesBase64: productReviewEncodeBytes(payload.bytes), execution: payload.execution ? {...payload.execution, transferReference: payload.execution.transferReference.trim().normalize('NFC')} : null};
    }
    const v = await manualRpc(a.uid, input, current), expectedId = `me_${await hashValue([a.uid, a.requestId])}`; current();
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'transactionId', 'refundIntentId', 'beneficiaryId', 'amountCents', 'currency', 'purpose', 'instructionId', 'inputHash', 'state', 'reason', 'evidence', 'recordedAt', 'externalAuthenticityVerified', 'bankArrivalVerified']) ||
      v.protocol !== 'purchase_refund_external_manual_evidence_v1' || v.actorId !== a.uid || v.requestId !== a.requestId || v.transactionId !== a.context.transactionId ||
      v.refundIntentId !== a.context.refundIntentId || v.beneficiaryId !== null && v.beneficiaryId !== a.beneficiaryId || v.amountCents !== null && v.amountCents !== a.amountCents ||
      v.currency !== 'CAD' || v.purpose !== null && v.purpose !== a.context.purpose || v.instructionId !== null && v.instructionId !== a.context.instructionId ||
      v.inputHash !== a.inputHash || !manualReason(v.reason) || !['unrecorded', 'upload_unknown', 'stored', 'stored_requires_review', 'not_executed'].includes(String(v.state)) ||
      v.bankArrivalVerified !== false || v.externalAuthenticityVerified !== false || (v.state === 'stored' || v.state === 'stored_requires_review'
        ? !isRefundRepairManualEvidence(v.evidence) || v.evidence.evidenceId !== expectedId || v.evidence.sha256 !== a.file.sha256 || !iso(v.recordedAt) ||
          v.beneficiaryId !== a.beneficiaryId || v.amountCents !== a.amountCents || v.purpose !== a.context.purpose || v.instructionId !== a.context.instructionId
        : v.evidence !== null || v.recordedAt !== null && !iso(v.recordedAt))) throw fail();
    current(); return v as unknown as RefundRepairManualEvidenceReceipt;
  },
  async file(uid: string, transactionId: string, refundIntentId: string, evidence: RefundRepairManualEvidenceReference, assertContext: () => void): Promise<RefundRepairManualEvidencePixels> {
    const current = manualGuard(uid, assertContext); if (!id(transactionId) || !id(refundIntentId) || !isRefundRepairManualEvidence(evidence)) throw fail();
    const v = await manualRpc(uid, {mode: 'purchase_refund_manual_evidence_read', transactionId, refundIntentId, evidence}, current);
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'transactionId', 'refundIntentId', 'evidence', 'purpose', 'dataUrl', 'bankArrivalVerified']) ||
      v.protocol !== 'purchase_refund_external_manual_evidence_file_v1' || v.actorId !== uid || v.transactionId !== transactionId || v.refundIntentId !== refundIntentId || !equal(v.evidence, evidence) ||
      !['beneficiary_verification', 'payment_execution'].includes(String(v.purpose)) || v.bankArrivalVerified !== false || typeof v.dataUrl !== 'string' ||
      !v.dataUrl.startsWith('data:image/jpeg;base64,') || v.dataUrl.length > 2796227) throw fail();
    const encoded = v.dataUrl.slice('data:image/jpeg;base64,'.length);
    if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw fail();
    const decoded = atob(encoded), bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    if (productReviewEncodeBytes(bytes) !== encoded || bytes.length > 2097152 || await productReviewByteHash(bytes) !== evidence.sha256) throw fail(); current();
    const size = productReviewJpegDimensions(bytes); if (size.width > 1200 || size.height > 1200 || size.width < 1 || size.height < 1) throw fail(); current();
    return v as unknown as RefundRepairManualEvidencePixels;
  },
};
