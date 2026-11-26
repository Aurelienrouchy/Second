import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import {functions} from '@/config/firebaseConfig';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {FINANCIAL_RECOVERY_STATUS_CAPABILITY, type FinancialRecoveryStatus} from '@/types/financialRecovery';

export function isFinancialRecoveryStatus(value: unknown, uid: string): value is FinancialRecoveryStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  const keys = ['protocol', 'mode', 'epoch', 'previousEpoch', 'controlGeneration', 'admissionControlOpen', 'reason', 'sourceQualification', 'drainState', 'reopeningAuthority', 'actorId', 'observedAt', 'financialEffectsApplied'];
  const nullableText = (v: unknown) => v === null || typeof v === 'string' && v.length > 0 && v.length <= 200;
  if (Object.keys(d).length !== keys.length || !Object.keys(d).every(k => keys.includes(k)) || d.protocol !== FINANCIAL_RECOVERY_STATUS_CAPABILITY || d.actorId !== uid ||
    !['normal', 'draining', 'recovery', 'unavailable'].includes(String(d.mode)) || ![d.epoch, d.previousEpoch, d.controlGeneration, d.reason].every(nullableText) ||
    d.admissionControlOpen !== (d.mode === 'normal') || d.sourceQualification !== 'required_per_source' || d.drainState !== 'not_measured' ||
    d.reopeningAuthority !== 'independent_iam' || d.financialEffectsApplied !== false || typeof d.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(d.observedAt)) || new Date(d.observedAt).toISOString() !== d.observedAt) return false;
  return d.mode === 'unavailable' ? d.epoch === null && d.previousEpoch === null && d.controlGeneration === null && typeof d.reason === 'string' :
    typeof d.epoch === 'string' && typeof d.controlGeneration === 'string' && d.reason === null;
}

export const FinancialRecoveryService = {
  async observe(uid: string, guard: () => void): Promise<FinancialRecoveryStatus> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
    const response = await httpsCallable<Record<string, unknown>, unknown>(functions, 'readSupportRequests')({capability: FINANCIAL_RECOVERY_STATUS_CAPABILITY, expectedUid: uid, mode: 'observe'});
    current();
    if (!isFinancialRecoveryStatus(response.data, uid)) throw new Error('L’état du contrôle indépendant ne peut pas être qualifié.');
    return response.data;
  },
};
