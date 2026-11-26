import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { auth, functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { SellerActivityCursor, SellerActivityDateFact, SellerActivityFactsPage, SellerActivityItem,
  SellerActivityLedgerFacts, SellerActivityMoneyFact, SellerActivityRecordSource, SellerActivitySource } from '@/types/sellerActivityFacts';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const reason = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const failure = () => new Error('Cette lecture native ne peut pas être qualifiée. Relisez explicitement la commande et ses sources.');
function documentId(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.includes('/') || v === '.' || v === '..' || /^__.*__$/.test(v)) return false;
  try {return encodeURIComponent(v).replace(/%[a-fA-F0-9]{2}/g, '_').length <= 1500;} catch {return false;}
}
export const isSellerActivityTransactionId = (v: unknown): v is string => documentId(v) && v.length <= 128 && v === v.trim();
function revision(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{1,20}:\d{1,9}$/.test(v)) return false;
  const [seconds, nanos] = v.split(':').map(Number);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 253402300799 && Number.isInteger(nanos) && nanos >= 0 && nanos < 1_000_000_000;
}
function source(v: unknown): v is SellerActivitySource {
  return object(v) && exact(v, ['transactionId', 'sellerId', 'orderRevision', 'orderSourceHash', 'scopeHash']) &&
    isSellerActivityTransactionId(v.transactionId) && documentId(v.sellerId) && v.sellerId.length <= 128 &&
    revision(v.orderRevision) && hash(v.orderSourceHash) && hash(v.scopeHash);
}
export const sameSellerActivitySource = (a: SellerActivitySource, b: SellerActivitySource) => a.transactionId === b.transactionId &&
  a.sellerId === b.sellerId && a.orderRevision === b.orderRevision && a.orderSourceHash === b.orderSourceHash && a.scopeHash === b.scopeHash;
function cursor(v: unknown): v is SellerActivityCursor {
  return object(v) && exact(v, ['lastId', 'scopeHash']) && documentId(v.lastId) && hash(v.scopeHash);
}
function recordSource(v: unknown, absent = false): v is SellerActivityRecordSource {
  return object(v) && exact(v, ['revision', 'sourceHash']) && (revision(v.revision) || absent && v.revision === null) && hash(v.sourceHash);
}
function clock(v: unknown, readAt: string): v is SellerActivityDateFact {
  return object(v) && exact(v, ['qualification', 'at', 'reason']) && (v.qualification === 'unknown' ? v.at === null && reason(v.reason) :
    v.qualification === 'native_timestamp' && iso(v.at) && Date.parse(v.at) >= 0 && Date.parse(v.at) <= Date.parse(readAt) && v.reason === null);
}
function money(v: unknown, kind: Exclude<SellerActivityMoneyFact['qualification'], 'unknown'>): v is SellerActivityMoneyFact {
  return object(v) && exact(v, ['qualification', 'amountCents', 'currency', 'reason']) && (v.qualification === 'unknown' ?
    v.amountCents === null && (v.currency === null || v.currency === 'CAD') && reason(v.reason) :
    v.qualification === kind && cents(v.amountCents) && v.currency === 'CAD' && v.reason === null);
}
/** UTF-8 document order compares Unicode scalar values, including supplementary characters. */
function after(a: string, b: string) {
  const left = Array.from(a, c => c.codePointAt(0)!), right = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] > right[i];
  return left.length > right.length;
}
function ledger(v: unknown): v is SellerActivityLedgerFacts {
  if (!object(v) || !exact(v, ['inspected', 'limit', 'hasMore', 'sources']) || !cents(v.inspected) || v.inspected > 20 || v.limit !== 20 ||
    typeof v.hasMore !== 'boolean' || v.hasMore && v.inspected !== 20 || !Array.isArray(v.sources) || v.sources.length !== v.inspected) return false;
  let prior: string | null = null;
  for (const entry of v.sources) {
    if (!object(entry) || !exact(entry, ['id', 'revision', 'sourceHash']) || !documentId(entry.id) || !revision(entry.revision) || !hash(entry.sourceHash) ||
      prior !== null && !after(entry.id, prior)) return false;
    prior = entry.id;
  }
  return true;
}
const statuses = new Set(['pending', 'pending_payment', 'meetup_pending', 'meetup_confirmed', 'paid', 'label_created', 'shipped', 'delivered', 'completed', 'cancelled', 'disputed',
  'return_requested', 'refund_in_progress', 'refund_action_required', 'refunded', 'delivery_failed', 'lost', 'meetup_completed']);
