import AsyncStorage from '@/utils/environmentStorage';
import { randomUUID } from 'expo-crypto';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual } from '@/services/productReviewService';
import { LabelLifecycleService, isLabelLifecycleAttempt } from '@/services/labelLifecycleService';
import type { LabelLifecycleAttempt, LabelLifecycleCommand, LabelLifecycleContext } from '@/types/labelLifecycle';
const queues = new Map<string, Promise<unknown>>();
const prefix = (uid: string) => `@label_lifecycle_intent:v1:${encodeURIComponent(uid)}:`;
const key = (uid: string, c: LabelLifecycleContext) => `${prefix(uid)}${encodeURIComponent(c.transactionId)}:${c.leg}`;
function locked<T>(id: string, run: () => Promise<T>) {const previous = queues.get(id) ?? Promise.resolve(), result = previous.then(run, run), tail = result.catch(() => undefined); queues.set(id, tail); void tail.then(() => {if (queues.get(id) === tail) queues.delete(id);}); return result;}
function guard(uid: string, assertContext: () => void) {const session = captureTradeSession(uid); assertContext(); return () => {assertTradeSessionCurrent(session); assertContext();};}
const failure = () => new Error('Votre intention exacte doit être retrouvée ; le journal est conservé et aucun nouveau remplacement n’est créé.');
export const LabelLifecycleJournal = {
  async pending(uid: string, c: LabelLifecycleContext, assertContext: () => void): Promise<LabelLifecycleAttempt | null> {
    const current = guard(uid, assertContext), raw = await AsyncStorage.getItem(key(uid, c)); current(); if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw); if (!isLabelLifecycleAttempt(parsed, uid) || !productReviewEqual(parsed.context, c)) throw failure(); return parsed;
  },
  async list(uid: string, assertContext: () => void): Promise<LabelLifecycleAttempt[]> {
    const current = guard(uid, assertContext), keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(prefix(uid))).sort(); current();
    const entries = await AsyncStorage.multiGet(keys); current(); const attempts: LabelLifecycleAttempt[] = [];
    for (const [id, raw] of entries) {if (raw === null) continue; const parsed: unknown = JSON.parse(raw); if (!isLabelLifecycleAttempt(parsed, uid) || key(uid, parsed.context) !== id) throw failure(); attempts.push(parsed);}
    return attempts;
  },
  stage(uid: string, command: LabelLifecycleCommand, assertContext: () => void) {
    const current = guard(uid, assertContext), captured = JSON.parse(JSON.stringify(command)) as LabelLifecycleCommand;
    const c: LabelLifecycleContext = {transactionId: captured.transactionId, leg: captured.leg}, id = key(uid, c);
    return locked(id, async () => {
      if (await this.pending(uid, c, current)) throw new Error('Relisez puis terminez le suivi de votre intention précédente.'); current();
      const attempt: LabelLifecycleAttempt = {version: 1, uid, requestId: randomUUID(), context: c, command: captured}; if (!isLabelLifecycleAttempt(attempt, uid)) throw failure();
      await AsyncStorage.setItem(id, JSON.stringify(attempt)); current(); const saved = await this.pending(uid, c, current); current(); if (!saved || !productReviewEqual(saved, attempt)) throw failure(); return saved;
    });
  },
  async run(attempt: LabelLifecycleAttempt, action: 'execute' | 'observe' | 'neutralize' | 'recover', assertContext: () => void) {
    const current = guard(attempt.uid, assertContext), saved = await this.pending(attempt.uid, attempt.context, current); current();
    if (!saved || !productReviewEqual(saved, attempt)) throw failure(); const receipt = await LabelLifecycleService.command(saved, action, current); current(); return receipt;
  },
  acknowledge(attempt: LabelLifecycleAttempt, assertContext: () => void) {
    const current = guard(attempt.uid, assertContext), id = key(attempt.uid, attempt.context);
    return locked(id, async () => {
      const native = await this.run(attempt, 'observe', current); current(); if (!['committed', 'not_executed'].includes(native.state)) throw new Error('L’opération reste inconnue ou engagée. Votre journal est conservé.');
      const saved = await this.pending(attempt.uid, attempt.context, current); current(); if (!saved || !productReviewEqual(saved, attempt)) throw failure(); await AsyncStorage.removeItem(id); current(); return native;
    });
  },
};
