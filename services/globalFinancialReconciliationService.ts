import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import {functions} from '@/config/firebaseConfig';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {productReviewEqual, productReviewHash} from '@/services/productReviewService';
import {GLOBAL_FINANCIAL_CAPABILITY, GLOBAL_FINANCIAL_LIMITS, GLOBAL_FINANCIAL_COMPLETE_LIMITS} from '@/types/globalFinancialReconciliation';
import type {GlobalFinancialAction, GlobalFinancialCapturePoint, GlobalFinancialJournalState, GlobalFinancialNativeCapture, GlobalFinancialPage, GlobalFinancialPageReference, GlobalFinancialPending, GlobalFinancialReceipt,
  GlobalFinancialResponse, GlobalFinancialRunReference, GlobalFinancialScope} from '@/types/globalFinancialReconciliation';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const id = (v: unknown): v is string => text(v) && !v.includes('/') && !['.', '..'].includes(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const count = (v: unknown): v is number => integer(v) && v >= 0;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v);
const stripeId = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]{1,190}$`).test(v);
const texts = (v: unknown, max = 30, length = 200): v is string[] => Array.isArray(v) && v.length <= max && v.every(x => text(x, length)) && new Set(v).size === v.length;
const phase = (v: unknown) => ['native', 'provider', 'audit', 'statement', 'ready'].includes(String(v));
const effects = ['financialEffectAuthorized', 'providerMutationAuthorized', 'holdReleaseAuthorized', 'globalBalanceReconciled', 'nativeSnapshotQualified', 'openingClosingQualified', 'bankArrivalVerified', 'taxPeriodQualified'] as const;
export const globalFinancialFailure = () => new Error('Relisez le rapport, son habilitation et le reçu exact de votre commande. Aucun mouvement financier n’est autorisé.');
export const isGlobalFinancialRunReference = (v: unknown): v is GlobalFinancialRunReference => object(v) && exact(v, ['runId', 'scopeHash']) && typeof v.runId === 'string' && /^gfr_[a-f0-9]{64}$/.test(v.runId) && hash(v.scopeHash);
export const isGlobalFinancialPageReference = (v: unknown, completeKnownSources = false): v is GlobalFinancialPageReference => object(v) && exact(v, ['id', 'contentHash']) && typeof v.id === 'string' &&
  (completeKnownSources ? /^page_[1-9]\d{0,15}$/.test(v.id) && count(Number(v.id.slice(5))) : /^page_[1-9]\d{0,7}$/.test(v.id)) && hash(v.contentHash);
function boundaries(v: unknown): boolean {
  if (v === null) return true;
  const row = (b: unknown) => object(b) && exact(b, ['balanceType', 'availableCents', 'pendingCents', 'evidenceReference']) &&
    ['payments', 'issuing', 'refund_and_dispute_prefunding', 'risk_reserved'].includes(String(b.balanceType)) && integer(b.availableCents) && integer(b.pendingCents) && integer(b.availableCents + b.pendingCents) &&
    object(b.evidenceReference) && exact(b.evidenceReference, ['reference', 'contentHash']) && id(b.evidenceReference.reference) && hash(b.evidenceReference.contentHash);
  return object(v) && exact(v, ['opening', 'closing']) && [v.opening, v.closing].every(rows => Array.isArray(rows) && rows.length <= 4 && rows.every(row) && new Set(rows.map(b => b.balanceType)).size === rows.length);
}
const statementReference = (v: unknown) => v === null || object(v) && exact(v, ['reportRunId', 'reportType']) && stripeId(v.reportRunId, 'frr') && ['balance.summary.1', 'balance.summary.2'].includes(String(v.reportType));
export function isGlobalFinancialNativeCapture(v: unknown): v is GlobalFinancialNativeCapture {
  return object(v) && exact(v, ['protocol', 'readTime']) && v.protocol === 'firestore_read_time_v1' && object(v.readTime) &&
    exact(v.readTime, ['seconds', 'nanoseconds']) && integer(v.readTime.seconds) && v.readTime.seconds > 0 && count(v.readTime.nanoseconds) && v.readTime.nanoseconds < 1e9 && v.readTime.nanoseconds % 1000 === 0;
}
export function parseGlobalFinancialCapturePoint(v: unknown): GlobalFinancialCapturePoint {
  if (!object(v) || !exact(v, ['protocol', 'nativeCapture', 'authorityReadMode', 'knownSourcesOnly', 'globalBalanceReconciled', 'sourceSetExhaustive',
    ...('precision' in v ? ['precision', 'readTimeVerified', 'pitrEnabledVerified', 'futureAvailabilityVerified'] : [])]) ||
    v.protocol !== 'global_financial_native_capture_point_v1' || !isGlobalFinancialNativeCapture(v.nativeCapture) || v.authorityReadMode !== 'current' ||
    v.knownSourcesOnly !== true || v.globalBalanceReconciled !== false || v.sourceSetExhaustive !== false) throw globalFinancialFailure();
  if ('precision' in v && (v.precision !== 'minute' || v.readTimeVerified !== true || v.pitrEnabledVerified !== false || v.futureAvailabilityVerified !== false ||
      v.nativeCapture.readTime.seconds % 60 !== 0 || v.nativeCapture.readTime.nanoseconds !== 0)) throw globalFinancialFailure();
  return v as unknown as GlobalFinancialCapturePoint; // Every closed field is qualified above; timestamp precision is preserved.
}
export function isGlobalFinancialScope(v: unknown): v is GlobalFinancialScope {
  if (!object(v) || !exact(v, ['accountKind', 'accountId', 'platformAccountId', 'livemode', 'currency', 'period', 'connectedReference', 'epoch', 'boundaries', 'statementReference', ...('nativeCapture' in v ? ['nativeCapture'] : []), ...('coverageMode' in v ? ['coverageMode'] : []), ...('controlBalanceMode' in v ? ['controlBalanceMode'] : [])]) ||
    !['platform', 'connected'].includes(String(v.accountKind)) || !stripeId(v.accountId, 'acct') || !stripeId(v.platformAccountId, 'acct') || typeof v.livemode !== 'boolean' || v.currency !== 'CAD' ||
    !object(v.period) || !exact(v.period, ['fromSeconds', 'toSeconds']) || !count(v.period.fromSeconds) || !count(v.period.toSeconds) || v.period.toSeconds <= v.period.fromSeconds || v.period.toSeconds > Math.floor(Date.now() / 1000) ||
    !boundaries(v.boundaries) || !statementReference(v.statementReference) || 'nativeCapture' in v && !isGlobalFinancialNativeCapture(v.nativeCapture) ||
    'coverageMode' in v && (v.coverageMode !== 'complete_known_sources_v1' || !isGlobalFinancialNativeCapture(v.nativeCapture)) ||
    'controlBalanceMode' in v && (v.controlBalanceMode !== 'global_control_balance_v1' || v.coverageMode !== 'complete_known_sources_v1' || !isGlobalFinancialNativeCapture(v.nativeCapture))) return false;
  const connected = v.connectedReference;
  if (v.accountKind === 'platform' ? v.accountId !== v.platformAccountId || connected !== null : v.accountId === v.platformAccountId || !object(connected) || !exact(connected, ['kind', 'id']) || !['withdrawal', 'current_account'].includes(String(connected.kind)) || !id(connected.id)) return false;
  return v.epoch === null || object(v.epoch) && exact(v.epoch, ['id', 'proofHash']) && id(v.epoch.id) && hash(v.epoch.proofHash);
}
/** NEW prepare only. Old exact scopes remain readable/resumable with their native unknown result. */
export const isGlobalFinancialControlPointAligned = (scope: GlobalFinancialScope) => scope.controlBalanceMode === 'global_control_balance_v1' &&
  scope.coverageMode === 'complete_known_sources_v1' && scope.nativeCapture?.readTime.nanoseconds === 0 && scope.nativeCapture.readTime.seconds === scope.period.toSeconds;
export function isGlobalFinancialJournalState(v: unknown, uid: string): v is GlobalFinancialJournalState {
  if (!object(v) || !exact(v, ['version', 'uid', 'runReference', 'pending']) || v.version !== 1 || v.uid !== uid || !id(uid) || !isGlobalFinancialRunReference(v.runReference)) return false;
  const p = v.pending;
  return p === null || object(p) && exact(p, ['requestId', 'action', 'expectedVersion', 'inputHash']) && typeof p.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(p.requestId) && ['prepare', 'advance', 'seal'].includes(String(p.action)) && count(p.expectedVersion) && hash(p.inputHash) && (p.action !== 'prepare' || p.expectedVersion === 0);
}
function receipt(v: unknown, completeKnownSources = false): v is GlobalFinancialReceipt {
  return object(v) && exact(v, ['protocol', 'actorId', 'requestId', 'action', 'inputHash', 'runReference', 'status', 'versionBefore', 'versionAfter', 'pageReference', 'createdAt', 'completedAt', 'disposition']) &&
    v.protocol === 'global_financial_command_receipt_v1' && id(v.actorId) && text(v.requestId, 128) && ['prepare', 'advance', 'seal'].includes(String(v.action)) && hash(v.inputHash) && isGlobalFinancialRunReference(v.runReference) &&
    ['completed', 'not_executed', 'pending', 'unknown'].includes(String(v.status)) && count(v.versionBefore) && count(v.versionAfter) && nullable(v.pageReference, x => isGlobalFinancialPageReference(x, completeKnownSources)) && iso(v.createdAt) &&
    (v.status === 'not_executed' ? iso(v.completedAt) && v.completedAt >= v.createdAt && v.versionAfter === v.versionBefore && v.pageReference === null && object(v.disposition) && exact(v.disposition, ['reason', 'observedVersion']) && text(v.disposition.reason) && count(v.disposition.observedVersion) :
      v.disposition === null && (v.status === 'completed' ? iso(v.completedAt) && v.completedAt >= v.createdAt && v.versionAfter >= v.versionBefore : v.completedAt === null && v.versionAfter === v.versionBefore && v.pageReference === null));
}
function statement(v: unknown, scope: GlobalFinancialScope, scopeHash: string): boolean {
  if (v === null) return true;
  if (!object(v) || !exact(v, ['protocol', 'qualification', 'reason', 'reference', 'scopeHash', 'summary', 'fileId', 'fileHash', 'proofHash', 'observedAt', 'startedAt', 'openingClosingQualified']) ||
    v.protocol !== 'global_financial_statement_v1' || !['unknown', 'native_provider_statement'].includes(String(v.qualification)) || !nullable(v.reason, text) || !productReviewEqual(v.reference, scope.statementReference) || v.scopeHash !== scopeHash ||
    !nullable(v.fileId, x => stripeId(x, 'file')) || !nullable(v.fileHash, hash) || !nullable(v.proofHash, hash) || !iso(v.startedAt) || !iso(v.observedAt) || v.startedAt > v.observedAt || v.openingClosingQualified !== (v.qualification === 'native_provider_statement')) return false;
  if (v.qualification === 'unknown') return v.summary === null && v.fileId === null && v.fileHash === null && v.proofHash === null && text(v.reason);
  const s = v.summary;
  return scope.statementReference?.reportType === 'balance.summary.1' && v.reason === null && stripeId(v.fileId, 'file') && hash(v.fileHash) && hash(v.proofHash) && object(s) &&
    exact(s, ['currency', 'openingCents', 'closingCents', 'activityNetCents', 'payoutNetCents', 'periodNetCents', 'scope', 'balanceType', 'bucketAllocationQualified']) &&
    s.currency === 'CAD' && s.scope === 'provider_currency_summary' && s.balanceType === null && s.bucketAllocationQualified === false &&
    [s.openingCents, s.closingCents, s.activityNetCents, s.payoutNetCents, s.periodNetCents].every(integer) &&
    integer(Number(s.activityNetCents) + Number(s.payoutNetCents)) && Number(s.activityNetCents) + Number(s.payoutNetCents) === s.periodNetCents &&
    integer(Number(s.openingCents) + Number(s.periodNetCents)) && Number(s.openingCents) + Number(s.periodNetCents) === s.closingCents;
}
function coverage(v: unknown, scope: GlobalFinancialScope): boolean {
  if (!object(v) || !exact(v, ['native', 'provider', 'audit', 'changedSources', 'unknownFacts', 'scopeOnly', 'liveScansAreAsOfSnapshot', 'externalExhaustivenessVerified', 'connectedPayoutsIncluded', 'otherAccountsReconciled', 'epochQualification', 'snapshotMissingProofs', ...(scope.nativeCapture ? ['nativeCapture'] : [])])) return false;
  if (scope.nativeCapture) {
    const c = v.nativeCapture;
    if (!object(c) || !exact(c, ['protocol', 'readTime', 'readMode', 'authorityReadMode', 'nativeAccountReferenceReadMode', 'providerObservationReadMode', 'knownSourcesOnly', 'sourceSetExhaustive', 'writerDrainQualified', 'periodCoveredByNativeCapture', 'state', 'lastFailureReason']) ||
      c.protocol !== scope.nativeCapture.protocol || !productReviewEqual(c.readTime, scope.nativeCapture.readTime) || c.readMode !== 'firestore_read_only_at_read_time' || c.authorityReadMode !== 'current' ||
      c.nativeAccountReferenceReadMode !== 'captured_at_read_time' || c.providerObservationReadMode !== 'current_get' || c.knownSourcesOnly !== true || c.sourceSetExhaustive !== false || c.writerDrainQualified !== false ||
      c.periodCoveredByNativeCapture !== (scope.nativeCapture.readTime.seconds >= scope.period.toSeconds) ||
      !['capture_in_progress', 'captured_known_sources_complete', 'read_time_unavailable'].includes(String(c.state)) || !nullable(c.lastFailureReason, text) ||
      (c.state === 'read_time_unavailable') !== (c.lastFailureReason !== null)) return false;
    if (c.state !== 'read_time_unavailable' && c.state !== (object(v.native) && v.native.closed === true && object(v.audit) && v.audit.closed === true ? 'captured_known_sources_complete' : 'capture_in_progress')) return false;
  }
  const n = v.native, p = v.provider, a = v.audit;
  return object(n) && exact(n, ['pages', 'sources', 'closed', 'cursor']) && count(n.pages) && count(n.sources) && typeof n.closed === 'boolean' && object(n.cursor) &&
    exact(n.cursor, ['rootIndex', 'lastId', 'pendingChildren']) && count(n.cursor.rootIndex) && n.cursor.rootIndex <= 6 && nullable(n.cursor.lastId, id) && count(n.cursor.pendingChildren) && n.cursor.pendingChildren <= 40 &&
    object(p) && exact(p, ['pages', 'movements', 'closed', 'cursor']) && count(p.pages) && count(p.movements) && typeof p.closed === 'boolean' && nullable(p.cursor, x => stripeId(x, 'txn')) &&
    object(a) && exact(a, ['pages', 'closed', 'cursor', 'stage']) && count(a.pages) && typeof a.closed === 'boolean' && nullable(a.cursor, id) && ['sources', 'references'].includes(String(a.stage)) &&
    count(v.changedSources) && count(v.unknownFacts) && v.scopeOnly === true && v.liveScansAreAsOfSnapshot === false && v.externalExhaustivenessVerified === false && v.connectedPayoutsIncluded === (scope.accountKind === 'connected') &&
    v.otherAccountsReconciled === false && v.epochQualification === 'unknown' && productReviewEqual(v.snapshotMissingProofs, ['qualified_external_epoch_manifest', 'writer_drain_covering_entire_capture', 'complete_native_source_set_bound_to_manifest']);
}
function controlCompartment(v: unknown): boolean {
  if (!object(v) || !exact(v, ['balanceType', 'openingBalanceCents', 'closingBalanceCents', 'providerNetCents', 'flowDifferenceCents', 'liabilitiesCents', 'receivablesCents', 'ownFundsCents', 'residualCents']) ||
    !['payments', 'issuing', 'refund_and_dispute_prefunding', 'risk_reserved'].includes(String(v.balanceType)) ||
    ![v.openingBalanceCents, v.closingBalanceCents, v.providerNetCents].every(integer) ||
    ![v.flowDifferenceCents, v.liabilitiesCents, v.receivablesCents, v.ownFundsCents, v.residualCents].every(x => nullable(x, integer))) return false;
  const b0 = Number(v.openingBalanceCents), b1 = Number(v.closingBalanceCents), flow = Number(v.providerNetCents);
  if (v.flowDifferenceCents !== null && (!integer(b1 - b0) || !integer(b1 - b0 - flow) || v.flowDifferenceCents !== b1 - b0 - flow)) return false;
  if (v.residualCents !== null) {
    if (![v.liabilitiesCents, v.receivablesCents, v.ownFundsCents].every(integer)) return false;
    const first = b1 + Number(v.receivablesCents), second = first - Number(v.liabilitiesCents), residual = second - Number(v.ownFundsCents);
    if (![first, second, residual].every(integer) || v.residualCents !== residual) return false;
  }
  return true;
}
function controlResult(v: unknown): boolean {
  if (!object(v) || !exact(v, ['protocol', 'qualification', 'qualified', 'sourceSetVerified', 'providerSetVerified', 'writerDrainVerified', 'compartments',
    'componentMismatches', 'eventMismatches', 'unmatchedProviderMovements', 'financialEffectAuthorized', 'providerMutationAuthorized', 'holdReleaseAuthorized']) ||
    v.protocol !== 'global_control_balance_result_v1' || !['balanced', 'mismatch', 'unknown'].includes(String(v.qualification)) || v.qualified !== (v.qualification === 'balanced') ||
    ![v.sourceSetVerified, v.providerSetVerified, v.writerDrainVerified].every(x => typeof x === 'boolean') ||
    ![v.componentMismatches, v.eventMismatches, v.unmatchedProviderMovements].every(count) ||
    !Array.isArray(v.compartments) || v.compartments.length < 1 || v.compartments.length > 4 || !v.compartments.every(controlCompartment) ||
    new Set(v.compartments.map(c => c.balanceType)).size !== v.compartments.length ||
    v.financialEffectAuthorized !== false || v.providerMutationAuthorized !== false || v.holdReleaseAuthorized !== false) return false;
  if (v.qualified && (v.sourceSetVerified !== true || v.providerSetVerified !== true || v.writerDrainVerified !== true || v.componentMismatches !== 0 ||
    v.eventMismatches !== 0 || v.unmatchedProviderMovements !== 0 || v.compartments.some(c => c.flowDifferenceCents !== 0 || c.residualCents !== 0 ||
      ![c.liabilitiesCents, c.receivablesCents, c.ownFundsCents].every(integer)))) return false;
  return true;
}
function controlBalance(v: unknown): boolean {
  if (!object(v) || !exact(v, ['protocol', 'stage', 'lastFailureReason', 'qualification', 'qualified', 'anchorHash', 'sourceCount', 'effectCount', 'components', 'events', 'unknownFacts',
    'issues', 'sourceSetVerified', 'providerSetVerified', 'writerDrainVerified', 'result', 'financialEffectAuthorized', 'providerMutationAuthorized', 'holdReleaseAuthorized', 'bankArrivalVerified', 'taxPeriodQualified', 'legalStatusVerified']) ||
    v.protocol !== 'global_control_balance_v1' || !['opening', 'sources', 'events', 'components', 'complete'].includes(String(v.stage)) || !nullable(v.lastFailureReason, text) ||
    !nullable(v.anchorHash, hash) || ![v.sourceCount, v.effectCount, v.components, v.events, v.unknownFacts].every(count) || !texts(v.issues, 40) ||
    !['financialEffectAuthorized', 'providerMutationAuthorized', 'holdReleaseAuthorized', 'bankArrivalVerified', 'taxPeriodQualified', 'legalStatusVerified'].every(k => v[k] === false)) return false;
  if (v.result === null) return v.stage !== 'complete' && v.qualification === 'incomplete' && v.qualified === false &&
    v.sourceSetVerified === false && v.providerSetVerified === false && v.writerDrainVerified === false;
  const result = v.result;
  if (v.stage !== 'complete' || !controlResult(result) || !object(result)) return false;
  if (!['qualification', 'qualified', 'sourceSetVerified', 'providerSetVerified', 'writerDrainVerified'].every(k => v[k] === result[k])) return false;
  return !v.qualified || v.unknownFacts === 0 && Array.isArray(v.issues) && v.issues.length === 0 && hash(v.anchorHash);
}
function report(v: unknown, ref: GlobalFinancialRunReference): boolean {
  if (!object(v)) return false;
  const completeKnownSources = object(v.scope) && v.scope.coverageMode === 'complete_known_sources_v1';
  const controlEnabled = object(v.scope) && v.scope.controlBalanceMode === 'global_control_balance_v1';
  const head = ['protocol', 'runReference', 'actorId', 'state', 'version', 'createdAt', 'lastPageReference', 'opaque', ...effects];
  if (!exact(v, v.opaque === true ? head : [...head, 'scope', 'nextPhase', 'limits', 'coverage', 'groups', 'qualification', 'openingClosing', 'financialTotalsAcrossLedgersProvided', ...(completeKnownSources ? ['effectiveLimits'] : []), ...(controlEnabled ? ['controlBalance'] : [])]) ||
    v.protocol !== GLOBAL_FINANCIAL_CAPABILITY || !productReviewEqual(v.runReference, ref) || !id(v.actorId) || !['active', 'waiting_provider', 'waiting_native_capture', 'budget_exhausted', 'sealed'].includes(String(v.state)) ||
    !count(v.version) || !iso(v.createdAt) || !nullable(v.lastPageReference, x => isGlobalFinancialPageReference(x, completeKnownSources)) || !effects.every(k => k === 'openingClosingQualified' ? typeof v[k] === 'boolean' : v[k] === false)) return false;
  if (v.opaque === true) return v.lastPageReference === null && v.openingClosingQualified === false;
  if (v.opaque !== false || !isGlobalFinancialScope(v.scope) || !phase(v.nextPhase) || !productReviewEqual(v.limits, GLOBAL_FINANCIAL_LIMITS) || !coverage(v.coverage, v.scope) ||
    completeKnownSources && !productReviewEqual(v.effectiveLimits, GLOBAL_FINANCIAL_COMPLETE_LIMITS) ||
    controlEnabled && !controlBalance(v.controlBalance) ||
    !Array.isArray(v.groups) || v.groups.length > 200 || v.qualification !== (v.state === 'sealed' ? 'documented_with_unknowns' : 'in_progress') || v.financialTotalsAcrossLedgersProvided !== false) return false;
  if (!v.groups.every(g => object(g) && exact(g, ['balanceType', 'status', 'type', 'reportingCategory', 'currency', 'groupHash', 'movements', 'amountCents', 'feeCents', 'netCents', 'qualification', 'nativeLedgerIncluded']) &&
    [g.balanceType, g.status, g.type, g.reportingCategory].every(x => nullable(x, text)) && g.currency === 'CAD' && hash(g.groupHash) && count(g.movements) &&
    [g.amountCents, g.feeCents, g.netCents].every(integer) && ['observed_provider_movements_only', 'unknown_arithmetic_overflow'].includes(String(g.qualification)) && g.nativeLedgerIncluded === false && Number(g.amountCents) - Number(g.feeCents) === g.netCents) ||
    new Set(v.groups.map(g => g.groupHash)).size !== v.groups.length) return false;
  const o = v.openingClosing;
  if (!object(o) || !exact(o, ['qualification', 'provided', 'providerStatementsVerified', 'statement', 'liveProviderBridgeQualified', 'providerFlowComparison']) ||
    o.qualification !== (v.scope.boundaries === null ? 'unknown' : 'declared_unverified') || !productReviewEqual(o.provided, v.scope.boundaries) || !statement(o.statement, v.scope, ref.scopeHash) ||
    o.providerStatementsVerified !== v.openingClosingQualified || o.providerStatementsVerified !== (object(o.statement) && o.statement.openingClosingQualified === true)) return false;
  const c = o.providerFlowComparison;
  if (!object(c) || !exact(c, ['qualification', 'reason', 'observedNetCents', 'statementNetCents', 'differenceCents', 'balanceType']) || !['unknown', 'observed_provider_flow_matches_statement'].includes(String(c.qualification)) ||
    !nullable(c.reason, text) || ![c.observedNetCents, c.statementNetCents, c.differenceCents].every(x => nullable(x, integer)) || ![null, 'payments'].includes(c.balanceType as 'payments' | null) ||
    o.liveProviderBridgeQualified !== (c.qualification === 'observed_provider_flow_matches_statement')) return false;
  return c.qualification === 'unknown' ? text(c.reason) && c.balanceType === null : c.reason === null && integer(c.observedNetCents) && c.statementNetCents === c.observedNetCents && c.differenceCents === 0 && c.balanceType === 'payments' && o.providerStatementsVerified === true;
}
function page(v: unknown, ref: GlobalFinancialRunReference, completeKnownSources = false): v is GlobalFinancialPage {
  if (!object(v) || !exact(v, ['protocol', 'runReference', 'sequence', 'phase', 'createdAt', 'entries', 'reference']) || v.protocol !== 'global_financial_page_v1' || !productReviewEqual(v.runReference, ref) ||
    !count(v.sequence) || v.sequence < 1 || !phase(v.phase) || !iso(v.createdAt) || !isGlobalFinancialPageReference(v.reference, completeKnownSources) || v.reference.id !== `page_${v.sequence}` || !Array.isArray(v.entries) || v.entries.length > 10) return false;
  return v.entries.every(e => object(e) && exact(e, ['entryId', 'kind', 'qualification', 'reasonCodes', 'source', 'providerMovementId', 'contractReferences', 'amountCents', 'feeCents', 'netCents', 'currency', 'balanceType', 'type', 'reportingCategory']) &&
    text(e.entryId) && ['native_source', 'provider_movement', 'source_audit', 'reference_audit', 'provider_statement'].includes(String(e.kind)) && text(e.qualification) && texts(e.reasonCodes) &&
    (e.source === null || object(e.source) && exact(e.source, ['path', 'sourceHash']) && text(e.source.path, 1000) && hash(e.source.sourceHash)) && nullable(e.providerMovementId, x => stripeId(x, 'txn')) && texts(e.contractReferences, 100, 600) &&
    [e.amountCents, e.feeCents, e.netCents].every(x => nullable(x, integer)) && (e.currency === null || e.currency === 'CAD') && [e.balanceType, e.type, e.reportingCategory].every(x => nullable(x, text))) && new Set(v.entries.map(e => e.entryId)).size === v.entries.length;
}
export async function parseGlobalFinancialResponse(raw: unknown, ref: GlobalFinancialRunReference, pending?: GlobalFinancialJournalState): Promise<GlobalFinancialResponse> {
  if (!object(raw) || !exact(raw, ['runReference', 'unrecorded', 'reportView', 'commandReceipt', 'pageView']) || !productReviewEqual(raw.runReference, ref) || typeof raw.unrecorded !== 'boolean') throw globalFinancialFailure();
  if (raw.unrecorded) {if (raw.reportView !== null || raw.commandReceipt !== null || raw.pageView !== null || pending?.pending?.action !== 'prepare') throw globalFinancialFailure();}
  else {
    const completeKnownSources = object(raw.reportView) && object(raw.reportView.scope) && raw.reportView.scope.coverageMode === 'complete_known_sources_v1';
    const ownOpaque = object(raw.reportView) && raw.reportView.opaque === true && !!pending?.pending;
    if (!report(raw.reportView, ref) || !nullable(raw.commandReceipt, v => receipt(v, completeKnownSources || ownOpaque)) || !nullable(raw.pageView, v => page(v, ref, completeKnownSources))) throw globalFinancialFailure();
    if (object(raw.reportView) && raw.reportView.opaque === true && raw.pageView !== null) throw globalFinancialFailure();
    if (object(raw.reportView) && raw.reportView.opaque === false) {
      if (await productReviewHash(raw.reportView.scope) !== ref.scopeHash) throw globalFinancialFailure();
      const groups = raw.reportView.groups;
      if (!Array.isArray(groups)) throw globalFinancialFailure();
      for (const g of groups) {if (!object(g) || await productReviewHash({balanceType: g.balanceType, status: g.status, type: g.type, reportingCategory: g.reportingCategory, currency: g.currency}) !== g.groupHash) throw globalFinancialFailure();}
    }
    if (page(raw.pageView, ref, completeKnownSources)) {const {reference, ...core} = raw.pageView; if (await productReviewHash(core) !== reference.contentHash) throw globalFinancialFailure();}
  }
  const p = pending?.pending, r = raw.commandReceipt;
  if (p && r !== null && (!receipt(r, true) || r.actorId !== pending.uid || r.requestId !== p.requestId || r.action !== p.action || r.inputHash !== p.inputHash || r.versionBefore !== p.expectedVersion || !productReviewEqual(r.runReference, ref))) throw globalFinancialFailure();
  return raw as unknown as GlobalFinancialResponse; // Every closed field and cross-reference is qualified above.
}
function guarded(uid: string, guard: () => void) {const s = captureTradeSession(uid); return () => {assertTradeSessionCurrent(s); guard();};}
async function call(uid: string, name: 'readSupportRequests' | 'administerSupportRequest', input: Record<string, unknown>, ref: GlobalFinancialRunReference, guard: () => void, pending?: GlobalFinancialJournalState) {
  const current = guarded(uid, guard); current();
  const {data} = await httpsCallable<Record<string, unknown>, unknown>(functions, name)({capability: GLOBAL_FINANCIAL_CAPABILITY, expectedUid: uid, ...input}); current();
  const value = await parseGlobalFinancialResponse(data, ref, pending); current(); return value;
}
export const GlobalFinancialReconciliationService = {
  async capturePoint(uid: string, guard: () => void, precision?: 'minute'): Promise<GlobalFinancialCapturePoint> {
    const current = guarded(uid, guard); current();
    if (precision !== undefined && precision !== 'minute') throw globalFinancialFailure();
    const {data} = await httpsCallable<Record<string, unknown>, unknown>(functions, 'readSupportRequests')({capability: GLOBAL_FINANCIAL_CAPABILITY, expectedUid: uid, mode: 'capture_point', ...(precision ? {precision} : {})}); current();
    const value = parseGlobalFinancialCapturePoint(data); current(); if (value.precision !== precision) throw globalFinancialFailure(); return value;
  },
  async attempt(uid: string, requestId: string, action: GlobalFinancialAction, runReference: GlobalFinancialRunReference | null, expectedVersion: number, scope: GlobalFinancialScope | null, guard: () => void): Promise<GlobalFinancialJournalState> {
    const current = guarded(uid, guard); current();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId) || !count(expectedVersion) || action === 'prepare' && (!isGlobalFinancialScope(scope) || runReference !== null || expectedVersion !== 0) || action !== 'prepare' && (!isGlobalFinancialRunReference(runReference) || scope !== null)) throw globalFinancialFailure();
    if (action === 'prepare' && scope?.controlBalanceMode && !isGlobalFinancialControlPointAligned(scope)) throw globalFinancialFailure();
    const ref = action === 'prepare' ? {runId: `gfr_${await productReviewHash([GLOBAL_FINANCIAL_CAPABILITY, uid, requestId])}`, scopeHash: await productReviewHash(scope)} : runReference; current();
    if (!ref) throw globalFinancialFailure();
    const inputHash = await productReviewHash({actorId: uid, requestId, action, runReference: ref, expectedVersion, ...(action === 'prepare' ? {scope} : {})}); current();
    const value: GlobalFinancialJournalState = {version: 1, uid, runReference: ref, pending: {requestId, action, expectedVersion, inputHash}};
    if (!isGlobalFinancialJournalState(value, uid)) throw globalFinancialFailure(); return value;
  },
  async execute(state: GlobalFinancialJournalState, scope: GlobalFinancialScope | null, guard: () => void) {
    if (!isGlobalFinancialJournalState(state, state.uid) || !state.pending) throw globalFinancialFailure();
    const p = state.pending, current = guarded(state.uid, guard); current();
    const body = p.action === 'prepare' ? {mode: p.action, requestId: p.requestId, scope} : {mode: p.action, requestId: p.requestId, runReference: state.runReference, expectedVersion: p.expectedVersion};
    if (p.action === 'prepare' && !isGlobalFinancialScope(scope) || p.action !== 'prepare' && scope !== null) throw globalFinancialFailure();
    const expected = await productReviewHash({actorId: state.uid, requestId: p.requestId, action: p.action, runReference: state.runReference, expectedVersion: p.expectedVersion, ...(p.action === 'prepare' ? {scope} : {})}); current();
    if (expected !== p.inputHash || p.action === 'prepare' && await productReviewHash(scope) !== state.runReference.scopeHash) throw globalFinancialFailure(); current();
    return call(state.uid, 'administerSupportRequest', body, state.runReference, current, state);
  },
  observe(uid: string, ref: GlobalFinancialRunReference, guard: () => void, state?: GlobalFinancialJournalState) {
    if (!isGlobalFinancialRunReference(ref) || state && (!isGlobalFinancialJournalState(state, uid) || !productReviewEqual(state.runReference, ref))) throw globalFinancialFailure();
    return call(uid, 'readSupportRequests', {mode: 'observe', runReference: ref, ...(state?.pending ? {requestId: state.pending.requestId} : {})}, ref, guard, state);
  },
  page(uid: string, ref: GlobalFinancialRunReference, reference: GlobalFinancialPageReference, guard: () => void) {
    if (!isGlobalFinancialRunReference(ref) || !isGlobalFinancialPageReference(reference, true)) throw globalFinancialFailure();
    return call(uid, 'readSupportRequests', {mode: 'page', runReference: ref, pageReference: reference}, ref, guard).then(value => {if (value.pageView && !productReviewEqual(value.pageView.reference, reference)) throw globalFinancialFailure(); guard(); return value;});
  },
};
export type {GlobalFinancialPending};