function item(v: unknown, readAt: string): v is SellerActivityItem {
  if (!object(v) || !exact(v, ['transactionId', 'qualification', 'source', 'recordedStatus', 'createdAt', 'paidAt', 'releasedAt', 'amounts', 'financialSources']) ||
    !documentId(v.transactionId) || !['native_order', 'unknown'].includes(String(v.qualification)) || !recordSource(v.source) ||
    !(v.recordedStatus === null || typeof v.recordedStatus === 'string' && statuses.has(v.recordedStatus)) ||
    !clock(v.createdAt, readAt) || !clock(v.paidAt, readAt) || !clock(v.releasedAt, readAt) || !object(v.amounts) ||
    !exact(v.amounts, ['orderTotal', 'articlePrice', 'sellerGross', 'cardCaptured', 'walletDebited', 'sellerCredit', 'release', 'nativeRefund'])) return false;
  const a = v.amounts;
  if (!money(a.orderTotal, 'native_order_amount') || !money(a.articlePrice, 'native_order_amount') || !money(a.sellerGross, 'native_order_amount') ||
    !money(a.cardCaptured, 'native_recorded_effect') || !money(a.walletDebited, 'native_recorded_effect') || !money(a.sellerCredit, 'native_recorded_effect') ||
    !money(a.release, 'native_recorded_effect') || !object(a.nativeRefund) || !exact(a.nativeRefund, ['total', 'card', 'wallet']) ||
    !money(a.nativeRefund.total, 'native_recorded_effect') || !money(a.nativeRefund.card, 'native_recorded_effect') || !money(a.nativeRefund.wallet, 'native_recorded_effect')) return false;
  const f = v.financialSources;
  if (!object(f) || !exact(f, ['buyerLedger', 'sellerLedger']) || !(f.buyerLedger === null || ledger(f.buyerLedger)) ||
    !(f.sellerLedger === null || ledger(f.sellerLedger)) || (v.qualification === 'unknown' ? f.buyerLedger !== null || f.sellerLedger !== null : f.buyerLedger === null || f.sellerLedger === null)) return false;
  const all = [a.orderTotal, a.articlePrice, a.sellerGross, a.cardCaptured, a.walletDebited, a.sellerCredit, a.release,
    a.nativeRefund.total, a.nativeRefund.card, a.nativeRefund.wallet];
  const currency = a.orderTotal.currency;
  if (all.some(m => m.currency !== currency) ||
    f.buyerLedger?.hasMore && [a.cardCaptured, a.walletDebited, a.nativeRefund.total].some(m => m.amountCents !== null) ||
    f.sellerLedger?.hasMore && [a.sellerCredit, a.release].some(m => m.amountCents !== null)) return false;
  if (v.qualification === 'unknown' && (all.some(m => m.qualification !== 'unknown' || m.currency !== null) ||
    v.paidAt.qualification !== 'unknown' || v.releasedAt.qualification !== 'unknown')) return false;
  const total = a.orderTotal.amountCents, article = a.articlePrice.amountCents, gross = a.sellerGross.amountCents;
  if (total === null ? article !== null || gross !== null || all.some(m => m.amountCents !== null) :
    total <= 0 || article === null || article <= 0 || article > total || gross === null || gross <= 0 || gross > article) return false;
  const captured = a.cardCaptured.amountCents, debited = a.walletDebited.amountCents;
  if (captured !== null && (captured <= 0 || total === null || captured > total) || debited !== null && (debited <= 0 || total === null || debited > total) ||
    captured !== null && debited !== null && captured + debited !== total ||
    v.paidAt.qualification !== (captured !== null || debited !== null ? 'native_timestamp' : 'unknown') ||
    a.sellerCredit.amountCents !== null && a.sellerCredit.amountCents !== gross ||
    a.release.amountCents !== null && (a.sellerCredit.amountCents === null || gross === null || a.release.amountCents > gross) ||
    v.releasedAt.qualification !== (a.release.amountCents !== null ? 'native_timestamp' : 'unknown')) return false;
  const refund = a.nativeRefund;
  if (!money(refund.total, 'native_recorded_effect') || !money(refund.card, 'native_recorded_effect') || !money(refund.wallet, 'native_recorded_effect')) return false;
  return refund.total.amountCents === null ? refund.card.amountCents === null && refund.wallet.amountCents === null :
    refund.total.amountCents === total && refund.card.amountCents !== null && refund.wallet.amountCents !== null &&
    refund.card.amountCents + refund.wallet.amountCents === total;
}
const noAuthorityKeys = ['fraudEstablished', 'financialPermissionGranted', 'inventoryPermissionGranted', 'restrictionPermissionGranted',
  'professionalClassification', 'activityAssessment', 'bankArrivalVerified'];
