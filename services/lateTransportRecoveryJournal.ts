import AsyncStorage from '@/utils/environmentStorage';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual } from '@/services/productReviewService';
import { isRecoveryAttempt, LateTransportRecoveryService } from '@/services/lateTransportRecoveryService';
import type { RecoveryAttempt } from '@/types/lateTransportRecovery';
import type { LateTransportScope } from '@/types/lateTransportIncident';
const key = (uid: string, scope: LateTransportScope) => `second:late-transport-recovery:v1:${JSON.stringify([uid, scope])}`;
const locks = new Set<string>();
const unknown = () => new Error('Relisez le reçu de cette même intention avant de préparer une nouvelle instruction.');
function fence(uid: string, guard: () => void) { const session = captureTradeSession(uid); return () => { assertTradeSessionCurrent(session); guard(); }; }
async function read(uid: string, scope: LateTransportScope, guard: () => void): Promise<RecoveryAttempt | null> {
    const assertCurrent = fence(uid, guard);
    assertCurrent();
    const raw = await AsyncStorage.getItem(key(uid, scope));
    assertCurrent();
    if (raw === null)
        return null;
    const v: unknown = JSON.parse(raw);
    if (!isRecoveryAttempt(v, uid, scope))
        throw unknown();
    return v;
}
async function locked<T>(attempt: RecoveryAttempt, work: () => Promise<T>) { const k = key(attempt.uid, attempt.scope); if (locks.has(k))
    throw unknown(); locks.add(k); try {
    return await work();
}
finally {
    locks.delete(k);
} }
async function same(attempt: RecoveryAttempt, guard: () => void) { if (!productReviewEqual(await read(attempt.uid, attempt.scope, guard), attempt))
    throw unknown(); guard(); }
export const LateTransportRecoveryJournal = {
    read,
    async prepare(attempt: RecoveryAttempt, guard: () => void) {
        if (!isRecoveryAttempt(attempt, attempt.uid, attempt.scope))
            throw unknown();
        const assertCurrent = fence(attempt.uid, guard);
        return locked(attempt, async () => {
            const previous = await read(attempt.uid, attempt.scope, assertCurrent);
            assertCurrent();
            if (previous && !productReviewEqual(previous, attempt))
                throw unknown();
            await AsyncStorage.setItem(key(attempt.uid, attempt.scope), JSON.stringify(attempt));
            assertCurrent();
        });
    },
    async execute(attempt: RecoveryAttempt, guard: () => void) {
        const assertCurrent = fence(attempt.uid, guard);
        return locked(attempt, async () => {
            await same(attempt, assertCurrent);
            // The exact old receipt is serviced before current role, source or preview.
            const old = await LateTransportRecoveryService.command(attempt, 'observe', assertCurrent);
            assertCurrent();
            if (old.state !== 'unrecorded')
                return old;
            if (attempt.scope === 'admin') {
                await LateTransportRecoveryService.preview(attempt, assertCurrent);
                assertCurrent();
            }
            await LateTransportRecoveryService.command(attempt, 'execute', assertCurrent);
            assertCurrent();
            return LateTransportRecoveryService.command(attempt, 'observe', assertCurrent);
        });
    },
    async observe(attempt: RecoveryAttempt, guard: () => void) { const assertCurrent = fence(attempt.uid, guard); assertCurrent(); return LateTransportRecoveryService.command(attempt, 'observe', assertCurrent); },
    async neutralize(attempt: RecoveryAttempt, guard: () => void) {
        const assertCurrent = fence(attempt.uid, guard);
        return locked(attempt, async () => {
            await same(attempt, assertCurrent);
            await LateTransportRecoveryService.command(attempt, 'neutralize', assertCurrent);
            assertCurrent();
            return LateTransportRecoveryService.command(attempt, 'observe', assertCurrent);
        });
    },
    async acknowledge(attempt: RecoveryAttempt, guard: () => void) {
        const assertCurrent = fence(attempt.uid, guard);
        return locked(attempt, async () => {
            const receipt = await LateTransportRecoveryService.command(attempt, 'observe', assertCurrent);
            assertCurrent();
            if (receipt.state === 'unrecorded')
                throw unknown();
            await same(attempt, assertCurrent);
            await AsyncStorage.removeItem(key(attempt.uid, attempt.scope));
            assertCurrent();
            return receipt;
        });
    },
};
