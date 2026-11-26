import {httpsCallable} from 'firebase/functions';
import {functions} from '@/config/firebaseConfig';
import {assertTradeSessionCurrent, captureTradeSession} from '@/services/tradeOperation';
import {productReviewEqual, productReviewHash} from '@/services/productReviewService';
import {PRICED_CONVENIENCE_RETURN_CAPABILITY, CONVENIENCE_RETURN_INCIDENT_CAPABILITY, type ConvenienceReturnCapability, type ConvenienceReturnAttempt, type ConvenienceReturnPreview, type ConvenienceReturnReceipt, type ConvenienceReturnReceptionAttempt, type ConvenienceReturnReceptionPreview, type ConvenienceReturnReceptionReceipt, type ConvenienceReturnIncidentAttempt, type ConvenienceReturnIncidentPreview, type ConvenienceReturnIncidentReceipt} from '@/types/convenienceReturn';
import {convenienceObject as object, convenienceExact as exact, convenienceHash as hash, convenienceId as id, convenienceDate as iso,
  convenienceProposalId as proposalId, convenienceNoEffects as noEffects, CONVENIENCE_EFFECT_KEYS as EFFECTS, isConvenienceTerms, isConvenienceAttempt,
  isConvenienceReturnReference, isConvenienceReturnFinancialReference, isConvenienceReturnReceptionAttempt, isConvenienceReturnTerminal, isConvenienceReturnVariance,
  isConvenienceReturnVarianceResolution, isConvenienceReturnIncidentAttempt} from '@/utils/convenienceReturnContract';