export function decodeSellerActivityFacts(v: unknown, uid: string, transactionId: string, expected: SellerActivitySource | null,
  prior: SellerActivityCursor | null): SellerActivityFactsPage {
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'anchorTransactionId', 'sellerId', 'readAt', 'source', 'profile', 'items', 'pagination', 'coverage', 'pageHash', ...noAuthorityKeys]) ||
    v.protocol !== 'seller_activity_facts_v1' || v.actorId !== uid || v.anchorTransactionId !== transactionId || !iso(v.readAt) || !source(v.source) ||
    v.source.transactionId !== transactionId || v.sellerId !== v.source.sellerId || expected !== null && !sameSellerActivitySource(v.source, expected) ||
    !object(v.profile) || !exact(v.profile, ['source', 'recordedCreatedAt', 'authCreatedAt']) || !recordSource(v.profile.source, true) ||
    !clock(v.profile.recordedCreatedAt, v.readAt) || !clock(v.profile.authCreatedAt, v.readAt) || v.profile.authCreatedAt.qualification !== 'unknown' ||
    v.profile.source.revision === null && v.profile.recordedCreatedAt.qualification !== 'unknown' ||
    v.profile.authCreatedAt.reason !== 'auth_creation_not_read' || !Array.isArray(v.items) || v.items.length > 20 || !v.items.every(row => item(row, v.readAt as string)) ||
    !hash(v.pageHash) || noAuthorityKeys.some(key => v[key] !== (key === 'professionalClassification' ? null : key === 'activityAssessment' ? 'not_provided' : false))) throw failure();
  const rows = v.items as SellerActivityItem[], p = v.pagination, c = v.coverage;
  if (!object(p) || !exact(p, ['inspected', 'limit', 'hasMore', 'nextCursor']) || p.inspected !== rows.length || p.limit !== 20 || typeof p.hasMore !== 'boolean' ||
    p.hasMore !== (rows.length === 20) || (p.hasMore ? !cursor(p.nextCursor) || p.nextCursor.lastId !== rows.at(-1)?.transactionId ||
      p.nextCursor.scopeHash !== v.source.scopeHash : p.nextCursor !== null) || !object(c) ||
    !exact(c, ['source', 'order', 'chronologicalOrderVerified', 'exhaustiveHistoryVerified', 'accountingSnapshot', 'globalTotalsProvided', 'firstInspectedId', 'lastInspectedId', 'afterId']) ||
    c.source !== 'native_transactions_for_seller' || c.order !== 'document_id' || c.chronologicalOrderVerified !== false || c.exhaustiveHistoryVerified !== false ||
    c.accountingSnapshot !== false || c.globalTotalsProvided !== false || c.afterId !== (prior?.lastId ?? null) ||
    c.firstInspectedId !== (rows[0]?.transactionId ?? null) || c.lastInspectedId !== (rows.at(-1)?.transactionId ?? null)) throw failure();
  let previous = prior?.lastId ?? null;
  for (const row of rows) {
    if (previous !== null && !after(row.transactionId, previous)) throw failure();
    if (row.transactionId === transactionId && (row.qualification !== 'native_order' || row.source.revision !== v.source.orderRevision || row.source.sourceHash !== v.source.orderSourceHash)) throw failure();
    previous = row.transactionId;
  }
  return v as unknown as SellerActivityFactsPage;
}
async function authenticationTime(uid: string, assertContext: () => void) {
  const session = captureTradeSession(uid), currentUser = auth.currentUser;
  const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
  assertCurrent();
  if (!currentUser || currentUser.uid !== uid) throw failure();
  const token = await currentUser.getIdTokenResult(); assertCurrent();
  const time = token.claims.auth_time, now = Math.floor(Date.now() / 1000);
  if (auth.currentUser !== currentUser || token.claims.admin !== true || typeof time !== 'number' || !Number.isSafeInteger(time) || time <= 0 || time > now || now - time > 300)
    throw new Error('Confirmez à nouveau votre identité avant de relire ces faits privés.');
  return time * 1000;
}
export const SellerActivityFactsService = {
  authenticationTime,
  async read(uid: string, transactionId: string, expected: SellerActivitySource | null, next: SellerActivityCursor | null, assertContext: () => void) {
    if (!isSellerActivityTransactionId(transactionId) || expected !== null && (!source(expected) || expected.transactionId !== transactionId) ||
      next !== null && (!cursor(next) || !expected || next.scopeHash !== expected.scopeHash)) throw failure();
    const session = captureTradeSession(uid);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    await authenticationTime(uid, assertCurrent); assertCurrent();
    const result = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({mode: 'seller_activity_facts_observe',
      capability: 'seller_activity_facts_v1', expectedUid: session.uid, expectedAdminUid: session.uid, transactionId,
      ...(expected ? {expectedSource: expected} : {}), ...(next ? {cursor: next} : {})});
    assertCurrent(); return decodeSellerActivityFacts(result.data, session.uid, transactionId, expected, next);
  },
};
/** Shared closed native facts codec for the human-review preview. */
export {item as isSellerActivityItem, recordSource as isSellerActivityRecordSource, clock as isSellerActivityDateFact, after as sellerActivityDocumentAfter};
