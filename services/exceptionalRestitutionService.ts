import { httpsCallable } from 'firebase/functions';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { auth, functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent, staleTradeOperation } from '@/services/tradeOperation';
import { RefundRepairManualService } from '@/services/refundRepairService';
import { productReviewByteHash, productReviewEncodeBytes, productReviewJpegDimensions } from '@/services/productReviewEvidenceService';
import { purchaseRefundRecord as record, purchaseRefundExact as exact, purchaseRefundHash as hash, purchaseRefundCents as cents,
  purchaseRefundIso as iso, purchaseRefundEqual as equal, purchaseRefundCanonical as canonical } from '@/utils/purchaseRefundContract';
import { isDeclaredSupportAccountId as uid } from '@/utils/supportAccountIdentity';
import { EXCEPTIONAL_RESTITUTION_CAPABILITY, type ExceptionalRestitutionContext as Context, type ExceptionalRestitutionAction as Action,
  type ExceptionalRestitutionSource as Source, type ExceptionalRestitutionPreview as Preview, type ExceptionalRestitutionCommand as Command,
  type ExceptionalRestitutionReceipt as Receipt, type ExceptionalRestitutionEvidenceReference as Evidence,
  type ExceptionalRestitutionEvidenceReceipt as EvidenceReceipt, type ExceptionalRestitutionEvidenceBody as EvidenceBody,
  type ExceptionalRestitutionReference as Reference, type ExceptionalRestitutionPixels as Pixels } from '@/types/exceptionalRestitution';

const fail = () => new Error('La source et le reçu exacts doivent être relus. Aucun nouvel envoi d’argent n’est autorisé par ce résultat.');
const id = (v: unknown): v is string => uid(v) && v.trim() === v;
const named = (v: unknown, prefix: string) => typeof v === 'string' && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(v);
const reason = (v: unknown) => v === null || typeof v === 'string' && v.length > 0 && v.length <= 4000;
const action = (v: unknown): v is Action => ['prepare', 'attest', 'void_never_executed'].includes(String(v));
const purpose = (v: unknown) => ['identity_destination', 'harm_or_authority', 'execution'].includes(String(v));
const state = (v: unknown) => ['unqualified', 'available', 'prepared', 'operator_attested', 'voided', 'reconciliation_required'].includes(String(v));
const effects = ['bankArrivalVerified', 'stripeSettlementGranted', 'accountAccessGranted'];
const noEffects = (v: Record<string, unknown>) => effects.every(k => v[k] === false);
const nullableCents = (v: unknown) => v === null || cents(v);
const debtCredit = (v: Context) => v.kind === 'refund_error' && v.harm === 'seller_debt_compensation';
const walletCredit = (v: unknown, amount: unknown) => v === null || record(v) && exact(v, ['debtOffsetCents', 'balanceCreditCents', 'recordedAt']) &&
  cents(v.debtOffsetCents) && cents(v.balanceCreditCents) && cents(v.debtOffsetCents + v.balanceCreditCents) && v.debtOffsetCents + v.balanceCreditCents > 0 &&
  (amount === null || v.debtOffsetCents + v.balanceCreditCents === amount) && iso(v.recordedAt);
