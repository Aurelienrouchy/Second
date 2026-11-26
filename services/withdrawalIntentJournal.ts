import AsyncStorage from '@/utils/environmentStorage';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { WITHDRAWAL_NON_EXECUTION_REASONS, type WithdrawalAttempt, type WithdrawalIntentResult } from '@/types/wallet';
import {isSmallBalanceClosureRequest} from '@/utils/smallBalanceClosure';

const key = (uid: string) => `second:withdrawal-intent:v1:${encodeURIComponent(uid)}`;
const active = new Set<string>();
const writes = new Map<string, Promise<void>>();
const unknown = () => new Error('La demande de retrait doit être relue avant toute nouvelle demande.');

export function isValidWithdrawalAttempt(value: unknown, uid: string): value is WithdrawalAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).every(k => ['version', 'uid', 'requestId', 'amountCents', 'bankAccountId', 'closureSettlement'].includes(k)) &&
    v.version === 1 && v.uid === uid && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) &&
    typeof v.amountCents === 'number' && Number.isSafeInteger(v.amountCents) && v.amountCents >= 1 &&
    (!Object.hasOwn(v, 'closureSettlement') || isSmallBalanceClosureRequest(v.closureSettlement) && v.amountCents < 1000) &&
    typeof v.bankAccountId === 'string' && /^ba_[A-Za-z0-9_]{1,190}$/.test(v.bankAccountId);
}

export function matchesWithdrawalAttempt(a: WithdrawalAttempt, b: WithdrawalAttempt): boolean {
  return a.uid === b.uid && a.requestId === b.requestId && a.amountCents === b.amountCents && a.bankAccountId === b.bankAccountId &&
    a.closureSettlement?.protocol === b.closureSettlement?.protocol && a.closureSettlement?.sourceHash === b.closureSettlement?.sourceHash;
}

export function hasQualifiedWithdrawalNonExecution(r: WithdrawalIntentResult): boolean {
  return r.nonExecutionReceiptQualified === true && WITHDRAWAL_NON_EXECUTION_REASONS.includes(r.nonExecutionReason!) &&
    typeof r.nonExecutionRecordedAt === 'string' && Number.isFinite(Date.parse(r.nonExecutionRecordedAt)) &&
    new Date(r.nonExecutionRecordedAt).toISOString() === r.nonExecutionRecordedAt && Date.parse(r.nonExecutionRecordedAt) > 0 && Date.parse(r.nonExecutionRecordedAt) <= Date.now() &&
    r.protocol === 'withdrawal_intent_v1' && r.currency === 'CAD' && r.status === 'not_executed' && r.operationState === 'not_executed' &&
    r.intentCommitted === false && r.debitCommitted === false && r.success === false && r.newBalance === null && r.balanceSource === 'unavailable' &&
    r.transferId === null && r.payoutId === null && r.transferState === 'not_started' && r.payoutState === 'not_started' && r.actionRequired === false &&
    r.retryPermissionGranted === false && r.completedReceiptQualified === false && r.recoveryCommitted === false && r.recoveryLedgerId === null && r.recoveredAt === null &&
    r.action === 'contactSupport' && typeof r.ownerMessage === 'string' && !!r.ownerMessage.trim();
}

export function hasTerminalWithdrawalReceipt(r: WithdrawalIntentResult): boolean {
  if (['nonExecutionReceiptQualified', 'nonExecutionReason', 'nonExecutionRecordedAt'].some(key => Object.hasOwn(r, key)) || r.status === 'not_executed' || r.operationState === 'not_executed') return hasQualifiedWithdrawalNonExecution(r);
  if (!r.intentCommitted || !r.debitCommitted || r.actionRequired || !r.transferId || !r.payoutId) return false;
  return r.operationState === 'completed' && r.status === 'completed' && r.completedReceiptQualified ||
    r.operationState === 'recovered' && r.status === 'failed' && r.recoveryCommitted &&
    r.recoveryLedgerId !== null && r.recoveredAt !== null;
}

/** One in-flight mutation per owner, shared by every mounted wallet consumer. */
export async function runWithdrawalOperation<T>(uid: string, assertContext: () => void, operation: () => Promise<T>): Promise<T> {
  const session = captureTradeSession(uid);
  assertContext();
  if (active.has(uid)) throw new Error('Une demande est déjà en cours. Relisez son résultat.');
  active.add(uid);
  try { assertTradeSessionCurrent(session); return await operation(); }
  finally { active.delete(uid); }
}

export async function readWithdrawalAttempt(uid: string, assertContext: () => void): Promise<WithdrawalAttempt | null> {
  const session = captureTradeSession(uid);
  assertContext();
  const raw = await AsyncStorage.getItem(key(uid));
  assertTradeSessionCurrent(session); assertContext();
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw unknown(); }
  if (!isValidWithdrawalAttempt(value, uid)) throw unknown();
  return value;
}

async function serialize(uid: string, operation: () => Promise<void>): Promise<void> {
  const pending = (writes.get(uid) ?? Promise.resolve()).catch(() => undefined).then(operation);
  writes.set(uid, pending);
  try { await pending; } finally { if (writes.get(uid) === pending) writes.delete(uid); }
}

export async function rememberWithdrawalAttempt(attempt: WithdrawalAttempt, assertContext: () => void): Promise<void> {
  const session = captureTradeSession(attempt.uid);
  await serialize(attempt.uid, async () => {
    assertTradeSessionCurrent(session); assertContext();
    if (!isValidWithdrawalAttempt(attempt, session.uid)) throw unknown();
    const previous = await readWithdrawalAttempt(attempt.uid, assertContext);
    if (!previous && attempt.amountCents < 1000 && !isSmallBalanceClosureRequest(attempt.closureSettlement)) throw unknown();
    if (previous && !matchesWithdrawalAttempt(previous, attempt)) throw unknown();
    assertTradeSessionCurrent(session); assertContext();
    await AsyncStorage.setItem(key(attempt.uid), JSON.stringify(attempt));
    assertTradeSessionCurrent(session); assertContext();
  });
}

/** Only an explicit user action with a fresh qualified terminal receipt may clear this slot. */
export async function finishWithdrawalAttempt(attempt: WithdrawalAttempt, receipt: WithdrawalIntentResult, assertContext: () => void): Promise<void> {
  const session = captureTradeSession(attempt.uid);
  await serialize(attempt.uid, async () => {
    assertTradeSessionCurrent(session); assertContext();
    const current = await readWithdrawalAttempt(attempt.uid, assertContext);
    if (!current || !matchesWithdrawalAttempt(current, attempt) || !hasTerminalWithdrawalReceipt(receipt) ||
        receipt.ownerId !== attempt.uid || receipt.requestId !== attempt.requestId || receipt.amountCents !== attempt.amountCents ||
        receipt.currency !== 'CAD' || receipt.bankAccountId !== attempt.bankAccountId) throw unknown();
    assertTradeSessionCurrent(session); assertContext();
    await AsyncStorage.removeItem(key(attempt.uid));
    assertTradeSessionCurrent(session); assertContext();
  });
}
