import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import {auth, functions} from '@/config/firebaseConfig';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {productReviewEqual, productReviewHash} from '@/services/productReviewService';
import {RETURN_DEPOSIT_DEADLINE_CAPABILITY, type ReturnDepositDeadlineAttempt, type ReturnDepositDeadlinePreview, type ReturnDepositDeadlineReceipt, type ReturnDepositDeadlineScope} from '@/types/returnDepositDeadline';
import {returnDepositObject as object, returnDepositExact as exact, returnDepositId as id, returnDepositHash as hash, returnDepositDate as date,
  returnDepositText as text, RETURN_DEPOSIT_EFFECT_KEYS as EFFECTS, returnDepositNoEffects as noEffects, isReturnDepositTerms, isReturnDepositAttempt} from '@/utils/returnDepositDeadlineContract';

export const returnDepositDeadlineFailure = () => new Error('Le délai et sa source doivent être relus. Une instruction dont le résultat est inconnu reste conservée avec sa référence.');
async function rpc(uid: string, input: Record<string, unknown>, guard: () => void): Promise<unknown> {
  const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
  const result = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({capability: RETURN_DEPOSIT_DEADLINE_CAPABILITY, expectedUid: uid, ...input});
  current(); return result.data;
}
async function currentOperator(uid: string, guard: () => void) {
  const session = captureTradeSession(uid), user = auth.currentUser, current = () => {assertTradeSessionCurrent(session); guard();}; current();
  if (!user || user.uid !== uid) throw returnDepositDeadlineFailure();
  const token = await user.getIdTokenResult(true); current(); const time = token.claims.auth_time, now = Math.floor(Date.now() / 1000);
  if (auth.currentUser !== user || token.claims.admin !== true || typeof time !== 'number' || !Number.isSafeInteger(time) || time <= 0 || time > now || now - time > 300) throw returnDepositDeadlineFailure();
}
export const ReturnDepositDeadlineService = {
  async preview(uid: string, transactionId: string, scope: ReturnDepositDeadlineScope, guard: () => void): Promise<ReturnDepositDeadlinePreview> {
    if (!id(transactionId)) throw returnDepositDeadlineFailure();
    const v = await rpc(uid, {transactionId, scope, ...(scope === 'operator' ? {expectedAdminUid: uid} : {}), mode: 'preview'}, guard);
    if (!object(v) || !exact(v, ['protocol', 'transactionId', 'ownerId', 'role', 'source', 'terms', 'termsAccepted', 'qualification', 'clock', 'currentLabelId', 'canMakeAvailable', 'canExtend', 'physicalEvidence', ...EFFECTS]) ||
        v.protocol !== 'return_deposit_deadline_preview_v1' || v.transactionId !== transactionId || v.ownerId !== uid ||
        !(scope === 'operator' ? v.role === 'operator' : v.role === 'buyer' || v.role === 'seller') || !noEffects(v) || !object(v.source) ||
        !exact(v.source, ['sourceHash', 'version']) || !hash(v.source.sourceHash) || !(v.source.version === null || Number.isSafeInteger(v.source.version) && Number(v.source.version) >= 0 && Number(v.source.version) <= 20) ||
        !['qualified', 'unknown', 'historical_terms_not_recorded'].includes(String(v.qualification)) || typeof v.termsAccepted !== 'boolean' ||
        (v.termsAccepted ? !isReturnDepositTerms(v.terms) : v.terms !== null) || v.canMakeAvailable !== false || typeof v.canExtend !== 'boolean' ||
        !(v.currentLabelId === null || id(v.currentLabelId))) throw returnDepositDeadlineFailure();
    const c = v.clock;
    if (c !== null && (!object(c) || !exact(c, ['version', 'availableAt', 'dueAt', 'baseLabelId', 'currentLabelId', 'currentLabelMatches', 'reviewRequired', 'extensions']) ||
        !Number.isSafeInteger(c.version) || Number(c.version) < 1 || Number(c.version) > 20 || c.version !== v.source.version || !date(c.availableAt) ||
        !(c.dueAt === null || date(c.dueAt) && Date.parse(c.dueAt) > Date.parse(c.availableAt)) || !id(c.baseLabelId) || c.currentLabelId !== v.currentLabelId ||
        typeof c.currentLabelMatches !== 'boolean' || c.currentLabelMatches !== (c.baseLabelId === c.currentLabelId) || typeof c.reviewRequired !== 'boolean' ||
        (c.dueAt === null || !c.currentLabelMatches) && c.reviewRequired !== true || !Array.isArray(c.extensions) || c.extensions.length !== Number(c.version) - 1 ||
        c.extensions.some(e => !object(e) || !exact(e, ['recordedAt', 'newDueAt', 'motivation', 'partyMessage']) || !date(e.recordedAt) || !date(e.newDueAt) || !text(e.partyMessage) ||
          (scope === 'owner' ? e.motivation !== null : !text(e.motivation))))) throw returnDepositDeadlineFailure();
    if ((v.qualification === 'qualified') !== (c !== null) || c !== null && !v.termsAccepted || v.qualification === 'historical_terms_not_recorded' && v.termsAccepted ||
        v.canExtend && (scope !== 'operator' || !object(c) || Number(c.version) >= 20)) throw returnDepositDeadlineFailure();
    const p = v.physicalEvidence;
    if (!object(p) || !exact(p, ['carrierDepositVerified', 'parcelDeliveredAt', 'parcelDeliveryDeclared', 'contentsReceivedConfirmed']) || p.carrierDepositVerified !== false ||
        p.contentsReceivedConfirmed !== false || typeof p.parcelDeliveryDeclared !== 'boolean' || !(p.parcelDeliveredAt === null || date(p.parcelDeliveredAt)) ||
        p.parcelDeliveredAt !== null && !p.parcelDeliveryDeclared) throw returnDepositDeadlineFailure();
    return v as unknown as ReturnDepositDeadlinePreview;
  },
  async command(a: ReturnDepositDeadlineAttempt, mode: 'execute' | 'observe' | 'neutralize', guard: () => void): Promise<ReturnDepositDeadlineReceipt> {
    const session = captureTradeSession(a.uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
    if (!isReturnDepositAttempt(a, a.uid, a.transactionId) || await productReviewHash(a.command) !== a.payloadHash) throw returnDepositDeadlineFailure(); current();
    if (mode === 'execute') {if (a.scope !== 'operator' || a.command.action !== 'extend') throw returnDepositDeadlineFailure(); await currentOperator(a.uid, current); current();}
    const v = await rpc(a.uid, {transactionId: a.transactionId, scope: a.scope, ...(a.scope === 'operator' ? {expectedAdminUid: a.uid} : {}), requestId: a.requestId, command: a.command, mode}, current);
    if (!object(v) || !exact(v, ['protocol', 'transactionId', 'ownerId', 'requestId', 'command', 'payloadHash', 'state', 'recordedAt', 'reason', 'clockVersion', ...EFFECTS]) ||
        v.protocol !== 'return_deposit_deadline_receipt_v1' || v.transactionId !== a.transactionId || v.ownerId !== a.uid || v.requestId !== a.requestId || v.payloadHash !== a.payloadHash ||
        !productReviewEqual(v.command, a.command) || !noEffects(v) ||
        (v.state === 'absent' ? v.recordedAt !== null || v.reason !== null || v.clockVersion !== null :
          !['committed', 'not_executed', 'neutralized'].includes(String(v.state)) || !date(v.recordedAt) ||
          (v.state === 'committed' ? v.reason !== null || !Number.isSafeInteger(v.clockVersion) || Number(v.clockVersion) < 1 || Number(v.clockVersion) > 20 :
            !text(v.reason) || v.clockVersion !== null))) throw returnDepositDeadlineFailure();
    return v as unknown as ReturnDepositDeadlineReceipt;
  },
};
