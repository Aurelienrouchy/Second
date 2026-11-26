export const GLOBAL_FINANCIAL_CAPABILITY = 'global_financial_reconciliation_v1';
export const GLOBAL_FINANCIAL_LIMITS = {nativePageSize: 10, providerPageSize: 5, maxNativePages: 2000, maxProviderPages: 1000, maxAuditPages: 2000,
  maxSources: 20000, maxReferences: 100000, maxPageBytes: 450000, maxRunBytes: 200000, maxClaimsPerReference: 8, maxReadAttempts: 5} as const;
export const GLOBAL_FINANCIAL_COMPLETE_LIMITS = {protocol: 'global_financial_effective_limits_v1', coverageMode: 'complete_known_sources_v1',
  total: {nativePages: null, providerPages: null, auditPages: null, sources: null, references: null, readAttemptsPerCommand: null},
  perCall: {nativePageSize: 10, providerPageSize: 5, externalPages: 1}, maxPageBytes: 450000, maxRunBytes: 200000, maxGroups: 200,
  maxClaimsPerReference: 8, maxMovementIdsPerReference: 20, maxPendingChildren: 40, safeIntegerMaximum: 9007199254740991, automaticLoop: false} as const;
export type GlobalFinancialBoundary = {balanceType: 'payments' | 'issuing' | 'refund_and_dispute_prefunding' | 'risk_reserved'; availableCents: number; pendingCents: number; evidenceReference: {reference: string; contentHash: string}};
export interface GlobalFinancialNativeCapture {protocol: 'firestore_read_time_v1'; readTime: {seconds: number; nanoseconds: number}}
interface GlobalFinancialCapturePointBase {
  protocol: 'global_financial_native_capture_point_v1'; nativeCapture: GlobalFinancialNativeCapture;
  authorityReadMode: 'current'; knownSourcesOnly: true; globalBalanceReconciled: false; sourceSetExhaustive: false;
}
export type GlobalFinancialCapturePoint = GlobalFinancialCapturePointBase & ({precision?: never; readTimeVerified?: never; pitrEnabledVerified?: never; futureAvailabilityVerified?: never} |
  {precision: 'minute'; readTimeVerified: true; pitrEnabledVerified: false; futureAvailabilityVerified: false});
