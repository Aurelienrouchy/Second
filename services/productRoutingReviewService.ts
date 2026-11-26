import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { auth, functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { isProductReviewContext, isProductReviewSource, productReviewEqual, productReviewHash, productReviewDocumentId } from '@/services/productReviewService';
import { isProductParcelOperatorRoutes } from '@/utils/productParcelStatement';
import { PRODUCT_ROUTING_QUALIFICATION, isProductRoutingStatement } from '@/utils/productRoutingStatement';
import { PRODUCT_ROUTING_CAPABILITY, type ProductRoutingAttempt, type ProductRoutingCommand, type ProductRoutingDecision, type ProductRoutingHistory, type ProductRoutingPreview, type ProductRoutingReceipt } from '@/types/productRoutingReview';
import type { ProductReviewScope } from '@/types/productReview';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const native = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown, max = 4000): v is string => typeof v === 'string' && !!v && v.trim() === v && v.length <= max;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const effectKeys = ['authenticityVerified', 'recallApplicabilityVerified', 'childSafetyVerified', 'hygieneVerified', 'speciesOrProvenanceVerified', 'financialEffectAuthorized', 'inventoryEffectAuthorized', 'shippingPermissionGranted', 'physicalContentsVerified', 'legalDeadlineEstablished'];
const qualificationKeys = Object.keys(PRODUCT_ROUTING_QUALIFICATION);
const noAuthority = (v: Record<string, unknown>) => effectKeys.every(k => v[k] === false) && Object.entries(PRODUCT_ROUTING_QUALIFICATION).every(([k, value]) => v[k] === value);
const actions = ['maintain_review', 'routing_resolved_for_current_sources'];
const failure = () => new Error('Les sources et le corpus exacts du routage doivent être relus. Aucune correction, possession, autorisation de transport ou financière n’est confirmée.');
const order = (v: unknown): v is {
    kind: 'order';
    id: string;
} => isProductReviewContext(v) && v.kind === 'order';
export function isProductRoutingCommand(v: unknown): v is ProductRoutingCommand {
    return object(v) && exact(v, ['context', 'sourceHash', 'semanticSourceHash', 'corpusHash', 'membersHash', 'caseVersion', 'action', 'routingFinding', 'destinationFinding', 'contradictions', 'privateNote', 'partyMessage', 'evidenceLimitations', 'acknowledged']) && order(v.context) && ['sourceHash', 'semanticSourceHash', 'corpusHash', 'membersHash'].every(k => hash(v[k])) && count(v.caseVersion) && actions.includes(String(v.action)) && ['correction_examined', 'no_destination_error_established', 'unresolved'].includes(String(v.routingFinding)) && ['native_destination_examined', 'unknown'].includes(String(v.destinationFinding)) && ['resolved_for_reviewed_sources', 'unresolved', 'unknown'].includes(String(v.contradictions)) && text(v.privateNote) && text(v.partyMessage) && text(v.evidenceLimitations, 2000) && v.acknowledged === true && (v.action !== 'routing_resolved_for_current_sources' || v.routingFinding !== 'unresolved' && v.destinationFinding === 'native_destination_examined' && v.contradictions === 'resolved_for_reviewed_sources');
}
export function isProductRoutingAttempt(v: unknown, uid: string): v is ProductRoutingAttempt {
    return object(v) && exact(v, ['version', 'uid', 'requestId', 'context', 'command', 'routingCapability', 'parcelCapability']) && v.version === 1 && v.uid === uid && productReviewDocumentId(uid) && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && order(v.context) && v.routingCapability === PRODUCT_ROUTING_CAPABILITY && v.parcelCapability === 'product_review_parcel_v1' && isProductRoutingCommand(v.command) && productReviewEqual(v.command.context, v.context);
}
function decision(v: unknown, scope: ProductReviewScope): v is ProductRoutingDecision {
    return object(v) && exact(v, ['decisionId', 'contentHash', 'action', 'partyMessage', 'recordedAt', ...(scope === 'admin' ? ['command', 'operatorId'] : []), ...qualificationKeys, ...effectKeys]) && native(v.decisionId, 'rd') && hash(v.contentHash) && actions.includes(String(v.action)) && text(v.partyMessage) && iso(v.recordedAt) && noAuthority(v) && (scope !== 'admin' || isProductRoutingCommand(v.command) && v.command.action === v.action && v.command.partyMessage === v.partyMessage && productReviewDocumentId(v.operatorId));
}
async function rpc(uid: string, endpoint: 'submitReport' | 'triageReport', body: Record<string, unknown>, guard: () => void, adminRead = false): Promise<unknown> {
    const session = captureTradeSession(uid), assertCurrent = () => { assertTradeSessionCurrent(session); guard(); };
    assertCurrent();
    const user = auth.currentUser;
    if (!user || user.uid !== uid)
        throw failure();
    if (adminRead) {
        const token = await user.getIdTokenResult(true);
        assertCurrent();
        const now = Math.floor(Date.now() / 1000), at = token.claims.auth_time;
        if (auth.currentUser !== user || token.claims.admin !== true || typeof at !== 'number' || !Number.isSafeInteger(at) || at <= 0 || at > now || now - at > 300)
            throw new Error('Confirmez à nouveau votre identité pour lire ce dossier opérateur privé.');
    }
    else {
        await user.getIdToken();
        assertCurrent();
    }
    const result = await httpsCallable<unknown, unknown>(functions, endpoint)({ expectedUid: uid, routingCapability: PRODUCT_ROUTING_CAPABILITY, parcelCapability: 'product_review_parcel_v1', ...body });
    assertCurrent();
    return result.data;
}
export const ProductRoutingReviewService = {
    async preview(uid: string, context: {
        kind: 'order';
        id: string;
    }, scope: ProductReviewScope, guard: () => void): Promise<ProductRoutingPreview> {
        if (!order(context))
            throw failure();
        const caseId = `pr_${await productReviewHash(['order', context.id])}`;
        guard();
        const v = await rpc(uid, 'submitReport', { operation: 'productRoutingPreview', context, scope }, guard, scope === 'admin');
        if (!object(v) || !exact(v, ['protocol', 'actorId', 'context', 'scope', 'caseId', 'source', 'sourceHash', 'semanticSourceHash', 'corpusHash', 'membersHash', 'caseVersion', 'guardQualification', 'observations', 'nativeRoutes', 'coverage', 'canConsiderRoutingResolution', 'options', 'currentDecision', 'releaseAllowedByRoutingOnly', ...qualificationKeys, ...effectKeys]) || v.protocol !== 'product_routing_preview_v1' || v.actorId !== uid || !productReviewEqual(v.context, context) || v.scope !== scope || v.caseId !== caseId || !noAuthority(v) || !isProductReviewSource(v.source, uid, context, caseId, scope, false, true) || v.source.protocol !== 'product_review_source_v4' || v.source.sourceHash !== v.sourceHash || !['sourceHash', 'semanticSourceHash', 'corpusHash', 'membersHash'].every(k => hash(v[k])) || !count(v.caseVersion) || !['native_current_routing_signals', 'unknown'].includes(String(v.guardQualification)) || typeof v.canConsiderRoutingResolution !== 'boolean' || scope === 'own' && v.canConsiderRoutingResolution !== false || !productReviewEqual(v.options, scope === 'admin' ? actions : []) || typeof v.releaseAllowedByRoutingOnly !== 'boolean' || !Array.isArray(v.observations) || v.observations.length > 100 || !v.observations.every(r => object(r) && exact(r, ['contributionId', 'contentHash', 'statement']) && native(r.contributionId, 'pc') && hash(r.contentHash) && isProductRoutingStatement(r.statement)) || new Set(v.observations.map(r => r.contributionId)).size !== v.observations.length ||
            (scope === 'admin' ? !isProductParcelOperatorRoutes(v.nativeRoutes, v.source.parcelSources, v.source.sourceHash, String(v.corpusHash), true) : v.nativeRoutes !== null) || !object(v.coverage) || !exact(v.coverage, ['contributionsInspected', 'communicationsInspected', 'limitPerSource', 'contributionsHasMore', 'communicationsHasMore', 'completeCurrentCaseSet', 'exhaustiveHistoryVerified', 'evidenceInspected', 'intentsInspected', 'evidenceHasMore', 'intentsHasMore', 'documentaryCompleteCurrentCaseSet']) || !['contributionsInspected', 'communicationsInspected', 'evidenceInspected', 'intentsInspected'].every(k => count((v.coverage as Record<string, unknown>)[k]) && Number((v.coverage as Record<string, unknown>)[k]) <= 100) || v.coverage.limitPerSource !== 100 || v.coverage.exhaustiveHistoryVerified !== false || !['contributionsHasMore', 'communicationsHasMore', 'completeCurrentCaseSet', 'evidenceHasMore', 'intentsHasMore', 'documentaryCompleteCurrentCaseSet'].every(k => typeof (v.coverage as Record<string, unknown>)[k] === 'boolean'))
            throw failure();
        const d = v.currentDecision;
        if (!object(d) || !exact(d, ['qualification', 'decision']) || !['native_current_decision', 'historical_sources_changed', 'unknown', 'unrecorded'].includes(String(d.qualification)) || (['unknown', 'unrecorded'].includes(String(d.qualification)) ? d.decision !== null : !decision(d.decision, scope)) || v.releaseAllowedByRoutingOnly && !(d.qualification === 'native_current_decision' && object(d.decision) && d.decision.action === 'routing_resolved_for_current_sources'))
            throw failure();
        if (scope === 'admin' && d.decision !== null && decision(d.decision, scope) && !productReviewEqual(d.decision.command?.context, context))
            throw failure();
        guard();
        return v as unknown as ProductRoutingPreview;
    },
    async command(attempt: ProductRoutingAttempt, action: 'execute' | 'observe' | 'neutralize', guard: () => void): Promise<ProductRoutingReceipt> {
        if (!isProductRoutingAttempt(attempt, attempt.uid))
            throw failure();
        const payloadHash = await productReviewHash(attempt.command);
        guard();
        const caseId = `pr_${await productReviewHash(['order', attempt.context.id])}`;
        guard();
        const expectedId = `rd_${await productReviewHash([attempt.uid, attempt.requestId])}`;
        guard();
        const v = await rpc(attempt.uid, 'triageReport', { operation: 'productRoutingCommand', requestId: attempt.requestId, action, command: attempt.command }, guard);
        if (!object(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'command', 'payloadHash', 'caseId', 'decisionId', 'state', 'reason', 'recordedAt', 'currentDecisionVerified', ...qualificationKeys, ...effectKeys]) || v.protocol !== 'product_routing_command_v1' || v.actorId !== attempt.uid || v.requestId !== attempt.requestId || !productReviewEqual(v.command, attempt.command) || v.payloadHash !== payloadHash || v.caseId !== caseId || v.currentDecisionVerified !== false || !noAuthority(v))
            throw failure();
        if (v.state === 'committed' ? v.decisionId !== expectedId || v.reason !== null || !iso(v.recordedAt) : v.decisionId !== null || (v.state === 'not_executed' ? !iso(v.recordedAt) || !['requester_neutralized', 'source_changed', 'incomplete_routing_sources', 'document_capacity_requires_review'].includes(String(v.reason)) : v.state !== 'unrecorded' || v.recordedAt !== null || v.reason !== null))
            throw failure();
        guard();
        return v as unknown as ProductRoutingReceipt;
    },
    async history(uid: string, context: {
        kind: 'order';
        id: string;
    }, scope: ProductReviewScope, cursor: {
        lastId: string;
    } | null, guard: () => void): Promise<ProductRoutingHistory> {
        if (!order(context) || cursor && !productReviewDocumentId(cursor.lastId))
            throw failure();
        const caseId = `pr_${await productReviewHash(['order', context.id])}`;
        guard();
        const v = await rpc(uid, 'submitReport', { operation: 'readProductRoutingDecisions', context, scope, cursor }, guard, scope === 'admin');
        if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'caseId', 'entries', 'nextCursor', 'coverage', 'currentDecisionVerified', ...qualificationKeys, ...effectKeys]) || v.protocol !== 'product_routing_decisions_page_v1' || v.actorId !== uid || v.scope !== scope || v.caseId !== caseId || v.currentDecisionVerified !== false || !noAuthority(v) || !Array.isArray(v.entries) || v.entries.length > 20 || !v.entries.every(r => object(r) && (r.qualification === 'unknown' ? exact(r, ['qualification', 'decisionId', 'decision']) && productReviewDocumentId(r.decisionId) && r.decision === null : r.qualification === 'native_recorded_decision' && exact(r, ['qualification', 'decision']) && decision(r.decision, scope) && (scope !== 'admin' || productReviewEqual(r.decision.command?.context, context)))) || !object(v.coverage) || !exact(v.coverage, ['inspected', 'limit', 'hasMore', 'exhaustiveHistoryVerified']) || v.coverage.inspected !== v.entries.length || v.coverage.limit !== 20 || typeof v.coverage.hasMore !== 'boolean' || v.coverage.hasMore !== (v.nextCursor !== null) || v.coverage.exhaustiveHistoryVerified !== false || !(v.nextCursor === null || object(v.nextCursor) && exact(v.nextCursor, ['lastId']) && productReviewDocumentId(v.nextCursor.lastId)))
            throw failure();
        const entries = v.entries as ProductRoutingHistory['entries'], ids = entries.map(r => r.qualification === 'unknown' ? r.decisionId : r.decision.decisionId);
        if (ids.some((id, i) => i > 0 && id <= ids[i - 1] || !!cursor && id <= cursor.lastId) || object(v.nextCursor) && (v.nextCursor.lastId !== ids.at(-1) || ids.length !== 20))
            throw failure();
        guard();
        return v as unknown as ProductRoutingHistory;
    }
};
