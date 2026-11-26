import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { EffectiveDeliveryWindow } from '@/types/effectiveDeliveryWindow';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const revision = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}:\d{1,9}$/.test(v) && Number.isSafeInteger(Number(v.split(':')[0])) &&
  Number(v.split(':')[0]) <= 253402300799 && Number(v.split(':')[1]) < 1_000_000_000;
const blockers = ['seller_context', 'source_unknown', 'correction_review', 'tracking_review', 'purchase_policy_review', 'bank_case', 'refund', 'return_request', 'return_to_sender', 'risk_review',
  'commercial_dispute', 'moderation_review', 'window_elapsed', 'funds_already_released', 'financial_source_unknown', 'label_reconciliation', 'commercial_context'];
const failure = () => new Error('La politique et les gardes actuelles de cette fenêtre doivent être relues.');
function parse(v: unknown, uid: string, transactionId: string): EffectiveDeliveryWindow {
  if (!object(v) || !exact(v, ['protocol', 'ownerId', 'transactionId', 'sourceRevision', 'sourceHash', 'policy', 'qualification', 'window', 'guardQualification', 'blockers',
    'canReportProblemNow', 'canPrepareReturnNow', 'financialEffectAuthorized', 'inventoryReleaseAuthorized', 'parcelPossessionVerified']) || v.protocol !== 'effective_delivery_window_v1' ||
    v.ownerId !== uid || v.transactionId !== transactionId || !revision(v.sourceRevision) || !hash(v.sourceHash) ||
    !['native_original_window', 'native_corrected_window', 'unknown'].includes(String(v.qualification)) || !['native_current', 'unknown'].includes(String(v.guardQualification)) ||
    !Array.isArray(v.blockers) || !v.blockers.every(k => typeof k === 'string' && blockers.includes(k)) || new Set(v.blockers).size !== v.blockers.length ||
    typeof v.canReportProblemNow !== 'boolean' || typeof v.canPrepareReturnNow !== 'boolean' || v.financialEffectAuthorized !== false || v.inventoryReleaseAuthorized !== false || v.parcelPossessionVerified !== false) throw failure();
  const policy = v.policy, window = v.window;
  if (policy !== null && (!object(policy) || !exact(policy, ['policyVersion', 'policyHash', 'acceptedAt', 'parameters']) || !['shipping_purchase_2026_01', 'shipping_purchase_2026_02'].includes(String(policy.policyVersion)) ||
    !hash(policy.policyHash) || !iso(policy.acceptedAt) || !object(policy.parameters) || !exact(policy.parameters, ['fundsHoldMs', 'deliveryProtectionMs', 'nonShipmentMs']) ||
    !['fundsHoldMs', 'deliveryProtectionMs', 'nonShipmentMs'].every(k => (policy.parameters as Record<string, unknown>)[k] === 604800000))) throw failure();
  if (window !== null && (!object(window) || !exact(window, ['clockBasis', 'occurredAt', 'originalDeliveryAt', 'originalRecordedAt', 'originalFundsReleaseAt', 'originalProtectionEndsAt',
    'effectiveFundsReleaseAt', 'effectiveProtectionEndsAt', 'correctionId', 'correctionDecidedAt']) || window.clockBasis !== 'qualified_provider_delivery_event' ||
    !['occurredAt', 'originalDeliveryAt', 'originalRecordedAt', 'originalFundsReleaseAt', 'originalProtectionEndsAt', 'effectiveFundsReleaseAt', 'effectiveProtectionEndsAt'].every(k => iso(window[k])) ||
    (v.qualification === 'native_corrected_window' ? !hash(window.correctionId) || !iso(window.correctionDecidedAt) : window.correctionId !== null || window.correctionDecidedAt !== null))) throw failure();
  if (v.qualification === 'unknown' ? window !== null || v.canReportProblemNow || v.canPrepareReturnNow : !policy || !window || !revision(v.sourceRevision)) throw failure();
  if ((v.canReportProblemNow || v.canPrepareReturnNow) && v.qualification === 'unknown' || v.canPrepareReturnNow && (v.guardQualification !== 'native_current' || v.blockers.length > 0)) throw failure();
  if (v.canReportProblemNow && v.blockers.some(k => ['seller_context', 'source_unknown', 'window_elapsed', 'funds_already_released', 'commercial_dispute'].includes(String(k)))) throw failure();
  return v as unknown as EffectiveDeliveryWindow;
}
export const EffectiveDeliveryWindowService = {
  async observe(uid: string, transactionId: string, assertContext: () => void): Promise<EffectiveDeliveryWindow> {
    const session = captureTradeSession(uid); assertContext(); if (!/^[A-Za-z0-9_-]{1,200}$/.test(transactionId)) throw failure();
    const result = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({mode: 'policy_observe', expectedUid: session.uid, transactionId, capability: 'effective_delivery_window_v1'});
    assertTradeSessionCurrent(session); assertContext(); return parse(result.data, session.uid, transactionId);
  },
};
