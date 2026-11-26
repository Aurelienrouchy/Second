import AsyncStorage from '@/utils/environmentStorage';
import { randomUUID } from 'expo-crypto';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual } from '@/services/productReviewService';
import { ProductPhysicalReviewService, isProductPhysicalAttempt } from '@/services/productPhysicalReviewService';
import type { ProductPhysicalAttempt, ProductPhysicalCommand, ProductPhysicalContext } from '@/types/productPhysicalReview';
const queues = new Map<string, Promise<unknown>>();
const key = (uid: string, context: ProductPhysicalContext) => `@product_physical_intent:v1:${encodeURIComponent(uid)}:${encodeURIComponent(context.id)}`;
function locked<T>(id: string, run: () => Promise<T>) {const prior = queues.get(id) ?? Promise.resolve(); const result = prior.then(run, run), tail = result.catch(() => undefined); queues.set(id, tail); void tail.then(() => {if (queues.get(id) === tail) queues.delete(id);}); return result;}
function guard(uid: string, callback: () => void) {const session = captureTradeSession(uid); callback(); return () => {assertTradeSessionCurrent(session); callback();};}
export const ProductPhysicalReviewJournal = {
  async pending(uid: string, context: ProductPhysicalContext, assertContext: () => void): Promise<ProductPhysicalAttempt | null> {
    const current = guard(uid, assertContext), raw = await AsyncStorage.getItem(key(uid, context)); current(); if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw); if (!isProductPhysicalAttempt(parsed, uid) || !productReviewEqual(parsed.context, context)) throw new Error('Votre journal exact doit être rapproché ; aucune nouvelle intention ne sera créée.'); return parsed;
  },
  stage(uid: string, command: ProductPhysicalCommand, assertContext: () => void, material = false, parcel = false) {
    const current = guard(uid, assertContext), capturedCommand = JSON.parse(JSON.stringify(command)) as ProductPhysicalCommand, id = key(uid, capturedCommand.context);
    return locked(id, async () => {
      if (await this.pending(uid, capturedCommand.context, current)) throw new Error('Relisez le résultat de votre intention précédente avant un nouvel examen.'); current();
      const attempt: ProductPhysicalAttempt = {version: 1, uid, requestId: randomUUID(), context: capturedCommand.context, command: capturedCommand,
        ...(material ? {materialCapability: 'product_review_material_v1' as const} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1' as const} : {})};
      if (!isProductPhysicalAttempt(attempt, uid)) throw new Error('Les sources, le trajet, les appréciations et les motifs exacts sont nécessaires.');
      await AsyncStorage.setItem(id, JSON.stringify(attempt)); current(); const saved = await this.pending(uid, capturedCommand.context, current); current();
      if (!saved || !productReviewEqual(saved, attempt)) throw new Error('Le journal ne peut pas être relu. Aucun envoi n’a été effectué.'); return saved;
    });
  },
  async run(attempt: ProductPhysicalAttempt, action: 'execute' | 'observe' | 'neutralize', assertContext: () => void) {
    const current = guard(attempt.uid, assertContext), saved = await this.pending(attempt.uid, attempt.context, current); current();
    if (!saved || !productReviewEqual(saved, attempt)) throw new Error('Cette intention ne correspond plus à votre journal.');
    const result = await ProductPhysicalReviewService.command(saved, action, current); current(); return result;
  },
  acknowledge(attempt: ProductPhysicalAttempt, assertContext: () => void) {
    const current = guard(attempt.uid, assertContext), id = key(attempt.uid, attempt.context);
    return locked(id, async () => {
      const native = await this.run(attempt, 'observe', current); current(); if (native.state === 'unrecorded') throw new Error('Le résultat demeure inconnu. Votre journal est conservé.');
      const saved = await this.pending(attempt.uid, attempt.context, current); current(); if (!saved || !productReviewEqual(saved, attempt)) throw new Error('Le journal a changé. Aucun acquittement n’a eu lieu.');
      await AsyncStorage.removeItem(id); current(); return native;
    });
  },
};
