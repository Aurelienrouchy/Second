import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewDocumentId, productReviewEqual, productReviewHash } from '@/services/productReviewService';
import { isLabelLifecycleContext } from '@/services/labelLifecycleService';
import type { LabelLifecycleContext, LabelLifecycleScope, LabelLifecycleCursor, LabelLifecycleNotificationContext } from '@/types/labelLifecycle';
import type { LabelRouteAction, LabelRouteAddress, LabelOperationalRoute, LabelRouteCommand, LabelRouteAttempt, LabelRouteReceipt, LabelRouteEntry, LabelRoutePreview, LabelRouteHistory, LabelRouteNoticeReference, LabelParcelAmendmentCapability, LabelParcelObservation, LabelPreviousParcel } from '@/types/labelRouteAmendment';
export const LABEL_ROUTE_OWN_ACTIONS: readonly LabelRouteAction[] = ['request_route', 'accept_route', 'withdraw_route'];
const PARCEL_OWN_ACTIONS: readonly LabelRouteAction[] = ['request_route', 'request_parcel', 'accept_route', 'withdraw_route'];
export const LABEL_ROUTE_ADMIN_ACTIONS: readonly LabelRouteAction[] = ['request_details', 'refuse_route', 'propose_route'];
const EFFECTS = ['shippingPermissionGranted', 'additionalPartyChargeAuthorized', 'inventoryEffectAuthorized', 'interceptionAuthorized', 'carrierPossessionVerified', 'historicalAddressReconstructed'];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const none = (v: Record<string, unknown>) => EFFECTS.every(k => v[k] === false);
const text = (v: unknown, max = 4000): v is string => typeof v === 'string' && !!v && v === v.trim() && v.length <= max;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^lr_[a-f0-9]{64}$/.test(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const providerId = (v: unknown): v is string => typeof v === 'string' && /^se-[A-Za-z0-9-]+$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v && Date.parse(v) <= Date.now();
const revision = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}:\d{1,9}$/.test(v) && Number.isSafeInteger(Number(v.split(':')[0])) && Number(v.split(':')[0]) <= 253402300799 && Number(v.split(':')[1]) < 1_000_000_000;
const reference = (v: unknown) => object(v) && exact(v, ['id', 'contentHash']) && id(v.id) && hash(v.contentHash);
const handover = (v: unknown) => ['not_deposited_declared', 'deposited_declared', 'unknown'].includes(String(v));
const parcelCapability = (v: unknown): v is LabelParcelAmendmentCapability => v === 'label_parcel_amendment_v1';
export function isLabelPreviousParcel(v: unknown): v is LabelPreviousParcel {return object(v) && exact(v, ['qualification', 'sourceHash', 'labelId']) &&
  ['native_current_label_route', 'native_historical_route', 'unknown'].includes(String(v.qualification)) && (v.qualification === 'unknown' ? v.sourceHash === null && v.labelId === null : hash(v.sourceHash)) &&
  (v.qualification === 'native_current_label_route' ? providerId(v.labelId) : v.labelId === null);}
