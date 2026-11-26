import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { auth, functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { isSupportAccountSource } from '@/services/supportRequestService';
import { productReviewEqual, productReviewHash } from '@/services/productReviewService';
import { ACCOUNT_RELATIONSHIP_CAPABILITY, ACCOUNT_RELATIONSHIP_INVENTORY_CAPABILITY, RELATIONSHIP_PAIR_ACTIONS, RELATIONSHIP_ORDER_ACTIONS, RELATIONSHIP_ASSESSMENTS,
  RELATIONSHIP_FACT_QUALIFICATIONS, type RelationshipAttempt, type RelationshipCommand, type RelationshipContext,
  type RelationshipEntry, type RelationshipFact, type RelationshipOrder, type RelationshipPreview, type RelationshipReference,
  type RelationshipReceipt, type RelationshipScope, type RelationshipInventoryCursor, type RelationshipInventoryPage,
  type RelationshipInventoryRow } from '@/types/accountRelationshipReview';
import { ACCOUNT_RELATIONSHIP_INVENTORY_V2_CAPABILITY, RELATIONSHIP_PURCHASE_RETIREMENT_CAPABILITY, RELATIONSHIP_PURCHASE_STATUSES,
  type RelationshipInventoryV2Cursor, type RelationshipInventoryV2Page, type RelationshipInventoryV2Row,
  type RelationshipPurchaseAttempt, type RelationshipPurchaseCommand, type RelationshipPurchasePreview, type RelationshipPurchaseReceipt } from '@/types/accountRelationshipReview';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const relationshipId = (v: unknown): v is string => typeof v === 'string' && !!v && v.trim() === v && v.length <= 128 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const documentId = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v) && Array.from(v).reduce((n, c) => n + (c.codePointAt(0)! <= 0x7f ? 1 : c.codePointAt(0)! <= 0x7ff ? 2 : c.codePointAt(0)! <= 0xffff ? 3 : 4), 0) <= 1500;
