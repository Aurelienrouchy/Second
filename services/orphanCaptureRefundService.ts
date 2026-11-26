import { httpsCallable } from 'firebase/functions';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { auth, functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent, staleTradeOperation } from '@/services/tradeOperation';
import { purchaseRefundRecord as object, purchaseRefundExact as exact, purchaseRefundHash as hash,
  purchaseRefundCents as cents, purchaseRefundIso as iso, purchaseRefundCanonical as canonical,
  purchaseRefundEqual as equal } from '@/utils/purchaseRefundContract';
import { isDeclaredSupportAccountId as uid } from '@/utils/supportAccountIdentity';
import { ORPHAN_CAPTURE_REFUND_CAPABILITY as capability, type OrphanCaptureRefundSource as Source,
  type OrphanCaptureRefundPreview as Preview, type OrphanCaptureRefundCommand as Command,
  type OrphanCaptureRefundReference as Reference, type OrphanCaptureRefundReceipt as Receipt } from '@/types/orphanCaptureRefund';

const fail = () => new Error('Relisez la même capture et le même reçu. Un résultat inconnu n’autorise aucune nouvelle demande de remboursement.');
const operation = (v: unknown): v is string => typeof v === 'string' && /^capture_[a-f0-9]{64}$/.test(v);
const request = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v);
const stripe = (v: unknown, prefix: string) => typeof v === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]{1,190}$`).test(v);
const nullableCents = (v: unknown) => v === null || cents(v);
const reason = (v: unknown) => v === null || typeof v === 'string' && v.length > 0 && v.length <= 4000;
const flags = ['originalPaymentMethodOnly', 'orderCreated', 'walletEffect', 'stockEffect', 'bankArrivalVerified'];
const effects = (v: Record<string, unknown>) => v.originalPaymentMethodOnly === true && flags.slice(1).every(k => v[k] === false);
const digest = (v: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(v)));
function guard(owner: string, assertContext: () => void) {
  const sdk = auth.currentUser, session = captureTradeSession(owner);
  const current = () => {assertTradeSessionCurrent(session); if (auth.currentUser !== sdk) throw staleTradeOperation(); assertContext();};
  current(); return current;
}
export function isOrphanCaptureRefundReference(v: unknown, owner: string): v is Reference {
  return object(v) && exact(v, ['uid', 'requestId', 'operationId', 'inputHash']) && uid(owner) && v.uid === owner && request(v.requestId) && operation(v.operationId) && hash(v.inputHash);
}
export function isOrphanCaptureRefundCommand(v: unknown): v is Command {
  return object(v) && exact(v, ['operationId', 'previewId', 'sourceHash', 'sourceRevision', 'paymentIntentId', 'chargeId', 'amountCents', 'currency', 'statementVersion', 'acknowledged', 'note']) &&
    operation(v.operationId) && hash(v.previewId) && hash(v.sourceHash) && hash(v.sourceRevision) && stripe(v.paymentIntentId, 'pi') && stripe(v.chargeId, 'ch') && cents(v.amountCents) && v.amountCents > 0 &&
    v.currency === 'CAD' && v.statementVersion === capability && v.acknowledged === true && typeof v.note === 'string' && v.note.trim() === v.note && v.note.length > 0 && v.note.length <= 2000;
}
async function captureMatches(operationId: string, paymentIntentId: string, current: () => void) {
  const value = await digestStringAsync(CryptoDigestAlgorithm.SHA256, paymentIntentId); current(); if (operationId !== `capture_${value}`) throw fail();
}
async function parseSource(v: unknown, operationId: string, current: () => void): Promise<Source> {
  if (!object(v) || !exact(v, ['protocol', 'operationId', 'paymentIntentId', 'chargeId', 'accountId', 'livemode', 'currency', 'capturedCents', 'refundableCents', 'sourceHash', 'sourceRevision', 'state', 'reason', 'canRefund', 'canResume', ...flags]) ||
    v.protocol !== 'orphan_capture_refund_source_v1' || v.operationId !== operationId || !operation(operationId) || v.paymentIntentId !== null && !stripe(v.paymentIntentId, 'pi') || v.chargeId !== null && !stripe(v.chargeId, 'ch') ||
    v.accountId !== null && !stripe(v.accountId, 'acct') || v.livemode !== null && typeof v.livemode !== 'boolean' || v.currency !== 'CAD' || !nullableCents(v.capturedCents) || !nullableCents(v.refundableCents) ||
    cents(v.capturedCents) && cents(v.refundableCents) && v.refundableCents > v.capturedCents || !hash(v.sourceHash) || !hash(v.sourceRevision) ||
    !['available', 'reserved', 'outcome_unknown', 'pending', 'requires_action', 'succeeded', 'failed', 'canceled', 'unqualified'].includes(String(v.state)) || !reason(v.reason) || typeof v.canRefund !== 'boolean' || typeof v.canResume !== 'boolean' || !effects(v)) throw fail();
  if (v.paymentIntentId !== null) await captureMatches(operationId, String(v.paymentIntentId), current);
  if ((v.canRefund || v.canResume) && (!stripe(v.paymentIntentId, 'pi') || !stripe(v.chargeId, 'ch') || !stripe(v.accountId, 'acct') || typeof v.livemode !== 'boolean' || !cents(v.capturedCents) || !cents(v.refundableCents) || v.refundableCents < 1 || v.reason !== null || v.canRefund && v.canResume)) throw fail();
  if (v.canResume && v.state !== 'reserved' || v.canRefund && ['reserved', 'outcome_unknown', 'pending', 'requires_action'].includes(String(v.state))) throw fail();
  current(); return v as unknown as Source;
}
async function rpc(owner: string, input: Record<string, unknown>, current: () => void) {
  current(); const result = await httpsCallable<Record<string, unknown>, unknown>(functions, 'adminRefundTransaction')({...input, capability, expectedUid: owner}); current(); return result.data;
}
async function parseReceipt(v: unknown, a: Reference, current: () => void): Promise<Receipt> {
  const commandId = `ocr_${await digest([a.uid, a.requestId])}`; current();
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'commandId', 'operationId', 'inputHash', 'state', 'paymentIntentId', 'chargeId', 'refundId', 'amountCents', 'currency', 'recordedAt', 'providerStatus', 'reason', 'nativeRecordPresent', ...flags]) ||
    v.protocol !== 'orphan_capture_refund_receipt_v1' || v.actorId !== a.uid || v.requestId !== a.requestId || v.commandId !== commandId || v.operationId !== a.operationId || v.inputHash !== a.inputHash ||
    !['unrecorded', 'not_executed', 'reserved', 'outcome_unknown', 'pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(String(v.state)) || v.paymentIntentId !== null && !stripe(v.paymentIntentId, 'pi') ||
    v.chargeId !== null && !stripe(v.chargeId, 'ch') || v.refundId !== null && !stripe(v.refundId, 're') || !nullableCents(v.amountCents) || v.currency !== 'CAD' || v.recordedAt !== null && !iso(v.recordedAt) ||
    v.providerStatus !== null && !['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(String(v.providerStatus)) || !reason(v.reason) || typeof v.nativeRecordPresent !== 'boolean' || !effects(v)) throw fail();
  if (v.paymentIntentId !== null) await captureMatches(a.operationId, String(v.paymentIntentId), current);
  if (!['unrecorded', 'not_executed'].includes(String(v.state)) && (!stripe(v.paymentIntentId, 'pi') || !stripe(v.chargeId, 'ch') || !cents(v.amountCents) || v.amountCents < 1)) throw fail();
  if (['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(String(v.state)) && (v.providerStatus !== v.state || !stripe(v.refundId, 're'))) throw fail();
  if (v.state === 'not_executed' && (!v.nativeRecordPresent || !iso(v.recordedAt)) || v.state === 'unrecorded' && (v.nativeRecordPresent || v.recordedAt !== null || v.refundId !== null)) throw fail();
  current(); return v as unknown as Receipt;
}
export const OrphanCaptureRefundService = {
  async source(owner: string, operationId: string, assertContext: () => void): Promise<Source> {
    const current = guard(owner, assertContext); if (!operation(operationId)) throw fail();
    const v = await parseSource(await rpc(owner, {mode: 'orphan_capture_source', operationId}, current), operationId, current);
    if (v.canRefund || v.canResume) throw fail(); return v;
  },
  async preview(owner: string, operationId: string, assertContext: () => void, continuation?: Reference): Promise<Preview> {
    const current = guard(owner, assertContext); if (!operation(operationId) || continuation && (!isOrphanCaptureRefundReference(continuation, owner) || continuation.operationId !== operationId)) throw fail();
    const v = await rpc(owner, {mode: 'orphan_capture_preview', operationId, ...(continuation ? {requestId: continuation.requestId, expectedInputHash: continuation.inputHash} : {})}, current);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'previewId', 'source']) || v.protocol !== 'orphan_capture_refund_preview_v1' || v.actorId !== owner || !hash(v.previewId)) throw fail();
    await parseSource(v.source, operationId, current); current(); return v as unknown as Preview;
  },
  async reference(owner: string, requestId: string, command: Command, assertContext: () => void): Promise<Reference> {
    const current = guard(owner, assertContext); if (!isOrphanCaptureRefundCommand(command) || !uid(owner) || !request(requestId)) throw fail();
    await captureMatches(command.operationId, command.paymentIntentId, current); const inputHash = await digest(command); current(); return {uid: owner, requestId, operationId: command.operationId, inputHash};
  },
  async command(a: Reference, modeAction: 'execute' | 'observe' | 'neutralize', assertContext: () => void, command?: Command): Promise<Receipt> {
    const current = guard(a.uid, assertContext); if (!isOrphanCaptureRefundReference(a, a.uid)) throw fail();
    let input: Record<string, unknown> = {mode: 'orphan_capture_command', modeAction, requestId: a.requestId, operationId: a.operationId, expectedInputHash: a.inputHash};
    if (modeAction === 'execute') {if (!command || !equal(a, await this.reference(a.uid, a.requestId, command, current))) throw fail(); current(); input = {mode: 'orphan_capture_command', modeAction, requestId: a.requestId, command};}
    const receipt = await parseReceipt(await rpc(a.uid, input, current), a, current);
    if (command && receipt.amountCents !== null && (receipt.amountCents !== command.amountCents || receipt.paymentIntentId !== command.paymentIntentId || receipt.chargeId !== command.chargeId)) throw fail();
    current(); return receipt;
  },
  async resume(a: Reference, preview: Preview, assertContext: () => void): Promise<Receipt> {
    const current = guard(a.uid, assertContext); if (!isOrphanCaptureRefundReference(a, a.uid) || preview.actorId !== a.uid || preview.source.operationId !== a.operationId || !hash(preview.previewId) || !preview.source.canResume || preview.source.state !== 'reserved') throw fail();
    return parseReceipt(await rpc(a.uid, {mode: 'orphan_capture_command', modeAction: 'resume', requestId: a.requestId, operationId: a.operationId, expectedInputHash: a.inputHash, previewId: preview.previewId, acknowledged: true}, current), a, current);
  },
};
