import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { SwapFundReleaseDecision, SwapFundReleaseLog, SwapHoldReview, SwapHoldSource } from '@/types/swapHoldReview';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const failure = () => new Error('Le dossier du complément ne peut pas être confirmé. Relisez-le ou contactez notre équipe.');
const revisionMillis = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value)) return null;
  const [seconds, nanos] = value.split(':').map(Number);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 253402300799 &&
    Number.isSafeInteger(nanos) && nanos >= 0 && nanos < 1_000_000_000 ? Math.floor(seconds * 1000 + nanos / 1_000_000) : null;
};
const decisionIso = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && iso(value) && Date.parse(value) >= 0;
/** A separate Troc projection. Missing historical explanations never establish a missing financial effect. */
export function isSwapFundReleaseLog(value: unknown, uid: string, swapId: string): value is SwapFundReleaseLog {
  if (!object(value) || !exact(value, ['ok', 'protocol', 'ownerId', 'swapId', 'sourceKind', 'coverage', 'absenceOfDecisionVerified',
    'financialExecutionCoverageVerified', 'completeHistory', 'journalState', 'entry']) || value.ok !== true ||
    value.protocol !== 'swap_fund_release_log_v1' || value.ownerId !== uid || value.swapId !== swapId || value.sourceKind !== 'swap' ||
    value.coverage !== 'recorded_entries_only' || value.absenceOfDecisionVerified !== false || value.financialExecutionCoverageVerified !== false ||
    value.completeHistory !== false || !['recorded', 'not_recorded', 'unqualified'].includes(String(value.journalState))) return false;
  if (value.journalState !== 'recorded') return value.entry === null;
  return isSwapFundReleaseDecision(value.entry, swapId);
}
/** Same exact immutable entry on its native reader and in a support snapshot. */
export function isSwapFundReleaseDecision(entry: unknown, swapId: string): entry is SwapFundReleaseDecision {
  if (!object(entry) || !exact(entry, ['id', 'revision', 'sourceHash', 'protocol', 'sourceKind', 'swapId', 'transactionId', 'decisionType',
    'criteria', 'result', 'executedAt', 'internalReleaseRecorded', 'externalPayoutVerified']) ||
    typeof entry.id !== 'string' || !/^swap_funds_released_[a-f0-9]{64}$/.test(entry.id) || revisionMillis(entry.revision) === null ||
    typeof entry.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sourceHash) || entry.protocol !== 'swap_funds_released_v1' ||
    entry.sourceKind !== 'swap' || entry.swapId !== swapId || entry.transactionId !== null || entry.decisionType !== 'funds_released' ||
    entry.result !== 'Libération interne du complément du Troc enregistrée après l’échéance de réclamation.' || !decisionIso(entry.executedAt) ||
    Date.parse(entry.executedAt) > Date.now() + 60_000 || entry.internalReleaseRecorded !== true || entry.externalPayoutVerified !== false ||
    !object(entry.criteria)) return false;
  const criteria = entry.criteria;
  if (!exact(criteria, ['status', 'disputed', 'heldAt', 'initialDeadlineAt', 'bothReceptionsAt', 'releasedCents', 'currency', 'swapSourceRevision']) ||
    criteria.status !== 'completed' || criteria.disputed !== false && criteria.disputed !== null ||
    !Number.isSafeInteger(criteria.releasedCents) || typeof criteria.releasedCents !== 'number' || criteria.releasedCents <= 0 || criteria.currency !== 'CAD' ||
    !decisionIso(criteria.heldAt) || !decisionIso(criteria.initialDeadlineAt) || !decisionIso(criteria.bothReceptionsAt)) return false;
  const sourceMillis = revisionMillis(criteria.swapSourceRevision), executedMillis = Date.parse(entry.executedAt);
  return sourceMillis !== null && sourceMillis <= executedMillis && Date.parse(criteria.bothReceptionsAt) <= Date.parse(criteria.heldAt) &&
    Date.parse(criteria.heldAt) <= Date.parse(criteria.initialDeadlineAt) && Date.parse(criteria.initialDeadlineAt) <= executedMillis;
}
export function isSwapHoldSource(v: unknown, at: string): v is SwapHoldSource {
  if (!object(v) || !exact(v, ['state', 'reason', 'amountCents', 'currency', 'amountBasis', 'startedAt', 'initialDeadlineAt',
    'startQualification', 'deadlineQualification', 'deadlineState', 'bothReceptionsAt', 'receptionsQualification', 'financialQualification', 'releaseReceiptQualification']) ||
    !['no_topup', 'held', 'release_recorded', 'review_required'].includes(String(v.state)) ||
    !(v.reason === null || ['commercial_dispute', 'financial_source_reconciliation', 'reception_source_reconciliation', 'hold_clock_unqualified'].includes(String(v.reason))) ||
    !(v.amountCents === null || Number.isSafeInteger(v.amountCents) && (v.amountCents as number) >= 0) || v.currency !== 'CAD' ||
    !['observed_swap_hold', 'recorded_swap_release'].includes(String(v.amountBasis)) ||
    !['native_linked_movements', 'unknown'].includes(String(v.financialQualification)) ||
    !['native_receipt', 'legacy_linked_movement', 'unknown'].includes(String(v.releaseReceiptQualification)) ||
    !(v.startedAt === null || iso(v.startedAt) && Date.parse(v.startedAt) <= Date.parse(at)) ||
    !(v.initialDeadlineAt === null || iso(v.initialDeadlineAt)) ||
    !(v.bothReceptionsAt === null || iso(v.bothReceptionsAt) && Date.parse(v.bothReceptionsAt) <= Date.parse(at)) ||
    v.startQualification !== (v.startedAt === null ? 'unknown' : 'native_timestamp') ||
    v.deadlineQualification !== (v.initialDeadlineAt === null ? 'unknown' : 'native_timestamp') ||
    v.receptionsQualification !== (v.bothReceptionsAt === null ? 'unknown' : 'native_participant_confirmations') ||
    v.deadlineState !== (v.initialDeadlineAt === null ? 'unknown' : Date.parse(v.initialDeadlineAt as string) > Date.parse(at) ? 'future' : 'elapsed') ||
    v.startedAt !== null && v.initialDeadlineAt !== null && Date.parse(v.initialDeadlineAt as string) < Date.parse(v.startedAt as string)) return false;
  if (v.state === 'review_required') return v.reason !== null && v.amountBasis === 'observed_swap_hold' && v.releaseReceiptQualification === 'unknown';
  if (v.reason !== null) return false;
  if (v.state === 'no_topup') return v.amountCents === null && v.amountBasis === 'observed_swap_hold' && v.financialQualification === 'unknown' && v.releaseReceiptQualification === 'unknown';
  return typeof v.amountCents === 'number' && v.amountCents > 0 && v.amountBasis === (v.state === 'release_recorded' ? 'recorded_swap_release' : 'observed_swap_hold') &&
    v.financialQualification === 'native_linked_movements' && (v.state === 'release_recorded' ? v.releaseReceiptQualification !== 'unknown' : v.releaseReceiptQualification === 'unknown') &&
    (v.state !== 'held' || v.startedAt !== null && v.initialDeadlineAt !== null && v.bothReceptionsAt !== null);
}
export const SwapHoldReviewService = {
  async exactReleaseDecision(uid: string, swapId: string, reference: {id: string; revision: string; sourceHash: string}, assertContext: () => void): Promise<SwapFundReleaseDecision> {
    if (!object(reference) || !exact(reference, ['id', 'revision', 'sourceHash']) ||
      !/^swap_funds_released_[a-f0-9]{64}$/.test(reference.id) || revisionMillis(reference.revision) === null || !/^[a-f0-9]{64}$/.test(reference.sourceHash)) throw failure();
    const current = await this.readReleaseDecision(uid, swapId, assertContext); assertContext();
    if (current.journalState !== 'recorded' || current.entry.id !== reference.id || current.entry.revision !== reference.revision || current.entry.sourceHash !== reference.sourceHash)
      throw new Error('La décision exacte ne peut plus être qualifiée. Relisez le Troc et sélectionnez explicitement sa décision actuelle.');
    return current.entry;
  },
  async readReleaseDecision(uid: string, swapId: string, assertContext: () => void): Promise<SwapFundReleaseLog> {
    const session = captureTradeSession(uid); assertContext();
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(swapId)) throw failure();
    const result = await httpsCallable<unknown, unknown>(functions, 'getAutomatedDecisionLog')({expectedUid: uid, operation: 'swap_fund_release', swapId});
    assertTradeSessionCurrent(session); assertContext();
    if (!isSwapFundReleaseLog(result.data, uid, swapId)) throw failure();
    return result.data;
  },
  async read(uid: string, swapId: string, assertContext: () => void): Promise<SwapHoldReview> {
    const session = captureTradeSession(uid); assertContext();
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(swapId)) throw failure();
    const result = await httpsCallable<unknown, unknown>(functions, 'getWalletInfo')({mode: 'swap_hold_review', expectedUid: uid, swapId});
    assertTradeSessionCurrent(session); assertContext(); const v = result.data;
    if (!object(v) || !exact(v, ['protocol', 'ownerId', 'swapId', 'readAt', 'role', 'currentSource', 'reviewQualification', 'review',
      'resolutionState', 'legalMaximumDeadlineAt', 'financialPermission']) || v.protocol !== 'swap_hold_review_v1' || v.ownerId !== uid || v.swapId !== swapId ||
      !iso(v.readAt) || !['payer', 'payee', 'participant_unknown'].includes(String(v.role)) || !isSwapHoldSource(v.currentSource, v.readAt) ||
      !['observed', 'absent', 'unqualified'].includes(String(v.reviewQualification)) || v.resolutionState !== 'unknown' ||
      v.legalMaximumDeadlineAt !== null || v.financialPermission !== false) throw failure();
    if (v.reviewQualification !== 'observed') {if (v.review !== null) throw failure();}
    else {
      const review = v.review;
      if (!object(review) || !exact(review, ['protocol', 'observationId', 'observedAt', 'currentSourceMatches', 'source', 'resolutionState',
        'legalMaximumDeadlineAt', 'financialPermission', 'action']) || review.protocol !== 'swap_hold_observation_v1' ||
        typeof review.observationId !== 'string' || !/^[a-f0-9]{64}$/.test(review.observationId) || !iso(review.observedAt) ||
        Date.parse(review.observedAt) > Date.parse(v.readAt) || typeof review.currentSourceMatches !== 'boolean' || !isSwapHoldSource(review.source, review.observedAt) ||
        review.source.state !== 'review_required' || review.resolutionState !== 'unknown' || review.legalMaximumDeadlineAt !== null ||
        review.financialPermission !== false || review.action !== 'contactSupport') throw failure();
    }
    return v as unknown as SwapHoldReview;
  },
};