export function compareRelationshipIds(a: string, b: string) {const x = Array.from(a), y = Array.from(b); for (let i = 0; i < Math.min(x.length, y.length); i++) {const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!; if (d) return d;} return x.length - y.length;}
const native = (v: unknown, prefix: string) => typeof v === 'string' && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown, max = 4000): v is string => typeof v === 'string' && !!v && v.trim() === v && v.length <= max;
const nullableText = (v: unknown, max = 4000) => v === null || text(v, max);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const revision = (v: unknown) => v === null || typeof v === 'string' && /^\d+:\d+$/.test(v) && (() => {const [s, n] = v.split(':').map(Number); return Number.isSafeInteger(s) && s >= 0 && s <= 253402300799 && Number.isSafeInteger(n) && n >= 0 && n < 1e9;})();
const effects = ['commonIdentityVerified', 'fraudEstablished', 'refundAuthorized', 'globalBanAuthorized', 'inventoryPermissionGranted', 'fundsRecovered'];
const limited = (v: Record<string, unknown>) => effects.every(k => v[k] === false);
export const relationshipFailure = () => new Error('Le dossier et les sources de cet examen doivent être relus. Aucun lien ne confirme une identité commune, une fraude ou un paiement.');
export function isRelationshipOrder(v: unknown): v is RelationshipOrder {
  return object(v) && exact(v, ['kind', 'id']) && ['purchase', 'swap'].includes(String(v.kind)) && relationshipId(v.id);
}
export function isRelationshipContext(v: unknown): v is RelationshipContext {
  return object(v) && exact(v, ['supportRequestId', 'orders']) && relationshipId(v.supportRequestId) && Array.isArray(v.orders) && v.orders.length >= 1 && v.orders.length <= 10 && v.orders.every(isRelationshipOrder) && new Set(v.orders.map(o => JSON.stringify([o.kind, o.id]))).size === v.orders.length;
}
export function isRelationshipReference(v: unknown): v is RelationshipReference {
  return object(v) && exact(v, ['pairId', 'id', 'contentHash', 'version']) && native(v.pairId, 'arp') && native(v.id, 'ar') && hash(v.contentHash) && count(v.version) && v.version > 0;
}
function facts(v: unknown): v is RelationshipFact[] {
  return Array.isArray(v) && v.length <= 10 && v.every(f => object(f) && exact(f, ['qualification', 'text']) && (RELATIONSHIP_FACT_QUALIFICATIONS as readonly unknown[]).includes(f.qualification) && text(f.text, 1000));
}
function messages(v: unknown): v is RelationshipCommand['partyMessages'] {
  return Array.isArray(v) && v.length <= 2 && v.every(m => object(m) && exact(m, ['userId', 'message']) && relationshipId(m.userId) && text(m.message, 2000)) && new Set(v.map(m => m.userId)).size === v.length;
}
export function isRelationshipCommand(v: unknown): v is RelationshipCommand {
  if (!object(v) || !exact(v, ['context', 'source', 'scope', 'action', 'pairAction', 'orderAction', 'assessment', 'facts', 'privateReason', 'statement', 'reconsiderWhen', 'partyMessages', 'decisionReference', 'acknowledged']) || !isRelationshipContext(v.context) || !object(v.source) || !exact(v.source, ['sourceHash', 'pairId', 'version']) || !hash(v.source.sourceHash) || !native(v.source.pairId, 'arp') || !count(v.source.version) || !['own', 'admin'].includes(String(v.scope)) || v.action !== (v.scope === 'own' ? 'contest' : 'record_review') || v.acknowledged !== true || !(RELATIONSHIP_PAIR_ACTIONS as readonly unknown[]).includes(v.pairAction) || !(RELATIONSHIP_ORDER_ACTIONS as readonly unknown[]).includes(v.orderAction) || !(RELATIONSHIP_ASSESSMENTS as readonly unknown[]).includes(v.assessment) || !facts(v.facts) || !messages(v.partyMessages)) return false;
  return v.scope === 'own' ? v.pairAction === 'retain_current' && v.orderAction === 'retain_current' && v.assessment === 'unresolved' && text(v.statement) && v.privateReason === null && v.reconsiderWhen === null && !v.facts.length && !v.partyMessages.length && isRelationshipReference(v.decisionReference) && v.decisionReference.pairId === v.source.pairId : text(v.privateReason) && text(v.reconsiderWhen, 2000) && v.statement === null && v.decisionReference === null && v.partyMessages.length === 2;
}
export function isRelationshipAttempt(v: unknown, uid: string, scope: RelationshipScope): v is RelationshipAttempt {
  return object(v) && exact(v, ['version', 'uid', 'requestId', 'capability', 'command']) && v.version === 1 && v.uid === uid && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && v.capability === ACCOUNT_RELATIONSHIP_CAPABILITY && isRelationshipCommand(v.command) && v.command.scope === scope;
}
function entry(v: unknown, scope: RelationshipScope, pairId: string): v is RelationshipEntry {
  if (!object(v) || !exact(v, ['reference', 'context', 'action', 'assessment', 'pairAction', 'orderAction', 'statement', 'privateReason', 'facts', 'reconsiderWhen', 'message', 'partyMessages', 'relatedDecision', 'orders', 'recordedAt', 'historicalOnly', ...effects]) || !isRelationshipReference(v.reference) || v.reference.pairId !== pairId || !isRelationshipContext(v.context) || !['record_review', 'contest'].includes(String(v.action)) || !(RELATIONSHIP_PAIR_ACTIONS as readonly unknown[]).includes(v.pairAction) || !(RELATIONSHIP_ORDER_ACTIONS as readonly unknown[]).includes(v.orderAction) || !(RELATIONSHIP_ASSESSMENTS as readonly unknown[]).includes(v.assessment) || !nullableText(v.statement) || !nullableText(v.message, 2000) || !(v.relatedDecision === null || isRelationshipReference(v.relatedDecision) && v.relatedDecision.pairId === pairId) || !iso(v.recordedAt) || v.historicalOnly !== true || !limited(v)) return false;
  if (scope === 'own') return v.privateReason === null && v.facts === null && v.reconsiderWhen === null && v.orders === null && v.partyMessages === null;
  return nullableText(v.privateReason) && nullableText(v.reconsiderWhen, 2000) && facts(v.facts) && messages(v.partyMessages) && Array.isArray(v.orders) && productReviewEqual(v.orders, v.context.orders) && (v.action === 'record_review' ? text(v.privateReason) && text(v.reconsiderWhen, 2000) && v.partyMessages.length === 2 : v.privateReason === null && v.reconsiderWhen === null && !v.partyMessages.length);
}
function restriction(v: unknown, pairId: string, order = false): boolean {
  return object(v) && exact(v, ['blocked', 'reference', ...(order ? ['order'] : [])]) && typeof v.blocked === 'boolean' && isRelationshipReference(v.reference) && v.reference.pairId === pairId && (!order || isRelationshipOrder(v.order));
}
function legacyPayments(v: unknown, context: RelationshipContext): v is RelationshipPreview['legacyPaymentReview'] {
  if (!object(v) || !exact(v, ['orders', 'coverage']) || !Array.isArray(v.orders) || v.orders.length > 10 || !object(v.coverage) || !exact(v.coverage, ['selectedSwapCount', 'selectedOnly', 'exhaustivePairSwapHistoryVerified']) || v.coverage.selectedSwapCount !== v.orders.length || v.coverage.selectedOnly !== true || v.coverage.exhaustivePairSwapHistoryVerified !== false) return false;
  return v.orders.every(r => object(r) && exact(r, ['order', 'state', 'externalConfirmationPrevented', 'providerObservedAt']) && isRelationshipOrder(r.order) && r.order.kind === 'swap' && context.orders.some(o => o.kind === 'swap' && o.id === (r.order as RelationshipOrder).id) && ['native_manual_protocol_recorded', 'neutralization_observed', 'legacy_exposure_requires_review', 'unknown'].includes(String(r.state)) && typeof r.externalConfirmationPrevented === 'boolean' && (r.providerObservedAt === null || iso(r.providerObservedAt)) && (!r.externalConfirmationPrevented || ['native_manual_protocol_recorded', 'neutralization_observed'].includes(String(r.state)))) && new Set(v.orders.map(r => JSON.stringify(r.order))).size === v.orders.length;
}
function preview(v: unknown, uid: string, scope: RelationshipScope, context: RelationshipContext | null, selected: RelationshipReference | null, operation: 'preview' | 'history'): v is RelationshipPreview {
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'context', 'source', 'ticket', 'accounts', 'orders', 'ownScopes', 'legacyPaymentReview', 'canRecordReview', 'canContest', 'selectedDecision', 'entries', 'nextCursor', 'coverage', 'statement', ...(scope === 'admin' ? ['pairRestriction', 'orderReviews'] : []), ...effects]) || v.protocol !== 'account_relationship_preview_v1' || v.actorId !== uid || v.scope !== scope || !isRelationshipContext(v.context) || !legacyPayments(v.legacyPaymentReview, v.context) || context !== null && !productReviewEqual(context, v.context) || !object(v.source) || !exact(v.source, ['sourceHash', 'pairId', 'version', 'qualification']) || !native(v.source.pairId, 'arp') || !(v.source.sourceHash === null || hash(v.source.sourceHash)) || !(v.source.version === null || count(v.source.version)) || !['native_current', 'unknown'].includes(String(v.source.qualification)) || v.source.qualification === 'native_current' && (!hash(v.source.sourceHash) || !count(v.source.version)) || !limited(v) || !text(v.statement) || !['canRecordReview', 'canContest'].every(k => typeof v[k] === 'boolean') || scope === 'own' && v.canRecordReview !== false || scope === 'admin' && v.canContest !== false) return false;
  const pid = v.source.pairId as string, nativeContext = v.context;
  if (!(v.selectedDecision === null || entry(v.selectedDecision, scope, pid)) || (selected === null ? v.selectedDecision !== null : !v.selectedDecision || !productReviewEqual(v.selectedDecision.reference, selected) || !productReviewEqual(v.selectedDecision.context, nativeContext)) || !Array.isArray(v.orders) || v.orders.length > 10 || !v.orders.every(o => object(o) && exact(o, ['kind', 'id', 'revision', 'sourceHash', 'originHash', 'originQualification']) && isRelationshipOrder({kind: o.kind, id: o.id}) && revision(o.revision) && hash(o.sourceHash) && (o.originHash === null || hash(o.originHash)) && ['native_agreement', 'native_proposal', 'unknown'].includes(String(o.originQualification)) && (o.originQualification === 'unknown' || hash(o.originHash))) || new Set(v.orders.map(o => JSON.stringify([o.kind, o.id]))).size !== v.orders.length || v.orders.some(o => !nativeContext.orders.some(c => c.kind === o.kind && c.id === o.id))) return false;
  const nativeOrders = v.orders as RelationshipPreview['orders'];
  if (v.legacyPaymentReview.orders.some(r => !nativeOrders.some(o => o.kind === 'swap' && o.id === r.order.id))) return false;
  if (scope === 'own') {
    if (v.ticket !== null || v.accounts !== null || !(v.ownScopes === null || object(v.ownScopes) && exact(v.ownScopes, ['newEngagements', 'orderReleaseReviews', 'currentPermissionsGranted']) && ['unknown', 'restricted_by_review', 'no_own_restriction'].includes(String(v.ownScopes.newEngagements)) && v.ownScopes.currentPermissionsGranted === false && Array.isArray(v.ownScopes.orderReleaseReviews) && v.ownScopes.orderReleaseReviews.length === nativeOrders.length && v.ownScopes.orderReleaseReviews.every((r, i) => object(r) && exact(r, ['order', 'state']) && isRelationshipOrder(r.order) && productReviewEqual(r.order, {kind: nativeOrders[i].kind, id: nativeOrders[i].id}) && ['unknown', 'retained_for_review', 'no_own_review'].includes(String(r.state))))) return false;
  } else if (v.ownScopes !== null || !(v.ticket === null || object(v.ticket) && exact(v.ticket, ['id', 'version', 'receivedAt', 'narrative']) && v.ticket.id === v.context.supportRequestId && count(v.ticket.version) && v.ticket.version > 0 && iso(v.ticket.receivedAt) && text(v.ticket.narrative)) || !(v.accounts === null || Array.isArray(v.accounts) && v.accounts.length === 2 && v.accounts.every(isSupportAccountSource) && new Set(v.accounts.map(a => a.declaredAccountId)).size === 2) || !(v.pairRestriction === null || restriction(v.pairRestriction, pid)) || !object(v.orderReviews) || Object.keys(v.orderReviews).length > 100 || !Object.entries(v.orderReviews).every(([k, r]) => hash(k) && restriction(r, pid, true))) return false;
  if (v.canRecordReview && (v.source.qualification !== 'native_current' || !v.ticket || !v.accounts || v.orders.length !== v.context.orders.length) || v.canContest && (scope !== 'own' || !v.selectedDecision)) return false;
  if (!Array.isArray(v.entries) || v.entries.length > 20 || !v.entries.every(r => object(r) && (r.qualification === 'native_relationship_entry' ? exact(r, ['qualification', 'entry']) && entry(r.entry, scope, pid) : r.qualification === 'unknown' && exact(r, ['qualification', 'entryId', 'entry']) && documentId(r.entryId) && r.entry === null)) || !(v.nextCursor === null || object(v.nextCursor) && exact(v.nextCursor, ['lastId']) && documentId(v.nextCursor.lastId))) return false;
  if (v.coverage === null) return operation === 'preview' && !v.entries.length && v.nextCursor === null;
  return object(v.coverage) && exact(v.coverage, ['inspected', 'limit', 'hasMore', 'exhaustiveHistoryVerified']) && count(v.coverage.inspected) && v.coverage.inspected <= 20 && v.coverage.inspected >= v.entries.length && v.coverage.limit === 20 && v.coverage.exhaustiveHistoryVerified === false && (v.coverage.hasMore === (v.nextCursor !== null) || v.coverage.hasMore === null && v.source.sourceHash === null && !v.entries.length && v.nextCursor === null);
}
function inventoryCursor(v: unknown): v is RelationshipInventoryCursor {
  return object(v) && exact(v, ['direction', 'lastId', 'sourceHash']) && ['first_to_second', 'second_to_first'].includes(String(v.direction)) && hash(v.sourceHash) && (documentId(v.lastId) || v.lastId === null && v.direction === 'second_to_first');
}
function inventoryRow(v: unknown, selected: RelationshipReference, direction: RelationshipInventoryCursor['direction']): v is RelationshipInventoryRow {
  if (!object(v) || !exact(v, ['swapId', 'source', 'direction', 'createdAt', 'acceptedAt', 'status', 'topUp', 'payment', 'selectedInDecision', 'newNativeReviewRequired', 'checkoutReference', 'coverage', 'paymentPermissionGranted', 'externalExposureExhaustivelyResolved']) || !documentId(v.swapId) || v.direction !== direction || !object(v.source) || !exact(v.source, ['revision', 'sourceHash', 'originQualification', 'originHash']) || !revision(v.source.revision) || !hash(v.source.sourceHash) || !['native_agreement', 'native_proposal', 'unknown'].includes(String(v.source.originQualification)) || !(v.source.originHash === null || hash(v.source.originHash)) || (v.source.originQualification === 'unknown' ? v.source.originHash !== null : !hash(v.source.originHash)) || !(v.createdAt === null || iso(v.createdAt)) || !(v.acceptedAt === null || iso(v.acceptedAt)) || !['proposed', 'payment_pending', 'accepted', 'photos_pending', 'shipping', 'completed', 'cancelled', 'declined', 'expired', 'disputed', 'unknown'].includes(String(v.status)) || typeof v.selectedInDecision !== 'boolean' || typeof v.newNativeReviewRequired !== 'boolean' || !v.selectedInDecision && !v.newNativeReviewRequired || v.coverage !== 'native_pair_row_only' || v.paymentPermissionGranted !== false || v.externalExposureExhaustivelyResolved !== false) return false;
  if (!object(v.topUp) || !exact(v.topUp, ['qualification', 'baseCents', 'payerRole', 'paymentReferenceQualification']) || !['native_reference_present', 'reference_absent_outcome_unknown', 'malformed_reference_unknown'].includes(String(v.topUp.paymentReferenceQualification)) || (v.topUp.qualification === 'native_declared' ? !count(v.topUp.baseCents) || !v.topUp.baseCents || !['first_party', 'second_party'].includes(String(v.topUp.payerRole)) : v.topUp.qualification !== 'unknown' || v.topUp.baseCents !== null || v.topUp.payerRole !== null)) return false;
  const p = v.payment;
  if (!object(p) || !exact(p, ['order', 'state', 'externalConfirmationPrevented', 'providerObservedAt', 'providerStatus', 'currentProviderStateVerified']) || !object(p.order) || !exact(p.order, ['kind', 'id']) || p.order.kind !== 'swap' || p.order.id !== v.swapId || !['native_manual_protocol_recorded', 'neutralization_observed', 'legacy_exposure_requires_review', 'unknown'].includes(String(p.state)) || p.externalConfirmationPrevented !== ['native_manual_protocol_recorded', 'neutralization_observed'].includes(String(p.state)) || !(p.providerObservedAt === null || iso(p.providerObservedAt)) || !['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'succeeded', 'requires_capture', 'canceled', 'unknown'].includes(String(p.providerStatus)) || p.currentProviderStateVerified !== false || (p.state === 'neutralization_observed' ? p.providerStatus !== 'canceled' : p.state !== 'native_manual_protocol_recorded' && p.providerStatus !== 'unknown')) return false;
  return v.checkoutReference === null || object(v.checkoutReference) && exact(v.checkoutReference, ['swapId', 'relationshipReference']) && relationshipId(v.checkoutReference.swapId) && v.checkoutReference.swapId === v.swapId && isRelationshipReference(v.checkoutReference.relationshipReference) && productReviewEqual(v.checkoutReference.relationshipReference, selected);
}
function inventoryPage(v: unknown, uid: string, selected: RelationshipReference, expectedSource: {sourceHash: string} | null, cursor: RelationshipInventoryCursor | null): v is RelationshipInventoryPage {
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'decisionReference', 'source', 'readAt', 'rows', 'nextCursor', 'coverage', 'selectedDecisionChangesRequiredForOtherSwaps', 'currentPermissionsGranted', ...effects]) || v.protocol !== ACCOUNT_RELATIONSHIP_INVENTORY_CAPABILITY || v.actorId !== uid || v.scope !== 'admin' || !isRelationshipReference(v.decisionReference) || !productReviewEqual(v.decisionReference, selected) || !object(v.source) || !exact(v.source, ['sourceHash', 'pairRevision', 'pairVersion', 'qualification']) || !hash(v.source.sourceHash) || expectedSource !== null && v.source.sourceHash !== expectedSource.sourceHash || !revision(v.source.pairRevision) || !(v.source.pairVersion === null || count(v.source.pairVersion)) || !['native_pair_current', 'historical_pair_current_unknown'].includes(String(v.source.qualification)) || (v.source.qualification === 'native_pair_current' ? !count(v.source.pairVersion) : v.source.pairVersion !== null) || !iso(v.readAt) || !limited(v) || v.selectedDecisionChangesRequiredForOtherSwaps !== true || v.currentPermissionsGranted !== false) return false;
  const direction = cursor?.direction ?? 'first_to_second';
  if (!Array.isArray(v.rows) || v.rows.length > 20 || !v.rows.every(row => inventoryRow(row, selected, direction)) || !object(v.coverage) || !exact(v.coverage, ['direction', 'inspected', 'limit', 'hasMoreInDirection', 'directionTailReached', 'resumedAfterId', 'snapshotConsistencyVerified', 'exhaustivePairSwapHistoryVerified', 'missingHistoricalPartyFields', 'orphanProviderIntents', 'providerQueriesPerformed']) || v.coverage.direction !== direction || !count(v.coverage.inspected) || v.coverage.inspected > 20 || v.coverage.inspected < v.rows.length || v.coverage.limit !== 20 || typeof v.coverage.hasMoreInDirection !== 'boolean' || v.coverage.directionTailReached !== !v.coverage.hasMoreInDirection || v.coverage.resumedAfterId !== (cursor?.lastId ?? null) || v.coverage.snapshotConsistencyVerified !== false || v.coverage.exhaustivePairSwapHistoryVerified !== false || v.coverage.missingHistoricalPartyFields !== 'unknown' || v.coverage.orphanProviderIntents !== 'unknown' || v.coverage.providerQueriesPerformed !== false) return false;
  const rows = v.rows as RelationshipInventoryRow[];
  if (rows.some((row, i) => i > 0 && compareRelationshipIds(row.swapId, rows[i - 1].swapId) <= 0 || cursor?.lastId && compareRelationshipIds(row.swapId, cursor.lastId) <= 0)) return false;
  if (v.coverage.hasMoreInDirection) {
    const next = v.nextCursor;
    if (v.coverage.inspected !== 20 || !inventoryCursor(next) || next.direction !== direction || next.sourceHash !== v.source.sourceHash || !documentId(next.lastId) || cursor?.lastId && compareRelationshipIds(next.lastId, cursor.lastId) <= 0) return false;
    const lastId = next.lastId; return rows.every(row => compareRelationshipIds(row.swapId, lastId) <= 0);
  }
  return direction === 'second_to_first' ? v.nextCursor === null : inventoryCursor(v.nextCursor) && v.nextCursor.direction === 'second_to_first' && v.nextCursor.lastId === null && v.nextCursor.sourceHash === v.source.sourceHash;
}
export function isRelationshipInventorySourceChanged(error: unknown) {
  return object(error) && object(error.details) && error.details.reason === 'account_relationship_inventory_source_changed';
}
function inventoryV2Cursor(v: unknown): v is RelationshipInventoryV2Cursor {
  return object(v) && exact(v, ['kind', 'direction', 'lastId', 'sourceHash']) && ['purchase', 'swap'].includes(String(v.kind)) &&
    ['first_to_second', 'second_to_first'].includes(String(v.direction)) && hash(v.sourceHash) && (v.lastId === null || documentId(v.lastId));
}
function inventoryV2Row(v: unknown, selected: RelationshipReference, kind: RelationshipOrder['kind'], direction: RelationshipInventoryCursor['direction']): v is RelationshipInventoryV2Row {
  if (!object(v) || v.kind !== kind || !documentId(v.id)) return false;
  if (kind === 'swap') {
    const {kind: _kind, id, ...legacy} = v; return id === legacy.swapId && inventoryRow(legacy, selected, direction);
  }
  if (!exact(v, ['kind', 'id', 'source', 'direction', 'createdAt', 'status', 'payment', 'purchase', 'selectedInDecision', 'newNativeReviewRequired', 'checkoutReference', 'coverage', 'paymentPermissionGranted', 'externalExposureExhaustivelyResolved']) || v.direction !== direction ||
      !object(v.source) || !exact(v.source, ['revision', 'sourceHash', 'originQualification', 'originHash']) || !revision(v.source.revision) || !hash(v.source.sourceHash) ||
      !['native_agreement', 'native_proposal', 'unknown'].includes(String(v.source.originQualification)) ||
      (v.source.originQualification === 'unknown' ? v.source.originHash !== null : !hash(v.source.originHash)) || !(v.createdAt === null || iso(v.createdAt)) ||
      !(RELATIONSHIP_PURCHASE_STATUSES as readonly unknown[]).includes(v.status) || typeof v.selectedInDecision !== 'boolean' || typeof v.newNativeReviewRequired !== 'boolean' ||
      !v.selectedInDecision && !v.newNativeReviewRequired || v.coverage !== 'native_pair_row_only' || v.paymentPermissionGranted !== false || v.externalExposureExhaustivelyResolved !== false) return false;
  const p = v.payment, purchase = v.purchase;
  if (!object(p) || !exact(p, ['state', 'externalConfirmationPrevented', 'providerStatus', 'currentProviderStateVerified']) ||
      !['native_manual_protocol_recorded', 'neutralization_observed', 'legacy_exposure_requires_review', 'unknown'].includes(String(p.state)) ||
      typeof p.externalConfirmationPrevented !== 'boolean' || p.externalConfirmationPrevented && !['native_manual_protocol_recorded', 'neutralization_observed'].includes(String(p.state)) ||
      p.currentProviderStateVerified !== false || p.providerStatus !== (p.state === 'neutralization_observed' ? 'canceled' : 'unknown') ||
      !object(purchase) || !exact(purchase, ['paymentReferenceQualification', 'totalCents', 'walletCents', 'currency']) ||
      !['native_reference_present', 'reference_absent_outcome_unknown', 'malformed_reference_unknown'].includes(String(purchase.paymentReferenceQualification)) ||
      !(purchase.totalCents === null || count(purchase.totalCents)) || !(purchase.walletCents === null || count(purchase.walletCents)) ||
      !(purchase.currency === null || purchase.currency === 'CAD') || typeof purchase.totalCents === 'number' && typeof purchase.walletCents === 'number' && purchase.walletCents > purchase.totalCents) return false;
  return v.checkoutReference === null || object(v.checkoutReference) && exact(v.checkoutReference, ['transactionId', 'relationshipReference']) &&
    v.checkoutReference.transactionId === v.id && isRelationshipReference(v.checkoutReference.relationshipReference) && productReviewEqual(v.checkoutReference.relationshipReference, selected);
}
function inventoryV2Page(v: unknown, uid: string, selected: RelationshipReference, expectedSource: {sourceHash: string} | null, cursor: RelationshipInventoryV2Cursor | null): v is RelationshipInventoryV2Page {
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'decisionReference', 'source', 'readAt', 'rows', 'nextCursor', 'coverage', 'selectedDecisionChangesRequiredForOtherOrders', 'currentPermissionsGranted', ...effects]) ||
      v.protocol !== ACCOUNT_RELATIONSHIP_INVENTORY_V2_CAPABILITY || v.actorId !== uid || v.scope !== 'admin' || !isRelationshipReference(v.decisionReference) || !productReviewEqual(v.decisionReference, selected) ||
      !object(v.source) || !exact(v.source, ['sourceHash', 'pairRevision', 'pairVersion', 'qualification']) || !hash(v.source.sourceHash) || expectedSource !== null && v.source.sourceHash !== expectedSource.sourceHash ||
      !revision(v.source.pairRevision) || !(v.source.pairVersion === null || count(v.source.pairVersion)) ||
      !['native_pair_current', 'historical_pair_current_unknown'].includes(String(v.source.qualification)) || (v.source.qualification === 'native_pair_current' ? !count(v.source.pairVersion) : v.source.pairVersion !== null) ||
      !iso(v.readAt) || !limited(v) || v.selectedDecisionChangesRequiredForOtherOrders !== true || v.currentPermissionsGranted !== false) return false;
  const kind = cursor?.kind ?? 'purchase', direction = cursor?.direction ?? 'first_to_second', c = v.coverage;
  if (!Array.isArray(v.rows) || v.rows.length > 20 || !v.rows.every(row => inventoryV2Row(row, selected, kind, direction)) || !object(c) ||
      !exact(c, ['kind', 'direction', 'inspected', 'limit', 'hasMoreInDirection', 'directionTailReached', 'resumedAfterId', 'snapshotConsistencyVerified', 'exhaustivePairSwapHistoryVerified', 'exhaustivePairPurchaseHistoryVerified', 'missingHistoricalPartyFields', 'orphanProviderIntents', 'providerQueriesPerformed']) ||
      c.kind !== kind || c.direction !== direction || !count(c.inspected) || c.inspected > 20 || c.inspected < v.rows.length || c.limit !== 20 || typeof c.hasMoreInDirection !== 'boolean' ||
      c.directionTailReached !== !c.hasMoreInDirection || c.resumedAfterId !== (cursor?.lastId ?? null) || c.snapshotConsistencyVerified !== false ||
      c.exhaustivePairSwapHistoryVerified !== false || c.exhaustivePairPurchaseHistoryVerified !== false || c.missingHistoricalPartyFields !== 'unknown' || c.orphanProviderIntents !== 'unknown' || c.providerQueriesPerformed !== false) return false;
  const rows = v.rows as RelationshipInventoryV2Row[];
  if (rows.some((row, i) => i > 0 && compareRelationshipIds(row.id, rows[i - 1].id) <= 0 || cursor?.lastId && compareRelationshipIds(row.id, cursor.lastId) <= 0)) return false;
  if (c.hasMoreInDirection) return c.inspected === 20 && inventoryV2Cursor(v.nextCursor) && v.nextCursor.kind === kind && v.nextCursor.direction === direction &&
    v.nextCursor.sourceHash === v.source.sourceHash && documentId(v.nextCursor.lastId) && (!cursor?.lastId || compareRelationshipIds(v.nextCursor.lastId, cursor.lastId) > 0) && rows.every(row => compareRelationshipIds(row.id, (v.nextCursor as RelationshipInventoryV2Cursor).lastId!) <= 0);
  const nextKind = direction === 'first_to_second' ? kind : 'swap', nextDirection = direction === 'first_to_second' ? 'second_to_first' : 'first_to_second';
  return kind === 'swap' && direction === 'second_to_first' ? v.nextCursor === null : inventoryV2Cursor(v.nextCursor) && v.nextCursor.kind === nextKind &&
    v.nextCursor.direction === nextDirection && v.nextCursor.lastId === null && v.nextCursor.sourceHash === v.source.sourceHash;
}
export function isRelationshipPurchaseCommand(v: unknown): v is RelationshipPurchaseCommand {
  return object(v) && exact(v, ['transactionId', 'scope', 'sourceHash', 'paymentIntentId', 'totalCents', 'walletCents', 'relationshipReference', 'acknowledged']) &&
    relationshipId(v.transactionId) && v.scope === 'admin' && hash(v.sourceHash) && typeof v.paymentIntentId === 'string' && /^pi_[A-Za-z0-9]+$/.test(v.paymentIntentId) &&
    count(v.totalCents) && v.totalCents > 0 && count(v.walletCents) && v.walletCents < v.totalCents && isRelationshipReference(v.relationshipReference) && v.acknowledged === true;
}
export function isRelationshipPurchaseAttempt(v: unknown, uid: string): v is RelationshipPurchaseAttempt {
  return object(v) && exact(v, ['version', 'uid', 'requestId', 'capability', 'command']) && v.version === 1 && v.uid === uid &&
    typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && v.capability === RELATIONSHIP_PURCHASE_RETIREMENT_CAPABILITY && isRelationshipPurchaseCommand(v.command);
}
const providerState = {requires_payment_method: 'unconfirmed', requires_confirmation: 'confirmation', requires_action: 'action', processing: 'processing', succeeded: 'succeeded', requires_capture: 'authorized', canceled: 'canceled'} as const;
function purchasePreview(v: unknown, uid: string, transactionId: string, reference: RelationshipReference): v is RelationshipPurchasePreview {
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'transactionId', 'relationshipReference', 'sourceHash', 'buyerId', 'sellerId', 'amounts', 'provider', 'wallet', 'canNeutralize', 'reason', 'commandTemplate', 'paymentPermissionGranted', 'preAuthorizationFenceSupported']) || v.preAuthorizationFenceSupported !== true ||
      v.protocol !== 'relationship_purchase_legacy_preview_v1' || v.actorId !== uid || v.transactionId !== transactionId || !productReviewEqual(v.relationshipReference, reference) || !hash(v.sourceHash) ||
      !relationshipId(v.buyerId) || !relationshipId(v.sellerId) || v.buyerId === v.sellerId || v.paymentPermissionGranted !== false || typeof v.canNeutralize !== 'boolean' || !nullableText(v.reason)) return false;
  const a = v.amounts, p = v.provider, w = v.wallet;
  if (!object(a) || !exact(a, ['totalCents', 'walletCents', 'cardCents', 'currency']) || !count(a.totalCents) || !count(a.walletCents) || !count(a.cardCents) || a.walletCents + a.cardCents !== a.totalCents || a.currency !== 'CAD' ||
      !object(p) || !exact(p, ['status', 'confirmationMethod', 'state', 'captureMethod', 'observedAt']) || !Object.hasOwn(providerState, String(p.status)) || p.state !== providerState[p.status as keyof typeof providerState] ||
      !['automatic', 'manual'].includes(String(p.confirmationMethod)) || !['automatic', 'automatic_async', 'manual', 'unknown'].includes(String(p.captureMethod)) || !iso(p.observedAt) ||
      !object(w) || !exact(w, ['qualification', 'obligationOpen']) || !['none', 'native_debit', 'unknown'].includes(String(w.qualification)) ||
      w.obligationOpen !== (a.walletCents > 0) || w.qualification === 'none' && a.walletCents !== 0 || w.qualification === 'native_debit' && a.walletCents === 0) return false;
  return v.commandTemplate === null ? v.canNeutralize === false : v.canNeutralize === true && isRelationshipPurchaseCommand(v.commandTemplate) &&
    v.commandTemplate.transactionId === transactionId && v.commandTemplate.sourceHash === v.sourceHash && v.commandTemplate.totalCents === a.totalCents && v.commandTemplate.walletCents === a.walletCents && productReviewEqual(v.commandTemplate.relationshipReference, reference);
}
async function purchaseReceipt(v: unknown, attempt: RelationshipPurchaseAttempt, guard: () => void): Promise<RelationshipPurchaseReceipt> {
  const payloadHash = await productReviewHash(attempt.command); guard();
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'command', 'payloadHash', 'state', 'reason', 'result', 'recordedAt', 'paymentPermissionGranted', 'preAuthorizationFenceSupported']) || v.preAuthorizationFenceSupported !== true ||
      v.protocol !== 'relationship_purchase_retirement_command_v1' || v.actorId !== attempt.uid || v.requestId !== attempt.requestId || !productReviewEqual(v.command, attempt.command) ||
      v.payloadHash !== payloadHash || !['unrecorded', 'authorized', 'unknown', 'received', 'not_executed'].includes(String(v.state)) || !nullableText(v.reason) || v.paymentPermissionGranted !== false) throw relationshipFailure();
  if (v.state === 'unrecorded' ? v.recordedAt !== null || v.reason !== null || v.result !== null : !iso(v.recordedAt)) throw relationshipFailure();
  if (v.state === 'received') {
    const r = v.result;
    if (!object(r) || !exact(r, ['transactionId', 'providerStatus', 'cardCapabilityNeutralized', 'walletObligationOpen', 'walletCents', 'totalCents', 'paymentPermissionGranted', 'orderChanged', 'stockChanged', 'fundsMoved', 'providerObservedAt']) ||
        r.transactionId !== attempt.command.transactionId || r.providerStatus !== 'canceled' || r.cardCapabilityNeutralized !== true || r.walletObligationOpen !== (attempt.command.walletCents > 0) ||
        r.walletCents !== attempt.command.walletCents || r.totalCents !== attempt.command.totalCents || !iso(r.providerObservedAt) ||
        ['paymentPermissionGranted', 'orderChanged', 'stockChanged', 'fundsMoved'].some(key => r[key] !== false)) throw relationshipFailure();
  } else if (v.result !== null) throw relationshipFailure();
  if (v.state === 'not_executed' ? v.reason !== 'requester_neutralized_before_authorization' : v.reason === 'requester_neutralized_before_authorization') throw relationshipFailure();
  return v as unknown as RelationshipPurchaseReceipt;
}
async function call(uid: string, endpoint: string, body: Record<string, unknown>, guard: () => void, privateRead = false): Promise<unknown> {
  const session = captureTradeSession(uid), assertCurrent = () => {assertTradeSessionCurrent(session); guard();};
  assertCurrent(); const user = auth.currentUser; if (!user || user.uid !== uid) throw relationshipFailure();
  if (privateRead) {
    const token = await user.getIdTokenResult(true); assertCurrent(); const now = Math.floor(Date.now() / 1000), time = token.claims.auth_time;
    if (auth.currentUser !== user || token.claims.admin !== true || typeof time !== 'number' || !Number.isSafeInteger(time) || time <= 0 || time > now || now - time > 300) throw new Error('Confirmez votre identité opérateur avant cette lecture privée.');
  } else {await user.getIdToken(); assertCurrent();}
  const result = await httpsCallable<unknown, unknown>(functions, endpoint)({capability: ACCOUNT_RELATIONSHIP_CAPABILITY, expectedUid: uid, ...body}); assertCurrent(); return result.data;
}
export const AccountRelationshipReviewService = {
  async inventoryV2(uid: string, selected: RelationshipReference, expectedSource: {sourceHash: string} | null, cursor: RelationshipInventoryV2Cursor | null, guard: () => void): Promise<RelationshipInventoryV2Page> {
    if (!isRelationshipReference(selected) || expectedSource !== null && (!exact(expectedSource, ['sourceHash']) || !hash(expectedSource.sourceHash)) || cursor !== null && (!inventoryV2Cursor(cursor) || expectedSource?.sourceHash !== cursor.sourceHash) || cursor === null && expectedSource !== null) throw relationshipFailure();
    const value = await call(uid, 'readSupportRequests', {inventoryCapability: ACCOUNT_RELATIONSHIP_INVENTORY_V2_CAPABILITY, operation: 'legacy_inventory', scope: 'admin', decisionReference: selected, expectedSource, cursor}, guard, true);
    if (!inventoryV2Page(value, uid, selected, expectedSource, cursor)) throw relationshipFailure(); guard(); return value;
  },
  async purchasePreview(uid: string, transactionId: string, reference: RelationshipReference, guard: () => void): Promise<RelationshipPurchasePreview> {
    if (!relationshipId(transactionId) || !isRelationshipReference(reference)) throw relationshipFailure();
    const value = await call(uid, 'readSupportRequests', {operation: 'purchase_legacy_preview', transactionId, relationshipReference: reference}, guard, true);
    if (!purchasePreview(value, uid, transactionId, reference)) throw relationshipFailure(); guard(); return value;
  },
  async purchaseObserve(attempt: RelationshipPurchaseAttempt, guard: () => void): Promise<RelationshipPurchaseReceipt> {
    if (!isRelationshipPurchaseAttempt(attempt, attempt.uid)) throw relationshipFailure();
    const value = await call(attempt.uid, 'readSupportRequests', {operation: 'purchase_legacy_observe', requestId: attempt.requestId, command: attempt.command}, guard);
    return purchaseReceipt(value, attempt, guard);
  },
  async purchaseRetire(attempt: RelationshipPurchaseAttempt, mode: 'execute' | 'neutralize', guard: () => void): Promise<RelationshipPurchaseReceipt> {
    if (!isRelationshipPurchaseAttempt(attempt, attempt.uid)) throw relationshipFailure();
    // The root transactionId is deliberately absent: older servers must refuse before their legacy mutation branch.
    if (!['execute', 'neutralize'].includes(mode)) throw relationshipFailure();
    const value = await call(attempt.uid, 'retireLegacyStripeCheckout', {capability: RELATIONSHIP_PURCHASE_RETIREMENT_CAPABILITY, mode, requestId: attempt.requestId, command: attempt.command}, guard, true);
    return purchaseReceipt(value, attempt, guard);
  },
  async inventory(uid: string, selected: RelationshipReference, expectedSource: {sourceHash: string} | null, cursor: RelationshipInventoryCursor | null, guard: () => void): Promise<RelationshipInventoryPage> {
    if (!isRelationshipReference(selected) || expectedSource !== null && (!exact(expectedSource, ['sourceHash']) || !hash(expectedSource.sourceHash)) || cursor !== null && (!inventoryCursor(cursor) || expectedSource?.sourceHash !== cursor.sourceHash) || cursor === null && expectedSource !== null) throw relationshipFailure();
    const value = await call(uid, 'readSupportRequests', {inventoryCapability: ACCOUNT_RELATIONSHIP_INVENTORY_CAPABILITY, operation: 'legacy_inventory', scope: 'admin', decisionReference: selected, expectedSource, cursor}, guard, true);
    if (!inventoryPage(value, uid, selected, expectedSource, cursor)) throw relationshipFailure();
    guard(); return value;
  },
  async read(uid: string, scope: RelationshipScope, context: RelationshipContext | null, selected: RelationshipReference | null, operation: 'preview' | 'history', cursor: {lastId: string} | null, guard: () => void): Promise<RelationshipPreview> {
    if (context !== null && !isRelationshipContext(context) || selected !== null && !isRelationshipReference(selected) || !context && !selected || cursor && (!documentId(cursor.lastId) || operation !== 'history')) throw relationshipFailure();
    const v = await call(uid, 'readSupportRequests', {operation, scope, ...(context ? {context} : {}), ...(selected ? {decisionReference: selected} : {}), ...(operation === 'history' ? {cursor} : {})}, guard, scope === 'admin');
    if (!preview(v, uid, scope, context, selected, operation)) throw relationshipFailure();
    const ids = v.entries.map(r => r.qualification === 'unknown' ? r.entryId : r.entry.reference.id);
    if (ids.some((id, i) => i > 0 && compareRelationshipIds(id, ids[i - 1]) <= 0 || !!cursor && compareRelationshipIds(id, cursor.lastId) <= 0) || v.nextCursor && (v.coverage?.inspected !== 20 || !!cursor && compareRelationshipIds(v.nextCursor.lastId, cursor.lastId) <= 0 || ids.some(id => compareRelationshipIds(id, v.nextCursor!.lastId) > 0))) throw relationshipFailure();
    if (scope === 'admin' && v.accounts && v.source.pairId !== `arp_${await productReviewHash(v.accounts.map(a => a.declaredAccountId).sort())}`) throw relationshipFailure();
    guard(); return v;
  },
  async command(attempt: RelationshipAttempt, mode: 'execute' | 'observe' | 'neutralize', guard: () => void): Promise<RelationshipReceipt> {
    if (!isRelationshipAttempt(attempt, attempt.uid, attempt.command.scope)) throw relationshipFailure();
    const payloadHash = await productReviewHash(attempt.command); guard();
    const expectedId = `ar_${await productReviewHash([attempt.uid, attempt.requestId])}`; guard();
    // Historical servicing deliberately uses SDK identity only; private authority is qualified after an unrecorded receipt.
    const v = await call(attempt.uid, attempt.command.scope === 'admin' ? 'administerSupportRequest' : 'commandSupportRequest', {requestId: attempt.requestId, mode, command: attempt.command}, guard);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'command', 'payloadHash', 'state', 'reason', 'reference', 'recordedAt', ...effects]) || v.protocol !== 'account_relationship_command_v1' || v.actorId !== attempt.uid || v.requestId !== attempt.requestId || !productReviewEqual(v.command, attempt.command) || v.payloadHash !== payloadHash || !limited(v) || !['unrecorded', 'committed', 'not_executed'].includes(String(v.state))) throw relationshipFailure();
    if (v.state === 'unrecorded' ? [v.reason, v.reference, v.recordedAt].some(x => x !== null) : !iso(v.recordedAt) || (v.state === 'committed' ? v.reason !== null || !isRelationshipReference(v.reference) || v.reference.id !== expectedId || v.reference.pairId !== attempt.command.source.pairId || v.reference.version !== attempt.command.source.version + 1 : !text(v.reason) || v.reference !== null)) throw relationshipFailure();
    guard(); return v as unknown as RelationshipReceipt;
  },
};

