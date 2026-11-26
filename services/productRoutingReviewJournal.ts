import AsyncStorage from '@/utils/environmentStorage';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual } from '@/services/productReviewService';
import { isProductRoutingAttempt, ProductRoutingReviewService } from '@/services/productRoutingReviewService';
import type { ProductRoutingAttempt } from '@/types/productRoutingReview';
const key = (uid: string, id: string) => `second:product-routing-review:v1:${JSON.stringify([uid, id])}`, locks = new Set<string>();
const failure = () => new Error('Le reçu de la même instruction de routage doit être relu avant une autre intention.');
function fence(uid: string, guard: () => void) { const session = captureTradeSession(uid); return () => { assertTradeSessionCurrent(session); guard(); }; }
async function pending(uid: string, id: string, guard: () => void): Promise<ProductRoutingAttempt | null> {
    const assertCurrent = fence(uid, guard);
    assertCurrent();
    const raw = await AsyncStorage.getItem(key(uid, id));
    assertCurrent();
    if (raw === null)
        return null;
    const v: unknown = JSON.parse(raw);
    if (!isProductRoutingAttempt(v, uid) || v.context.id !== id)
        throw failure();
    return v;
}
async function locked<T>(attempt: ProductRoutingAttempt, work: () => Promise<T>) {
    const slot = key(attempt.uid, attempt.context.id);
    if (locks.has(slot))
        throw failure();
    locks.add(slot);
    try {
        return await work();
    }
    finally {
        locks.delete(slot);
    }
}
async function same(attempt: ProductRoutingAttempt, guard: () => void) {
    if (!productReviewEqual(await pending(attempt.uid, attempt.context.id, guard), attempt))
        throw failure();
    guard();
}
export const ProductRoutingReviewJournal = {
    async list(uid: string, guard: () => void): Promise<ProductRoutingAttempt[]> {
        const assertCurrent = fence(uid, guard);
        assertCurrent();
        const keys = await AsyncStorage.getAllKeys();
        assertCurrent();
        const own: string[] = [];
        for (const candidate of keys) {
            if (!candidate.startsWith('second:product-routing-review:v1:'))
                continue;
            let parts: unknown;
            try {
                parts = JSON.parse(candidate.slice('second:product-routing-review:v1:'.length));
            }
            catch {
                continue;
            }
            if (!Array.isArray(parts) || parts[0] !== uid)
                continue;
            if (parts.length !== 2 || typeof parts[1] !== 'string' || candidate !== key(uid, parts[1]))
                throw failure();
            own.push(candidate);
        }
        const stored = await AsyncStorage.multiGet(own);
        assertCurrent();
        const attempts: ProductRoutingAttempt[] = [];
        for (const [slot, raw] of stored) {
            if (raw === null)
                continue;
            const value: unknown = JSON.parse(raw);
            if (!isProductRoutingAttempt(value, uid) || slot !== key(uid, value.context.id))
                throw failure();
            attempts.push(value);
        }
        assertCurrent();
        return attempts;
    },
    pending,
    async execute(attempt: ProductRoutingAttempt, guard: () => void) {
        if (!isProductRoutingAttempt(attempt, attempt.uid))
            throw failure();
        const assertCurrent = fence(attempt.uid, guard);
        return locked(attempt, async () => {
            if (await pending(attempt.uid, attempt.context.id, assertCurrent))
                throw failure();
            assertCurrent();
            await AsyncStorage.setItem(key(attempt.uid, attempt.context.id), JSON.stringify(attempt));
            assertCurrent();
            await same(attempt, assertCurrent);
            await ProductRoutingReviewService.command(attempt, 'execute', assertCurrent);
            assertCurrent();
            return ProductRoutingReviewService.command(attempt, 'observe', assertCurrent);
        });
    },
    async observe(attempt: ProductRoutingAttempt, guard: () => void) { const assertCurrent = fence(attempt.uid, guard); assertCurrent(); return ProductRoutingReviewService.command(attempt, 'observe', assertCurrent); },
    async resume(attempt: ProductRoutingAttempt, guard: () => void, verifyNew: () => Promise<void>) {
        const assertCurrent = fence(attempt.uid, guard);
        return locked(attempt, async () => {
            await same(attempt, assertCurrent);
            const receipt = await ProductRoutingReviewService.command(attempt, 'observe', assertCurrent);
            assertCurrent();
            if (receipt.state !== 'unrecorded')
                return receipt;
            await verifyNew();
            assertCurrent();
            await ProductRoutingReviewService.command(attempt, 'execute', assertCurrent);
            assertCurrent();
            return ProductRoutingReviewService.command(attempt, 'observe', assertCurrent);
        });
    },
    async neutralize(attempt: ProductRoutingAttempt, guard: () => void) { const assertCurrent = fence(attempt.uid, guard); return locked(attempt, async () => { await same(attempt, assertCurrent); await ProductRoutingReviewService.command(attempt, 'neutralize', assertCurrent); assertCurrent(); return ProductRoutingReviewService.command(attempt, 'observe', assertCurrent); }); },
    async acknowledge(attempt: ProductRoutingAttempt, guard: () => void) {
        const assertCurrent = fence(attempt.uid, guard);
        return locked(attempt, async () => {
            const receipt = await ProductRoutingReviewService.command(attempt, 'observe', assertCurrent);
            assertCurrent();
            if (receipt.state === 'unrecorded')
                throw failure();
            await same(attempt, assertCurrent);
            await AsyncStorage.removeItem(key(attempt.uid, attempt.context.id));
            assertCurrent();
            return receipt;
        });
    }
};
