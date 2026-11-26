import AsyncStorage from '@/utils/environmentStorage';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {productReviewEqual} from '@/services/productReviewService';
import {BankRefundReconciliationService, bankRefundReconciliationFailure} from '@/services/bankRefundReconciliationService';
import {isBankRefundReconciliationAttempt} from '@/utils/bankRefundReconciliationContract';
import type {BankRefundReconciliationAttempt} from '@/types/bankRefundReconciliation';

const prefix = 'second:bank-financial-reconciliation:v1:', locks = new Set<string>();
const slot = (a: BankRefundReconciliationAttempt) => prefix + JSON.stringify([a.uid, a.transactionId, a.disputeId, a.requestId]);
function fence(uid: string, guard: () => void) {const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); guard();};}
async function list(uid: string, guard: () => void): Promise<BankRefundReconciliationAttempt[]> {
  const current = fence(uid, guard); current(); const keys = await AsyncStorage.getAllKeys(); current(); const own: string[] = [];
  for (const key of keys) {if (!key.startsWith(prefix)) continue; let parts: unknown; try {parts = JSON.parse(key.slice(prefix.length));} catch {continue;}
    if (!Array.isArray(parts) || parts[0] !== uid) continue; if (parts.length !== 4 || parts.some(p => typeof p !== 'string')) throw bankRefundReconciliationFailure(); own.push(key);}
  const rows = await AsyncStorage.multiGet(own); current();
  return rows.flatMap(([key, raw]) => {if (raw === null) return []; const a: unknown = JSON.parse(raw); if (!isBankRefundReconciliationAttempt(a, uid) || slot(a) !== key) throw bankRefundReconciliationFailure(); return [a];});
}
async function same(a: BankRefundReconciliationAttempt, current: () => void) {const raw = await AsyncStorage.getItem(slot(a)); current(); if (raw === null || !productReviewEqual(JSON.parse(raw), a)) throw bankRefundReconciliationFailure();}
async function run(a: BankRefundReconciliationAttempt, mode: 'execute' | 'observe' | 'neutralize' | 'acknowledge', guard: () => void, verifyNew?: () => Promise<void>) {
  if (!isBankRefundReconciliationAttempt(a, a.uid)) throw bankRefundReconciliationFailure();
  const current = fence(a.uid, guard), key = slot(a); current(); if (locks.has(key)) throw bankRefundReconciliationFailure(); locks.add(key);
  try {
    if (mode === 'execute') {
      const old = await AsyncStorage.getItem(key); current(); if (old !== null) throw bankRefundReconciliationFailure();
      await AsyncStorage.setItem(key, JSON.stringify(a)); current(); await same(a, current);
      if (!verifyNew) throw bankRefundReconciliationFailure(); await verifyNew(); current();
      await BankRefundReconciliationService.command(a, 'execute', current); current(); return BankRefundReconciliationService.command(a, 'observe', current);
    }
    await same(a, current); const receipt = await BankRefundReconciliationService.command(a, 'observe', current); current();
    if (mode === 'observe') return receipt;
    if (mode === 'acknowledge') {if (!['received', 'not_executed'].includes(receipt.state) || receipt.recordedAt === null) throw bankRefundReconciliationFailure(); await same(a, current); await AsyncStorage.removeItem(key); current(); return receipt;}
    if (['received', 'not_executed'].includes(receipt.state)) return receipt;
    // Recovery stays under the original intention by observation; this journal never resends execute.
    await BankRefundReconciliationService.command(a, 'neutralize', current); current(); return BankRefundReconciliationService.command(a, 'observe', current);
  } finally {locks.delete(key);}
}
export const BankRefundReconciliationJournal = {list,
  execute: (a: BankRefundReconciliationAttempt, g: () => void, v: () => Promise<void>) => run(a, 'execute', g, v),
  observe: (a: BankRefundReconciliationAttempt, g: () => void) => run(a, 'observe', g),
  neutralize: (a: BankRefundReconciliationAttempt, g: () => void) => run(a, 'neutralize', g),
  acknowledge: (a: BankRefundReconciliationAttempt, g: () => void) => run(a, 'acknowledge', g)};