export function isLabelParcelObservation(v: unknown): v is LabelParcelObservation {
  if (!object(v) || !exact(v, ['protocol', 'previousParcel', 'weight', 'dimensions', 'observedAt', 'method']) || v.protocol !== 'label_parcel_measurement_statement_v1' || !isLabelPreviousParcel(v.previousParcel) ||
      !object(v.weight) || !exact(v.weight, ['value', 'unit']) || !object(v.dimensions) || !exact(v.dimensions, ['length', 'width', 'height', 'unit']) ||
      !['kilogram', 'gram', 'pound', 'ounce', 'unknown'].includes(String(v.weight.unit)) || !['centimeter', 'millimeter', 'inch', 'unknown'].includes(String(v.dimensions.unit)) ||
      !(v.observedAt === null || iso(v.observedAt)) || !(v.method === null || text(v.method, 1000))) return false;
  const nullablePositive = (n: unknown) => n === null || positive(n);
  return nullablePositive(v.weight.value) && (v.weight.unit !== 'unknown' || v.weight.value === null) && [v.dimensions.length, v.dimensions.width, v.dimensions.height].every(nullablePositive) &&
    (v.dimensions.unit !== 'unknown' || [v.dimensions.length, v.dimensions.width, v.dimensions.height].every(n => n === null));
}
export function isLabelRouteAddress(v: unknown): v is LabelRouteAddress {
  return object(v) && exact(v, ['name', 'street', 'city', 'province', 'postalCode', 'country', ...(Object.prototype.hasOwnProperty.call(v, 'line2') ? ['line2'] : [])]) && text(v.name, 100) && text(v.street, 200) && text(v.city, 100) && v.province === 'QC' && v.country === 'CA' && typeof v.postalCode === 'string' && /^[GHJ]\d[ABCEGHJKLMNPRSTVWXYZ]\d[ABCEGHJKLMNPRSTVWXYZ]\d$/.test(v.postalCode) && (!Object.prototype.hasOwnProperty.call(v, 'line2') || text(v.line2, 200));
}
export function isLabelOperationalRoute(v: unknown, leg: LabelLifecycleContext['leg']): v is LabelOperationalRoute {
  if (!object(v) || !exact(v, ['origin', 'destination', 'parcel', 'carrierId', 'carrierCode', 'serviceCode', 'outboundLabelId']) || !isLabelRouteAddress(v.origin) || !isLabelRouteAddress(v.destination) || !providerId(v.carrierId) || typeof v.carrierCode !== 'string' || !/^[-a-z0-9_]{1,100}$/.test(v.carrierCode) || typeof v.serviceCode !== 'string' || !/^[-A-Za-z0-9_]{1,100}$/.test(v.serviceCode) || (leg === 'return' ? !providerId(v.outboundLabelId) : v.outboundLabelId !== null)) return false;
  const p = v.parcel;
  return object(p) && exact(p, ['weight', 'dimensions']) && object(p.weight) && exact(p.weight, ['value', 'unit']) && positive(p.weight.value) && p.weight.unit === 'kilogram' && object(p.dimensions) && exact(p.dimensions, ['length', 'width', 'height', 'unit']) && ['length', 'width', 'height'].every(k => positive((p.dimensions as Record<string, unknown>)[k])) && p.dimensions.unit === 'centimeter';
}
function capturedRoute(v: unknown, leg: LabelLifecycleContext['leg']): boolean {
  if (!object(v) || !exact(v, ['shipFrom', 'shipTo', 'parcel', ...(Object.prototype.hasOwnProperty.call(v, 'isReturn') ? ['isReturn'] : []), ...(leg === 'return' ? ['externalShipmentId', 'carrierId', 'carrierCode', 'serviceCode', 'outboundLabelId'] : [])]) || (leg === 'return' ? v.isReturn !== true || !text(v.externalShipmentId, 200) || !providerId(v.carrierId) || !providerId(v.outboundLabelId) || !text(v.carrierCode, 100) || !text(v.serviceCode, 100) : Object.prototype.hasOwnProperty.call(v, 'isReturn') && v.isReturn !== false)) return false;
  const bounded = (s: unknown) => typeof s === 'string' && !!s.trim() && s.length <= 500;
  if (!['shipFrom', 'shipTo'].every(key => {const a = v[key]; return object(a) && exact(a, ['name', 'addressLine1', 'cityLocality', 'stateProvince', 'postalCode', 'countryCode', ...(Object.prototype.hasOwnProperty.call(a, 'addressLine2') ? ['addressLine2'] : [])]) && Object.values(a).every(bounded);})) return false;
  const p = v.parcel;
  return object(p) && exact(p, ['weight', 'dimensions']) && object(p.weight) && exact(p.weight, ['value', 'unit']) && positive(p.weight.value) && p.weight.unit === 'kilogram' && object(p.dimensions) && exact(p.dimensions, ['length', 'width', 'height', 'unit']) && ['length', 'width', 'height'].every(k => positive((p.dimensions as Record<string, unknown>)[k])) && p.dimensions.unit === 'centimeter';
}
export function isLabelRouteCommand(v: unknown, c: LabelLifecycleContext): v is LabelRouteCommand {
  const declared = object(v) && Object.prototype.hasOwnProperty.call(v, 'handoverDeclaration');
  const parcel = object(v) && parcelCapability(v.parcelAmendmentCapability);
  if (!object(v) || !exact(v, ['transactionId', 'leg', 'scope', 'sourceHash', 'sourceRevision', 'version', 'action', 'reason', 'endpoint', 'address', 'route', 'reference', 'acknowledged', ...(declared ? ['handoverDeclaration'] : []), ...(parcel ? ['parcelAmendmentCapability'] : []), ...(v.action === 'request_parcel' ? ['parcelObservation'] : [])]) || declared && (v.action !== 'accept_route' || !handover(v.handoverDeclaration)) || !productReviewEqual({transactionId: v.transactionId, leg: v.leg}, c) || !['own', 'admin'].includes(String(v.scope)) || !hash(v.sourceHash) || !revision(v.sourceRevision) || !count(v.version) || !(v.scope === 'admin' ? LABEL_ROUTE_ADMIN_ACTIONS : parcel ? PARCEL_OWN_ACTIONS : LABEL_ROUTE_OWN_ACTIONS).includes(v.action as LabelRouteAction) || !text(v.reason) || v.acknowledged !== true) return false;
  if (v.action === 'request_parcel') return parcel && isLabelParcelObservation(v.parcelObservation) && [v.endpoint, v.address, v.route, v.reference].every(x => x === null);
  if (v.action === 'request_route') return ['origin', 'destination'].includes(String(v.endpoint)) && isLabelRouteAddress(v.address) && v.route === null && v.reference === null;
  return v.endpoint === null && v.address === null && reference(v.reference) && (v.action === 'propose_route' ? isLabelOperationalRoute(v.route, c.leg) : v.route === null);
}
export function isLabelRouteAttempt(v: unknown, uid: string): v is LabelRouteAttempt {
  return object(v) && exact(v, ['version', 'uid', 'requestId', 'context', 'command']) && v.version === 1 && v.uid === uid && text(uid, 128) && productReviewDocumentId(uid) && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && isLabelLifecycleContext(v.context) && isLabelRouteCommand(v.command, v.context);
}
function entry(v: unknown, leg: LabelLifecycleContext['leg'], parcelReader = false): v is LabelRouteEntry {
  const declared = object(v) && Object.prototype.hasOwnProperty.call(v, 'handoverDeclaration');
  const parcel = object(v) && parcelCapability(v.parcelAmendmentCapability);
  if (!object(v) || !exact(v, ['reference', 'action', 'scope', 'actorRole', 'reason', 'endpoint', 'address', 'route', 'relatedReference', 'recordedAt', 'historicalOnly', ...(declared ? ['handoverDeclaration'] : []), ...(parcel ? ['parcelAmendmentCapability'] : []), ...(v.action === 'request_parcel' ? ['parcelObservation'] : []), ...EFFECTS]) || parcel && !parcelReader || declared && (v.action !== 'accept_route' || !handover(v.handoverDeclaration)) || !reference(v.reference) || !['own', 'admin'].includes(String(v.scope)) || (v.scope === 'admin' ? v.actorRole !== 'operator' : !['buyer', 'seller'].includes(String(v.actorRole))) || !(v.scope === 'admin' ? LABEL_ROUTE_ADMIN_ACTIONS : parcel ? PARCEL_OWN_ACTIONS : LABEL_ROUTE_OWN_ACTIONS).includes(v.action as LabelRouteAction) || !text(v.reason) || !iso(v.recordedAt) || v.historicalOnly !== true || !none(v)) return false;
  if (v.action === 'request_parcel') return parcel && isLabelParcelObservation(v.parcelObservation) && [v.endpoint, v.address, v.route, v.relatedReference].every(x => x === null);
  return v.action === 'request_route' ? ['origin', 'destination'].includes(String(v.endpoint)) && isLabelRouteAddress(v.address) && v.route === null && v.relatedReference === null : v.endpoint === null && v.address === null && reference(v.relatedReference) && (v.action === 'propose_route' ? isLabelOperationalRoute(v.route, leg) : v.route === null);
}
const failure = () => new Error('Le trajet et ses accords doivent être relus. Aucun transport ni débit n’est autorisé par cet échange.');
const cursor = (v: unknown): v is LabelLifecycleCursor | null => v === null || object(v) && exact(v, ['lastId']) && productReviewDocumentId(v.lastId);
function guard(uid: string, assertContext: () => void) {const session = captureTradeSession(uid); assertContext(); return () => {assertTradeSessionCurrent(session); assertContext();};}
async function rpc(uid: string, mode: string, input: Record<string, unknown>, assertContext: () => void) {
  const current = guard(uid, assertContext), response = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({capability: 'label_lifecycle_v1', routeAmendmentCapability: 'label_route_amendment_v1', expectedUid: uid, mode, ...input}); current(); return response.data;
}
async function read(v: unknown, uid: string, c: LabelLifecycleContext, scope: LabelLifecycleScope, history: boolean, noticeReference: LabelRouteNoticeReference | null = null, parcel?: LabelParcelAmendmentCapability): Promise<boolean> {
  if (parcel !== undefined && !parcelCapability(parcel)) return false;
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'transactionId', 'leg', 'source', 'state', 'request', 'proposal', 'originalRoute', 'currentLabelRoute', 'preparationBasisQualified', 'senderHandoverDeclaration', 'acceptances', 'options', 'entries', 'nextCursor', 'coverage', ...(noticeReference ? ['notice'] : []), ...(parcel ? ['parcelAmendment'] : []), ...EFFECTS]) || v.protocol !== (history ? 'label_route_amendment_history_v1' : 'label_route_amendment_preview_v1') || v.actorId !== uid || v.scope !== scope || v.transactionId !== c.transactionId || v.leg !== c.leg || !none(v) || !['unrecorded', 'awaiting_review', 'details_requested', 'proposed', 'agreed', 'refused', 'withdrawn'].includes(String(v.state)) || typeof v.preparationBasisQualified !== 'boolean' || !handover(v.senderHandoverDeclaration)) return false;
  if (noticeReference && (!object(v.notice) || !exact(v.notice, ['qualification', 'entry', 'notificationId']) || v.notice.qualification !== 'native_owner_notice' || v.notice.notificationId !== noticeReference.notificationId || !entry(v.notice.entry, c.leg, !!parcel) || v.notice.entry.reference.id !== noticeReference.entryId || v.notice.entry.reference.contentHash !== noticeReference.contentHash || v.notice.entry.parcelAmendmentCapability !== parcel)) return false;
  for (const key of ['originalRoute', 'currentLabelRoute'] as const) {
    const r = v[key], actual = key === 'currentLabelRoute';
    if (!object(r) || !exact(r, ['qualification', 'context', 'sourceHash', ...(actual ? ['labelId'] : [])]) || (r.qualification === 'unknown' ? r.context !== null || r.sourceHash !== null || actual && r.labelId !== null : r.qualification !== (actual ? 'native_current_label_route' : 'native_historical_route') || !capturedRoute(r.context, c.leg) || !hash(r.sourceHash) || actual && !providerId(r.labelId))) return false;
  }
  const parcelView = v.parcelAmendment;
  if (parcel) {
    if (!object(parcelView) || !exact(parcelView, ['capability', 'enabled', 'previousParcel', 'previousMeasurements', 'physicalMeasurementsVerified', 'unitConversionApplied', 'previousSourcePreserved']) || parcelView.capability !== parcel || typeof parcelView.enabled !== 'boolean' || !isLabelPreviousParcel(parcelView.previousParcel) || parcelView.physicalMeasurementsVerified !== false || parcelView.unitConversionApplied !== false || parcelView.previousSourcePreserved !== true) return false;
    const actual = v.currentLabelRoute as LabelRoutePreview['currentLabelRoute'], original = v.originalRoute as LabelRoutePreview['originalRoute'];
    const selected = actual.qualification === 'native_current_label_route' ? actual : original.qualification === 'native_historical_route' ? original : null;
    const previous: LabelPreviousParcel = selected ? {qualification: selected.qualification, sourceHash: selected.sourceHash, labelId: selected === actual ? actual.labelId : null} : {qualification: 'unknown', sourceHash: null, labelId: null};
    if (!productReviewEqual(parcelView.previousParcel, previous) || !productReviewEqual(parcelView.previousMeasurements, selected?.context?.parcel ?? null)) return false;
  }
  const s = v.source;
  if (!object(s) || !exact(s, ['protocol', 'transactionId', 'leg', 'buyerId', 'sellerId', 'sourceRevision', 'orderHash', 'stateHash', 'version', 'baseHash', 'returnRequestId', 'sourceHash', 'qualification']) || s.protocol !== 'label_route_amendment_source_v1' || s.transactionId !== c.transactionId || s.leg !== c.leg || !productReviewDocumentId(s.buyerId) || !productReviewDocumentId(s.sellerId) || s.buyerId === s.sellerId || scope === 'own' && ![s.buyerId, s.sellerId].includes(uid) || !revision(s.sourceRevision) || !['orderHash', 'stateHash', 'baseHash', 'sourceHash'].every(k => hash(s[k])) || !['native_order_parties', 'unknown'].includes(String(s.qualification)) || (s.qualification === 'unknown' ? s.version !== null && !count(s.version) : !count(s.version)) || !(s.returnRequestId === null || text(s.returnRequestId, 128)) || c.leg === 'forward' && s.returnRequestId !== null) return false;
  if (!Array.isArray(v.options) || !(noticeReference && v.options.length === 0 || productReviewEqual(v.options, s.qualification === 'unknown' || parcel && object(parcelView) && !parcelView.enabled ? [] : scope === 'admin' ? LABEL_ROUTE_ADMIN_ACTIONS : parcel ? PARCEL_OWN_ACTIONS : LABEL_ROUTE_OWN_ACTIONS)) || !(v.request === null || entry(v.request, c.leg, !!parcel) && (v.request.action === 'request_route' || parcel && v.request.action === 'request_parcel')) || !(v.proposal === null || entry(v.proposal, c.leg, !!parcel) && v.proposal.action === 'propose_route') || !object(v.acceptances) || !exact(v.acceptances, ['buyer', 'seller']) || !Object.values(v.acceptances).every(a => ['unrecorded', 'native_accepted', 'unknown'].includes(String(a)))) return false;
  if (!history) return Array.isArray(v.entries) && v.entries.length === 0 && v.nextCursor === null && v.coverage === null;
  if (!Array.isArray(v.entries) || v.entries.length > 20 || !cursor(v.nextCursor) || !object(v.coverage) || !exact(v.coverage, ['inspected', 'limit', 'hasMore', 'exhaustiveHistoryVerified']) || !count(v.coverage.inspected) || v.coverage.inspected > 20 || v.coverage.inspected < v.entries.length || parcel && v.coverage.inspected !== v.entries.length || v.coverage.limit !== 20 || typeof v.coverage.hasMore !== 'boolean' || v.coverage.exhaustiveHistoryVerified !== false) return false;
  return v.entries.every(r => object(r) && (r.qualification === 'unknown' ? exact(r, ['qualification', 'entryId', 'entry']) && productReviewDocumentId(r.entryId) && r.entry === null : exact(r, ['qualification', 'entry']) && r.qualification === 'native_route_entry' && entry(r.entry, c.leg, !!parcel)));
}
export const LabelRouteAmendmentService = {
  async preview(uid: string, c: LabelLifecycleContext, scope: LabelLifecycleScope, assertContext: () => void, parcel?: LabelParcelAmendmentCapability): Promise<LabelRoutePreview> {
    const current = guard(uid, assertContext); if (!isLabelLifecycleContext(c) || parcel !== undefined && !parcelCapability(parcel)) throw failure(); const v = await rpc(uid, 'label_lifecycle_preview', {...c, scope, ...(parcel ? {parcelAmendmentCapability: parcel} : {})}, current);
    if (!await read(v, uid, c, scope, false, null, parcel)) throw failure(); current(); return v as LabelRoutePreview;
  },
  async observeNotice(uid: string, c: LabelLifecycleContext, noticeReference: LabelRouteNoticeReference, assertContext: () => void, parcel?: LabelParcelAmendmentCapability): Promise<LabelRoutePreview> {
    const current = guard(uid, assertContext); if (!isLabelLifecycleContext(c) || !id(noticeReference.entryId) || !hash(noticeReference.contentHash) || !/^operational_[a-f0-9]{64}$/.test(noticeReference.notificationId)) throw failure();
    const v = await rpc(uid, 'label_lifecycle_source_observe', {...c, scope: 'own', noticeReference, ...(parcel ? {parcelAmendmentCapability: parcel} : {})}, current);
    if (!await read(v, uid, c, 'own', false, noticeReference, parcel)) throw failure(); current(); return v as LabelRoutePreview;
  },
  async history(uid: string, c: LabelLifecycleContext, scope: LabelLifecycleScope, after: LabelLifecycleCursor | null, expected: LabelRoutePreview, assertContext: () => void, parcel?: LabelParcelAmendmentCapability): Promise<LabelRouteHistory> {
    const current = guard(uid, assertContext); if (!isLabelLifecycleContext(c) || !cursor(after) || parcel !== undefined && !parcelCapability(parcel)) throw failure(); const v = await rpc(uid, 'label_lifecycle_history_observe', {...c, scope, cursor: after, ...(parcel ? {parcelAmendmentCapability: parcel} : {})}, current);
    if (!await read(v, uid, c, scope, true, null, parcel)) throw failure(); const page = v as LabelRouteHistory, ids = page.entries.map(r => r.qualification === 'unknown' ? r.entryId : r.entry.reference.id);
    if (!productReviewEqual(page.source, expected.source) || new Set(ids).size !== ids.length || (page.coverage.hasMore ? page.coverage.inspected !== 20 || !page.nextCursor || parcel && page.nextCursor.lastId !== ids.at(-1) || page.nextCursor?.lastId === after?.lastId : page.nextCursor !== null)) throw failure();
    const n = expected.notice, fresh = n ? await this.observeNotice(uid, c, {entryId: n.entry.reference.id, contentHash: n.entry.reference.contentHash, notificationId: n.notificationId}, current, parcel) : await this.preview(uid, c, scope, current, parcel); current(); if (!productReviewEqual(fresh, expected)) throw failure(); return page;
  },
  async command(attempt: LabelRouteAttempt, action: 'execute' | 'observe' | 'neutralize', assertContext: () => void): Promise<LabelRouteReceipt> {
    const current = guard(attempt.uid, assertContext); if (!isLabelRouteAttempt(attempt, attempt.uid)) throw failure(); const payloadHash = await productReviewHash(attempt.command), eid = `lr_${await productReviewHash([attempt.uid, attempt.requestId])}`; current();
    const v = await rpc(attempt.uid, 'label_lifecycle_command', {requestId: attempt.requestId, action, command: attempt.command, ...(attempt.command.parcelAmendmentCapability ? {parcelAmendmentCapability: attempt.command.parcelAmendmentCapability} : {})}, current);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'command', 'payloadHash', 'entryId', 'state', 'reason', 'recordedAt', ...EFFECTS]) || v.protocol !== 'label_route_amendment_command_v1' || v.actorId !== attempt.uid || v.requestId !== attempt.requestId || !productReviewEqual(v.command, attempt.command) || v.payloadHash !== payloadHash || !none(v) || !['unrecorded', 'committed', 'not_executed'].includes(String(v.state))) throw failure();
    if (v.state === 'unrecorded' ? v.entryId !== null || v.reason !== null || v.recordedAt !== null : !iso(v.recordedAt) || (v.state === 'committed' ? v.entryId !== eid || v.reason !== null : v.entryId !== null || !text(v.reason))) throw failure(); current(); return v as unknown as LabelRouteReceipt;
  },
};