const hashValue = (v: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(v)));
function guard(uid: string, current: () => void) {
  const owner = auth.currentUser, session = captureTradeSession(uid);
  const check = () => {assertTradeSessionCurrent(session); if (auth.currentUser !== owner) throw staleTradeOperation(); current();};
  check(); return check;
}
export function isExceptionalRestitutionContext(v: unknown): v is Context {
  return record(v) && (v.kind === 'withdrawal_misdirection' ? exact(v, ['kind', 'withdrawalRequestId']) && id(v.withdrawalRequestId)
    : v.kind === 'wallet_restitution' ? exact(v, ['kind', 'ownerId', 'supportRequestId']) && uid(v.ownerId) && id(v.supportRequestId)
      : v.kind === 'refund_error' && exact(v, ['kind', 'transactionId', 'refundIntentId', 'harm']) && id(v.transactionId) && id(v.refundIntentId) &&
        ['buyer_shortfall', 'buyer_wrong_attribution', 'seller_undue_debit', 'seller_debt_compensation'].includes(String(v.harm)));
}
export function isExceptionalRestitutionEvidence(v: unknown): v is Evidence {
  return record(v) && exact(v, ['evidenceId', 'generation', 'sha256', 'contentHash']) && named(v.evidenceId, 'xe') &&
    typeof v.generation === 'string' && /^\d{1,30}$/.test(v.generation) && hash(v.sha256) && hash(v.contentHash);
}
export function isExceptionalRestitutionReference(v: unknown, owner: string): v is Reference {
  return record(v) && exact(v, ['version', 'uid', 'requestId', 'kind', 'context', 'caseId', 'inputHash', 'slotHash']) && v.version === 3 && v.uid === owner && uid(owner) &&
    typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && ['command', 'evidence'].includes(String(v.kind)) &&
    isExceptionalRestitutionContext(v.context) && named(v.caseId, 'exception') && hash(v.inputHash) && hash(v.slotHash);
}
function parseSource(v: unknown, context: Context, caseId: string, scope: 'own' | 'admin'): Source {
  if (!record(v) || !exact(v, ['protocol', 'context', 'caseId', 'sourceHash', 'sourceRevision', 'ownerId', 'beneficiaryId', 'currency', 'maximumCents', 'amountCents',
    'funding', 'state', 'instructionId', 'identityEvidence', 'authorityEvidence', 'executionEvidence', 'canPrepare', 'canAttest', 'canVoid', 'reason', ...effects, ...(debtCredit(context) ? ['nativeWalletCredit'] : [])]) ||
    v.protocol !== 'exceptional_restitution_source_v1' || !equal(v.context, context) || v.caseId !== caseId || !hash(v.sourceHash) || !hash(v.sourceRevision) ||
    v.ownerId !== null && !uid(v.ownerId) || v.beneficiaryId !== null && !uid(v.beneficiaryId) || v.currency !== 'CAD' || !nullableCents(v.maximumCents) || !nullableCents(v.amountCents) ||
    cents(v.amountCents) && cents(v.maximumCents) && v.amountCents > v.maximumCents || !(debtCredit(context) ? [null, 'seconde_wallet_compensation'] : [null, 'seconde_compensation', 'existing_wallet', 'original_refund_allocation']).includes(v.funding as string | null) ||
    !state(v.state) || v.instructionId !== null && !named(v.instructionId, 'er') || ['identityEvidence', 'authorityEvidence', 'executionEvidence'].some(k => v[k] !== null && !isExceptionalRestitutionEvidence(v[k])) ||
    !['canPrepare', 'canAttest', 'canVoid'].every(k => typeof v[k] === 'boolean') || !reason(v.reason) || !noEffects(v)) throw fail();
  if (scope === 'own' && (v.identityEvidence !== null || v.authorityEvidence !== null || v.executionEvidence !== null || v.canPrepare || v.canAttest || v.canVoid)) throw fail();
  if ((v.canPrepare || v.canAttest || v.canVoid) && (!uid(v.beneficiaryId) || !cents(v.amountCents) || v.amountCents < 1 || !cents(v.maximumCents) || v.funding === 'original_refund_allocation')) throw fail();
  if ((v.canAttest || v.canVoid) && (!named(v.instructionId, 'er') || !isExceptionalRestitutionEvidence(v.identityEvidence) || !isExceptionalRestitutionEvidence(v.authorityEvidence))) throw fail();
  if (v.canAttest && v.state !== 'prepared' || v.canVoid && v.state !== 'prepared' && !(context.kind === 'withdrawal_misdirection' && v.state === 'reconciliation_required')) throw fail();
  if (debtCredit(context) && (!walletCredit(v.nativeWalletCredit, v.amountCents) || v.executionEvidence !== null || v.state === 'operator_attested' && v.nativeWalletCredit === null)) throw fail();
  return v as unknown as Source;
}
export function isExceptionalRestitutionCommand(v: unknown): v is Command {
  if (!record(v) || !exact(v, ['context', 'action', 'previewId', 'sourceHash', 'sourceRevision', 'instructionId', 'amountCents', 'currency', 'beneficiaryId',
    'identityEvidence', 'authorityEvidence', 'executionEvidence', 'attestation', 'note', 'partyMessage', 'acknowledged']) || !isExceptionalRestitutionContext(v.context) ||
    !action(v.action) || !hash(v.previewId) || !hash(v.sourceHash) || !hash(v.sourceRevision) || !cents(v.amountCents) || v.amountCents < 1 || v.currency !== 'CAD' || !uid(v.beneficiaryId) ||
    !isExceptionalRestitutionEvidence(v.identityEvidence) || !isExceptionalRestitutionEvidence(v.authorityEvidence) || v.identityEvidence.evidenceId === v.authorityEvidence.evidenceId ||
    typeof v.note !== 'string' || !v.note.trim() || v.note.trim() !== v.note || v.note.length > 2000 || typeof v.partyMessage !== 'string' || !v.partyMessage.trim() || v.partyMessage.trim() !== v.partyMessage || v.partyMessage.length > 2000 ||
    v.acknowledged !== true || !record(v.attestation) || !exact(v.attestation, ['version', 'nativeBeneficiaryAndDestinationVerified', 'harmOrLegalAuthorityVerified', 'transferExecutedAndReceiptVerified', 'neverExecuted', ...(debtCredit(v.context) ? ['nativeCompensationCreditVerified'] : [])]) ||
    v.attestation.version !== 'exceptional_restitution_human_v1' || v.attestation.nativeBeneficiaryAndDestinationVerified !== true || v.attestation.harmOrLegalAuthorityVerified !== true) return false;
  const a = v.attestation;
  if (debtCredit(v.context)) return a.nativeCompensationCreditVerified === true && v.executionEvidence === null && a.transferExecutedAndReceiptVerified === false &&
    (v.action === 'prepare' ? v.instructionId === null && a.neverExecuted === false : named(v.instructionId, 'er') && a.neverExecuted === (v.action === 'void_never_executed'));
  return v.action === 'prepare' ? v.instructionId === null && v.executionEvidence === null && a.transferExecutedAndReceiptVerified === false && a.neverExecuted === false
    : named(v.instructionId, 'er') && (v.action === 'attest' ? isExceptionalRestitutionEvidence(v.executionEvidence) &&
      v.executionEvidence.evidenceId !== v.identityEvidence.evidenceId && v.executionEvidence.evidenceId !== v.authorityEvidence.evidenceId && a.transferExecutedAndReceiptVerified === true && a.neverExecuted === false
      : v.executionEvidence === null && a.transferExecutedAndReceiptVerified === false && a.neverExecuted === true);
}
async function rpc(owner: string, input: Record<string, unknown>, current: () => void) {
  current(); const response = await httpsCallable<Record<string, unknown>, unknown>(functions, 'adminRefundTransaction')({...input, capability: EXCEPTIONAL_RESTITUTION_CAPABILITY, expectedUid: owner}); current(); return response.data;
}
const fileValid = (v: unknown) => record(v) && exact(v, ['sha256', 'byteLength', 'contentType', 'width', 'height']) && hash(v.sha256) && v.contentType === 'image/jpeg' &&
  ['byteLength', 'width', 'height'].every(k => cents(v[k]) && v[k] > 0) && Number(v.byteLength) <= 2097152 && Number(v.width) <= 1200 && Number(v.height) <= 1200;