/** Presence selects this guarded branch even when the supplied reference is malformed. */
export function hasAccountRelationshipNotice(v: unknown) {
  return object(v) && ['accountRelationshipCapability', 'accountRelationshipPairId', 'accountRelationshipEntryId', 'accountRelationshipEntryHash', 'accountRelationshipVersion'].some(k => k in v);
}
export async function accountRelationshipNotificationContext(v: unknown, uid: string, guard: () => void) {
  if (!object(v) || v.ownerId !== uid || v.accountRelationshipCapability !== ACCOUNT_RELATIONSHIP_CAPABILITY || !relationshipId(v.supportRequestId) || typeof v.accountRelationshipVersion !== 'string' || !/^[1-9]\d*$/.test(v.accountRelationshipVersion)) throw relationshipFailure();
  const reference = {pairId: v.accountRelationshipPairId, id: v.accountRelationshipEntryId, contentHash: v.accountRelationshipEntryHash, version: Number(v.accountRelationshipVersion)};
  if (!isRelationshipReference(reference)) throw relationshipFailure();
  const source = await AccountRelationshipReviewService.read(uid, 'own', null, reference, 'preview', null, guard); guard();
  // The server proves command, immutable context and addressed operational receipts before returning any own projection.
  if (source.context.supportRequestId !== v.supportRequestId || !productReviewEqual(source.selectedDecision?.reference, reference)) throw relationshipFailure();
  return {supportRequestId: source.context.supportRequestId, reference};
}
