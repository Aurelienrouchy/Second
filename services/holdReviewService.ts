import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { HOLD_REVIEW_REASONS } from '@/types/holdReview';
import type { HoldReview, HoldReviewCursor, HoldReviewPage, HoldReviewRow } from '@/types/holdReview';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, limit: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= limit;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && Date.parse(v) >= 0 && new Date(v).toISOString() === v;
const nullableDate = (v: unknown): v is string | null => v === null || iso(v);
const unavailable = () => new Error('Les revues de cette page doivent être relues. Aucun solde ni état de résolution n’est déduit d’une lecture incomplète.');

// Firestore orders document IDs by UTF-8 bytes, including historical non-ASCII IDs.
function idBytes(v: unknown): number[] | null {
  if (typeof v !== 'string' || !v || v.includes('/') || v === '.' || v === '..') return null;
  try {
    const bytes = (encodeURIComponent(v).match(/%[0-9A-F]{2}|[^%]/g) ?? []).map(part => part.startsWith('%') ? parseInt(part.slice(1), 16) : part.charCodeAt(0));
    return bytes.length <= 1500 ? bytes : null;
  } catch { return null; }
}
function compareIds(left: string, right: string): number {
  const a = idBytes(left), b = idBytes(right);
  if (!a || !b) throw unavailable();
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
function parseCursor(v: unknown, uid: string): HoldReviewCursor | null {
  if (v === null) return null;
  if (!record(v) || Object.keys(v).length !== 4 || !['schemaVersion', 'ownerId', 'scope', 'lastId'].every(field => Object.prototype.hasOwnProperty.call(v, field)) ||
    v.schemaVersion !== 1 || v.ownerId !== uid || v.scope !== 'seller_sales' || !idBytes(v.lastId)) throw unavailable();
  return {schemaVersion: 1, ownerId: uid, scope: 'seller_sales', lastId: v.lastId as string};
}
function parseReview(v: unknown, readAt: string): HoldReview {
  if (!record(v) || v.protocol !== 'hold_review_v1' || !hash(v.observationId) ||
    !HOLD_REVIEW_REASONS.includes(v.reason as HoldReview['reason']) || !iso(v.observedAt) || Date.parse(v.observedAt) > Date.parse(readAt) ||
    typeof v.currentSourceMatches !== 'boolean' || !(v.amountCents === null || integer(v.amountCents, Number.MAX_SAFE_INTEGER)) ||
    v.currency !== 'CAD' || v.amountBasis !== 'observed_sale_hold' || !nullableDate(v.startedAt) || !nullableDate(v.initialDeadlineAt) ||
    !['native_timestamp', 'unknown'].includes(String(v.startQualification)) || !['native_timestamp', 'unknown'].includes(String(v.deadlineQualification)) ||
    (v.startQualification === 'native_timestamp') !== (v.startedAt !== null) || (v.deadlineQualification === 'native_timestamp') !== (v.initialDeadlineAt !== null) ||
    v.startedAt !== null && Date.parse(v.startedAt) > Date.parse(v.observedAt) ||
    v.startedAt !== null && v.initialDeadlineAt !== null && Date.parse(v.initialDeadlineAt) < Date.parse(v.startedAt) ||
    !nullableDate(v.agingOpenedAt) || v.agingOpenedAt !== null && Date.parse(v.agingOpenedAt) > Date.parse(v.observedAt) ||
    !(v.operationalAgingThresholdMs === null || v.operationalAgingThresholdMs === 432000000) ||
    !(v.operationalThresholdExceeded === null || typeof v.operationalThresholdExceeded === 'boolean') ||
    v.operationalAgingThresholdMs === null && (v.agingOpenedAt !== null || v.operationalThresholdExceeded !== null) ||
    v.agingOpenedAt === null && v.operationalThresholdExceeded !== null ||
    v.legalMaximumDeadlineAt !== null || v.resolutionState !== 'unknown' || v.financialPermission !== false || v.action !== 'contactSupport' ||
    typeof v.message !== 'string' || !v.message.trim() || v.message.length > 2000) throw unavailable();
  return {protocol: 'hold_review_v1', observationId: v.observationId, reason: v.reason as HoldReview['reason'], observedAt: v.observedAt,
    currentSourceMatches: v.currentSourceMatches, amountCents: v.amountCents as number | null, currency: 'CAD', amountBasis: 'observed_sale_hold',
    startedAt: v.startedAt, initialDeadlineAt: v.initialDeadlineAt, startQualification: v.startQualification as HoldReview['startQualification'],
    deadlineQualification: v.deadlineQualification as HoldReview['deadlineQualification'], agingOpenedAt: v.agingOpenedAt,
    operationalAgingThresholdMs: v.operationalAgingThresholdMs as number | null, operationalThresholdExceeded: v.operationalThresholdExceeded as boolean | null,
    legalMaximumDeadlineAt: null, resolutionState: 'unknown', financialPermission: false, message: v.message, action: 'contactSupport'};
}
function parsePage(v: unknown, uid: string, cursor: HoldReviewCursor | null): HoldReviewPage {
  if (!record(v) || v.protocol !== 'seller_hold_reviews_v1' || v.ownerId !== uid || v.scope !== 'seller_sales' || !iso(v.readAt) ||
    !Array.isArray(v.rows) || v.rows.length > 30 || v.resolutionState !== 'unknown' || v.financialPermission !== false || !record(v.coverage)) throw unavailable();
  const c = v.coverage;
  if (c.order !== 'document_id_asc' || c.limit !== 30 || !integer(c.inspectedCount, 30) || !integer(c.returnedCount, 30) ||
    !integer(c.skippedOwnerSources, 30) || c.returnedCount !== v.rows.length || c.returnedCount + c.skippedOwnerSources !== c.inspectedCount ||
    typeof c.hasMore !== 'boolean' || c.pageEnded !== !c.hasMore || c.immutableCapture !== false || c.globalCoverage !== false ||
    c.hasMore && c.inspectedCount !== 30) throw unavailable();
  const rows: HoldReviewRow[] = [];
  let priorId = cursor?.lastId ?? null;
  for (const row of v.rows) {
    if (!record(row) || !idBytes(row.transactionId) || !['observed', 'absent', 'unqualified'].includes(String(row.reviewQualification)) ||
      (row.reviewQualification === 'observed') !== (row.review !== null)) throw unavailable();
    const transactionId = row.transactionId as string;
    if (priorId !== null && compareIds(transactionId, priorId) <= 0) throw unavailable();
    rows.push({transactionId, reviewQualification: row.reviewQualification as HoldReviewRow['reviewQualification'],
      review: row.reviewQualification === 'observed' ? parseReview(row.review, v.readAt) : null});
    priorId = transactionId;
  }
  const nextCursor = parseCursor(v.nextCursor, uid);
  if (c.hasMore !== (nextCursor !== null) || nextCursor && ((cursor && compareIds(nextCursor.lastId, cursor.lastId) <= 0) ||
    (priorId !== null && compareIds(nextCursor.lastId, priorId) < 0) ||
    (c.skippedOwnerSources === 0 && nextCursor.lastId !== priorId))) throw unavailable();
  return {protocol: 'seller_hold_reviews_v1', ownerId: uid, scope: 'seller_sales', readAt: v.readAt, rows, nextCursor,
    coverage: {order: 'document_id_asc', inspectedCount: c.inspectedCount, returnedCount: c.returnedCount, skippedOwnerSources: c.skippedOwnerSources,
      limit: 30, hasMore: c.hasMore, pageEnded: !c.hasMore, immutableCapture: false, globalCoverage: false}, resolutionState: 'unknown', financialPermission: false};
}

/** Pure owner read: no provider call, total, release, refund or withdrawal. */
export async function getSellerHoldReviews(uid: string, cursor: HoldReviewCursor | null, assertFocus: () => void): Promise<HoldReviewPage> {
  const session = captureTradeSession(uid), nativeCursor = parseCursor(cursor, uid), cursorKey = JSON.stringify(nativeCursor);
  const assertCurrent = () => {
    assertTradeSessionCurrent(session); assertFocus();
    if (JSON.stringify(parseCursor(cursor, uid)) !== cursorKey) throw unavailable();
  };
  assertCurrent();
  const {data} = await httpsCallable<unknown, unknown>(functions, 'getWalletInfo')({mode: 'hold_reviews', expectedUid: uid, scope: 'seller_sales',
    ...(nativeCursor ? {cursor: nativeCursor} : {})});
  assertCurrent();
  const page = parsePage(data, uid, nativeCursor); assertCurrent(); return page;
}
