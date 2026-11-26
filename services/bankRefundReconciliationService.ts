import {httpsCallable} from 'firebase/functions';
import {auth, functions} from '@/config/firebaseConfig';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {productReviewEqual, productReviewHash} from '@/services/productReviewService';
import {BANK_REFUND_RECONCILIATION_CAPABILITY, type BankRefundReconciliationAttempt, type BankRefundReconciliationPreview, type BankRefundReconciliationReceipt, type BankRefundReconciliationReference} from '@/types/bankRefundReconciliation';
import {BANK_RECONCILIATION_EFFECTS, reconciliationObject as obj, reconciliationExact as exact, reconciliationHash as hash, reconciliationId as id, reconciliationProviderId, reconciliationDate as iso, reconciliationDocumentId, reconciliationNoEffects as none, isBankReconciliationNativeCapture, isBankReconciliationLocalEvidence, isBankRefundReconciliationEntry, isBankRefundReconciliationReference, isBankRefundReconciliationAttempt} from '@/utils/bankRefundReconciliationContract';

export const bankRefundReconciliationFailure = () => new Error('Le rapport documentaire, sa source et son propre reçu doivent être relus.');
async function rpc(uid: string, input: Record<string, unknown>, guard: () => void, privateRead: boolean) {
  const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();};
  current(); const user = auth.currentUser; if (!user || user.uid !== uid) throw bankRefundReconciliationFailure();
  if (privateRead) {
    const token = await user.getIdTokenResult(true); current(); const at = token.claims.auth_time, now = Math.floor(Date.now() / 1000);
    if (auth.currentUser !== user || token.claims.admin !== true || typeof at !== 'number' || !Number.isSafeInteger(at) || at <= 0 || at > now || now - at > 300) throw new Error('Une confirmation récente de votre identité est requise pour ce rapport privé.');
  } else {await user.getIdToken(); current();}
  const result = await httpsCallable<unknown, unknown>(functions, 'adminRefundTransaction')({capability: BANK_REFUND_RECONCILIATION_CAPABILITY, expectedUid: uid, ...input});
  current(); return result.data;
}
const cursor = (v: unknown): v is {lastId: string} | null => v === null || obj(v) && exact(v, ['lastId']) && reconciliationDocumentId(v.lastId);
export const BankRefundReconciliationService = {
  async read(uid: string, transactionId: string, disputeId: string, mode: 'preview' | 'history', guard: () => void, expectedSource: string | null = null, reportReference: BankRefundReconciliationReference | null = null, after: {lastId: string} | null = null): Promise<BankRefundReconciliationPreview> {
    if (!id(transactionId) || !reconciliationProviderId(disputeId, 'du') || expectedSource !== null && !hash(expectedSource) || reportReference !== null && !isBankRefundReconciliationReference(reportReference) || !cursor(after) || after !== null && expectedSource === null || mode === 'preview' && after !== null) throw bankRefundReconciliationFailure();
    const v = await rpc(uid, {mode, transactionId, disputeId, ...(expectedSource ? {expectedSource: {sourceHash: expectedSource}} : {}), ...(reportReference ? {reportReference} : {}), ...(after ? {cursor: after} : {})}, guard, true);
    if (!obj(v) || !exact(v, ['protocol', 'actorId', 'transactionId', 'disputeId', 'source', 'localEvidence', 'selectedEntry', 'rows', 'nextCursor', 'coverage', 'readAt', ...BANK_RECONCILIATION_EFFECTS]) || v.protocol !== 'bank_financial_reconciliation_preview_v1' || v.actorId !== uid || v.transactionId !== transactionId || v.disputeId !== disputeId || !obj(v.source) || !exact(v.source, ['sourceHash', 'qualification', 'capture']) || !hash(v.source.sourceHash) || expectedSource !== null && v.source.sourceHash !== expectedSource || !['native_current', 'unknown'].includes(String(v.source.qualification)) || !isBankReconciliationNativeCapture(v.source.capture) || v.source.capture.transactionId !== transactionId || v.source.capture.disputeId !== disputeId || (v.source.qualification === 'native_current') !== v.source.capture.identityQualified || !isBankReconciliationLocalEvidence(v.localEvidence) || !iso(v.readAt) || !none(v) || !Array.isArray(v.rows) || v.rows.length > 20 || !cursor(v.nextCursor)) throw bankRefundReconciliationFailure();
    if (reportReference === null ? v.selectedEntry !== null : !isBankRefundReconciliationEntry(v.selectedEntry, transactionId, disputeId) || v.selectedEntry.id !== reportReference.id) throw bankRefundReconciliationFailure();
    const ids: string[] = [];
    for (const r of v.rows) {
      if (!obj(r)) throw bankRefundReconciliationFailure();
      if (r.qualification === 'unknown') {if (!exact(r, ['qualification', 'entryId', 'entry']) || !reconciliationDocumentId(r.entryId) || r.entry !== null) throw bankRefundReconciliationFailure(); ids.push(r.entryId);}
      else {if (r.qualification !== 'native_documentary_entry' || !exact(r, ['qualification', 'reference', 'entry']) || !isBankRefundReconciliationReference(r.reference) || !isBankRefundReconciliationEntry(r.entry, transactionId, disputeId) || r.reference.id !== r.entry.id) throw bankRefundReconciliationFailure(); ids.push(r.reference.id);}
    }
    if (ids.some((value, i) => after !== null && value <= after.lastId || i > 0 && value <= ids[i - 1]) || v.nextCursor !== null && v.nextCursor.lastId !== ids.at(-1)) throw bankRefundReconciliationFailure();
    const c = v.coverage;
    if (mode === 'preview' ? v.rows.length !== 0 || c !== null || v.nextCursor !== null : !obj(c) || !exact(c, ['inspected', 'limit', 'hasMore', 'exhaustiveHistoricalReportsVerified']) || c.inspected !== v.rows.length || c.limit !== 20 || c.hasMore !== (v.nextCursor !== null) || c.exhaustiveHistoricalReportsVerified !== false || v.nextCursor !== null && v.rows.length !== 20) throw bankRefundReconciliationFailure();
    return v as unknown as BankRefundReconciliationPreview;
  },
  async command(a: BankRefundReconciliationAttempt, mode: 'execute' | 'observe' | 'neutralize', guard: () => void): Promise<BankRefundReconciliationReceipt> {
    if (!isBankRefundReconciliationAttempt(a, a.uid)) throw bankRefundReconciliationFailure();
    const payloadHash = await productReviewHash(a.command); guard();
    const entryId = `fr_${await productReviewHash([a.uid, a.requestId])}`; guard();
    const v = await rpc(a.uid, {mode, transactionId: a.transactionId, disputeId: a.disputeId, requestId: a.requestId, command: a.command}, guard, mode === 'execute');
    if (!obj(v) || !exact(v, ['protocol', 'actorId', 'transactionId', 'disputeId', 'requestId', 'command', 'payloadHash', 'state', 'reason', 'reference', 'recordedAt', 'result', ...BANK_RECONCILIATION_EFFECTS]) || v.protocol !== 'bank_financial_reconciliation_command_v1' || v.actorId !== a.uid || v.transactionId !== a.transactionId || v.disputeId !== a.disputeId || v.requestId !== a.requestId || !productReviewEqual(v.command, a.command) || v.payloadHash !== payloadHash || !none(v)) throw bankRefundReconciliationFailure();
    if (v.state === 'received') {
      const r = v.result;
      if (v.reason !== null || !iso(v.recordedAt) || !isBankRefundReconciliationReference(v.reference) || v.reference.id !== entryId || !obj(r) || !exact(r, ['kind', 'documentaryOnly', ...BANK_RECONCILIATION_EFFECTS]) || r.kind !== (a.command.action === 'capture_report' ? 'report' : 'instruction') || r.documentaryOnly !== true || !none(r)) throw bankRefundReconciliationFailure();
    } else if (v.reference !== null || v.result !== null || (v.state === 'not_executed' ? typeof v.reason !== 'string' || !v.reason || v.reason.length > 200 || !iso(v.recordedAt) : !['unrecorded', 'unknown'].includes(String(v.state)) || v.reason !== null || v.recordedAt !== null)) throw bankRefundReconciliationFailure();
    return v as unknown as BankRefundReconciliationReceipt;
  },
};
