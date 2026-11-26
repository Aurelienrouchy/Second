import AsyncStorage from '@/utils/environmentStorage';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {productReviewEqual} from '@/services/productReviewService';
import {SellerActivityReviewService as Service, isSellerActivityReviewAttempt, sellerActivityReviewFailure} from '@/services/sellerActivityReviewService';
import type {SellerActivityReviewAttempt, SellerActivityReviewCommand} from '@/types/sellerActivityReview';
const slot = (uid: string) => `second:seller-activity-review:v1:${encodeURIComponent(uid)}`, locks = new Set<string>();
const fenced = (uid: string, guard: () => void) => {const s = captureTradeSession(uid); return () => {assertTradeSessionCurrent(s); guard();};};
async function read(uid: string, guard: () => void): Promise<SellerActivityReviewAttempt | null> {const current = fenced(uid, guard); current(); const raw = await AsyncStorage.getItem(slot(uid)); current();
  if (raw === null) return null; if (raw.length > 700) throw sellerActivityReviewFailure(); const parsed: unknown = JSON.parse(raw); if (!isSellerActivityReviewAttempt(parsed, uid)) throw sellerActivityReviewFailure(); return parsed;}
async function same(attempt: SellerActivityReviewAttempt, current: () => void) {if (!productReviewEqual(await read(attempt.uid, current), attempt)) throw sellerActivityReviewFailure(); current();}
async function locked<T>(uid: string, work: () => Promise<T>) {if (locks.has(uid)) throw sellerActivityReviewFailure(); locks.add(uid); try {return await work();} finally {locks.delete(uid);}}
export const SellerActivityReviewJournal = {
  read,
  async submit(attempt: SellerActivityReviewAttempt, command: SellerActivityReviewCommand, guard: () => void, verifySource: () => void) {const current = fenced(attempt.uid, guard);
    return locked(attempt.uid, async () => {if (!isSellerActivityReviewAttempt(attempt, attempt.uid) || await read(attempt.uid, current)) throw sellerActivityReviewFailure(); verifySource(); current();
      await AsyncStorage.setItem(slot(attempt.uid), JSON.stringify(attempt)); current(); await same(attempt, current);
      const old = await Service.command(attempt, 'observe', current); current(); if (old.state !== 'unrecorded') return old;
      verifySource(); current(); await Service.command(attempt, 'execute', current, command); current(); return Service.command(attempt, 'observe', current);});},
  async observe(attempt: SellerActivityReviewAttempt, guard: () => void) {const current = fenced(attempt.uid, guard); await same(attempt, current); return Service.command(attempt, 'observe', current);},
  async neutralize(attempt: SellerActivityReviewAttempt, guard: () => void) {const current = fenced(attempt.uid, guard); return locked(attempt.uid, async () => {await same(attempt, current); const old = await Service.command(attempt, 'observe', current); current();
    if (old.state !== 'unrecorded') return old; await Service.command(attempt, 'neutralize', current); current(); return Service.command(attempt, 'observe', current);});},
  async acknowledge(attempt: SellerActivityReviewAttempt, guard: () => void) {const current = fenced(attempt.uid, guard); return locked(attempt.uid, async () => {await same(attempt, current); const fresh = await Service.command(attempt, 'observe', current); current();
    if (fresh.state === 'unrecorded') throw sellerActivityReviewFailure(); await same(attempt, current); await AsyncStorage.removeItem(slot(attempt.uid)); current(); return fresh;});},
};
