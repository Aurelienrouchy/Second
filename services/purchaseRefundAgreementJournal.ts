import AsyncStorage from '@/utils/environmentStorage';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { PurchaseRefundService, isPurchaseRefundAgreementAttempt } from '@/services/purchaseRefundService';
import { purchaseRefundEqual, purchaseRefundId } from '@/utils/purchaseRefundContract';
import type { PurchaseRefundAgreementAttempt } from '@/types/purchaseRefund';
const slot = (uid: string, id: string) => `second:purchase-refund-agreement:v1:${JSON.stringify([uid, id])}`;
const locks = new Set<string>();
const fail = () => new Error('L’intention d’accord exacte reste conservée. Relisez son reçu avant une autre démarche.');
async function pending(uid: string, transactionId: string, assertContext: () => void): Promise<PurchaseRefundAgreementAttempt | null> {
  const session = captureTradeSession(uid); assertContext(); if (!purchaseRefundId(transactionId)) throw fail();
  const raw = await AsyncStorage.getItem(slot(uid, transactionId)); assertTradeSessionCurrent(session); assertContext(); if (raw === null) return null;
  let a: unknown; try {a = JSON.parse(raw);} catch {throw fail();}
  if (!isPurchaseRefundAgreementAttempt(a, uid) || a.command.transactionId !== transactionId) throw fail(); return a;
}
async function locked<T>(uid: string, transactionId: string, assertContext: () => void, task: () => Promise<T>) {const key = slot(uid, transactionId), session = captureTradeSession(uid); assertContext(); if (locks.has(key)) throw fail(); locks.add(key);
  try {const value = await task(); assertTradeSessionCurrent(session); assertContext(); return value;} finally {locks.delete(key);}}
export const PurchaseRefundAgreementJournal = {
  async read(uid: string, transactionId: string, assertContext: () => void) {const a = await pending(uid, transactionId, assertContext); assertContext(); const receipt = a ? await PurchaseRefundService.command(a, 'observe', assertContext) : null; assertContext(); return {attempt: a, receipt};},
  execute(a: PurchaseRefundAgreementAttempt, assertContext: () => void) {return locked(a.uid, a.command.transactionId, assertContext, async () => {
    if (!isPurchaseRefundAgreementAttempt(a, a.uid)) throw fail(); const old = await pending(a.uid, a.command.transactionId, assertContext); if (old && !purchaseRefundEqual(old, a)) throw fail();
    const session = captureTradeSession(a.uid); assertContext();
    if (!old) {await AsyncStorage.setItem(slot(a.uid, a.command.transactionId), JSON.stringify(a)); assertTradeSessionCurrent(session); assertContext();}
    const saved = await pending(a.uid, a.command.transactionId, assertContext); if (!saved || !purchaseRefundEqual(saved, a)) throw fail();
    return PurchaseRefundService.command(saved, 'execute', assertContext);
  });},
  neutralize(a: PurchaseRefundAgreementAttempt, assertContext: () => void) {return locked(a.uid, a.command.transactionId, assertContext, async () => {const saved = await pending(a.uid, a.command.transactionId, assertContext); if (!saved || !purchaseRefundEqual(saved, a)) throw fail(); return PurchaseRefundService.command(saved, 'neutralize', assertContext);});},
  acknowledge(a: PurchaseRefundAgreementAttempt, assertContext: () => void) {return locked(a.uid, a.command.transactionId, assertContext, async () => {
    const saved = await pending(a.uid, a.command.transactionId, assertContext); if (!saved || !purchaseRefundEqual(saved, a)) throw fail();
    const receipt = await PurchaseRefundService.command(saved, 'observe', assertContext); assertContext(); if (receipt.state === 'unrecorded') throw fail();
    const session = captureTradeSession(a.uid), still = await pending(a.uid, a.command.transactionId, assertContext); if (!purchaseRefundEqual(still, a)) throw fail();
    await AsyncStorage.removeItem(slot(a.uid, a.command.transactionId)); assertTradeSessionCurrent(session); assertContext(); return receipt;
  });},
};
