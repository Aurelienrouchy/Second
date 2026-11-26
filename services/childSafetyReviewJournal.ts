import AsyncStorage from '@/utils/environmentStorage';
import { randomUUID } from 'expo-crypto';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { productReviewEqual } from '@/services/productReviewService';
import { ChildSafetyReviewService, isChildSafetyReviewAttempt } from '@/services/childSafetyReviewService';
import type { ChildSafetyAdmissionCommand, ChildSafetyPublicationCommand, ChildSafetyReviewAttempt } from '@/types/childSafetyReview';
const locks = new Map<string, Promise<unknown>>();
const key = (uid: string, articleId: string, kind: ChildSafetyReviewAttempt['kind']) => `@child_safety_review:v1:${encodeURIComponent(uid)}:${encodeURIComponent(articleId)}:${kind}`;
function locked<T>(id: string, run: () => Promise<T>) {const prior = locks.get(id) ?? Promise.resolve(); const result = prior.then(run, run); const tail = result.catch(() => undefined); locks.set(id, tail); void tail.then(() => {if (locks.get(id) === tail) locks.delete(id);}); return result;}
function guard(uid: string, assertContext: () => void) {const session = captureTradeSession(uid); assertContext(); return () => {assertTradeSessionCurrent(session); assertContext();};}
export const ChildSafetyReviewJournal = {
  async pending(uid: string, articleId: string, kind: ChildSafetyReviewAttempt['kind'], assertContext: () => void): Promise<ChildSafetyReviewAttempt | null> {
    const current = guard(uid, assertContext), raw = await AsyncStorage.getItem(key(uid, articleId, kind)); current(); if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw); if (!isChildSafetyReviewAttempt(parsed, uid) || parsed.articleId !== articleId || parsed.kind !== kind) throw new Error('Le journal de cette intention doit être rapproché.'); return parsed;
  },
  stage(uid: string, articleId: string, value: {kind: 'admission'; command: ChildSafetyAdmissionCommand} | {kind: 'publication'; command: ChildSafetyPublicationCommand}, assertContext: () => void) {
    const current = guard(uid, assertContext), id = key(uid, articleId, value.kind);
    return locked(id, async () => {
      current(); if (await this.pending(uid, articleId, value.kind, current)) throw new Error('Vérifiez et acquittez votre intention précédente avant d’en créer une nouvelle.'); current();
      const attempt = {version: 1 as const, uid, articleId, requestId: randomUUID(), ...value};
      if (!isChildSafetyReviewAttempt(attempt, uid)) throw new Error('Tous les choix, motifs et sources exactes doivent être examinés.');
      await AsyncStorage.setItem(id, JSON.stringify(attempt)); current();
      const saved = await this.pending(uid, articleId, value.kind, current); current(); if (!saved || !productReviewEqual(saved, attempt)) throw new Error('Le journal exact ne peut pas être relu. Aucun envoi n’a été effectué.'); return saved;
    });
  },
  async run(attempt: ChildSafetyReviewAttempt, action: 'execute' | 'observe' | 'neutralize', assertContext: () => void) {
    const current = guard(attempt.uid, assertContext), saved = await this.pending(attempt.uid, attempt.articleId, attempt.kind, current); current();
    if (!saved || !productReviewEqual(saved, attempt)) throw new Error('Cette intention ne correspond plus à votre journal.');
    const receipt = await ChildSafetyReviewService.command(saved, action, current); current(); return receipt;
  },
  async acknowledge(attempt: ChildSafetyReviewAttempt, assertContext: () => void) {
    const current = guard(attempt.uid, assertContext), id = key(attempt.uid, attempt.articleId, attempt.kind);
    return locked(id, async () => {
      const fresh = await this.run(attempt, 'observe', current); current();
      if (fresh.state !== 'committed' && fresh.state !== 'not_executed') throw new Error('Le résultat natif reste inconnu. Votre intention est conservée.');
      const saved = await this.pending(attempt.uid, attempt.articleId, attempt.kind, current); current(); if (!saved || !productReviewEqual(saved, attempt)) throw new Error('Le journal a changé.');
      await AsyncStorage.removeItem(id); current(); return fresh;
    });
  },
};
