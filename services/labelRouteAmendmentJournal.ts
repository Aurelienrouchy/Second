import AsyncStorage from '@/utils/environmentStorage';
import { randomUUID } from 'expo-crypto';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual } from '@/services/productReviewService';
import { LabelRouteAmendmentService, isLabelRouteAttempt, isLabelRouteCommand } from '@/services/labelRouteAmendmentService';
import type { LabelRouteAttempt, LabelRouteCommand } from '@/types/labelRouteAmendment';
import type { LabelLifecycleContext } from '@/types/labelLifecycle';
const queues = new Map<string, Promise<unknown>>();
const prefix = (uid: string) => `@label_route_amendment_intent:v1:${encodeURIComponent(uid)}:`;
const key = (uid: string, c: LabelLifecycleContext) => `${prefix(uid)}${encodeURIComponent(c.transactionId)}:${c.leg}`;
function locked<T>(id: string, run: () => Promise<T>) {const previous = queues.get(id) ?? Promise.resolve(), result = previous.then(run, run), tail = result.catch(() => undefined); queues.set(id, tail); void tail.then(() => {if (queues.get(id) === tail) queues.delete(id);}); return result;}
function guard(uid: string, assertContext: () => void) {const session = captureTradeSession(uid); assertContext(); return () => {assertTradeSessionCurrent(session); assertContext();};}
const failure = () => new Error('Votre intention de trajet exacte reste conservée. Relisez son reçu avant une nouvelle démarche.');
export const LabelRouteAmendmentJournal = {
  async pending(uid: string, c: LabelLifecycleContext, assertContext: () => void): Promise<LabelRouteAttempt | null> {
    const current = guard(uid, assertContext), raw = await AsyncStorage.getItem(key(uid, c)); current(); if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw); if (!isLabelRouteAttempt(parsed, uid) || !productReviewEqual(parsed.context, c)) throw failure(); return parsed;
  },
  async list(uid: string, assertContext: () => void): Promise<LabelRouteAttempt[]> {
    const current = guard(uid, assertContext), keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(prefix(uid))).sort(); current();
    const entries = await AsyncStorage.multiGet(keys); current(); const attempts: LabelRouteAttempt[] = [];
    for (const [id, raw] of entries) {if (raw === null) continue; const parsed: unknown = JSON.parse(raw); if (!isLabelRouteAttempt(parsed, uid) || key(uid, parsed.context) !== id) throw failure(); attempts.push(parsed);} return attempts;
  },
  stage(uid: string, command: LabelRouteCommand, assertContext: () => void) {
    // Validate before JSON cloning: NaN must never become a declared unknown
    // measurement, and an old tuple must never acquire the new capability.
    if (!isLabelRouteCommand(command, {transactionId: command.transactionId, leg: command.leg})) throw failure();
    const current = guard(uid, assertContext), captured = JSON.parse(JSON.stringify(command)) as LabelRouteCommand;
    const c: LabelLifecycleContext = {transactionId: captured.transactionId, leg: captured.leg}, id = key(uid, c);
    return locked(id, async () => {
      if (await this.pending(uid, c, current)) throw failure(); current(); const attempt: LabelRouteAttempt = {version: 1, uid, requestId: randomUUID(), context: c, command: captured}; if (!isLabelRouteAttempt(attempt, uid)) throw failure();
      await AsyncStorage.setItem(id, JSON.stringify(attempt)); current(); const saved = await this.pending(uid, c, current); current(); if (!saved || !productReviewEqual(saved, attempt)) throw failure(); return saved;
    });
  },
  async run(attempt: LabelRouteAttempt, action: 'execute' | 'observe' | 'neutralize', assertContext: () => void) {
    const current = guard(attempt.uid, assertContext), saved = await this.pending(attempt.uid, attempt.context, current); current(); if (!saved || !productReviewEqual(saved, attempt)) throw failure();
    const receipt = await LabelRouteAmendmentService.command(saved, action, current); current(); return receipt;
  },
  acknowledge(attempt: LabelRouteAttempt, assertContext: () => void) {
    const current = guard(attempt.uid, assertContext), id = key(attempt.uid, attempt.context);
    return locked(id, async () => {
      const native = await this.run(attempt, 'observe', current); current(); if (!['committed', 'not_executed'].includes(native.state)) throw failure();
      const saved = await this.pending(attempt.uid, attempt.context, current); current(); if (!saved || !productReviewEqual(saved, attempt)) throw failure(); await AsyncStorage.removeItem(id); current(); return native;
    });
  },
};
