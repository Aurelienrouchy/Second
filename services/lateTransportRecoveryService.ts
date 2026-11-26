import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { auth, functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual, productReviewHash, isProductReviewEvidenceReference } from '@/services/productReviewService';
import { isLateTransportSupportSource, isLateTransportRefundObservation } from '@/services/supportRequestService';
import { LATE_TRANSPORT_RECOVERY_CAPABILITY, RECOVERY_CRITERIA, type RecoveryAttempt, type RecoveryCommand, type RecoverySourceTuple, type RecoverySource, type RecoveryHistory, type RecoveryHistoryEntry, type RecoveryPreview, type RecoveryReceipt } from '@/types/lateTransportRecovery';
import type { LateTransportScope } from '@/types/lateTransportIncident';
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && !!v && v.trim() === v && v.length <= 200 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const native = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(v);
const entryName = (v: unknown): v is string => typeof v === 'string' && v.startsWith('entry_') && !v.includes('/') && Array.from(v).reduce((n, c) => n + (c.codePointAt(0)! <= 0x7f ? 1 : c.codePointAt(0)! <= 0x7ff ? 2 : c.codePointAt(0)! <= 0xffff ? 3 : 4), 0) <= 1500;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const text = (v: unknown): v is string => typeof v === 'string' && !!v && v.trim() === v && v.length <= 2000;
const revision = (v: unknown) => typeof v === 'string' && /^\d+:\d+$/.test(v) && (() => { const [s, n] = v.split(':').map(Number); return Number.isSafeInteger(s) && s >= 0 && s <= 253402300799 && Number.isSafeInteger(n) && n >= 0 && n < 1e9; })();
const effectKeys = ['financialEffectAuthorized', 'inventoryReleaseAuthorized', 'relistAuthorized', 'physicalPossessionCertified', 'legalOwnershipCertified'];
const effects = (v: Record<string, unknown>) => effectKeys.every(k => v[k] === false);
const possession = (v: unknown) => ['held_by_me', 'not_held_by_me', 'unknown'].includes(String(v));
const restitution = (v: unknown) => ['returned_to_seller_declared', 'retained_by_buyer_declared', 'not_returned_declared', 'unknown'].includes(String(v));
const actions = ['statement', 'retain_review', 'complete_own_review'];
const failure = () => new Error('Le dossier natif de récupération doit être relu. Aucune possession, remise en vente ou opération financière n’est confirmée.');
function tuple(v: unknown, command = false): v is RecoverySourceTuple {
    return obj(v) && exact(v, ['sourceHash', 'semanticHash', 'orderRevision', 'incidentRevision', 'incidentHash', 'financialSourceHash', 'stateVersion', 'corpusHash', 'membersHash']) &&
        ['sourceHash', 'semanticHash', 'incidentHash', 'financialSourceHash'].every(k => hash(v[k])) && revision(v.orderRevision) && revision(v.incidentRevision) &&
        typeof v.stateVersion === 'number' && Number.isSafeInteger(v.stateVersion) && v.stateVersion >= (command ? 0 : -1) && [v.corpusHash, v.membersHash].every(h => h === null || hash(h));
}
export function isRecoveryCommand(v: unknown): v is RecoveryCommand {
    if (!obj(v) || !id(v.transactionId) || !native(v.incidentId, 'late') || !tuple(v.source, true))
        return false;
    const common = ['transactionId', 'incidentId', 'source', 'action'];
    if (v.action === 'statement')
        return exact(v, [...common, 'possession', 'restitution', 'narrative', 'occurredAt']) && possession(v.possession) && restitution(v.restitution) && text(v.narrative) && (v.occurredAt === null || iso(v.occurredAt));
    return ['retain_review', 'complete_own_review'].includes(String(v.action)) && exact(v, [...common, 'assessments', 'privateReason', 'partyMessage', 'examinedCorpus']) &&
        text(v.privateReason) && text(v.partyMessage) && v.examinedCorpus === true && Array.isArray(v.assessments) && v.assessments.length === 4 &&
        v.assessments.every(a => obj(a) && exact(a, ['criterion', 'qualification', 'summary']) && RECOVERY_CRITERIA.includes(a.criterion as typeof RECOVERY_CRITERIA[number]) && ['examined', 'unknown'].includes(String(a.qualification)) && text(a.summary)) &&
        new Set(v.assessments.map(a => a.criterion)).size === 4;
}
export function isRecoveryAttempt(v: unknown, uid: string, scope: LateTransportScope): v is RecoveryAttempt {
    return obj(v) && exact(v, ['version', 'uid', 'scope', 'requestId', 'command']) && v.version === 1 && v.uid === uid && v.scope === scope &&
        typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && isRecoveryCommand(v.command) && (scope === 'owner' ? v.command.action === 'statement' : v.command.action !== 'statement');
}
function source(v: unknown, uid: string, transactionId: string, incidentId: string, scope: LateTransportScope): v is RecoverySource {
    if (!obj(v) || !exact(v, ['protocol', 'ownerId', 'transactionId', 'incidentId', 'articleId', 'source', 'qualification', 'statements', 'statementSetComplete', 'documentaryComplete', 'productReviewContext', 'productReviewCaseId', 'evidenceReferences', 'incident', 'refundCurrentlyRecorded', 'canRecordStatementNow', 'canCompleteOwnReviewNow', 'criteria', 'currentDecision', ...effectKeys]) ||
        v.protocol !== 'late_transport_recovery_source_v1' || v.ownerId !== uid || v.transactionId !== transactionId || v.incidentId !== incidentId || !id(v.articleId) || !tuple(v.source) || !['native_context', 'unknown'].includes(String(v.qualification)) || !effects(v) ||
        !['statementSetComplete', 'documentaryComplete', 'canRecordStatementNow', 'canCompleteOwnReviewNow'].every(k => typeof v[k] === 'boolean') || scope === 'owner' && v.canCompleteOwnReviewNow !== false ||
        !obj(v.productReviewContext) || !exact(v.productReviewContext, ['kind', 'id']) || v.productReviewContext.kind !== 'order' || v.productReviewContext.id !== transactionId || !(v.productReviewCaseId === null || native(v.productReviewCaseId, 'pr')) ||
        !productReviewEqual(v.criteria, RECOVERY_CRITERIA) || !isLateTransportSupportSource(v.incident) || v.incident.reference.transactionId !== transactionId || v.incident.reference.incidentId !== incidentId ||
        v.incident.reference.incidentHash !== v.source.incidentHash || v.incident.reference.incidentRevision !== v.source.incidentRevision || v.incident.reference.orderRevision !== v.source.orderRevision || !isLateTransportRefundObservation(v.refundCurrentlyRecorded) ||
        !Array.isArray(v.evidenceReferences) || v.evidenceReferences.length > 100 || !v.evidenceReferences.every(r => isProductReviewEvidenceReference(r) && (scope === 'admin' || r.actorId === uid)) || new Set(v.evidenceReferences.map(r => r.id)).size !== v.evidenceReferences.length ||
        !Array.isArray(v.statements) || v.statements.length > 2 || !v.statements.every(r => obj(r) && exact(r, ['role', 'actorId', 'entryId', 'contentHash', 'possession', 'restitution', 'occurredAt', 'narrative', 'recordedAt', 'currentBusinessContext', 'statementVerified']) &&
        ['buyer', 'seller'].includes(String(r.role)) && id(r.actorId) && native(r.entryId, 'entry') && hash(r.contentHash) && possession(r.possession) && restitution(r.restitution) && (r.occurredAt === null || iso(r.occurredAt)) && iso(r.recordedAt) && typeof r.currentBusinessContext === 'boolean' && r.statementVerified === false &&
        (scope === 'admin' || r.actorId === uid ? text(r.narrative) : r.narrative === null)) || new Set(v.statements.map(r => r.role)).size !== v.statements.length)
        return false;
    const d = v.currentDecision;
    return d === null || obj(d) && exact(d, ['entryId', 'contentHash', 'action', 'partyMessage', 'recordedAt', 'qualification', 'ownReviewComplete', ...effectKeys]) && native(d.entryId, 'entry') && hash(d.contentHash) && ['retain_review', 'complete_own_review'].includes(String(d.action)) && text(d.partyMessage) && iso(d.recordedAt) && ['native_current', 'historical_or_changed'].includes(String(d.qualification)) && typeof d.ownReviewComplete === 'boolean' &&
        (!d.ownReviewComplete || d.qualification === 'native_current' && d.action === 'complete_own_review') && effects(d);
}
async function call(uid: string, endpoint: string, payload: Record<string, unknown>, assertContext: () => void): Promise<unknown> {
    const session = captureTradeSession(uid), assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent();
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== uid)
        throw failure();
    await currentUser.getIdToken();
    assertCurrent();
    const result = await httpsCallable<unknown, unknown>(functions, endpoint)({ capability: LATE_TRANSPORT_RECOVERY_CAPABILITY, expectedUid: uid, ...payload });
    assertCurrent();
    return result.data;
}
export const LateTransportRecoveryService = {
    async source(uid: string, transactionId: string, incidentId: string, scope: LateTransportScope, assertCurrent: () => void): Promise<RecoverySource> {
        if (!id(transactionId) || !native(incidentId, 'late'))
            throw failure();
        const v = await call(uid, 'readSupportRequests', { mode: 'source', transactionId, incidentId, scope }, assertCurrent);
        if (!source(v, uid, transactionId, incidentId, scope))
            throw failure();
        if (v.productReviewCaseId !== null && v.productReviewCaseId !== `pr_${await productReviewHash(['order', transactionId])}`)
            throw failure();
        assertCurrent();
        return v;
    },
    async history(uid: string, transactionId: string, incidentId: string, scope: LateTransportScope, cursor: string | null, assertCurrent: () => void): Promise<RecoveryHistory> {
        if (!id(transactionId) || !native(incidentId, 'late') || cursor !== null && !entryName(cursor))
            throw failure();
        const v = await call(uid, 'readSupportRequests', { mode: 'history', transactionId, incidentId, scope, ...(cursor ? { cursor } : {}) }, assertCurrent);
        if (!obj(v) || !exact(v, ['protocol', 'ownerId', 'transactionId', 'incidentId', 'source', 'items', 'cursor', ...effectKeys]) || v.protocol !== 'late_transport_recovery_history_v1' || v.ownerId !== uid || v.transactionId !== transactionId || v.incidentId !== incidentId || !effects(v) || !source(v.source, uid, transactionId, incidentId, scope) ||
            !Array.isArray(v.items) || v.items.length > 20 || !v.items.every(r => obj(r) && (r.qualification === 'historical_unknown' ? exact(r, ['entryId', 'qualification']) && entryName(r.entryId) :
            r.qualification === 'native_record' && exact(r, ['entryId', 'contentHash', 'qualification', 'actorId', 'action', 'command', 'partyMessage', 'recordedAt', 'currentPermissionGranted', ...effectKeys]) && native(r.entryId, 'entry') && hash(r.contentHash) && id(r.actorId) && actions.includes(String(r.action)) && iso(r.recordedAt) && r.currentPermissionGranted === false && effects(r) &&
                (scope === 'admin' || r.actorId === uid ? isRecoveryCommand(r.command) && r.command.transactionId === transactionId && r.command.incidentId === incidentId && r.command.action === r.action : r.command === null && r.action !== 'statement') && (r.action === 'statement' ? r.partyMessage === null : text(r.partyMessage)))) || !(v.cursor === null || entryName(v.cursor)))
            throw failure();
        const items = v.items as RecoveryHistoryEntry[];
        if (items.some((r, i) => i > 0 && r.entryId <= items[i - 1].entryId || !!cursor && r.entryId <= cursor) || typeof v.cursor === 'string' && (cursor !== null && v.cursor <= cursor || items.some(r => r.entryId > (v.cursor as string))))
            throw failure();
        if (v.source.productReviewCaseId !== null && v.source.productReviewCaseId !== `pr_${await productReviewHash(['order', transactionId])}`)
            throw failure();
        assertCurrent();
        return v as unknown as RecoveryHistory;
    },
    async preview(attempt: RecoveryAttempt, assertCurrent: () => void): Promise<RecoveryPreview> {
        if (!isRecoveryAttempt(attempt, attempt.uid, 'admin'))
            throw failure();
        const payloadHash = await productReviewHash(attempt.command);
        assertCurrent();
        const previewId = `preview_${await productReviewHash([attempt.uid, payloadHash])}`;
        assertCurrent();
        const v = await call(attempt.uid, 'administerSupportRequest', { mode: 'preview', command: attempt.command }, assertCurrent);
        if (!obj(v) || !exact(v, ['protocol', 'actorId', 'previewId', 'payloadHash', 'source', ...effectKeys]) || v.protocol !== 'late_transport_recovery_preview_v1' || v.actorId !== attempt.uid || v.previewId !== previewId || v.payloadHash !== payloadHash || !effects(v) || !source(v.source, attempt.uid, attempt.command.transactionId, attempt.command.incidentId, 'admin') || !productReviewEqual(v.source.source, attempt.command.source))
            throw failure();
        if (v.source.productReviewCaseId !== null && v.source.productReviewCaseId !== `pr_${await productReviewHash(['order', attempt.command.transactionId])}`)
            throw failure();
        assertCurrent();
        return v as unknown as RecoveryPreview;
    },
    async command(attempt: RecoveryAttempt, operation: 'execute' | 'observe' | 'neutralize', assertCurrent: () => void): Promise<RecoveryReceipt> {
        if (!isRecoveryAttempt(attempt, attempt.uid, attempt.scope))
            throw failure();
        const payloadHash = await productReviewHash(attempt.command);
        assertCurrent();
        const expectedEntry = `entry_${await productReviewHash([attempt.uid, attempt.requestId])}`;
        assertCurrent();
        const v = await call(attempt.uid, attempt.scope === 'admin' ? 'administerSupportRequest' : 'commandSupportRequest', { mode: 'command', operation, requestId: attempt.requestId, command: attempt.command }, assertCurrent);
        if (!obj(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'command', 'payloadHash', 'state', 'reason', 'entryId', 'entryHash', 'recordedAt', ...effectKeys]) || v.protocol !== 'late_transport_recovery_command_v1' || v.actorId !== attempt.uid || v.requestId !== attempt.requestId || v.payloadHash !== payloadHash || !productReviewEqual(v.command, attempt.command) || !effects(v) || !['unrecorded', 'committed', 'not_executed'].includes(String(v.state)))
            throw failure();
        if (v.state === 'unrecorded' ? [v.reason, v.entryId, v.entryHash, v.recordedAt].some(x => x !== null) : !iso(v.recordedAt) || (v.state === 'committed' ? v.reason !== null || v.entryId !== expectedEntry || !hash(v.entryHash) : !text(v.reason) || v.entryId !== null || v.entryHash !== null))
            throw failure();
        return v as unknown as RecoveryReceipt;
    },
};
