import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import type { WalletHistoryEntry, WalletHistoryInput, WalletHistoryPage, WalletHistoryPeriod } from '@/types/walletHistory';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nullableCents = (v: unknown) => v === null || integer(v);
const reference = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v) && !/^(?:ba|acct|tok|sk|rk|pk|secret)_/.test(v);
const nullableReference = (v: unknown) => v === null || reference(v);
const nullableText = (v: unknown, max = 100) => v === null || typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const identifier = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 1500 && !v.includes('/');
const invalid = () => new Error('Cette page d’historique ne peut pas être qualifiée. Aucun export ne sera partagé.');
export function validWalletHistoryPeriod(v: WalletHistoryPeriod): boolean {
  return v.fromMs === null && v.toMs === null || integer(v.fromMs) && integer(v.toMs) && v.fromMs < v.toMs && v.toMs <= 8640000000000000;
}
const knownLedgerTypes = ['sale_credit', 'sale_held', 'sale_released', 'funds_held', 'funds_released', 'purchase_debit', 'refund_credit', 'refund_debit', 'refund_hold',
  'withdrawal', 'withdrawal_debit', 'withdrawal_failed', 'dispute_hold', 'dispute_hold_released', 'debt_repayment', 'swap_top_up_credit'];
function parseEntry(value: unknown, input: WalletHistoryInput, readAt: string): WalletHistoryEntry {
  if (!record(value) || value.source !== input.source || !identifier(value.id) || !nullableCents(value.amountCents) ||
      ![null, 'CAD'].includes(value.currency as null | string) || !Array.isArray(value.anomalies) || value.anomalies.length > 20 ||
      value.anomalies.some(v => typeof v !== 'string' || !/^[A-Za-z_]{1,100}$/.test(v)) || new Set(value.anomalies).size !== value.anomalies.length) throw invalid();
  if (value.dateQualification === 'qualified') {
    if (!iso(value.createdAt) || typeof value.createdAtMs !== 'number' || !Number.isSafeInteger(value.createdAtMs) || Math.abs(value.createdAtMs) > 8640000000000000 ||
        Date.parse(value.createdAt) !== value.createdAtMs || value.createdAtMs > Date.parse(readAt) && !value.anomalies.includes('date_after_read') ||
        input.period.fromMs !== null && (value.createdAtMs < input.period.fromMs || value.createdAtMs >= input.period.toMs!)) throw invalid();
  } else if (value.dateQualification !== 'review_required' || value.createdAt !== null || value.createdAtMs !== null || !value.anomalies.includes('date_unqualified')) throw invalid();
  if (value.amountCents === null && !value.anomalies.includes('amount_unqualified') || value.currency === null && !value.anomalies.includes('currency_unqualified')) throw invalid();
  const refs = value.references;
  if (!record(refs)) throw invalid();
  if (input.source === 'ledger') {
    const known = typeof value.type === 'string' && knownLedgerTypes.includes(value.type);
    if (!nullableText(value.type) || !nullableText(value.description, 500) || !nullableCents(value.balanceAfterCents) ||
        !nullableCents(value.debtRecordedCents) || !nullableCents(value.debtAllocationCents) ||
        !['transactionId', 'refundIntentId', 'disputeId', 'withdrawalRequestId', 'withdrawalDebitLedgerId', 'swapId'].every(k => nullableReference(refs[k])) ||
        value.amountMeaning !== (value.type === 'debt_repayment' ? 'debt_allocation' : known ? 'wallet_movement' : 'unknown_type') ||
        value.debtAllocationCents !== (value.type === 'debt_repayment' ? value.amountCents : null) ||
        value.financialQualification !== (value.anomalies.length > 0 ? 'review_required' : 'qualified') ||
        !known && value.type !== null && !value.anomalies.includes('unknown_type') ||
        value.type === null && !value.anomalies.includes('type_unqualified') ||
        value.balanceAfterCents === null && !value.anomalies.includes('balance_after_unqualified')) throw invalid();
  } else {
    if (value.type !== 'withdrawal_request' || value.description !== 'Demande de retrait' || !nullableText(value.state) || !nullableText(value.operationState) ||
        !['qualified', 'review_required'].includes(String(value.proofQualification)) || refs.withdrawalRequestId !== value.id ||
        !nullableReference(refs.debitLedgerId) || !nullableReference(refs.compensationLedgerId)) throw invalid();
    if (value.bankDestination !== null && (!record(value.bankDestination) || typeof value.bankDestination.last4 !== 'string' || !/^\d{4}$/.test(value.bankDestination.last4) ||
        value.bankDestination.country !== 'CA' || value.bankDestination.currency !== 'CAD' || value.proofQualification !== 'qualified')) throw invalid();
    if (value.completionProof !== null && (!record(value.completionProof) || value.completionProof.qualified !== true ||
        !iso(value.completionProof.observedAt) || value.proofQualification !== 'qualified')) throw invalid();
    if (value.compensationProof !== null && (!record(value.compensationProof) || value.compensationProof.qualified !== true ||
        !integer(value.compensationProof.amountCents) || value.compensationProof.amountCents !== value.amountCents || !reference(value.compensationProof.ledgerEntryId) ||
        value.compensationProof.ledgerEntryId !== refs.compensationLedgerId || !iso(value.compensationProof.recordedAt) || value.proofQualification !== 'qualified')) throw invalid();
    if (value.proofQualification === 'review_required' && (!value.anomalies.includes('withdrawal_receipt_unqualified') ||
        value.bankDestination !== null || value.operationState !== null || value.completionProof !== null || value.compensationProof !== null || refs.compensationLedgerId !== null)) throw invalid();
  }
  return value as unknown as WalletHistoryEntry;
}
export function parseWalletHistoryPage(data: unknown, uid: string, input: WalletHistoryInput): WalletHistoryPage {
  if (!record(data) || data.protocol !== 'wallet_history_page_v1' || data.ownerId !== uid || data.source !== input.source ||
      !record(data.period) || data.period.fromMs !== input.period.fromMs || data.period.toMs !== input.period.toMs || data.periodBoundary !== '[fromMs,toMs)' ||
      !iso(data.readAt) || data.order !== 'document_id_asc' || typeof data.hasMore !== 'boolean' ||
      !(data.hasMore ? typeof data.cursor === 'string' && /^[A-Za-z0-9_-]{1,4096}$/.test(data.cursor) && data.cursor !== input.cursor : data.cursor === null) ||
      !Array.isArray(data.entries) || data.entries.length > input.pageSize || !record(data.coverage)) throw invalid();
  const c = data.coverage;
  if (!integer(c.inspectedCount) || c.inspectedCount > 200 || !integer(c.excludedByPeriodCount) || c.emittedCount !== data.entries.length ||
      c.inspectedCount !== c.excludedByPeriodCount + data.entries.length || c.scanLimit !== 200 || c.pageSize !== input.pageSize ||
      c.includesUnqualifiedDates !== true || c.undatedEntriesBelongToPeriod !== false || c.scanCompleteAtRead !== !data.hasMore ||
      c.accountingSnapshot !== false || c.totalsProvided !== false || c.sourcesMayDescribeSameMovement !== true || c.continuationIsCompletenessProof !== false ||
      c.scope !== 'page_forward_scan' || c.timestampPrecision !== 'millisecond_floor' ||
      data.hasMore && c.inspectedCount === 0) throw invalid();
  const entries = data.entries.map(value => parseEntry(value, input, data.readAt as string));
  if (new Set(entries.map(e => e.id)).size !== entries.length) throw invalid();
  return { ...data, entries } as unknown as WalletHistoryPage;
}
export async function getWalletHistoryPage(expectedUid: string, input: WalletHistoryInput, assertContext: () => void): Promise<WalletHistoryPage> {
  const session = captureTradeSession(expectedUid);
  const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
  assertCurrent();
  if (!['ledger', 'withdrawals'].includes(input.source) || !validWalletHistoryPeriod(input.period) || !integer(input.pageSize) || input.pageSize < 1 || input.pageSize > 50 ||
      !(input.cursor === null || typeof input.cursor === 'string' && /^[A-Za-z0-9_-]{1,4096}$/.test(input.cursor))) throw invalid();
  const payload = { mode: 'history', expectedUid: session.uid, ...input };
  const { data } = await httpsCallable<typeof payload, unknown>(functions, 'getWalletInfo')(payload); assertCurrent();
  return parseWalletHistoryPage(data, session.uid, input);
}
