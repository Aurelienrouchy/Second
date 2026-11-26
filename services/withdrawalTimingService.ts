import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { WithdrawalTimingSource } from '@/types/withdrawalTiming';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const failure = () => new Error('L’observation du délai de ce retrait ne peut pas être confirmée. Relisez le dossier ou demandez une enquête à notre équipe.');
function revision(v: unknown) {
  if (v === null) return true;
  if (typeof v !== 'string' || !/^\d+:\d+$/.test(v)) return false;
  const [seconds, nanos] = v.split(':').map(Number);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 253402300799 && Number.isSafeInteger(nanos) && nanos >= 0 && nanos < 1_000_000_000;
}
export function parseWithdrawalTimingSource(v: unknown, ownerId: string, withdrawalRequestId: string): WithdrawalTimingSource {
  if (!object(v) || !exact(v, ['protocol', 'ownerId', 'withdrawalRequestId', 'sourceRevision', 'sourceHash', 'sourceQualification',
    'requestState', 'amountCents', 'currency', 'observation', 'bankReceiptVerified', 'financialEffectAuthorized']) ||
    v.protocol !== 'withdrawal_timing_source_v1' || v.ownerId !== ownerId || v.withdrawalRequestId !== withdrawalRequestId ||
    !identifier(v.ownerId) || !identifier(v.withdrawalRequestId) || !revision(v.sourceRevision) || typeof v.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.sourceHash) ||
    !['qualified', 'unknown'].includes(String(v.sourceQualification)) || !(v.requestState === null || ['processing', 'completed', 'failed'].includes(String(v.requestState))) ||
    v.bankReceiptVerified !== false || v.financialEffectAuthorized !== false) throw failure();
  if (v.sourceQualification === 'unknown') {if (v.amountCents !== null || v.currency !== null || v.observation !== null) throw failure();}
  else if (typeof v.sourceRevision !== 'string' || !Number.isSafeInteger(v.amountCents) || (v.amountCents as number) <= 0 || v.currency !== 'CAD') throw failure();
  if (v.observation !== null) {
    const o = v.observation;
    if (!object(o) || !exact(o, ['protocol', 'providerStatus', 'arrivalDateSeconds', 'arrivalCalendarDate', 'arrivalQualification', 'observedAt',
      'identityQualification', 'sourceCurrent', 'bankReceiptVerified', 'arrivalGuaranteed']) || o.protocol !== 'withdrawal_payout_timing_v1' ||
      !['pending', 'in_transit', 'paid', 'failed', 'canceled'].includes(String(o.providerStatus)) || !iso(o.observedAt) ||
      !['frozen_destination', 'legacy_saved_payout'].includes(String(o.identityQualification)) || typeof o.sourceCurrent !== 'boolean' ||
      o.bankReceiptVerified !== false || o.arrivalGuaranteed !== false) throw failure();
    if (o.arrivalQualification === 'unknown') {if (o.arrivalDateSeconds !== null || o.arrivalCalendarDate !== null) throw failure();}
    else if (o.arrivalQualification !== 'provider_estimate' || !Number.isSafeInteger(o.arrivalDateSeconds) || (o.arrivalDateSeconds as number) < 0 ||
      (o.arrivalDateSeconds as number) > 253402300799 || typeof o.arrivalCalendarDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.arrivalCalendarDate) ||
      new Date((o.arrivalDateSeconds as number) * 1000).toISOString().slice(0, 10) !== o.arrivalCalendarDate) throw failure();
  }
  return v as unknown as WithdrawalTimingSource;
}
export const WithdrawalTimingService = {
  async read(uid: string, withdrawalRequestId: string, assertContext: () => void): Promise<WithdrawalTimingSource> {
    const session = captureTradeSession(uid); assertContext(); if (!identifier(withdrawalRequestId)) throw failure();
    const result = await httpsCallable<unknown, unknown>(functions, 'getWalletInfo')({mode: 'withdrawal_timing_observe', expectedUid: uid, withdrawalRequestId});
    assertTradeSessionCurrent(session); assertContext(); return parseWithdrawalTimingSource(result.data, uid, withdrawalRequestId);
  },
};