async function reference(owner: string, requestId: string, kind: Reference['kind'], context: Context, inputHash: string, slot: unknown, current: () => void): Promise<Reference> {
  const caseId = `exception_${await hashValue(context)}`; current(); const slotHash = await hashValue(slot); current();
  const result: Reference = {version: 3, uid: owner, requestId, kind, context, caseId, inputHash, slotHash};
  if (!isExceptionalRestitutionReference(result, owner)) throw fail(); return result;
}
async function evidenceHash(body: EvidenceBody, current: () => void) {
  const execution = body.execution, normalized = execution?.transferReference.trim().normalize('NFC');
  if (body.purpose === 'execution' ? !execution : execution !== null) throw fail();
  if (execution && (!normalized || normalized.length < 3 || normalized.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized) || !/^\d{4}-\d{2}-\d{2}$/.test(execution.executedDate) ||
    !Number.isFinite(Date.parse(execution.executedDate)) || new Date(execution.executedDate).toISOString().slice(0, 10) !== execution.executedDate)) throw fail();
  const referenceHash = normalized ? await hashValue(normalized.toUpperCase()) : null; current();
  const inputHash = await hashValue({context: body.context, previewId: body.previewId, sourceHash: body.sourceHash, sourceRevision: body.sourceRevision,
    purpose: body.purpose, instructionId: body.instructionId, file: body.file, execution: execution ? {referenceHash, executedDate: execution.executedDate} : null}); current(); return inputHash;
}
export const ExceptionalRestitutionService = {
  async validateReference(a: Reference, assertContext: () => void) {const current = guard(a.uid, assertContext); if (!isExceptionalRestitutionReference(a, a.uid) || a.caseId !== `exception_${await hashValue(a.context)}`) throw fail(); current();},
  async source(owner: string, context: Context, scope: 'own' | 'admin', assertContext: () => void): Promise<Source> {
    const current = guard(owner, assertContext); if (!isExceptionalRestitutionContext(context)) throw fail(); const caseId = `exception_${await hashValue(context)}`; current();
    const value = await rpc(owner, {mode: 'exceptional_restitution_source', context, scope}, current); const parsed = parseSource(value, context, caseId, scope); current(); return parsed;
  },
  async preview(owner: string, context: Context, chosen: Action, amountCents: number | null, assertContext: () => void): Promise<Preview> {
    const current = guard(owner, assertContext); if (!isExceptionalRestitutionContext(context) || !action(chosen) || amountCents !== null && (!cents(amountCents) || amountCents < 1)) throw fail();
    if (debtCredit(context) && amountCents !== null) throw fail();
    const caseId = `exception_${await hashValue(context)}`; current(); const v = await rpc(owner, {mode: 'exceptional_restitution_preview', context, action: chosen, amountCents}, current);
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'action', 'previewId', 'source']) || v.protocol !== 'exceptional_restitution_preview_v1' || v.actorId !== owner || v.action !== chosen || !hash(v.previewId)) throw fail();
    parseSource(v.source, context, caseId, 'admin'); current(); return v as unknown as Preview;
  },
  async commandReference(owner: string, requestId: string, command: Command, assertContext: () => void) {
    const current = guard(owner, assertContext); if (!isExceptionalRestitutionCommand(command)) throw fail(); const inputHash = await hashValue(command); current();
    return reference(owner, requestId, 'command', command.context, inputHash, {kind: 'command', context: command.context}, current);
  },
  async command(a: Reference, modeAction: 'execute' | 'observe' | 'neutralize', assertContext: () => void, command?: Command): Promise<Receipt> {
    const current = guard(a.uid, assertContext); await this.validateReference(a, current); current(); if (a.kind !== 'command') throw fail();
    let input: Record<string, unknown> = {mode: 'exceptional_restitution_command', requestId: a.requestId, modeAction, context: a.context, expectedInputHash: a.inputHash};
    if (modeAction === 'execute') {if (!command || !equal(a, await this.commandReference(a.uid, a.requestId, command, current))) throw fail(); current(); input = {mode: 'exceptional_restitution_command', requestId: a.requestId, modeAction, command};}
    const v = await rpc(a.uid, input, current);
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'caseId', 'inputHash', 'state', 'reason', 'instructionId', 'outcome', 'recordedAt', ...effects, ...(debtCredit(a.context) ? ['nativeWalletCredit'] : [])]) ||
      v.protocol !== 'exceptional_restitution_command_v1' || v.actorId !== a.uid || v.requestId !== a.requestId || v.caseId !== a.caseId || v.inputHash !== a.inputHash ||
      !['unrecorded', 'committed', 'not_executed'].includes(String(v.state)) || !reason(v.reason) || v.instructionId !== null && !named(v.instructionId, 'er') ||
      v.outcome !== null && !['prepared', 'operator_attested', 'voided', 'reconciliation_required'].includes(String(v.outcome)) || !noEffects(v) ||
      (v.state === 'unrecorded' ? v.recordedAt !== null : !iso(v.recordedAt)) || v.state === 'committed' && (v.reason !== null || v.outcome === null || !named(v.instructionId, 'er'))) throw fail();
    if (command && v.state === 'committed' && v.outcome !== ({prepare: 'prepared', attest: 'operator_attested', void_never_executed: 'voided'}[command.action])) throw fail();
    if (debtCredit(a.context) && (!walletCredit(v.nativeWalletCredit, command?.amountCents ?? null) || (v.state === 'committed' && v.outcome === 'operator_attested') !== (v.nativeWalletCredit !== null))) throw fail();
    current(); return v as unknown as Receipt;
  },
  prepareImage: RefundRepairManualService.prepareImage,
  async evidenceReference(owner: string, requestId: string, body: EvidenceBody, assertContext: () => void) {
    const current = guard(owner, assertContext); if (!isExceptionalRestitutionContext(body.context) || !hash(body.previewId) || !hash(body.sourceHash) || !hash(body.sourceRevision) || !purpose(body.purpose) ||
      debtCredit(body.context) && body.purpose === 'execution' ||
      (body.purpose === 'execution' ? !named(body.instructionId, 'er') : body.instructionId !== null) || !fileValid(body.file) || !(body.bytes instanceof Uint8Array) ||
      body.bytes.length !== body.file.byteLength || await productReviewByteHash(body.bytes) !== body.file.sha256 || !equal(productReviewJpegDimensions(body.bytes), {width: body.file.width, height: body.file.height})) throw fail(); current();
    const inputHash = await evidenceHash(body, current); current(); return reference(owner, requestId, 'evidence', body.context, inputHash, {kind: 'evidence', context: body.context, purpose: body.purpose}, current);
  },
  async evidence(a: Reference, modeAction: 'execute' | 'observe' | 'neutralize', assertContext: () => void, body?: EvidenceBody): Promise<EvidenceReceipt> {
    const current = guard(a.uid, assertContext); await this.validateReference(a, current); current(); if (a.kind !== 'evidence') throw fail();
    let input: Record<string, unknown> = {mode: 'exceptional_restitution_evidence', requestId: a.requestId, modeAction, context: a.context, expectedInputHash: a.inputHash};
    if (modeAction === 'execute') {if (!body || !equal(a, await this.evidenceReference(a.uid, a.requestId, body, current))) throw fail(); current(); input = {mode: 'exceptional_restitution_evidence', requestId: a.requestId, modeAction,
      context: body.context, previewId: body.previewId, sourceHash: body.sourceHash, sourceRevision: body.sourceRevision, purpose: body.purpose, instructionId: body.instructionId, file: body.file,
      bytesBase64: productReviewEncodeBytes(body.bytes), execution: body.execution ? {...body.execution, transferReference: body.execution.transferReference.trim().normalize('NFC')} : null};}
    const v = await rpc(a.uid, input, current), expectedId = `xe_${await hashValue([a.uid, a.requestId])}`; current();
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'caseId', 'inputHash', 'state', 'reason', 'purpose', 'beneficiaryId', 'amountCents', 'evidence', 'recordedAt', 'bankArrivalVerified', 'externalAuthenticityVerified']) ||
      v.protocol !== 'exceptional_restitution_evidence_v1' || v.actorId !== a.uid || v.requestId !== a.requestId || v.caseId !== a.caseId || v.inputHash !== a.inputHash ||
      !['unrecorded', 'upload_unknown', 'stored', 'stored_requires_review', 'not_executed'].includes(String(v.state)) || !reason(v.reason) || v.purpose !== null && !purpose(v.purpose) ||
      v.beneficiaryId !== null && !uid(v.beneficiaryId) || !nullableCents(v.amountCents) || v.bankArrivalVerified !== false || v.externalAuthenticityVerified !== false ||
      debtCredit(a.context) && v.purpose === 'execution' ||
      (['stored', 'stored_requires_review'].includes(String(v.state)) ? !isExceptionalRestitutionEvidence(v.evidence) || v.evidence.evidenceId !== expectedId || !purpose(v.purpose) || !uid(v.beneficiaryId) || !cents(v.amountCents) || v.amountCents < 1 || !iso(v.recordedAt)
        : v.evidence !== null || v.recordedAt !== null && !iso(v.recordedAt))) throw fail();
    if (body && modeAction === 'execute' && (v.purpose !== body.purpose || !record(v.evidence) || v.evidence.sha256 !== body.file.sha256) && v.state === 'stored') throw fail();
    current(); return v as unknown as EvidenceReceipt;
  },
  async file(owner: string, context: Context, evidence: Evidence, assertContext: () => void): Promise<Pixels> {
    const current = guard(owner, assertContext); if (!isExceptionalRestitutionContext(context) || !isExceptionalRestitutionEvidence(evidence)) throw fail();
    const caseId = `exception_${await hashValue(context)}`; current(); const v = await rpc(owner, {mode: 'exceptional_restitution_evidence_read', context, evidence}, current);
    if (!record(v) || !exact(v, ['protocol', 'actorId', 'caseId', 'evidence', 'purpose', 'dataUrl', 'bankArrivalVerified']) || v.protocol !== 'exceptional_restitution_evidence_file_v1' ||
      v.actorId !== owner || v.caseId !== caseId || !equal(v.evidence, evidence) || !purpose(v.purpose) || debtCredit(context) && v.purpose === 'execution' || v.bankArrivalVerified !== false || typeof v.dataUrl !== 'string' ||
      !v.dataUrl.startsWith('data:image/jpeg;base64,') || v.dataUrl.length > 2796227) throw fail();
    const encoded = v.dataUrl.slice(23); if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw fail();
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    try {if (productReviewEncodeBytes(bytes) !== encoded || bytes.length > 2097152 || await productReviewByteHash(bytes) !== evidence.sha256) throw fail(); current();
      const dimensions = productReviewJpegDimensions(bytes); if (dimensions.width > 1200 || dimensions.height > 1200 || dimensions.width < 1 || dimensions.height < 1) throw fail(); current(); return v as unknown as Pixels;
    } finally {bytes.fill(0);}
  },
};
