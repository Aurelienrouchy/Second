import AsyncStorage from '@/utils/environmentStorage';
import {assertTradeSessionCurrent, captureTradeSession} from '@/services/tradeOperation';
import {productReviewEqual, productReviewHash} from '@/services/productReviewService';
import {ReturnDepositDeadlineService, returnDepositDeadlineFailure} from '@/services/returnDepositDeadlineService';
import {returnDepositId, isReturnDepositAttempt} from '@/utils/returnDepositDeadlineContract';
import type {ReturnDepositDeadlineAttempt} from '@/types/returnDepositDeadline';

const prefix = 'second:return-deposit-deadline:v1:';
const slot = (uid: string, transactionId: string) => prefix + JSON.stringify([uid, transactionId]);
const locks = new Set<string>();
function fence(uid: string, guard: () => void) {const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); guard();};}
async function read(uid: string, transactionId: string, guard: () => void): Promise<ReturnDepositDeadlineAttempt | null> {
  const current = fence(uid, guard); current(); if (!returnDepositId(transactionId)) throw returnDepositDeadlineFailure();
  const raw = await AsyncStorage.getItem(slot(uid, transactionId)); current(); if (raw === null) return null;
  const a: unknown = JSON.parse(raw);
  if (!isReturnDepositAttempt(a, uid, transactionId) || await productReviewHash(a.command) !== a.payloadHash) throw returnDepositDeadlineFailure(); current(); return a;
}
/** Local discovery only. Each selected tuple still observes its own native receipt. */
async function list(uid: string, guard: () => void): Promise<ReturnDepositDeadlineAttempt[]> {
  const current = fence(uid, guard); current(); const keys = await AsyncStorage.getAllKeys(); current(); const own: string[] = [];
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    let parts: unknown; try {parts = JSON.parse(key.slice(prefix.length));} catch {continue;}
    if (!Array.isArray(parts) || parts[0] !== uid) continue;
    if (parts.length !== 2 || !returnDepositId(parts[1]) || slot(uid, parts[1]) !== key) throw returnDepositDeadlineFailure();
    own.push(key);
  }
  const values = await AsyncStorage.multiGet(own.sort()); current(); const attempts: ReturnDepositDeadlineAttempt[] = [];
  for (const [key, raw] of values) {
    if (raw === null) continue;
    const value: unknown = JSON.parse(raw), parts: unknown = JSON.parse(key.slice(prefix.length));
    if (!Array.isArray(parts) || !isReturnDepositAttempt(value, uid, parts[1]) || slot(value.uid, value.transactionId) !== key || await productReviewHash(value.command) !== value.payloadHash) throw returnDepositDeadlineFailure();
    current(); attempts.push(value);
  }
  return attempts;
}
async function run(a: ReturnDepositDeadlineAttempt, mode: 'execute' | 'observe' | 'neutralize' | 'acknowledge', guard: () => void, verifyNew?: () => Promise<void>) {
  const current = fence(a.uid, guard), key = slot(a.uid, a.transactionId); current();
  if (!isReturnDepositAttempt(a, a.uid, a.transactionId) || await productReviewHash(a.command) !== a.payloadHash) throw returnDepositDeadlineFailure(); current();
  if (locks.has(key)) throw returnDepositDeadlineFailure(); locks.add(key);
  try {
    const prior = await read(a.uid, a.transactionId, current); current();
    if (mode === 'execute') {
      if (prior !== null || !verifyNew || a.scope !== 'operator' || a.command.action !== 'extend') throw returnDepositDeadlineFailure();
      await AsyncStorage.setItem(key, JSON.stringify(a)); current();
      if (!productReviewEqual(await read(a.uid, a.transactionId, current), a)) throw returnDepositDeadlineFailure(); current();
      await verifyNew(); current(); await ReturnDepositDeadlineService.command(a, 'execute', current); current();
      return ReturnDepositDeadlineService.command(a, 'observe', current);
    }
    if (!productReviewEqual(prior, a)) throw returnDepositDeadlineFailure();
    const receipt = await ReturnDepositDeadlineService.command(a, 'observe', current); current();
    if (mode === 'observe') return receipt;
    if (mode === 'neutralize') {
      if (receipt.state !== 'absent') return receipt;
      await ReturnDepositDeadlineService.command(a, 'neutralize', current); current();
      return ReturnDepositDeadlineService.command(a, 'observe', current);
    }
    if (receipt.state === 'absent' || receipt.recordedAt === null) throw returnDepositDeadlineFailure();
    if (!productReviewEqual(await read(a.uid, a.transactionId, current), a)) throw returnDepositDeadlineFailure(); current();
    await AsyncStorage.removeItem(key); current(); return receipt;
  } finally {locks.delete(key);}
}
export const ReturnDepositDeadlineJournal = {read, list,
  execute: (a: ReturnDepositDeadlineAttempt, g: () => void, v: () => Promise<void>) => run(a, 'execute', g, v),
  observe: (a: ReturnDepositDeadlineAttempt, g: () => void) => run(a, 'observe', g),
  neutralize: (a: ReturnDepositDeadlineAttempt, g: () => void) => run(a, 'neutralize', g),
  acknowledge: (a: ReturnDepositDeadlineAttempt, g: () => void) => run(a, 'acknowledge', g),
};
