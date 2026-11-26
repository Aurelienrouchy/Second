import AsyncStorage from '@/utils/environmentStorage';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { isProductReviewAttempt, isProductReviewContext, productReviewEqual, ProductReviewService } from '@/services/productReviewService';
import type { ProductReviewAttempt, ProductReviewContext } from '@/types/productReview';

const locks = new Set<string>();
const key = (uid: string, context: ProductReviewContext) => `second:product-review:v1:${JSON.stringify([uid, context.kind, context.id])}`;
const failure = () => new Error('L’intention exacte reste conservée. Relisez son reçu avant de recommencer une autre démarche.');
async function pending(uid: string, context: ProductReviewContext, assertContext: () => void): Promise<ProductReviewAttempt | null> {
  const session = captureTradeSession(uid); assertContext(); if (!isProductReviewContext(context)) throw failure();
  const raw = await AsyncStorage.getItem(key(uid, context)); assertTradeSessionCurrent(session); assertContext();
  if (raw === null) return null;
  const attempt: unknown = JSON.parse(raw);
  if (!isProductReviewAttempt(attempt, uid) || !productReviewEqual(attempt.context, context)) throw failure();
  return attempt;
}
async function locked<T>(uid: string, context: ProductReviewContext, assertContext: () => void, task: () => Promise<T>): Promise<T> {
  const session = captureTradeSession(uid); assertContext(); if (!isProductReviewContext(context)) throw failure();
  const slot = key(uid, context); if (locks.has(slot)) throw failure(); locks.add(slot);
  try {const result = await task(); assertTradeSessionCurrent(session); assertContext(); return result;} finally {locks.delete(slot);}
}
async function exactPending(attempt: ProductReviewAttempt, assertContext: () => void) {
  const saved = await pending(attempt.uid, attempt.context, assertContext);
  if (!saved || !productReviewEqual(saved, attempt)) throw failure(); return saved;
}
export const ProductReviewJournal = {
  pending,
  execute(attempt: ProductReviewAttempt, assertContext: () => void) {
    return locked(attempt.uid, attempt.context, assertContext, async () => {
      if (!isProductReviewAttempt(attempt, attempt.uid) || await pending(attempt.uid, attempt.context, assertContext)) throw failure();
      const session = captureTradeSession(attempt.uid); assertContext();
      await AsyncStorage.setItem(key(attempt.uid, attempt.context), JSON.stringify(attempt)); assertTradeSessionCurrent(session); assertContext();
      const saved = await exactPending(attempt, assertContext);
      await ProductReviewService.command(saved, 'execute', assertContext);
      return ProductReviewService.command(saved, 'observe', assertContext);
    });
  },
  observe(attempt: ProductReviewAttempt, assertContext: () => void) {
    return locked(attempt.uid, attempt.context, assertContext, async () => ProductReviewService.command(await exactPending(attempt, assertContext), 'observe', assertContext));
  },
  resume(attempt: ProductReviewAttempt, assertContext: () => void) {
    return locked(attempt.uid, attempt.context, assertContext, async () => {
      const saved = await exactPending(attempt, assertContext);
      await ProductReviewService.command(saved, 'execute', assertContext); return ProductReviewService.command(saved, 'observe', assertContext);
    });
  },
  neutralize(attempt: ProductReviewAttempt, assertContext: () => void) {
    return locked(attempt.uid, attempt.context, assertContext, async () => {
      const saved = await exactPending(attempt, assertContext);
      await ProductReviewService.command(saved, 'neutralize', assertContext); return ProductReviewService.command(saved, 'observe', assertContext);
    });
  },
  acknowledge(attempt: ProductReviewAttempt, assertContext: () => void) {
    return locked(attempt.uid, attempt.context, assertContext, async () => {
      const saved = await exactPending(attempt, assertContext), receipt = await ProductReviewService.command(saved, 'observe', assertContext);
      if (receipt.state === 'unrecorded') throw failure();
      await exactPending(saved, assertContext);
      const session = captureTradeSession(saved.uid); assertContext(); await AsyncStorage.removeItem(key(saved.uid, saved.context));
      assertTradeSessionCurrent(session); assertContext(); return receipt;
    });
  },
};