const RECEPTION_EFFECTS = ['financialEffectAuthorized', 'refundDecisionGranted', 'physicalContentsVerified'];
const INCIDENT_EFFECTS = ['financialEffectAuthorized', 'refundDecisionGranted', 'shippingPermissionGranted'];
export const convenienceReturnFailure = () => new Error('L’accord pour changement d’avis doit être relu depuis cette commande. Une réponse inconnue reste conservée avec sa référence.');
async function rpc(uid: string, capability: ConvenienceReturnCapability | typeof CONVENIENCE_RETURN_INCIDENT_CAPABILITY, input: Record<string, unknown>, guard: () => void): Promise<unknown> {
  const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
  const result = await httpsCallable<unknown, unknown>(functions, 'requestReturn')({...input, capability, expectedUid: uid});
  current(); return result.data;
}
export const ConvenienceReturnService = {
  async preview(uid: string, transactionId: string, guard: () => void, capability: ConvenienceReturnCapability = PRICED_CONVENIENCE_RETURN_CAPABILITY): Promise<ConvenienceReturnPreview> {
    if (!id(transactionId)) throw convenienceReturnFailure();
    const priced = capability === PRICED_CONVENIENCE_RETURN_CAPABILITY, termsProtocol = priced ? 'convenience_return_terms_v2' : 'convenience_return_terms_v1';
    const v = await rpc(uid, capability, {transactionId, mode: 'preview'}, guard);
    if (!object(v) || !exact(v, ['protocol', 'transactionId', 'ownerId', 'role', 'source', 'state', 'sourceCurrentlyMatches', 'proposal', 'terms', 'canRequest', 'canRespond', ...EFFECTS]) ||
        v.protocol !== (priced ? 'convenience_return_preview_v2' : 'convenience_return_preview_v1') || v.transactionId !== transactionId || v.ownerId !== uid || !['buyer', 'seller'].includes(String(v.role)) ||
        !['none', 'pending', 'accepted', 'refused', 'unknown'].includes(String(v.state)) || !['sourceCurrentlyMatches', 'canRequest', 'canRespond'].every(k => typeof v[k] === 'boolean') ||
        !noEffects(v, capability) || (v.source !== null && (!object(v.source) || !exact(v.source, ['sourceHash', 'version']) || !hash(v.source.sourceHash) ||
          !(v.source.version === null || typeof v.source.version === 'number' && Number.isSafeInteger(v.source.version) && v.source.version >= 0 && v.source.version <= 2))) ||
        (v.terms !== null && (!isConvenienceTerms(v.terms, transactionId) || v.terms.protocol !== termsProtocol))) throw convenienceReturnFailure();
    const p = v.proposal;
    if (p !== null && (!object(p) || !exact(p, ['proposalId', 'contentHash', 'terms', 'requestedAt', 'respondedAt']) || !proposalId(p.proposalId) || !hash(p.contentHash) ||
        !isConvenienceTerms(p.terms, transactionId) || p.terms.protocol !== termsProtocol || !iso(p.requestedAt) || !(p.respondedAt === null || iso(p.respondedAt)))) throw convenienceReturnFailure();
    if (v.terms && (v.role === 'buyer' ? v.terms.buyerId !== uid : v.terms.sellerId !== uid) ||
        object(p) && isConvenienceTerms(p.terms, transactionId) && (v.role === 'buyer' ? p.terms.buyerId !== uid : p.terms.sellerId !== uid) ||
        object(p) && v.sourceCurrentlyMatches && !productReviewEqual(p.terms, v.terms) ||
        (v.state === 'none' || v.state === 'unknown') !== (p === null) ||
        (v.state === 'pending' && object(p) && p.respondedAt !== null) ||
        (['accepted', 'refused'].includes(String(v.state)) && object(p) && p.respondedAt === null) ||
        v.canRequest && (v.role !== 'buyer' || v.state !== 'none' || !v.sourceCurrentlyMatches || !v.terms || !object(v.source) || v.source.version !== 0 ||
          priced && (v.terms.protocol !== 'convenience_return_terms_v2' || v.terms.refund.maximumRemainingArticleCents <= 0)) ||
        v.canRespond && (v.role !== 'seller' || v.state !== 'pending' || !v.sourceCurrentlyMatches || !v.terms || !object(v.source) || v.source.version !== 1 || !object(p) || !productReviewEqual(p.terms, v.terms))) throw convenienceReturnFailure();
    return v as unknown as ConvenienceReturnPreview;
  },
  async command(a: ConvenienceReturnAttempt, mode: 'execute' | 'observe' | 'neutralize', guard: () => void): Promise<ConvenienceReturnReceipt> {
    const session = captureTradeSession(a.uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
    if (!isConvenienceAttempt(a, a.uid, a.transactionId) || await productReviewHash(a.command) !== a.payloadHash) throw convenienceReturnFailure(); current();
    const priced = a.capability === PRICED_CONVENIENCE_RETURN_CAPABILITY;
    const v = await rpc(a.uid, a.capability, {transactionId: a.transactionId, requestId: a.requestId, command: a.command, mode}, current);
    if (!object(v) || !exact(v, ['protocol', 'transactionId', 'ownerId', 'requestId', 'command', 'payloadHash', 'state', 'recordedAt', 'reason', ...EFFECTS]) ||
        v.protocol !== (priced ? 'convenience_return_receipt_v2' : 'convenience_return_receipt_v1') || v.transactionId !== a.transactionId || v.ownerId !== a.uid || v.requestId !== a.requestId ||
        v.payloadHash !== a.payloadHash || !productReviewEqual(v.command, a.command) || !noEffects(v, a.capability) ||
        (v.state === 'absent' ? v.recordedAt !== null || v.reason !== null :
          !['committed', 'not_executed', 'neutralized'].includes(String(v.state)) || !iso(v.recordedAt) ||
          (v.state === 'committed' ? v.reason !== null : typeof v.reason !== 'string' || !v.reason || v.reason.length > 200))) throw convenienceReturnFailure();
    return v as unknown as ConvenienceReturnReceipt;
  },
  async receptionPreview(uid: string, transactionId: string, guard: () => void): Promise<ConvenienceReturnReceptionPreview> {
    if (!id(transactionId)) throw convenienceReturnFailure();
    const v = await rpc(uid, PRICED_CONVENIENCE_RETURN_CAPABILITY, {transactionId, mode: 'reception_preview'}, guard);
    if (!object(v) || !exact(v, ['protocol', 'transactionId', 'ownerId', 'role', 'state', 'source', 'canConfirm', 'reception', ...RECEPTION_EFFECTS]) ||
        v.protocol !== 'convenience_return_reception_preview_v1' || v.transactionId !== transactionId || v.ownerId !== uid || !['buyer', 'seller'].includes(String(v.role)) ||
        !['none', 'recorded', 'unknown'].includes(String(v.state)) || typeof v.canConfirm !== 'boolean' || !RECEPTION_EFFECTS.every(k => v[k] === false)) throw convenienceReturnFailure();
    const s = v.source;
    if (s !== null && (!object(s) || !exact(s, ['sourceHash', 'returnRequestId', 'labelId', 'financingTermsHash', 'agreement']) || !hash(s.sourceHash) ||
        !id(s.returnRequestId) || !id(s.labelId) || !hash(s.financingTermsHash) || !isConvenienceReturnReference(s.agreement)) ||
        (v.reception !== null && !isConvenienceReturnFinancialReference(v.reception)) ||
        (v.state === 'recorded') !== (v.reception !== null) || v.canConfirm && (v.role !== 'seller' || v.state !== 'none' || !s)) throw convenienceReturnFailure();
    if (object(s) && isConvenienceReturnFinancialReference(v.reception) && isConvenienceReturnReference(s.agreement) &&
        (v.reception.requestId !== s.returnRequestId || v.reception.financingTermsHash !== s.financingTermsHash || v.reception.proposalId !== s.agreement.proposalId || v.reception.agreementContentHash !== s.agreement.contentHash)) throw convenienceReturnFailure();
    return v as unknown as ConvenienceReturnReceptionPreview;
  },
  async receptionCommand(a: ConvenienceReturnReceptionAttempt, mode: 'execute' | 'observe' | 'neutralize', guard: () => void): Promise<ConvenienceReturnReceptionReceipt> {
    const session = captureTradeSession(a.uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
    if (!isConvenienceReturnReceptionAttempt(a, a.uid, a.transactionId) || await productReviewHash(a.command) !== a.payloadHash) throw convenienceReturnFailure(); current();
    const v = await rpc(a.uid, a.capability, {transactionId: a.transactionId, requestId: a.requestId, command: a.command, mode}, current);
    if (!object(v) || !exact(v, ['protocol', 'transactionId', 'ownerId', 'requestId', 'command', 'payloadHash', 'state', 'recordedAt', 'reason', 'reception', ...RECEPTION_EFFECTS]) ||
        v.protocol !== 'convenience_return_reception_receipt_v1' || v.transactionId !== a.transactionId || v.ownerId !== a.uid || v.requestId !== a.requestId ||
        v.payloadHash !== a.payloadHash || !productReviewEqual(v.command, a.command) || !RECEPTION_EFFECTS.every(k => v[k] === false) ||
        (v.state === 'absent' ? v.recordedAt !== null || v.reason !== null || v.reception !== null :
          !['committed', 'not_executed', 'neutralized'].includes(String(v.state)) || !iso(v.recordedAt) ||
          (v.state === 'committed' ? v.reason !== null || !isConvenienceReturnFinancialReference(v.reception) : v.reception !== null || typeof v.reason !== 'string' || !v.reason || v.reason.length > 200))) throw convenienceReturnFailure();
    if (isConvenienceReturnFinancialReference(v.reception) && (v.reception.requestId !== a.command.returnRequestId || v.reception.receptionRequestId !== a.requestId ||
        v.reception.proposalId !== a.command.agreement.proposalId || v.reception.agreementContentHash !== a.command.agreement.contentHash || v.reception.financingTermsHash !== a.command.financingTermsHash)) throw convenienceReturnFailure();
    return v as unknown as ConvenienceReturnReceptionReceipt;
  },
  async incidentPreview(uid: string, transactionId: string, scope: 'owner' | 'operator', guard: () => void): Promise<ConvenienceReturnIncidentPreview> {
    if (!id(transactionId)) throw convenienceReturnFailure();
    const v = await rpc(uid, CONVENIENCE_RETURN_INCIDENT_CAPABILITY, {transactionId, scope, ...(scope === 'operator' ? {expectedAdminUid: uid} : {}), mode: 'preview'}, guard);
    if (!object(v) || !exact(v, ['protocol', 'transactionId', 'ownerId', 'role', 'state', 'source', 'closeBasis', 'variance', 'canClose', 'canAdopt', 'terminal', ...INCIDENT_EFFECTS]) ||
        v.protocol !== 'convenience_return_incident_preview_v1' || v.transactionId !== transactionId || v.ownerId !== uid ||
        (scope === 'operator' ? v.role !== 'operator' : !['buyer', 'seller'].includes(String(v.role))) ||
        !['unfurnished', 'label_ready', 'closed', 'unknown'].includes(String(v.state)) || !INCIDENT_EFFECTS.every(k => v[k] === false) ||
        !['canClose', 'canAdopt'].every(k => typeof v[k] === 'boolean') || scope === 'owner' && (v.canClose || v.canAdopt) ||
        !object(v.closeBasis) || !exact(v.closeBasis, ['nativeBeforePurchase', 'nativePostValidationRejected', 'operatorPlatformRiskAssumption']) ||
        !Object.values(v.closeBasis).every(k => typeof k === 'boolean') || v.variance !== null && !isConvenienceReturnVariance(v.variance) ||
        v.terminal !== null && !isConvenienceReturnTerminal(v.terminal) || (v.state === 'closed') !== (v.terminal !== null)) throw convenienceReturnFailure();
    const s = v.source;
    if (s !== null && (!object(s) || !exact(s, ['sourceHash', 'version', 'returnRequestId', 'purchaseExternalId', 'quoteId', 'financingTermsHash']) || !hash(s.sourceHash) ||
        typeof s.version !== 'number' || !Number.isSafeInteger(s.version) || s.version < 1 || !id(s.returnRequestId) ||
        !(s.purchaseExternalId === null || id(s.purchaseExternalId)) || !(s.quoteId === null || id(s.quoteId)) || !(s.financingTermsHash === null || hash(s.financingTermsHash))) ||
        v.canClose && (!s || v.state !== 'unfurnished' || !Object.values(v.closeBasis).some(k => k === true)) ||
        v.canAdopt && (!s || !v.variance)) throw convenienceReturnFailure();
    return v as unknown as ConvenienceReturnIncidentPreview;
  },
  async incidentCommand(a: ConvenienceReturnIncidentAttempt, mode: 'execute' | 'observe' | 'neutralize', guard: () => void): Promise<ConvenienceReturnIncidentReceipt> {
    const session = captureTradeSession(a.uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
    if (!isConvenienceReturnIncidentAttempt(a, a.uid) || await productReviewHash(a.command) !== a.payloadHash) throw convenienceReturnFailure(); current();
    const v = await rpc(a.uid, a.capability, {transactionId: a.transactionId, scope: a.scope, expectedAdminUid: a.uid, requestId: a.requestId, command: a.command, mode}, current);
    if (!object(v) || !exact(v, ['protocol', 'transactionId', 'ownerId', 'requestId', 'command', 'payloadHash', 'state', 'recordedAt', 'reason', 'result', ...INCIDENT_EFFECTS]) ||
        v.protocol !== 'convenience_return_incident_receipt_v1' || v.transactionId !== a.transactionId || v.ownerId !== a.uid || v.requestId !== a.requestId ||
        v.payloadHash !== a.payloadHash || !productReviewEqual(v.command, a.command) || !INCIDENT_EFFECTS.every(k => v[k] === false) ||
        (v.state === 'absent' ? v.recordedAt !== null || v.reason !== null || v.result !== null :
          !['committed', 'not_executed', 'neutralized'].includes(String(v.state)) || !iso(v.recordedAt) ||
          (v.state === 'committed' ? v.reason !== null || (a.command.action === 'close_unfurnished_return' ? !isConvenienceReturnTerminal(v.result) : !isConvenienceReturnVarianceResolution(v.result)) :
            v.result !== null || typeof v.reason !== 'string' || !v.reason || v.reason.length > 200))) throw convenienceReturnFailure();
    if (isConvenienceReturnTerminal(v.result) && (v.result.returnRequestId !== a.command.returnRequestId || v.result.basis !== a.command.basis) ||
        isConvenienceReturnVarianceResolution(v.result) && (v.result.financingTermsHash !== a.command.financingTermsHash || v.result.actualProofHash !== a.command.actualProofHash)) throw convenienceReturnFailure();
    return v as unknown as ConvenienceReturnIncidentReceipt;
  },
};
