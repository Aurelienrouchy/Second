import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { isAdminProductFinancialReference } from '@/services/adminProductFinancialSource';
import { productReviewEqual } from '@/services/productReviewService';
import { isProductParcelAssessment, PRODUCT_PARCEL_REASONS } from '@/utils/productParcelStatement';
import { PARCEL_CLAIM_HISTORY_CAPABILITY, type ParcelClaimHistoryPage, type ParcelClaimHistoryEntry, type ParcelClaimHistoryReference, type ParcelClaimDecision } from '@/types/parcelClaimHistory';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const docId = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v) && Array.from(v).reduce((n, c) => n + (c.codePointAt(0)! <= 0x7f ? 1 : c.codePointAt(0)! <= 0x7ff ? 2 : c.codePointAt(0)! <= 0xffff ? 3 : 4), 0) <= 1500;
const id = (v: unknown): v is string => docId(v) && v.trim() === v && v.length <= 200;
const native = (v: unknown, prefix: string) => typeof v === 'string' && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(v);
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && Date.parse(v) >= 0;
const nullableDate = (v: unknown) => v === null || date(v);
const text = (v: unknown, max = 4000): v is string => typeof v === 'string' && !!v.trim() && v.trim() === v && v.length <= max;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const revision = (v: unknown) => typeof v === 'string' && /^\d+:\d+$/.test(v) && (() => { const [s, n] = v.split(':').map(Number); return Number.isSafeInteger(s) && s >= 0 && s <= 253402300799 && Number.isSafeInteger(n) && n >= 0 && n < 1e9; })();
const limits = ['fraudEstablished', 'physicalReceiptVerified', 'rejectionPermissionGranted', 'financialPermissionGranted', 'inventoryPermissionGranted', 'bankArrivalVerified'];
const limited = (v: Record<string, unknown>) => limits.every(k => v[k] === false);
const originQualifications = ['native_parcel_report_receipt', 'native_order_report_receipt'];
const failure = () => new Error('La lecture comparative privée ne peut pas être qualifiée. Relisez le dossier sélectionné ; aucune répétition ne prouve une fraude.');
/** Firestore document names use UTF-8 order; inspected unknown names remain opaque. */
export function compareParcelClaimIds(a: string, b: string) { const x = Array.from(a), y = Array.from(b); for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d)
        return d;
} return x.length - y.length; }
function origin(v: unknown) {
    return object(v) && exact(v, ['qualification', 'kind', 'key', 'contributionId', 'contributionHash', 'requestId', 'recourseScope', 'reportedAt', 'sameOriginAsSelected', 'retriesAreDistinctClaims']) && hash(v.key) && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && date(v.reportedAt) && (v.sameOriginAsSelected === null || typeof v.sameOriginAsSelected === 'boolean') && v.retriesAreDistinctClaims === false &&
        (v.kind === 'product_contribution' ? v.qualification === 'native_parcel_report_receipt' && native(v.contributionId, 'pc') && hash(v.contributionHash) && ['parcel_investigation', 'buyer_delivery', 'seller_return_parcel'].includes(String(v.recourseScope)) :
            v.kind === 'report_intent' && v.qualification === 'native_order_report_receipt' && v.contributionId === null && v.contributionHash === null && v.recourseScope === 'order_problem');
}
function productIssue(v: unknown) {
    if (!object(v) || !exact(v, ['qualification', 'caseId', 'caseVersion', 'caseSourceHash', 'issue', 'currentCorpusQualified', 'financialPermissionGranted']) || !native(v.caseId, 'pr') || !(v.caseVersion === null || count(v.caseVersion) && v.caseVersion > 0) || !(v.caseSourceHash === null || hash(v.caseSourceHash)) || v.currentCorpusQualified !== false || v.financialPermissionGranted !== false)
        return false;
    if (v.qualification === 'unknown')
        return v.issue === null;
    const i = v.issue;
    return v.qualification === 'native_historical_issue' && object(i) && exact(i, ['eventId', 'contentHash', 'caseVersion', 'result', 'motivation', 'sourceHash', 'recordedAt', 'parcelAssessment', 'scope', 'claimOriginIncluded', 'physicalFindingVerified']) && native(i.eventId, 'pe') && hash(i.contentHash) && count(i.caseVersion) && i.caseVersion > 0 && ['information_incomplete', 'review_documented', 'additional_action_required'].includes(String(i.result)) && (i.motivation === null || text(i.motivation)) && hash(i.sourceHash) && nullableDate(i.recordedAt) && (i.parcelAssessment === null || isProductParcelAssessment(i.parcelAssessment)) && i.scope === 'order_product_case' && (i.claimOriginIncluded === null || typeof i.claimOriginIncluded === 'boolean') && i.physicalFindingVerified === false;
}
function decision(v: unknown): v is ParcelClaimDecision {
    if (!object(v) || !exact(v, ['decisionId', 'qualification', 'kind', 'outcome', 'recordedAt', 'motivation', 'productReference', 'financialEffect']) || !docId(v.decisionId))
        return false;
    if (v.qualification === 'unknown')
        return ['kind', 'outcome', 'recordedAt', 'motivation', 'productReference', 'financialEffect'].every(k => v[k] === null);
    if (v.qualification !== 'native_historical_decision' || !['refund', 'commercial_classification'].includes(String(v.kind)) || !text(v.outcome, 200) || !nullableDate(v.recordedAt) || !text(v.motivation, 500) || !(v.productReference === null || isAdminProductFinancialReference(v.productReference)))
        return false;
    if (v.kind === 'commercial_classification')
        return v.financialEffect === null;
    const f = v.financialEffect;
    if (!object(f) || !exact(f, ['qualification', 'currency', 'totalCents', 'cardCents', 'walletCents', 'sellerDebitCents', 'refundIntentId', 'bankArrivalVerified']) || f.currency !== 'CAD' || f.bankArrivalVerified !== false || !(f.refundIntentId === null || id(f.refundIntentId)))
        return false;
    return f.qualification === 'native_refund_effect' ? ['totalCents', 'cardCents', 'walletCents', 'sellerDebitCents'].every(k => count(f[k])) && (f.cardCents as number) + (f.walletCents as number) === f.totalCents : f.qualification === 'unknown' && ['totalCents', 'cardCents', 'walletCents', 'sellerDebitCents'].every(k => f[k] === null);
}
function entry(v: unknown, selectedOrigin: Record<string, unknown> | null): v is ParcelClaimHistoryEntry {
    if (!object(v) || !exact(v, ['disputeId', 'transactionId', 'qualification', 'source', 'claimOwnershipQualification', 'reason', 'recordedAt', 'recordedAtQualification', 'origin', 'declaration', 'carrierObservation', 'productReview', 'decisions', 'bank', ...limits]) || !docId(v.disputeId) || !(v.transactionId === null || id(v.transactionId)) || ![...originQualifications, 'unknown'].includes(String(v.qualification)) || !limited(v) || !object(v.source) || !exact(v.source, ['claimRevision', 'claimSourceHash', 'orderRevision', 'orderSourceHash']) || !revision(v.source.claimRevision) || !hash(v.source.claimSourceHash) || !(v.source.orderRevision === null || revision(v.source.orderRevision)) || !(v.source.orderSourceHash === null || hash(v.source.orderSourceHash)) ||
        !['native_buyer_report', 'unknown'].includes(String(v.claimOwnershipQualification)) || !(v.reason === null || v.reason === 'not_received_despite_delivered') || !nullableDate(v.recordedAt) || (v.recordedAtQualification === 'native_timestamp' ? v.recordedAt === null : v.recordedAtQualification !== 'unknown' || v.recordedAt !== null))
        return false;
    if (v.origin === null) {
        if (v.qualification !== 'unknown' || v.claimOwnershipQualification !== 'unknown')
            return false;
    }
    else if (!origin(v.origin) || !object(v.origin) || v.origin.qualification !== v.qualification || v.claimOwnershipQualification !== 'native_buyer_report' || v.transactionId === null || v.origin.sameOriginAsSelected !== (selectedOrigin === null ? null : v.origin.key === selectedOrigin.key))
        return false;
    const d = v.declaration;
    if (d !== null && (!object(d) || !exact(d, ['qualification', 'contributionId', 'contentHash', 'receiptDeclared', 'reasonDeclared', 'observedAtDeclared', 'recordedAt', 'declarationIsPhysicalProof']) || d.qualification !== 'native_actor_statement' || !native(d.contributionId, 'pc') || !hash(d.contentHash) || !['received', 'not_received', 'unknown'].includes(String(d.receiptDeclared)) || !PRODUCT_PARCEL_REASONS.includes(d.reasonDeclared as typeof PRODUCT_PARCEL_REASONS[number]) || !nullableDate(d.observedAtDeclared) || !nullableDate(d.recordedAt) || d.declarationIsPhysicalProof !== false || !object(v.origin) || v.origin.kind !== 'product_contribution' || d.contributionId !== v.origin.contributionId || d.contentHash !== v.origin.contributionHash))
        return false;
    const c = v.carrierObservation;
    if (!object(c) || !exact(c, ['qualification', 'labelId', 'statusCode', 'providerEventAtMs', 'observationIsPhysicalReceipt']) || c.observationIsPhysicalReceipt !== false || (c.qualification === 'native_current_observation' ? !id(c.labelId) || !text(c.statusCode, 50) || !(c.providerEventAtMs === null || count(c.providerEventAtMs)) : c.qualification !== 'unknown' || [c.labelId, c.statusCode, c.providerEventAtMs].some(x => x !== null)))
        return false;
    if (!(v.productReview === null || productIssue(v.productReview)) || !object(v.decisions) || !exact(v.decisions, ['entries', 'coverage']) || !Array.isArray(v.decisions.entries) || v.decisions.entries.length > 3 || !v.decisions.entries.every(decision) || new Set(v.decisions.entries.map(e => e.decisionId)).size !== v.decisions.entries.length || !object(v.decisions.coverage) || !exact(v.decisions.coverage, ['inspected', 'limit', 'hasMore', 'legacyWithoutTargetField', 'exhaustiveDecisionsVerified']) || v.decisions.coverage.inspected !== v.decisions.entries.length || v.decisions.coverage.limit !== 3 || typeof v.decisions.coverage.hasMore !== 'boolean' || v.decisions.coverage.legacyWithoutTargetField !== 'unknown' || v.decisions.coverage.exhaustiveDecisionsVerified !== false)
        return false;
    const b = v.bank;
    return object(b) && exact(b, ['qualification', 'nativeMarkerPresent', 'commercialDecisionIsBankOutcome', 'bankSettlementVerified']) && b.qualification === 'unknown' && typeof b.nativeMarkerPresent === 'boolean' && b.commercialDecisionIsBankOutcome === false && b.bankSettlementVerified === false;
}
export const ParcelClaimHistoryService = {
    async read(uid: string, transactionId: string, disputeId: string, cursor: {
        lastId: string;
    } | null, expectedSource: ParcelClaimHistoryReference | null, assertContext: () => void): Promise<ParcelClaimHistoryPage> {
        if (!id(transactionId) || !id(disputeId) || cursor && (!docId(cursor.lastId) || !expectedSource) || expectedSource && (!hash(expectedSource.sourceHash) || expectedSource.transactionId !== transactionId || expectedSource.disputeId !== disputeId))
            throw failure();
        const session = captureTradeSession(uid), assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
        assertCurrent();
        const user = auth.currentUser;
        if (!user || user.uid !== uid)
            throw failure();
        const token = await user.getIdTokenResult(true);
        assertCurrent();
        const now = Math.floor(Date.now() / 1000), authTime = token.claims.auth_time;
        if (auth.currentUser !== user || token.claims.admin !== true || typeof authTime !== 'number' || !Number.isSafeInteger(authTime) || authTime <= 0 || authTime > now || now - authTime > 300)
            throw new Error('Confirmez à nouveau votre identité administrateur pour lire ce dossier privé.');
        const result = await httpsCallable<unknown, unknown>(functions, 'reportTransactionProblem')({ capability: PARCEL_CLAIM_HISTORY_CAPABILITY, mode: 'parcel_claim_history_observe', expectedUid: uid, transactionId, disputeId, ...(cursor ? { cursor } : {}), ...(expectedSource ? { expectedSource } : {}) });
        assertCurrent();
        const v = result.data;
        if (!object(v) || !exact(v, ['protocol', 'actorId', 'source', 'selectedOrigin', 'entries', 'nextCursor', 'readAt', 'coverage', 'repetitionIsFraudEvidence', ...limits]) || v.protocol !== 'parcel_claim_history_page_v1' || v.actorId !== uid || !limited(v) || v.repetitionIsFraudEvidence !== false || !date(v.readAt) || !object(v.source) || !exact(v.source, ['transactionId', 'disputeId', 'sourceHash', 'protocol', 'orderRevision', 'orderSourceHash', 'claimRevision', 'claimSourceHash', 'qualification']) || v.source.protocol !== 'parcel_claim_history_source_v1' || v.source.qualification !== 'native_selected_order_claim' || v.source.transactionId !== transactionId || v.source.disputeId !== disputeId || !['sourceHash', 'orderSourceHash', 'claimSourceHash'].every(k => hash((v.source as Record<string, unknown>)[k])) || !revision(v.source.orderRevision) || !revision(v.source.claimRevision) || expectedSource && !productReviewEqual({ transactionId, disputeId, sourceHash: v.source.sourceHash }, expectedSource) ||
            !(v.selectedOrigin === null || object(v.selectedOrigin) && exact(v.selectedOrigin, ['key', 'qualification']) && hash(v.selectedOrigin.key) && originQualifications.includes(String(v.selectedOrigin.qualification))) || !Array.isArray(v.entries) || v.entries.length > 10 || !v.entries.every(r => entry(r, v.selectedOrigin as Record<string, unknown> | null)) || !(v.nextCursor === null || object(v.nextCursor) && exact(v.nextCursor, ['lastId']) && docId(v.nextCursor.lastId)) || !object(v.coverage) || !exact(v.coverage, ['inspected', 'limit', 'hasMore', 'association', 'historicalWithoutBuyerField', 'reasonFilter', 'unknownRowsIncluded', 'exhaustiveHistoryVerified', 'totalClaims']) || !count(v.coverage.inspected) || v.coverage.inspected > 10 || v.coverage.inspected < v.entries.length || v.coverage.limit !== 10 || v.coverage.hasMore !== (v.nextCursor !== null) || v.coverage.association !== 'native_buyer_field_only' || v.coverage.historicalWithoutBuyerField !== 'unknown' || v.coverage.reasonFilter !== 'nonreceipt_or_unqualified' || v.coverage.unknownRowsIncluded !== true || v.coverage.exhaustiveHistoryVerified !== false || v.coverage.totalClaims !== null)
            throw failure();
        const entries = v.entries as ParcelClaimHistoryEntry[];
        if (entries.some((e, i) => i > 0 && compareParcelClaimIds(e.disputeId, entries[i - 1].disputeId) <= 0 || !!cursor && compareParcelClaimIds(e.disputeId, cursor.lastId) <= 0) || object(v.nextCursor) && (v.coverage.inspected !== 10 || cursor && compareParcelClaimIds(v.nextCursor.lastId as string, cursor.lastId) <= 0 || entries.some(e => compareParcelClaimIds(e.disputeId, (v.nextCursor as {
            lastId: string;
        }).lastId) > 0)))
            throw failure();
        assertCurrent();
        return v as unknown as ParcelClaimHistoryPage;
    }
};
export function parcelClaimHistoryError(error: unknown) {
    const details = object(error) && object(error.details) ? error.details : null;
    return details?.reason === 'parcel_claim_history_source_changed' ? 'source_changed' : details?.reason === 'parcel_claim_history_not_exposed' ? 'not_exposed' : 'unqualified';
}
