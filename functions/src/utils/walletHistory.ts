/** Owner-only bounded history. Document order includes missing financial dates. */
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';

type Data = FirebaseFirestore.DocumentData;
type Source = 'ledger' | 'withdrawals';
type Period = { fromMs: number | null; toMs: number | null };
type Cursor = Period & { version: 1; ownerId: string; source: Source; lastId: string };
const SCAN_LIMIT = 200;
const cents = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const currency = (v: unknown): 'CAD' | null => typeof v === 'string' && v.toUpperCase() === 'CAD' ? 'CAD' : null;
const reference = (v: unknown): string | null => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v) &&
  !/^(?:ba|acct|tok|sk|rk|pk|secret)_/.test(v) ? v : null;
const label = (v: unknown, max = 100): string | null => typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null;
const description = (v: unknown) => label(v, 500)?.replace(/\b(?:ba|acct|tok|sk|rk|pk|secret)_[A-Za-z0-9_]+\b/g, '[masqué]')
  .replace(/\d(?:[ -]?\d){4,}/g, '[masqué]') ?? null;
function nativeDate(v: unknown): { createdAt: string | null; createdAtMs: number | null; dateQualification: 'qualified' | 'review_required' } {
  const nativeMs = v instanceof Timestamp ? v.toMillis() : NaN;
  if (!Number.isFinite(nativeMs) || Math.abs(nativeMs) > 8640000000000000)
    return { createdAt: null, createdAtMs: null, dateQualification: 'review_required' };
  const ms = Math.floor(nativeMs);
  return { createdAt: new Date(ms).toISOString(), createdAtMs: ms, dateQualification: 'qualified' };
}
function period(raw: any): Period {
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw) ||
      !Object.prototype.hasOwnProperty.call(raw, 'fromMs') || !Object.prototype.hasOwnProperty.call(raw, 'toMs')))
    throw new HttpsError('invalid-argument', 'La période doit fournir ses deux bornes UTC.');
  const fromMs = raw?.fromMs ?? null, toMs = raw?.toMs ?? null;
  if (fromMs === null && toMs === null) return { fromMs, toMs };
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs < 0 || toMs <= fromMs || toMs > 8640000000000000)
    throw new HttpsError('invalid-argument', 'La période UTC doit définir début inclus et fin exclue.');
  return { fromMs, toMs };
}
function decodeCursor(raw: unknown, ownerId: string, source: Source, range: Period): Cursor | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || raw.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new HttpsError('invalid-argument', 'Curseur invalide.');
  let value: any;
  try { value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { throw new HttpsError('invalid-argument', 'Curseur invalide.'); }
  if (value?.version !== 1 || value.ownerId !== ownerId || value.source !== source || value.fromMs !== range.fromMs || value.toMs !== range.toMs ||
      typeof value.lastId !== 'string' || !value.lastId || value.lastId.includes('/') || Buffer.byteLength(value.lastId) > 1500 ||
      value.lastId === '.' || value.lastId === '..') throw new HttpsError('invalid-argument', 'Le curseur appartient à une autre lecture.');
  return value as Cursor;
}

function ledgerRow(id: string, data: Data, readAtMs: number, nativeSaleCurrency: 'CAD' | null = null) {
  const date = nativeDate(data.createdAt), amountCents = cents(data.amount), currencyValue = currency(data.currency) ?? nativeSaleCurrency;
  const type = label(data.type), balanceAfterCents = cents(data.balanceAfter), debtRecordedCents = cents(data.debtRecorded);
  const refs = { transactionId: reference(data.transactionId), refundIntentId: reference(data.refundIntentId),
    disputeId: reference(data.disputeId), withdrawalRequestId: reference(data.withdrawalRequestId),
    withdrawalDebitLedgerId: reference(data.withdrawalDebitLedgerId), swapId: reference(data.swapId) };
  const anomalies: string[] = [];
  if (date.dateQualification !== 'qualified') anomalies.push('date_unqualified');
  if (date.createdAtMs !== null && date.createdAtMs > readAtMs) anomalies.push('date_after_read');
  if (amountCents === null) anomalies.push('amount_unqualified');
  if (currencyValue === null) anomalies.push('currency_unqualified');
  if (type === null) anomalies.push('type_unqualified');
  if (balanceAfterCents === null) anomalies.push('balance_after_unqualified');
  if (data.debtRecorded != null && debtRecordedCents === null) anomalies.push('debt_unqualified');
  for (const [key, value] of Object.entries(refs)) if (data[key] != null && value === null) anomalies.push(`${key}_unqualified`);
  if (debtRecordedCents !== null && debtRecordedCents > 0 &&
      (type !== 'refund_debit' || refs.transactionId === null || refs.refundIntentId === null && refs.disputeId === null)) anomalies.push('debt_reference_unqualified');
  const knownTypes = ['sale_credit', 'funds_held', 'funds_released', 'sale_held', 'sale_released', 'purchase_debit', 'refund_credit', 'refund_debit', 'refund_hold',
    'withdrawal', 'withdrawal_debit', 'withdrawal_failed', 'dispute_hold', 'dispute_hold_released', 'debt_repayment', 'swap_top_up_credit'];
  if (type !== null && !knownTypes.includes(type)) anomalies.push('unknown_type');
  return { source: 'ledger' as const, id, type, ...date, amountCents, currency: currencyValue, balanceAfterCents,
    debtRecordedCents, debtAllocationCents: type === 'debt_repayment' ? amountCents : null,
    amountMeaning: type === 'debt_repayment' ? 'debt_allocation' : type && knownTypes.includes(type) ? 'wallet_movement' : 'unknown_type',
    description: description(data.description), references: refs, anomalies,
    financialQualification: anomalies.length ? 'review_required' : 'qualified' };
}

