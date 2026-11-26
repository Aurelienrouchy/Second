import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { isRelationshipReference } from '@/services/accountRelationshipReviewService';
import { productReviewEqual, productReviewHash } from '@/services/productReviewService';
import { SWAP_TOPUP_MANUAL_CAPABILITY, type SwapTopUpAmounts, type SwapTopUpAttempt, type SwapTopUpCommand, type SwapTopUpPayment,
  type SwapTopUpPreview, type SwapTopUpReceipt, type SwapTopUpScope } from '@/types/swapTopUpCheckout';
import type { RelationshipReference } from '@/types/accountRelationshipReview';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const id = (v: unknown): v is string => typeof v === 'string' && !!v && v.trim() === v && v.length <= 128 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const providerId = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(v);
const statuses = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded', 'unknown'];
export const swapTopUpFailure = () => new Error('Le complément reste à vérifier dans son dossier exact. Aucun nouveau paiement ou règlement n’est confirmé.');
function amounts(v: unknown): v is SwapTopUpAmounts {
  return object(v) && exact(v, ['baseCents', 'serviceFeeCents', 'taxCents', 'totalCents', 'currency']) && ['baseCents', 'serviceFeeCents', 'taxCents', 'totalCents'].every(k => count(v[k])) && (v.baseCents as number) > 0 && v.totalCents === (v.baseCents as number) + (v.serviceFeeCents as number) + (v.taxCents as number) && v.currency === 'CAD';
}
export function isSwapTopUpCommand(v: unknown): v is SwapTopUpCommand {
  if (!object(v) || !exact(v, ['action', 'scope', 'sourceHash', 'intentId', 'intentVersion', 'paymentIntentId', 'paymentMethodId', 'totalCents', 'relationshipReference', 'acknowledged']) || !['prepare', 'confirm', 'retire_legacy'].includes(String(v.action)) || !['own', 'admin'].includes(String(v.scope)) || !hash(v.sourceHash) || !count(v.totalCents) || !v.totalCents || v.acknowledged !== true || !(v.intentId === null || id(v.intentId)) || !(v.intentVersion === null || count(v.intentVersion) && v.intentVersion > 0) || !(v.paymentIntentId === null || providerId(v.paymentIntentId, 'pi')) || !(v.paymentMethodId === null || providerId(v.paymentMethodId, 'pm')) || (v.scope === 'admin' ? v.action !== 'retire_legacy' || !isRelationshipReference(v.relationshipReference) : v.relationshipReference !== null)) return false;
  if (v.action === 'prepare') return v.intentId === null && v.intentVersion === null && v.paymentIntentId === null && v.paymentMethodId === null;
  if (v.action === 'retire_legacy') return v.intentId === null && v.intentVersion === null && v.paymentMethodId === null && providerId(v.paymentIntentId, 'pi');
  return id(v.intentId) && count(v.intentVersion) && v.intentVersion > 0 && providerId(v.paymentIntentId, 'pi');
}
export function isSwapTopUpAttempt(v: unknown, uid: string, scope: SwapTopUpScope): v is SwapTopUpAttempt {
  return object(v) && exact(v, ['version', 'uid', 'swapId', 'requestId', 'capability', 'command']) && v.version === 1 && v.uid === uid && id(v.swapId) && id(v.requestId) && v.requestId.length >= 16 && v.capability === SWAP_TOPUP_MANUAL_CAPABILITY && isSwapTopUpCommand(v.command) && v.command.scope === scope;
}
function payment(v: unknown, swapId: string, total?: SwapTopUpAmounts): v is SwapTopUpPayment {
  if (!object(v) || !exact(v, ['protocol', 'swapId', 'paymentIntentId', 'intentId', 'intentVersion', 'amounts', 'providerStatus', 'confirmationMethod', 'action', 'legacyExternalConfirmationPrevented', 'settlementReceiptVerified', 'paymentPermissionGranted', ...('actionClientSecret' in v ? ['actionClientSecret'] : [])]) || v.protocol !== 'swap_topup_payment_v1' || v.swapId !== swapId || !providerId(v.paymentIntentId, 'pi') || !amounts(v.amounts) || total && !productReviewEqual(total, v.amounts) || !statuses.includes(String(v.providerStatus)) || !['manual', 'automatic', 'unknown'].includes(String(v.confirmationMethod)) || !['awaitSettlement', 'reviewCancellation', 'handleNextAction', 'confirmOnServer', 'reviewLegacyExposure'].includes(String(v.action)) || !['legacyExternalConfirmationPrevented', 'settlementReceiptVerified'].every(k => typeof v[k] === 'boolean') || v.paymentPermissionGranted !== false) return false;
  if (v.confirmationMethod === 'manual' ? !id(v.intentId) || !count(v.intentVersion) || v.intentVersion < 1 : v.intentId !== null || v.intentVersion !== null) return false;
  const manualReconciliation = v.confirmationMethod === 'manual' && ['requires_payment_method', 'requires_confirmation'].includes(String(v.providerStatus));
  if (v.settlementReceiptVerified && v.providerStatus !== 'succeeded' || v.action === 'handleNextAction' && (v.confirmationMethod !== 'manual' || v.providerStatus !== 'requires_action') || v.action === 'confirmOnServer' && (v.confirmationMethod !== 'manual' || !['requires_payment_method', 'requires_confirmation'].includes(String(v.providerStatus))) || v.action === 'awaitSettlement' && !manualReconciliation && !['succeeded', 'processing', 'requires_capture'].includes(String(v.providerStatus)) || v.action === 'reviewCancellation' && v.providerStatus !== 'canceled') return false;
  return !('actionClientSecret' in v) || v.action === 'handleNextAction' && typeof v.actionClientSecret === 'string' && v.actionClientSecret.startsWith(`${v.paymentIntentId}_secret_`) && v.actionClientSecret.length <= 1000;
}
async function call(uid: string, swapId: string, input: Record<string, unknown>, guard: () => void, privateRead = false): Promise<unknown> {
  const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
  const user = auth.currentUser; if (!user || user.uid !== uid || !id(swapId)) throw swapTopUpFailure();
  if (privateRead) {const token = await user.getIdTokenResult(true); current(); const time = token.claims.auth_time, now = Math.floor(Date.now() / 1000);
    if (auth.currentUser !== user || token.claims.admin !== true || typeof time !== 'number' || !Number.isSafeInteger(time) || time <= 0 || time > now || now - time > 300) throw new Error('Confirmez à nouveau votre identité opérateur pour ce dossier exact.');
  } else {await user.getIdToken(); current();}
  const result = await httpsCallable<unknown, unknown>(functions, 'createSwapTopUpCheckout')({capability: SWAP_TOPUP_MANUAL_CAPABILITY, expectedUid: uid, swapId, ...input}); current(); return result.data;
}
export const SwapTopUpCheckoutService = {
  async preview(uid: string, swapId: string, scope: SwapTopUpScope, relationshipReference: RelationshipReference | null, guard: () => void): Promise<SwapTopUpPreview> {
    if (scope === 'admin' ? !isRelationshipReference(relationshipReference) : relationshipReference !== null) throw swapTopUpFailure();
    const v = await call(uid, swapId, {mode: 'preview', scope, ...(relationshipReference ? {relationshipReference} : {})}, guard, scope === 'admin');
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'swapId', 'sourceHash', 'amounts', 'payment', 'preparation', 'manualEnabled', 'legacyCoverage', 'exhaustivePairSwapHistoryVerified', 'paymentPermissionGranted']) || v.protocol !== 'swap_topup_preview_v1' || v.actorId !== uid || v.scope !== scope || v.swapId !== swapId || !hash(v.sourceHash) || !amounts(v.amounts) || !(v.payment === null || payment(v.payment, swapId, v.amounts)) || typeof v.manualEnabled !== 'boolean' || !object(v.preparation) || !exact(v.preparation, ['qualification', 'canPrepareNow']) || !['native_unstarted', 'native_manual_intention', 'native_legacy_exposure', 'native_legacy_neutralized', 'unknown'].includes(String(v.preparation.qualification)) || typeof v.preparation.canPrepareNow !== 'boolean' || v.preparation.canPrepareNow && (!v.manualEnabled || !['native_unstarted', 'native_legacy_neutralized'].includes(String(v.preparation.qualification))) || v.legacyCoverage !== 'selected_swap_only' || v.exhaustivePairSwapHistoryVerified !== false || v.paymentPermissionGranted !== false) throw swapTopUpFailure();
    guard(); return v as unknown as SwapTopUpPreview;
  },
  async command(attempt: SwapTopUpAttempt, mode: 'execute' | 'observe' | 'neutralize', guard: () => void): Promise<SwapTopUpReceipt> {
    if (!isSwapTopUpAttempt(attempt, attempt.uid, attempt.command.scope)) throw swapTopUpFailure();
    const expectedHash = await productReviewHash(attempt.command); guard();
    const v = await call(attempt.uid, attempt.swapId, {requestId: attempt.requestId, mode, command: attempt.command}, guard);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'swapId', 'requestId', 'command', 'payloadHash', 'state', 'reason', 'result', 'futureEffectsNeutralized', 'recordedAt', 'paymentPermissionGranted', ...('payment' in v ? ['payment'] : [])]) || v.protocol !== 'swap_topup_command_v1' || v.actorId !== attempt.uid || v.swapId !== attempt.swapId || v.requestId !== attempt.requestId || !productReviewEqual(v.command, attempt.command) || v.payloadHash !== expectedHash || !['unrecorded', 'received', 'not_executed', 'unknown', 'engaged'].includes(String(v.state)) || typeof v.futureEffectsNeutralized !== 'boolean' || v.paymentPermissionGranted !== false || !(v.reason === null || typeof v.reason === 'string' && !!v.reason) || !(v.recordedAt === null || iso(v.recordedAt))) throw swapTopUpFailure();
    if (!(v.result === null || object(v.result) && exact(v.result, ['providerStatus', 'paymentIntentId', 'intentId', 'financialSettlementVerified', 'legacyExternalConfirmationPrevented']) && statuses.includes(String(v.result.providerStatus)) && providerId(v.result.paymentIntentId, 'pi') && (v.result.intentId === null || id(v.result.intentId)) && v.result.financialSettlementVerified === false && typeof v.result.legacyExternalConfirmationPrevented === 'boolean')) throw swapTopUpFailure();
    if (v.state === 'received' ? !iso(v.recordedAt) || v.reason !== null || v.result === null : v.state === 'not_executed' ? !iso(v.recordedAt) || v.reason === null || v.result !== null : v.recordedAt !== null || v.reason !== null || v.state === 'unrecorded' && (v.result !== null || v.futureEffectsNeutralized)) throw swapTopUpFailure();
    if (v.result && attempt.command.paymentIntentId !== null && v.result.paymentIntentId !== attempt.command.paymentIntentId) throw swapTopUpFailure();
    if (v.result && attempt.command.intentId !== null && v.result.intentId !== attempt.command.intentId) throw swapTopUpFailure();
    if ('payment' in v) {
      if (!payment(v.payment, attempt.swapId) || v.payment.amounts.totalCents !== attempt.command.totalCents || attempt.command.paymentIntentId !== null && v.payment.paymentIntentId !== attempt.command.paymentIntentId || attempt.command.intentId !== null && v.payment.intentId !== attempt.command.intentId) throw swapTopUpFailure();
    }
    guard(); return v as unknown as SwapTopUpReceipt;
  },
};
