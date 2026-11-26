import AsyncStorage from '@/utils/environmentStorage';
import {productReviewEqual} from '@/services/productReviewService';
import {SupportLegalReviewService as Service, isLegalReviewAttempt, legalReviewFailure, legalReviewGuard, legalReviewReceipt} from '@/services/supportLegalReviewService';
import type {LegalReviewArea, LegalReviewAttempt, LegalReviewCommand, LegalReviewReceipt, LegalReviewResult} from '@/types/supportLegalReview';

const slot = (uid: string, area: LegalReviewArea) => `second:support-legal-review:v2:${JSON.stringify([uid, area])}`;
const locks = new Set<string>();
async function read(uid: string, area: LegalReviewArea, guard: () => void): Promise<LegalReviewAttempt | null> {
  const current = legalReviewGuard(uid, guard); current(); const raw = await AsyncStorage.getItem(slot(uid, area)); current();
  if (raw === null) return null; const value: unknown = JSON.parse(raw); if (!isLegalReviewAttempt(value, uid, area)) throw legalReviewFailure(); return value;
}
async function same(attempt: LegalReviewAttempt, guard: () => void) {if (!productReviewEqual(await read(attempt.uid, attempt.area, guard), attempt)) throw legalReviewFailure(); guard();}
async function locked<T>(attempt: LegalReviewAttempt, work: () => Promise<T>): Promise<T> {const key = slot(attempt.uid, attempt.area); if (locks.has(key)) throw legalReviewFailure(); locks.add(key); try {return await work();} finally {locks.delete(key);}}
export const SupportLegalReviewJournal = {
  read,
  async submit(attempt: LegalReviewAttempt, command: LegalReviewCommand, guard: () => void, verifyNew: () => void, resume = false): Promise<LegalReviewResult> {
    const current = legalReviewGuard(attempt.uid, guard); current();
    if (!isLegalReviewAttempt(attempt, attempt.uid, attempt.area)) throw legalReviewFailure();
    return locked(attempt, async () => {
      const prior = await read(attempt.uid, attempt.area, current); current();
      if (prior ? !resume || !productReviewEqual(prior, attempt) : resume) throw new Error('Rapprochez le reçu exact de l’intention conservée avant une nouvelle instruction.');
      if (!productReviewEqual(await Service.attempt(attempt.uid, attempt.area, attempt.requestId, command, current), attempt)) throw legalReviewFailure(); current();
      if (!prior) {verifyNew(); current(); await AsyncStorage.setItem(slot(attempt.uid, attempt.area), JSON.stringify(attempt)); current(); await same(attempt, current);}
      const receipt = legalReviewReceipt(await Service.command(attempt, 'observe', current)); current();
      if (receipt.state !== 'unrecorded') return receipt;
      verifyNew(); current(); return Service.command(attempt, 'execute', current, command);
    });
  },
  async observe(attempt: LegalReviewAttempt, guard: () => void): Promise<LegalReviewReceipt> {const current = legalReviewGuard(attempt.uid, guard); await same(attempt, current); return legalReviewReceipt(await Service.command(attempt, 'observe', current));},
  async neutralize(attempt: LegalReviewAttempt, guard: () => void): Promise<LegalReviewReceipt> {
    const current = legalReviewGuard(attempt.uid, guard);
    return locked(attempt, async () => {await same(attempt, current); const prior = legalReviewReceipt(await Service.command(attempt, 'observe', current)); current(); if (prior.state !== 'unrecorded') return prior; return legalReviewReceipt(await Service.command(attempt, 'neutralize', current));});
  },
  async acknowledge(attempt: LegalReviewAttempt, guard: () => void): Promise<LegalReviewReceipt> {
    const current = legalReviewGuard(attempt.uid, guard);
    return locked(attempt, async () => {await same(attempt, current); const receipt = legalReviewReceipt(await Service.command(attempt, 'observe', current)); current(); if (receipt.state === 'unrecorded') throw legalReviewFailure(); await same(attempt, current); await AsyncStorage.removeItem(slot(attempt.uid, attempt.area)); current(); return receipt;});
  },
};