export interface GlobalFinancialNativeCaptureCoverage extends GlobalFinancialNativeCapture {
  readMode: 'firestore_read_only_at_read_time'; authorityReadMode: 'current'; nativeAccountReferenceReadMode: 'captured_at_read_time';
  providerObservationReadMode: 'current_get'; knownSourcesOnly: true; sourceSetExhaustive: false; writerDrainQualified: false;
  periodCoveredByNativeCapture: boolean; state: 'capture_in_progress' | 'captured_known_sources_complete' | 'read_time_unavailable'; lastFailureReason: string | null;
}
export interface GlobalFinancialScope {
  accountKind: 'platform' | 'connected'; accountId: string; platformAccountId: string; livemode: boolean; currency: 'CAD';
  period: {fromSeconds: number; toSeconds: number}; connectedReference: null | {kind: 'withdrawal' | 'current_account'; id: string};
  epoch: null | {id: string; proofHash: string}; boundaries: null | {opening: GlobalFinancialBoundary[]; closing: GlobalFinancialBoundary[]};
  statementReference: null | {reportRunId: string; reportType: 'balance.summary.1' | 'balance.summary.2'};
  /** Omitted on legacy V1 scopes, preserving their exact DTO and scope hash. */
  nativeCapture?: GlobalFinancialNativeCapture;
  /** Explicit new-report choice only; requires nativeCapture and is omitted on V1 scopes. */
  coverageMode?: 'complete_known_sources_v1';
  /** Explicit new-report control; never inferred from a balanced provider flow. */
  controlBalanceMode?: 'global_control_balance_v1';
}
export interface GlobalFinancialControlCompartment {
  balanceType: GlobalFinancialBoundary['balanceType']; openingBalanceCents: number; closingBalanceCents: number; providerNetCents: number;
  flowDifferenceCents: number | null; liabilitiesCents: number | null; receivablesCents: number | null; ownFundsCents: number | null; residualCents: number | null;
}
export interface GlobalFinancialControlResult {
  protocol: 'global_control_balance_result_v1'; qualification: 'balanced' | 'mismatch' | 'unknown'; qualified: boolean;
  sourceSetVerified: boolean; providerSetVerified: boolean; writerDrainVerified: boolean; compartments: GlobalFinancialControlCompartment[];
  componentMismatches: number; eventMismatches: number; unmatchedProviderMovements: number;
  financialEffectAuthorized: false; providerMutationAuthorized: false; holdReleaseAuthorized: false;
}
export interface GlobalFinancialControlBalance {
  protocol: 'global_control_balance_v1'; stage: 'opening' | 'sources' | 'events' | 'components' | 'complete'; lastFailureReason: string | null;
  qualification: 'incomplete' | GlobalFinancialControlResult['qualification']; qualified: boolean; anchorHash: string | null;
  sourceCount: number; effectCount: number; components: number; events: number; unknownFacts: number; issues: string[];
  sourceSetVerified: boolean; providerSetVerified: boolean; writerDrainVerified: boolean; result: GlobalFinancialControlResult | null;
  financialEffectAuthorized: false; providerMutationAuthorized: false; holdReleaseAuthorized: false; bankArrivalVerified: false; taxPeriodQualified: false; legalStatusVerified: false;
}
export type GlobalFinancialRunReference = {runId: string; scopeHash: string};
export type GlobalFinancialPageReference = {id: string; contentHash: string};
export type GlobalFinancialAction = 'prepare' | 'advance' | 'seal';
export type GlobalFinancialPhase = 'native' | 'provider' | 'audit' | 'statement' | 'ready';
export interface GlobalFinancialEffects {
  financialEffectAuthorized: false; providerMutationAuthorized: false; holdReleaseAuthorized: false; globalBalanceReconciled: false;
  nativeSnapshotQualified: false; openingClosingQualified: boolean; bankArrivalVerified: false; taxPeriodQualified: false;
}
export interface GlobalFinancialReceipt {
  protocol: 'global_financial_command_receipt_v1'; actorId: string; requestId: string; action: GlobalFinancialAction; inputHash: string;
  runReference: GlobalFinancialRunReference; status: 'completed' | 'not_executed' | 'pending' | 'unknown'; versionBefore: number; versionAfter: number;
  pageReference: GlobalFinancialPageReference | null; createdAt: string; completedAt: string | null; disposition: null | {reason: string; observedVersion: number};
}
export interface GlobalFinancialEntry {
  entryId: string; kind: 'native_source' | 'provider_movement' | 'source_audit' | 'reference_audit' | 'provider_statement'; qualification: string;
  reasonCodes: string[]; source: null | {path: string; sourceHash: string}; providerMovementId: string | null; contractReferences: string[];
  amountCents: number | null; feeCents: number | null; netCents: number | null; currency: 'CAD' | null; balanceType: string | null; type: string | null; reportingCategory: string | null;
}
export interface GlobalFinancialPage {
  protocol: 'global_financial_page_v1'; runReference: GlobalFinancialRunReference; reference: GlobalFinancialPageReference;
  sequence: number; phase: GlobalFinancialPhase; createdAt: string; entries: GlobalFinancialEntry[];
}
export interface GlobalFinancialGroup {
  balanceType: string | null; status: string | null; type: string | null; reportingCategory: string | null; currency: 'CAD'; groupHash: string;
  movements: number; amountCents: number | null; feeCents: number | null; netCents: number | null;
  qualification: 'observed_provider_movements_only' | 'unknown_arithmetic_overflow'; nativeLedgerIncluded: false;
}
export interface GlobalFinancialStatement {
  protocol: 'global_financial_statement_v1'; qualification: 'unknown' | 'native_provider_statement'; reason: string | null;
  reference: GlobalFinancialScope['statementReference']; scopeHash: string;
  summary: null | {currency: 'CAD'; openingCents: number; closingCents: number; activityNetCents: number; payoutNetCents: number; periodNetCents: number;
    scope: 'provider_currency_summary'; balanceType: null; bucketAllocationQualified: false};
  fileId: string | null; fileHash: string | null; proofHash: string | null; observedAt: string; startedAt: string; openingClosingQualified: boolean;
}
export interface GlobalFinancialReportHeader extends GlobalFinancialEffects {
  protocol: typeof GLOBAL_FINANCIAL_CAPABILITY; runReference: GlobalFinancialRunReference; actorId: string;
  state: 'active' | 'waiting_provider' | 'waiting_native_capture' | 'budget_exhausted' | 'sealed'; version: number; createdAt: string; lastPageReference: GlobalFinancialPageReference | null;
}
export interface GlobalFinancialPrivateReport extends GlobalFinancialReportHeader {
  opaque: false; scope: GlobalFinancialScope; nextPhase: GlobalFinancialPhase; limits: typeof GLOBAL_FINANCIAL_LIMITS;
  effectiveLimits?: typeof GLOBAL_FINANCIAL_COMPLETE_LIMITS;
  controlBalance?: GlobalFinancialControlBalance;
  coverage: {
    native: {pages: number; sources: number; closed: boolean; cursor: {rootIndex: number; lastId: string | null; pendingChildren: number}};
    provider: {pages: number; movements: number; closed: boolean; cursor: string | null};
    audit: {pages: number; closed: boolean; cursor: string | null; stage: 'sources' | 'references'};
    changedSources: number; unknownFacts: number; scopeOnly: true; liveScansAreAsOfSnapshot: false; externalExhaustivenessVerified: false;
    connectedPayoutsIncluded: boolean; otherAccountsReconciled: false; epochQualification: 'unknown'; snapshotMissingProofs: string[];
    nativeCapture?: GlobalFinancialNativeCaptureCoverage;
  };
  groups: GlobalFinancialGroup[]; qualification: 'in_progress' | 'documented_with_unknowns';
  openingClosing: {
    qualification: 'declared_unverified' | 'unknown'; provided: GlobalFinancialScope['boundaries']; providerStatementsVerified: boolean;
    statement: GlobalFinancialStatement | null; liveProviderBridgeQualified: boolean;
    providerFlowComparison: {qualification: 'unknown' | 'observed_provider_flow_matches_statement'; reason: string | null;
      observedNetCents: number | null; statementNetCents: number | null; differenceCents: number | null; balanceType: null | 'payments'};
  };
  financialTotalsAcrossLedgersProvided: false;
}
export type GlobalFinancialReport = GlobalFinancialPrivateReport | GlobalFinancialReportHeader & {opaque: true};
export interface GlobalFinancialResponse {runReference: GlobalFinancialRunReference; unrecorded: boolean; reportView: GlobalFinancialReport | null; commandReceipt: GlobalFinancialReceipt | null; pageView: GlobalFinancialPage | null}
/** Only owner references and the exact outstanding command persist, never report bodies. */
export interface GlobalFinancialPending {requestId: string; action: GlobalFinancialAction; expectedVersion: number; inputHash: string}
export interface GlobalFinancialJournalState {version: 1; uid: string; runReference: GlobalFinancialRunReference; pending: GlobalFinancialPending | null}