/** Derivation supplies a candidate only; the server must prove the exact owner's notice. */
export async function labelRouteAmendmentNotificationContext(data: unknown, uid: string, assertContext: () => void, notificationId?: string): Promise<LabelLifecycleNotificationContext | null> {
  const current = guard(uid, assertContext); if (!object(data) || data.ownerId !== uid || data.routeAmendmentCapability !== 'label_route_amendment_v1' || !id(data.labelRouteAmendmentEntryId) || !hash(data.labelRouteAmendmentContentHash)) return null;
  if (Object.prototype.hasOwnProperty.call(data, 'parcelAmendmentCapability') && !parcelCapability(data.parcelAmendmentCapability)) return null;
  const parcel = parcelCapability(data.parcelAmendmentCapability) ? data.parcelAmendmentCapability : undefined;
  const c = {transactionId: data.transactionId, leg: data.labelLifecycleLeg}; if (!isLabelLifecycleContext(c)) return null;
  const caseId = `ll_${await productReviewHash([c.transactionId, c.leg])}`, expectedNoticeId = `operational_${await productReviewHash([`label_route_amendment_v1:${data.labelRouteAmendmentEntryId}`, uid])}`; current();
  if (data.labelLifecycleCaseId !== caseId || notificationId !== undefined && notificationId !== expectedNoticeId) return null;
  const value = await LabelRouteAmendmentService.observeNotice(uid, c, {entryId: data.labelRouteAmendmentEntryId, contentHash: data.labelRouteAmendmentContentHash, notificationId: expectedNoticeId}, current, parcel); current();
  return value.notice?.qualification === 'native_owner_notice' && value.notice.notificationId === expectedNoticeId && value.notice.entry.parcelAmendmentCapability === parcel ? {...c, routeAmendmentNotice: {entryId: data.labelRouteAmendmentEntryId, contentHash: data.labelRouteAmendmentContentHash, notificationId: expectedNoticeId}, ...(parcel ? {parcelAmendmentCapability: parcel} : {})} : null;
}