/** Historical sale credits omitted their currency. Their native same-commit
 * order tuple can qualify that one currency without rewriting the ledger or
 * treating another kind, an explicit unknown currency or a bare link as CAD. */
function nativeSaleCreditCurrency(ownerId: string, row: Data, wallet: Data | undefined, order: Data | undefined): 'CAD' | null {
  const amount = cents(row.amount), pending = cents(order?.sellerPendingCreditCents), credited = cents(order?.sellerCreditedCents),
    debt = cents(order?.sellerDebtRepaidCents);
  return !Object.prototype.hasOwnProperty.call(row, 'currency') && row.type === 'sale_credit' && currency(wallet?.currency) === 'CAD' &&
    currency(order?.currency) === 'CAD' && order?.sellerId === ownerId && reference(row.transactionId) !== null &&
    amount !== null && amount > 0 && pending === amount && credited !== null && debt !== null && credited === pending + debt &&
    row.createdAt instanceof Timestamp && order.sellerCreditRecordedAt instanceof Timestamp && row.createdAt.isEqual(order.sellerCreditRecordedAt)
    ? 'CAD' : null;
}

type WithdrawalQualifier = (tx: FirebaseFirestore.Transaction, id: string, data: Data) => Promise<Data | null>;
async function withdrawalRow(tx: FirebaseFirestore.Transaction, id: string, data: Data, readAtMs: number, qualify: WithdrawalQualifier) {
  const date = nativeDate(data.createdAt), amountCents = cents(data.amount), currencyValue = currency(data.currency);
  const state = label(data.status), destination = data.payoutDestination;
  let proof: Data | null = null;
  try { proof = await qualify(tx, id, data); } catch (error) {
    if (!(error instanceof HttpsError)) throw error;
  }
  const exactIdentity = proof?.protocol === 'withdrawal_intent_v1' && proof.withdrawalRequestId === id && proof.ownerId === data.userId &&
    proof.amountCents === amountCents && proof.currency === 'CAD';
  const exactProof = exactIdentity && proof!.intentCommitted === true && proof!.debitCommitted === true;
  // Only the existing qualified receipt reader proves this native refusal.
  // The amount remains the requested amount, with no debit or compensation.
  const exactNonExecution = exactIdentity && state === 'not_executed' && proof!.status === 'not_executed' &&
    proof!.operationState === 'not_executed' && proof!.nonExecutionReceiptQualified === true &&
    proof!.intentCommitted === false && proof!.debitCommitted === false && proof!.transferId === null && proof!.payoutId === null &&
    proof!.completedReceiptQualified === false && proof!.recoveryCommitted === false && proof!.actionRequired === false;
  const qualifiedReceipt = exactProof || exactNonExecution;
  const anomalies: string[] = [];
  if (date.dateQualification !== 'qualified') anomalies.push('date_unqualified');
  if (date.createdAtMs !== null && date.createdAtMs > readAtMs) anomalies.push('date_after_read');
  if (amountCents === null) anomalies.push('amount_unqualified');
  if (currencyValue === null) anomalies.push('currency_unqualified');
  if (!['processing', 'completed', 'failed'].includes(state ?? '') && !exactNonExecution) anomalies.push('state_unqualified');
  if (!qualifiedReceipt) anomalies.push('withdrawal_receipt_unqualified');
  if (state === 'completed' && !(exactProof && proof!.completedReceiptQualified === true)) anomalies.push('completion_unqualified');
  if (state === 'failed' && !(exactProof && proof!.recoveryCommitted === true)) anomalies.push('compensation_unqualified');
  return { source: 'withdrawals' as const, id, type: 'withdrawal_request', ...date, amountCents, currency: currencyValue,
    description: 'Demande de retrait', state, proofQualification: qualifiedReceipt ? 'qualified' : 'review_required',
    operationState: qualifiedReceipt ? label(proof!.operationState) : null,
    bankDestination: exactProof && destination?.schemaVersion === 1 && typeof destination.last4 === 'string' && /^\d{4}$/.test(destination.last4)
      ? { last4: destination.last4 as string, country: 'CA', currency: 'CAD' } : null,
    references: { withdrawalRequestId: id, debitLedgerId: reference(data.ledgerEntryId),
      compensationLedgerId: exactProof && proof!.recoveryCommitted === true ? reference(proof!.recoveryLedgerId) : null },
    completionProof: exactProof && proof!.completedReceiptQualified === true
      ? { qualified: true, observedAt: data.payoutCompletion.observedAt.toDate().toISOString() } : null,
    compensationProof: exactProof && proof!.recoveryCommitted === true
      ? { qualified: true, amountCents, ledgerEntryId: reference(proof!.recoveryLedgerId), recordedAt: proof!.recoveredAt as string } : null,
    anomalies };
}

export async function readWalletHistoryPage(ownerId: string, raw: any, qualify: WithdrawalQualifier, guard?: (tx: FirebaseFirestore.Transaction) => Promise<unknown>) {
  if (raw?.expectedUid !== ownerId || !['ledger', 'withdrawals'].includes(raw?.source)) throw new HttpsError('invalid-argument', 'Compte et source de lecture requis.');
  const source = raw.source as Source, range = period(raw.period), prior = decodeCursor(raw.cursor, ownerId, source, range);
  const pageSize = raw.pageSize ?? 40;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new HttpsError('invalid-argument', 'Taille de page invalide.');
  const readAtMs = Date.now();
  return db.runTransaction(async tx => {
    await guard?.(tx);
    let query: FirebaseFirestore.Query = source === 'ledger' ? db.collection('wallets').doc(ownerId).collection('ledger')
      : db.collection('withdrawal_requests').where('userId', '==', ownerId);
    query = query.orderBy(FieldPath.documentId(), 'asc');
    if (prior) query = query.startAfter(prior.lastId);
    const docs = (await tx.get(query.limit(SCAN_LIMIT + 1))).docs;
    const selected: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    let inspectedCount = 0, excludedByPeriodCount = 0, lastInspectedId: string | null = null;
    for (const doc of docs.slice(0, SCAN_LIMIT)) {
      inspectedCount++; lastInspectedId = doc.id;
      const data = doc.data(), date = nativeDate(data.createdAt);
      if (date.createdAtMs !== null && range.fromMs !== null && (date.createdAtMs < range.fromMs || date.createdAtMs >= range.toMs!)) {
        excludedByPeriodCount++; continue;
      }
      selected.push(doc);
      if (selected.length >= pageSize) break;
    }
    const orders = new Map<string, Data>();
    let wallet: Data | undefined;
    if (source === 'ledger') {
      // At most one wallet read and one batch of <= pageSize distinct orders.
      // Neither a full account scan nor an additional query per ledger row.
      const ids = [...new Set(selected.map(doc => doc.data()).filter(data => data.type === 'sale_credit' &&
        !Object.prototype.hasOwnProperty.call(data, 'currency')).map(data => reference(data.transactionId)).filter((id): id is string => id !== null))];
      if (ids.length) {
        wallet = (await tx.get(db.collection('wallets').doc(ownerId))).data();
        const snapshots = await tx.getAll(...ids.map(id => db.collection('transactions').doc(id)));
        for (const snapshot of snapshots) if (snapshot.exists) orders.set(snapshot.id, snapshot.data()!);
      }
    }
    const entries: (ReturnType<typeof ledgerRow> | Awaited<ReturnType<typeof withdrawalRow>>)[] = [];
    for (const doc of selected) {
      const data = doc.data();
      entries.push(source === 'ledger' ? ledgerRow(doc.id, data, readAtMs,
        nativeSaleCreditCurrency(ownerId, data, wallet, orders.get(data.transactionId))) : await withdrawalRow(tx, doc.id, data, readAtMs, qualify));
    }
    const hasMore = inspectedCount < docs.length;
    const next: Cursor | null = hasMore && lastInspectedId ? { version: 1, ownerId, source, ...range, lastId: lastInspectedId } : null;
    return { protocol: 'wallet_history_page_v1', ownerId, source, period: range, periodBoundary: '[fromMs,toMs)',
      readAt: new Date(readAtMs).toISOString(), order: 'document_id_asc', entries,
      hasMore, cursor: next ? Buffer.from(JSON.stringify(next)).toString('base64url') : null,
      coverage: { inspectedCount, excludedByPeriodCount, emittedCount: entries.length, scanLimit: SCAN_LIMIT, pageSize,
        scope: 'page_forward_scan', timestampPrecision: 'millisecond_floor',
        includesUnqualifiedDates: true, undatedEntriesBelongToPeriod: false,
        scanCompleteAtRead: !hasMore, accountingSnapshot: false, totalsProvided: false,
        sourcesMayDescribeSameMovement: true, continuationIsCompletenessProof: false } };
  });
}
