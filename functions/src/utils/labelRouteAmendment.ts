/** Private, bilateral operational route amendments. No carrier interception or money authority. */
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { normalizeCanadianAddress } from '../shared/canadianAddress';
import { supportUid, supportObject, supportId, supportRequestId, supportText, supportHash, supportSourceHash, supportRevision, supportAdmin, supportCurrentAdminSession, supportDeclaredDate } from './supportRequest';
import { assertRecentAccountAuthentication, assertAccountSecurityOpen } from './eligibility';
import {assertStoredAccountSecuritySession} from './storedAccountSecuritySession';
import { prepareOperationalNotices, readOperationalNoticeReceipts } from './notifications';
import { providerId } from './shippingPurchaseRate';
import type { PurchaseRateContext } from './shippingPurchaseRate';
import type { ReturnShipmentContext, ShipEngineAddress } from '../config/shipEngine';
export const LABEL_ROUTE_AMENDMENT_ENABLED: boolean = true;
export const LABEL_ROUTE_AMENDMENT_CAPABILITY = 'label_route_amendment_v1';
export const LABEL_PARCEL_AMENDMENT_ENABLED: boolean = true;
export const LABEL_PARCEL_AMENDMENT_CAPABILITY = 'label_parcel_amendment_v1';
const effects = { shippingPermissionGranted: false, additionalPartyChargeAuthorized: false, inventoryEffectAuthorized: false,
    interceptionAuthorized: false, carrierPossessionVerified: false, historicalAddressReconstructed: false } as const;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const docId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
type Context = {
    transactionId: string;
    leg: 'forward' | 'return';
};
type Reference = {
    id: string;
    contentHash: string;
};
type PreviousParcel = {
    qualification: 'native_current_label_route' | 'native_historical_route' | 'unknown';
    sourceHash: string | null;
    labelId: string | null;
};
type ParcelObservation = {
    protocol: 'label_parcel_measurement_statement_v1';
    previousParcel: PreviousParcel;
    weight: { value: number | null; unit: 'kilogram' | 'gram' | 'pound' | 'ounce' | 'unknown' };
    dimensions: { length: number | null; width: number | null; height: number | null; unit: 'centimeter' | 'millimeter' | 'inch' | 'unknown' };
    observedAt: string | null;
    method: string | null;
};
type Address = {
    name: string;
    street: string;
    line2?: string;
    city: string;
    province: 'QC';
    postalCode: string;
    country: 'CA';
};
export type OperationalRoute = {
    origin: Address;
    destination: Address;
    parcel: PurchaseRateContext['parcel'];
    carrierId: string;
    carrierCode: string;
    serviceCode: string;
    outboundLabelId: string | null;
};
type Command = Context & {
    scope: 'own' | 'admin';
    sourceHash: string;
    sourceRevision: string;
    version: number;
    action: 'request_route' | 'request_parcel' | 'request_details' | 'refuse_route' | 'propose_route' | 'accept_route' | 'withdraw_route';
    reason: string;
    endpoint: 'origin' | 'destination' | null;
    address: Address | null;
    route: OperationalRoute | null;
    reference: Reference | null;
    acknowledged: true;
    handoverDeclaration?: 'not_deposited_declared' | 'deposited_declared' | 'unknown';
    parcelAmendmentCapability?: typeof LABEL_PARCEL_AMENDMENT_CAPABILITY;
    parcelObservation?: ParcelObservation;
};
const caseId = (c: Context) => 'll_' + supportHash([c.transactionId, c.leg]);
const caseRef = (c: Context) => db.collection('label_lifecycle_cases').doc(caseId(c));
const stateRef = (c: Context) => caseRef(c).collection('route_amendment').doc('state');
const entries = (c: Context) => caseRef(c).collection('route_entries');
const receiptRef = (uid: string, id: string) => db.collection('label_lifecycle_commands').doc(supportHash([uid, id]));
const entryId = (uid: string, id: string) => 'lr_' + supportHash([uid, id]);
const context = (r: any): Context => {
    if (!['forward', 'return'].includes(r.leg))
        throw new HttpsError('invalid-argument', 'Trajet exact requis.');
    return { transactionId: supportId(r.transactionId), leg: r.leg };
};
function reference(v: unknown): Reference {
    const r = supportObject(v, ['id', 'contentHash']);
    if (!/^lr_[a-f0-9]{64}$/.test(r.id ?? '') || !hash(r.contentHash))
        throw new HttpsError('invalid-argument', 'Référence native exacte requise.');
    return { id: r.id, contentHash: r.contentHash };
}
function address(v: unknown): Address {
    const r = supportObject(v, ['name', 'street', 'line2', 'city', 'province', 'postalCode', 'country']), a = normalizeCanadianAddress(r);
    if (!a || a.province !== 'QC' || r.country !== 'CA')
        throw new HttpsError('invalid-argument', 'Adresse déclarée au Québec requise.');
    return { ...a, province: 'QC', name: supportText(r.name, 'Destinataire', 100) };
}
function parseRoute(v: unknown): OperationalRoute {
    const r = supportObject(v, ['origin', 'destination', 'parcel', 'carrierId', 'carrierCode', 'serviceCode', 'outboundLabelId']);
    const p = supportObject(r.parcel, ['weight', 'dimensions']), w = supportObject(p.weight, ['value', 'unit']), d = supportObject(p.dimensions, ['length', 'width', 'height', 'unit']);
    if (w.unit !== 'kilogram' || d.unit !== 'centimeter' || ![w.value, d.length, d.width, d.height].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0) ||
        !providerId(r.carrierId) || typeof r.carrierCode !== 'string' || !/^[-a-z0-9_]{1,100}$/.test(r.carrierCode) || typeof r.serviceCode !== 'string' || !/^[-A-Za-z0-9_]{1,100}$/.test(r.serviceCode) || r.outboundLabelId !== null && !providerId(r.outboundLabelId))
        throw new HttpsError('invalid-argument', 'Route entière et colis déclaré explicites requis.');
    return { origin: address(r.origin), destination: address(r.destination), parcel: { weight: { value: w.value, unit: 'kilogram' }, dimensions: { length: d.length, width: d.width, height: d.height, unit: 'centimeter' } }, carrierId: r.carrierId, carrierCode: r.carrierCode, serviceCode: r.serviceCode, outboundLabelId: r.outboundLabelId };
}
function parcelObservation(v: unknown): ParcelObservation {
    const p = supportObject(v, ['protocol', 'previousParcel', 'weight', 'dimensions', 'observedAt', 'method']);
    const previous = supportObject(p.previousParcel, ['qualification', 'sourceHash', 'labelId']);
    const w = supportObject(p.weight, ['value', 'unit']), d = supportObject(p.dimensions, ['length', 'width', 'height', 'unit']);
    const value = (n: unknown) => n === null || typeof n === 'number' && Number.isFinite(n) && n > 0;
    if (p.protocol !== 'label_parcel_measurement_statement_v1' ||
        !['native_current_label_route', 'native_historical_route', 'unknown'].includes(previous.qualification) ||
        (previous.qualification === 'unknown' ? previous.sourceHash !== null || previous.labelId !== null : !hash(previous.sourceHash)) ||
        (previous.qualification === 'native_current_label_route' ? !providerId(previous.labelId) : previous.labelId !== null) ||
        !['kilogram', 'gram', 'pound', 'ounce', 'unknown'].includes(w.unit) || !value(w.value) || w.unit === 'unknown' && w.value !== null ||
        !['centimeter', 'millimeter', 'inch', 'unknown'].includes(d.unit) || ![d.length, d.width, d.height].every(value) ||
        d.unit === 'unknown' && [d.length, d.width, d.height].some(n => n !== null))
        throw new HttpsError('invalid-argument', 'Mesures déclarées et référence précédente explicites requises.');
    return { protocol: p.protocol, previousParcel: { qualification: previous.qualification, sourceHash: previous.sourceHash, labelId: previous.labelId },
        weight: { value: w.value, unit: w.unit }, dimensions: { length: d.length, width: d.width, height: d.height, unit: d.unit },
        observedAt: supportDeclaredDate(p.observedAt, Date.now()), method: p.method === null ? null : supportText(p.method, 'Méthode déclarée', 1000) };
}
function input(v: unknown): Command {
    const c = supportObject(v, ['transactionId', 'leg', 'scope', 'sourceHash', 'sourceRevision', 'version', 'action', 'reason', 'endpoint', 'address', 'route', 'reference', 'acknowledged', 'handoverDeclaration', 'parcelAmendmentCapability', 'parcelObservation']);
    const parcel = c.parcelAmendmentCapability === LABEL_PARCEL_AMENDMENT_CAPABILITY;
    if (c.parcelAmendmentCapability !== undefined && !parcel || c.action === 'request_parcel' && !parcel ||
        (c.action === 'request_parcel' ? c.parcelObservation == null || c.reference !== null : c.parcelObservation !== undefined))
        throw new HttpsError('invalid-argument', 'Version explicite de correction du colis requise.');
    if (!['own', 'admin'].includes(c.scope) || !hash(c.sourceHash) || typeof c.sourceRevision !== 'string' || !/^\d+:\d+$/.test(c.sourceRevision) || c.sourceRevision.length > 100 || !Number.isSafeInteger(c.version) || c.version < 0 || c.acknowledged !== true ||
        !(c.scope === 'admin' ? ['request_details', 'refuse_route', 'propose_route'] : ['request_route', 'request_parcel', 'accept_route', 'withdraw_route']).includes(c.action))
        throw new HttpsError('invalid-argument', 'Intention de route exacte requise.');
    if (c.action === 'request_route' ? !['origin', 'destination'].includes(c.endpoint) || c.address == null || c.route !== null || c.reference !== null : c.endpoint !== null || c.address !== null)
        throw new HttpsError('invalid-argument', 'Extrémité déclarée requise pour une nouvelle demande.');
    if (c.action === 'propose_route' ? c.route == null || c.reference == null : c.route !== null)
        throw new HttpsError('invalid-argument', 'Une proposition décrit toute sa route.');
    if (['request_details', 'refuse_route', 'accept_route', 'withdraw_route'].includes(c.action) && c.reference == null)
        throw new HttpsError('invalid-argument', 'Demande ou proposition exacte requise.');
    if (c.action === 'propose_route' && (c.leg === 'return' ? c.route?.outboundLabelId == null : c.route?.outboundLabelId !== null))
        throw new HttpsError('invalid-argument', 'Liaison aller exacte de la route requise.');
    if (c.handoverDeclaration !== undefined && (c.action !== 'accept_route' || !['not_deposited_declared', 'deposited_declared', 'unknown'].includes(c.handoverDeclaration)))
        throw new HttpsError('invalid-argument', 'Déclaration de remise explicite requise.');
    return { ...context(c), scope: c.scope, sourceHash: c.sourceHash, sourceRevision: c.sourceRevision, version: c.version, action: c.action, reason: supportText(c.reason, 'Motif', 4000),
        endpoint: c.action === 'request_route' ? c.endpoint : null, address: c.action === 'request_route' ? address(c.address) : null, route: c.action === 'propose_route' ? parseRoute(c.route) : null, reference: c.reference === null ? null : reference(c.reference), acknowledged: true, ...(c.handoverDeclaration === undefined ? {} : { handoverDeclaration: c.handoverDeclaration }),
        ...(parcel ? { parcelAmendmentCapability: LABEL_PARCEL_AMENDMENT_CAPABILITY } : {}), ...(c.action === 'request_parcel' ? { parcelObservation: parcelObservation(c.parcelObservation) } : {}) };
}
/** Excludes this amendment's own activation and return-servicing writes only. */
export function routeAmendmentBase(order: FirebaseFirestore.DocumentData) {
    const transient = ['operationalRoutes', 'labelRouteReview', 'updatedAt', 'labelLifecycleCurrent', 'labelLifecycleStop', 'productPhysicalInstruction', 'productCommercialReturnInstruction',
        'shipEngineLabelId', 'trackingNumber', 'carrierCode', 'shippingLabelUrl', 'trackingUrl', 'returnLabelId', 'returnTrackingNumber', 'returnLabelUrl', 'returnCarrierCode', 'returnLabelCost',
        'returnLabelPending', 'returnReconciliationRequired', 'returnReconciliationReason', 'returnRequestedAt', 'trackingRead', 'returnTrackingRead'];
    const body = Object.fromEntries(Object.entries(order).filter(([k]) => !transient.includes(k)));
    if (['delivered', 'disputed', 'return_requested'].includes(body.status)) {
        body.status = 'native_return_flow';
        delete body.statusBeforeDispute;
    }
    for (const key of ['trackingObservation', 'returnTrackingObservation', 'trackingSnapshot', 'returnTrackingSnapshot'])
        if (body[key] && typeof body[key] === 'object')
            body[key] = Object.fromEntries(Object.entries(body[key]).filter(([k]) => !['readId', 'readVersion', 'requestedAtMs', 'observedAtMs', 'recordedAt'].includes(k)));
    if (body.returnRequest) {
        const r = body.returnRequest;
        body.returnRequest = Object.fromEntries(['schemaVersion', 'requestId', 'transactionId', 'actorUid', 'buyerId', 'sellerId', 'reason', 'totalCents', 'sellerPayoutCents', 'currency', 'requestedAt', 'fundsReleaseAt', 'sourceHash', 'commercialReturn', 'commercialReturnBasis', 'effectiveDeliveryWindowSourceHash'].filter(k => r[k] !== undefined).map(k => [k, r[k]]));
    }
    return body;
}
async function current(tx: FirebaseFirestore.Transaction, c: Context) {
    const snap = await tx.get(db.collection('transactions').doc(c.transactionId)), order = snap.data();
    if (!order || order.deliveryType !== 'shipping' || !docId(order.buyerId) || !docId(order.sellerId) || order.buyerId === order.sellerId)
        throw new HttpsError('failed-precondition', 'Parties et commande natives requises.');
    const root = (await tx.get(stateRef(c))).data();
    const qualified = root == null || root.protocol === 'label_route_amendment_state_v1' && root.caseId === caseId(c) && root.transactionId === c.transactionId && root.leg === c.leg && root.buyerId === order.buyerId && root.sellerId === order.sellerId && Number.isSafeInteger(root.version) && root.version > 0 && ['awaiting_review', 'details_requested', 'proposed', 'agreed', 'refused', 'withdrawn'].includes(root.state);
    const capture = { protocol: 'label_route_amendment_source_v1', transactionId: c.transactionId, leg: c.leg, buyerId: order.buyerId, sellerId: order.sellerId,
        sourceRevision: supportRevision(snap), orderHash: supportSourceHash(order), stateHash: supportSourceHash(root ?? null), version: qualified ? root?.version ?? 0 : null, baseHash: supportSourceHash(routeAmendmentBase(order)), returnRequestId: c.leg === 'return' ? order.returnRequest?.requestId ?? null : null };
    return { c, snap, order, root, qualified, capture, sourceHash: supportSourceHash(capture) };
}
async function operator(tx: FirebaseFirestore.Transaction, request: any, uid: string) {
    await supportCurrentAdminSession(request);
    await supportAdmin(tx, uid, false);
    assertRecentAccountAuthentication(request.auth.token);
    await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(uid))).data(), tx, uid);
    const role = await tx.get(db.collection('users').doc(uid));
    return { actorId: uid, authTime: request.auth.token.auth_time, currentAuthorityQualified: true, privateRoleSourceHash: supportSourceHash(role.data() ?? null) };
}
async function parcelSource(tx: FirebaseFirestore.Transaction, c: Context, order: FirebaseFirestore.DocumentData) {
    const { readLabelRouteAmendmentRoutes } = await import('./labelLifecycle');
    const routes = await readLabelRouteAmendmentRoutes(tx, c.transactionId, order, c.leg);
    const actual = routes.currentLabelRoute, original = routes.originalRoute;
    const selected = actual.qualification === 'native_current_label_route' ? actual : original.qualification === 'native_historical_route' ? original : null;
    const previousParcel: PreviousParcel = selected && hash(selected.sourceHash) ? {
        qualification: selected.qualification as PreviousParcel['qualification'], sourceHash: selected.sourceHash,
        labelId: actual === selected ? actual.labelId : null
    } : { qualification: 'unknown', sourceHash: null, labelId: null };
    return { protocol: 'label_parcel_measurement_source_v1' as const, previousParcel,
        previousMeasurements: selected?.context?.parcel ?? null, previousRoute: selected?.context ?? null };
}
function parcelSourceQualified(d: any, command: Command) {
    const capture = d.parcelSourceCapture, observation = command.parcelObservation;
    return command.action !== 'request_parcel' ? capture === undefined : capture?.protocol === 'label_parcel_measurement_source_v1' &&
        supportHash(capture.previousParcel) === supportHash(observation!.previousParcel) &&
        supportHash(capture.previousMeasurements) === supportHash(capture.previousRoute?.parcel ?? null) &&
        (capture.previousParcel.qualification === 'unknown' ? capture.previousMeasurements === null && capture.previousRoute === null : capture.previousRoute != null) &&
        (observation!.observedAt === null || Date.parse(observation!.observedAt) <= d.recordedAt.toMillis());
}
function parcelProposalPreservesAddresses(target: NonNullable<Awaited<ReturnType<typeof proof>>>, route: OperationalRoute) {
    const previous = target.document.parcelSourceCapture?.previousRoute;
    if (!previous) return false;
    try {
        const priorAddress = (a: any) => address({ name: a.name, street: a.addressLine1, ...(a.addressLine2 ? { line2: a.addressLine2 } : {}),
            city: a.cityLocality, province: a.stateProvince, postalCode: a.postalCode, country: a.countryCode });
        return supportHash(priorAddress(previous.shipFrom)) === supportHash(route.origin) && supportHash(priorAddress(previous.shipTo)) === supportHash(route.destination);
    }
    catch { return false; }
}
const notices = (c: Context, id: string, contentHash: string, buyerId: string, sellerId: string, parcel = false) => [buyerId, sellerId].map(userId => ({ eventKey: `label_route_amendment_v1:${id}`, userId, type: 'shipping_update', title: 'Examen du trajet de transport',
    message: 'Un échange privé sur le trajet est enregistré. Consultez sa version dans le dossier. Aucun envoi, débit ou détournement de colis n’est autorisé par cet avis.', data: { ownerId: userId, transactionId: c.transactionId, labelLifecycleCaseId: caseId(c), labelLifecycleLeg: c.leg,
        labelRouteAmendmentEntryId: id, labelRouteAmendmentContentHash: contentHash, routeAmendmentCapability: LABEL_ROUTE_AMENDMENT_CAPABILITY,
        ...(parcel ? { parcelAmendmentCapability: LABEL_PARCEL_AMENDMENT_CAPABILITY } : {}) } }));
async function proof(tx: FirebaseFirestore.Transaction, c: Context, r: Reference) {
    const raw = (await tx.get(entries(c).doc(r.id))).data(), d = raw?.document;
    if (raw?.protocol !== 'label_route_amendment_entry_v1' || !d || d.protocol !== raw.protocol || raw.contentHash !== r.contentHash || supportSourceHash(d) !== r.contentHash || d.entryId !== r.id || r.id !== entryId(d.actorId, d.requestId) || d.caseId !== caseId(c) || !native(d.recordedAt))
        return null;
    let command: Command;
    try {
        command = input(d.command);
    }
    catch {
        return null;
    }
    const s = d.sourceCapture, payloadHash = supportHash(command);
    if (Object.entries(effects).some(([k, v]) => d[k] !== v) || s?.protocol !== 'label_route_amendment_source_v1' || command.transactionId !== c.transactionId || command.leg !== c.leg || payloadHash !== d.payloadHash || !s || command.sourceHash !== supportSourceHash(s) || s.sourceRevision !== command.sourceRevision || s.version !== command.version || s.transactionId !== c.transactionId || s.leg !== c.leg ||
        !docId(s.buyerId) || !docId(s.sellerId) || s.buyerId === s.sellerId || !hash(s.baseHash) || !hash(s.orderHash) || !hash(s.stateHash) ||
        command.scope === 'own' && ![s.buyerId, s.sellerId].includes(d.actorId) || command.scope === 'admin' && (d.operatorAuthority?.actorId !== d.actorId || d.operatorAuthority.currentAuthorityQualified !== true || !hash(d.operatorAuthority.privateRoleSourceHash) || !Number.isSafeInteger(d.operatorAuthority.authTime) || d.operatorAuthority.authTime < 1 || d.operatorAuthority.authTime * 1000 > d.recordedAt.toMillis()))
        return null;
    if (!parcelSourceQualified(d, command)) return null;
    const receipt = (await tx.get(receiptRef(d.actorId, d.requestId))).data();
    if (receipt?.protocol !== 'label_route_amendment_command_v1' || receipt.actorId !== d.actorId || receipt.requestId !== d.requestId || receipt.payloadHash !== payloadHash || supportHash(receipt.command) !== payloadHash || receipt.state !== 'committed' || receipt.reason !== null || receipt.entryId !== r.id || !native(receipt.recordedAt) || !receipt.recordedAt.isEqual(d.recordedAt) || receipt.contentHash !== r.contentHash)
        return null;
    const n = await readOperationalNoticeReceipts(tx, notices(c, r.id, r.contentHash, s.buyerId, s.sellerId, command.parcelAmendmentCapability !== undefined));
    if (!Array.isArray(receipt.notificationIds) || receipt.notificationIds.length !== 2 || n.some((v, i) => !v || v.notificationId !== receipt.notificationIds[i]))
        return null;
    return { document: d, command, reference: r, notificationIds: receipt.notificationIds as string[] };
}
async function proposal(tx: FirebaseFirestore.Transaction, s: Awaited<ReturnType<typeof current>>) {
    const r = s.root?.proposal;
    if (!r)
        return null;
    let ref: Reference;
    try {
        ref = reference(r);
    }
    catch {
        return null;
    }
    const p = await proof(tx, s.c, ref);
    return p?.command.action === 'propose_route' && p.command.route && p.document.sourceCapture.baseHash === s.capture.baseHash && p.document.sourceCapture.buyerId === s.order.buyerId && p.document.sourceCapture.sellerId === s.order.sellerId ? p : null;
}
async function acceptances(tx: FirebaseFirestore.Transaction, s: Awaited<ReturnType<typeof current>>, p: NonNullable<Awaited<ReturnType<typeof proposal>>>) {
    const result = [];
    for (const role of ['buyer', 'seller'] as const) {
        const r = s.root?.acceptances?.[role];
        if (!r)
            return null;
        let ref: Reference;
        try {
            ref = reference(r);
        }
        catch {
            return null;
        }
        const a = await proof(tx, s.c, ref);
        if (a?.command.action !== 'accept_route' || a.document.actorId !== s.order[`${role}Id`] || supportHash(a.command.reference) !== supportHash(p.reference) || a.document.sourceCapture.baseHash !== s.capture.baseHash || a.document.recordedAt.toMillis() < p.document.recordedAt.toMillis())
            return null;
        result.push(a.reference);
    }
    return result;
}
export async function readRouteAmendmentSenderDeclaration(tx: FirebaseFirestore.Transaction, c: Context, order: FirebaseFirestore.DocumentData): Promise<'not_deposited_declared' | 'deposited_declared' | 'unknown'> {
    const s = await current(tx, c), p = await proposal(tx, s);
    if (!s.qualified || !p || supportSourceHash(s.order) !== supportSourceHash(order))
        return 'unknown';
    const role = c.leg === 'return' ? 'buyer' : 'seller', value = s.root?.acceptances?.[role];
    if (!value)
        return 'unknown';
    let ref: Reference;
    try {
        ref = reference(value);
    }
    catch {
        return 'unknown';
    }
    const a = await proof(tx, c, ref);
    return a?.command.action === 'accept_route' && a.document.actorId === order[`${role}Id`] && supportHash(a.command.reference) === supportHash(p.reference) && a.document.sourceCapture.baseHash === s.capture.baseHash ? a.command.handoverDeclaration ?? 'unknown' : 'unknown';
}
export function routeToContext(c: Context, r: OperationalRoute, requestId: string | null): PurchaseRateContext | ReturnShipmentContext {
    const contact = (a: Address): ShipEngineAddress => ({ name: a.name, addressLine1: a.street, ...(a.line2 ? { addressLine2: a.line2 } : {}), cityLocality: a.city, stateProvince: a.province, postalCode: a.postalCode, countryCode: 'CA' });
    const base = { shipFrom: contact(r.origin), shipTo: contact(r.destination), parcel: r.parcel };
    return c.leg === 'return' ? { ...base, isReturn: true, carrierId: r.carrierId, carrierCode: r.carrierCode, serviceCode: r.serviceCode, outboundLabelId: r.outboundLabelId!, externalShipmentId: 'sr_' + supportHash([c.transactionId, requestId, 'route', r]).slice(0, 40) } : base;
}
export async function readAcceptedRouteAmendment(tx: FirebaseFirestore.Transaction, c: Context, order: FirebaseFirestore.DocumentData) {
    const s = await current(tx, c), p = await proposal(tx, s);
    if (!LABEL_ROUTE_AMENDMENT_ENABLED || !s.qualified || s.root?.state !== 'agreed' || !p ||
        p.command.parcelAmendmentCapability !== undefined && !LABEL_PARCEL_AMENDMENT_ENABLED || supportSourceHash(s.order) !== supportSourceHash(order))
        return null;
    try {
        const actorId = p.document.actorId;
        const session = await assertStoredAccountSecuritySession(tx, actorId, p.document.operatorAuthority.authTime);
        await supportAdmin(tx, actorId, session.currentAdminClaim);
    }
    catch {
        return null;
    }
    const a = await acceptances(tx, s, p), marker = order.operationalRoutes?.[c.leg];
    if (!a || marker?.protocol !== 'label_operational_route_v1' || marker.caseId !== caseId(c) || supportHash(marker.proposal) !== supportHash(p.reference) || !native(marker.recordedAt) || marker.baseHash !== s.capture.baseHash)
        return null;
    const last = s.root?.latestEntry ? await proof(tx, c, reference(s.root.latestEntry)) : null;
    if (last?.command.action !== 'accept_route' || !last.document.recordedAt.isEqual(marker.recordedAt) || supportHash(last.command.reference) !== supportHash(p.reference))
        return null;
    if (c.leg === 'return' && p.command.route!.outboundLabelId !== order.shipEngineLabelId)
        return null;
    return { protocol: 'label_route_amendment_capture_v1', transactionId: c.transactionId, leg: c.leg, buyerId: order.buyerId, sellerId: order.sellerId,
        requestId: s.capture.returnRequestId, proposal: p.reference, baseHash: s.capture.baseHash, acceptances: a, route: p.command.route!, context: routeToContext(c, p.command.route!, s.capture.returnRequestId), recordedAt: marker.recordedAt,
        ...(p.command.parcelAmendmentCapability === undefined ? {} : { parcelAmendmentCapability: LABEL_PARCEL_AMENDMENT_CAPABILITY }), ...effects };
}
export async function readHistoricalRouteAmendment(tx: FirebaseFirestore.Transaction, c: Context, capture: any) {
    if (capture?.protocol !== 'label_route_amendment_capture_v1' || capture.transactionId !== c.transactionId || capture.leg !== c.leg || !native(capture.recordedAt))
        return null;
    let ref: Reference;
    try {
        ref = reference(capture.proposal);
    }
    catch {
        return null;
    }
    const p = await proof(tx, c, ref);
    if (!p || p.command.action !== 'propose_route' || !p.command.route || p.command.parcelAmendmentCapability !== capture.parcelAmendmentCapability || p.document.sourceCapture.baseHash !== capture.baseHash || p.document.sourceCapture.buyerId !== capture.buyerId || p.document.sourceCapture.sellerId !== capture.sellerId || capture.requestId !== p.document.sourceCapture.returnRequestId || supportHash(p.command.route) !== supportHash(capture.route) || supportHash(routeToContext(c, p.command.route, capture.requestId)) !== supportHash(capture.context) || !Array.isArray(capture.acceptances) || capture.acceptances.length !== 2)
        return null;
    for (let i = 0; i < 2; i++) {
        let r: Reference;
        try {
            r = reference(capture.acceptances[i]);
        }
        catch {
            return null;
        }
        const a = await proof(tx, c, r);
        if (a?.command.action !== 'accept_route' || a.document.actorId !== p.document.sourceCapture[i === 0 ? 'buyerId' : 'sellerId'] || supportHash(a.command.reference) !== supportHash(p.reference) || a.document.sourceCapture.baseHash !== capture.baseHash || a.document.recordedAt.toMillis() > capture.recordedAt.toMillis() || a.document.recordedAt.toMillis() < p.document.recordedAt.toMillis())
            return null;
    }
    return capture;
}
function view(uid: string, id: string, command: Command, d?: any) { return { protocol: 'label_route_amendment_command_v1', actorId: uid, requestId: id, command, payloadHash: supportHash(command), entryId: d?.entryId ?? null, state: d?.state ?? 'unrecorded', reason: d?.reason ?? null, recordedAt: native(d?.recordedAt) ? d.recordedAt.toDate().toISOString() : null, ...effects }; }
function entryView(p: NonNullable<Awaited<ReturnType<typeof proof>>>, _admin: boolean) {
    return { reference: p.reference, action: p.command.action, scope: p.command.scope,
        actorRole: p.command.scope === 'admin' ? 'operator' : p.document.actorId === p.document.sourceCapture.buyerId ? 'buyer' : 'seller', reason: p.command.reason,
        endpoint: p.command.endpoint, address: p.command.address, route: p.command.route, relatedReference: p.command.reference, ...(p.command.handoverDeclaration === undefined ? {} : { handoverDeclaration: p.command.handoverDeclaration }),
        ...(p.command.parcelAmendmentCapability === undefined ? {} : { parcelAmendmentCapability: LABEL_PARCEL_AMENDMENT_CAPABILITY }),
        ...(p.command.parcelObservation === undefined ? {} : { parcelObservation: p.command.parcelObservation }), recordedAt: p.document.recordedAt.toDate().toISOString(), historicalOnly: true, ...effects };
}
export async function labelRouteAmendment(request: any) {
    const uid = supportUid(request), r = supportObject(request.data, ['mode', 'capability', 'routeAmendmentCapability', 'parcelAmendmentCapability', 'expectedUid', 'transactionId', 'leg', 'scope', 'cursor', 'requestId', 'action', 'command', 'noticeReference']);
    if (r.routeAmendmentCapability !== LABEL_ROUTE_AMENDMENT_CAPABILITY)
        throw new HttpsError('invalid-argument', 'Version de l’amendement requise.');
    const parcel = r.parcelAmendmentCapability === LABEL_PARCEL_AMENDMENT_CAPABILITY;
    if (r.parcelAmendmentCapability !== undefined && !parcel)
        throw new HttpsError('invalid-argument', 'Version explicite de correction du colis requise.');
    let noticeReference: { entryId: string; contentHash: string; notificationId: string } | null = null;
    if (r.noticeReference !== undefined) {
        const n = supportObject(r.noticeReference, ['entryId', 'contentHash', 'notificationId']);
        if (r.mode !== 'label_lifecycle_source_observe' || r.scope !== 'own' || !/^lr_[a-f0-9]{64}$/.test(n.entryId ?? '') || !hash(n.contentHash) || !/^operational_[a-f0-9]{64}$/.test(n.notificationId ?? ''))
            throw new HttpsError('invalid-argument', 'Référence exacte de votre avis requise.');
        noticeReference = { entryId: n.entryId, contentHash: n.contentHash, notificationId: n.notificationId };
    }
    if (r.mode === 'label_lifecycle_command') {
        const id = supportRequestId(r.requestId), command = input(r.command), ref = receiptRef(uid, id), eid = entryId(uid, id);
        if (parcel !== (command.parcelAmendmentCapability !== undefined))
            throw new HttpsError('invalid-argument', 'Conservez la capacité de l’intention originale.');
        if (!['execute', 'observe', 'neutralize'].includes(r.action))
            throw new HttpsError('invalid-argument', 'Journal exact requis.');
        return db.runTransaction(async (tx) => {
            const prior = (await tx.get(ref)).data();
            if (prior) {
                if (prior.protocol !== 'label_route_amendment_command_v1' || prior.actorId !== uid || prior.requestId !== id || prior.payloadHash !== supportHash(command) || supportHash(prior.command) !== supportHash(command) || !native(prior.recordedAt) || !['committed', 'not_executed'].includes(prior.state))
                    throw new HttpsError('already-exists', 'Intention différente.');
                if (prior.state === 'not_executed' && (prior.entryId !== null || typeof prior.reason !== 'string'))
                    throw new HttpsError('unavailable', 'Non-exécution à rapprocher.');
                if (prior.state === 'committed' && !await proof(tx, command, { id: eid, contentHash: prior.contentHash }))
                    throw new HttpsError('unavailable', 'Reçu à rapprocher.');
                return view(uid, id, command, prior);
            }
            if (r.action === 'observe')
                return view(uid, id, command);
            const now = Timestamp.now(), reject = (reason: string) => { const d = { protocol: 'label_route_amendment_command_v1', actorId: uid, requestId: id, command, payloadHash: supportHash(command), state: 'not_executed', reason, entryId: null, recordedAt: now }; tx.create(ref, d); return view(uid, id, command, d); };
            if (r.action === 'neutralize')
                return reject('requester_neutralized');
            if (!LABEL_ROUTE_AMENDMENT_ENABLED)
                return reject('label_route_amendment_not_exposed');
            if (parcel && !LABEL_PARCEL_AMENDMENT_ENABLED)
                return reject('label_parcel_amendment_not_exposed');
            const authority = command.scope === 'admin' ? await operator(tx, request, uid) : null, s = await current(tx, command);
            if (!s.qualified || s.capture.version === null || s.capture.version >= Number.MAX_SAFE_INTEGER - 1)
                return reject('native_sources_unknown');
            if (command.scope === 'own' && ![s.order.buyerId, s.order.sellerId].includes(uid))
                return reject('not_a_native_participant');
            if (command.scope === 'own') {
                // New bilateral declarations can later support a changed route.
                // Qualify this ordinary SDK actor's current Auth cutoff and private
                // security barrier without requiring any commercial admission.
                const security = (await tx.get(db.collection('eligibility_profiles').doc(uid))).data();
                const authenticatedAtMs = request.auth.token?.auth_time * 1000;
                if (!Number.isSafeInteger(authenticatedAtMs) || authenticatedAtMs < 1 || authenticatedAtMs > Date.now())
                    return reject('participant_session_unavailable');
                try { await supportCurrentAdminSession(request); }
                catch (e) {
                    if (e instanceof HttpsError && e.code === 'permission-denied' || (e as { code?: string })?.code === 'auth/user-not-found')
                        return reject('participant_session_unavailable');
                    throw e;
                }
                try { await assertAccountSecurityOpen(security, tx, uid); }
                catch (e) {
                    if (e instanceof HttpsError && e.code === 'failed-precondition')
                        return reject('participant_security_restricted');
                    throw e;
                }
            }
            if (command.sourceHash !== s.sourceHash || command.sourceRevision !== s.capture.sourceRevision || command.version !== s.capture.version)
                return reject('source_changed');
            let nativeRequest = null;
            try { nativeRequest = s.root?.request ? await proof(tx, command, reference(s.root.request)) : null; }
            catch { return reject('reference_unqualified'); }
            if (s.root?.request != null && !nativeRequest) return reject('reference_unqualified');
            if (!parcel && nativeRequest?.command.parcelAmendmentCapability !== undefined)
                return reject('parcel_amendment_capability_required');
            const capturedParcel = command.action === 'request_parcel' ? await parcelSource(tx, command, s.order) : null;
            if (capturedParcel && supportHash(command.parcelObservation!.previousParcel) !== supportHash(capturedParcel.previousParcel))
                return reject('previous_parcel_changed');
            const target = command.reference ? await proof(tx, command, command.reference) : null;
            if (command.reference && !target)
                return reject('reference_unqualified');
            if (['request_details', 'refuse_route', 'propose_route'].includes(command.action) && (!target || !['request_route', 'request_parcel'].includes(target.command.action) || supportHash(s.root?.request) !== supportHash(command.reference)))
                return reject('request_changed');
            if (command.action === 'propose_route' && target?.command.action === 'request_parcel') {
                const previous = await parcelSource(tx, command, s.order);
                if (supportHash(previous.previousParcel) !== supportHash(target.command.parcelObservation!.previousParcel))
                    return reject('previous_parcel_changed');
                if (!parcelProposalPreservesAddresses(target, command.route!))
                    return reject('parcel_only_route_sources_required');
            }
            const p = await proposal(tx, s);
            if (command.action === 'accept_route' && (!p || supportHash(p.reference) !== supportHash(command.reference)))
                return reject('proposal_changed');
            if (command.action === 'withdraw_route' && !(p && supportHash(p.reference) === supportHash(command.reference)) && !(target && ['request_route', 'request_parcel'].includes(target.command.action) && target.document.actorId === uid && supportHash(s.root?.request) === supportHash(command.reference)))
                return reject('proposal_changed');
            if (command.action === 'accept_route' && !['proposed', 'agreed'].includes(s.root?.state))
                return reject('proposal_changed');
            const version = s.capture.version + 1, root = { ...(s.root ?? {}), protocol: 'label_route_amendment_state_v1', caseId: caseId(command), transactionId: command.transactionId, leg: command.leg, buyerId: s.order.buyerId, sellerId: s.order.sellerId, version, latestEntry: { id: eid }, state: s.root?.state ?? 'awaiting_review', request: s.root?.request ?? null, proposal: s.root?.proposal ?? null, acceptances: s.root?.acceptances ?? {} };
            if (['request_route', 'request_parcel', 'request_details', 'refuse_route', 'propose_route', 'withdraw_route'].includes(command.action)) {
                root.acceptances = {};
                root.proposal = command.action === 'propose_route' ? { id: eid } : null;
                root.state = ['request_route', 'request_parcel'].includes(command.action) ? 'awaiting_review' : command.action === 'request_details' ? 'details_requested' : command.action === 'refuse_route' ? 'refused' : command.action === 'propose_route' ? 'proposed' : 'withdrawn';
            }
            const other = command.action === 'accept_route' ? s.root?.acceptances?.[uid === s.order.buyerId ? 'seller' : 'buyer'] : null;
            let otherQualified: NonNullable<Awaited<ReturnType<typeof proof>>> | null = null;
            if (other) {
                try {
                    otherQualified = await proof(tx, command, reference(other));
                }
                catch {
                    return reject('acceptance_requires_review');
                }
                if (!otherQualified || otherQualified.command.action !== 'accept_route' || otherQualified.document.actorId !== (uid === s.order.buyerId ? s.order.sellerId : s.order.buyerId) || supportHash(otherQualified.command.reference) !== supportHash(p!.reference) || otherQualified.document.sourceCapture.baseHash !== s.capture.baseHash)
                    return reject('acceptance_requires_review');
            }
            const document = { protocol: 'label_route_amendment_entry_v1', entryId: eid, caseId: caseId(command), actorId: uid, requestId: id, command, payloadHash: supportHash(command), sourceCapture: s.capture,
                ...(capturedParcel ? { parcelSourceCapture: capturedParcel } : {}), operatorAuthority: authority, recordedAt: now, ...effects }, contentHash = supportSourceHash(document), entryReference = { id: eid, contentHash };
            root.latestEntry = entryReference;
            if (['request_route', 'request_parcel'].includes(command.action))
                root.request = entryReference;
            if (command.action === 'propose_route')
                root.proposal = entryReference;
            if (command.action === 'accept_route') {
                root.acceptances = { ...root.acceptances, [uid === s.order.buyerId ? 'buyer' : 'seller']: entryReference };
                if (otherQualified)
                    root.state = 'agreed';
            }
            const n = await prepareOperationalNotices(tx, notices(command, eid, contentHash, s.order.buyerId, s.order.sellerId, parcel));
            const alert = db.collection('admin_alerts').doc('label_route_' + eid);
            if ((await tx.get(entries(command).doc(eid))).exists || (await tx.get(alert)).exists)
                return reject('entry_without_receipt_requires_review');
            tx.create(entries(command).doc(eid), { protocol: document.protocol, document, contentHash });
            tx.set(stateRef(command), root);
            tx.update(s.snap.ref, { [`labelRouteReview.${command.leg}`]: { protocol: 'label_route_review_pointer_v1', caseId: caseId(command), entry: entryReference, state: root.state }, [`operationalRoutes.${command.leg}`]: root.state === 'agreed' ? { protocol: 'label_operational_route_v1', caseId: caseId(command), proposal: p!.reference, baseHash: s.capture.baseHash, recordedAt: now } : null });
            tx.create(alert, { kind: 'label_route_amendment', severity: 'warning', status: 'open', refId: command.transactionId, createdAt: now, context: { transactionId: command.transactionId, leg: command.leg, entryId: eid }, message: 'Amendement de route à examiner sur sa version privée. Aucun transport ni paiement autorisé.' });
            const receipt = { protocol: 'label_route_amendment_command_v1', actorId: uid, requestId: id, command, payloadHash: supportHash(command), state: 'committed', reason: null, entryId: eid, contentHash, recordedAt: now, notificationIds: n.notificationIds };
            tx.create(ref, receipt);
            n.commit();
            return view(uid, id, command, receipt);
        });
    }
    if (!LABEL_ROUTE_AMENDMENT_ENABLED && !noticeReference)
        throw new HttpsError('failed-precondition', 'Parcours d’amendement en préparation.', { reason: 'label_route_amendment_not_exposed' });
    const c = context(r);
    if (!['own', 'admin'].includes(r.scope))
        throw new HttpsError('invalid-argument', 'Portée requise.');
    return db.runTransaction(async (tx) => {
        const admin = r.scope === 'admin';
        if (admin)
            await operator(tx, request, uid);
        const s = await current(tx, c);
        if (!admin && ![s.order.buyerId, s.order.sellerId].includes(uid))
            throw new HttpsError('permission-denied', 'Pas votre commande.');
        let notice = null;
        if (noticeReference) {
            const target = await proof(tx, c, { id: noticeReference.entryId, contentHash: noticeReference.contentHash });
            if (!target || target.document.sourceCapture.buyerId !== s.order.buyerId || target.document.sourceCapture.sellerId !== s.order.sellerId ||
                target.notificationIds[uid === s.order.buyerId ? 0 : 1] !== noticeReference.notificationId)
                throw new HttpsError('permission-denied', 'Avis natif personnel non qualifié.');
            if (!parcel && target.command.parcelAmendmentCapability !== undefined)
                throw new HttpsError('failed-precondition', 'Version de correction du colis requise pour cet avis.', { reason: 'parcel_amendment_capability_required' });
            notice = { qualification: 'native_owner_notice' as const, entry: entryView(target, false), notificationId: noticeReference.notificationId };
        }
        const p = await proposal(tx, s), list = [];
        let nextCursor = null, coverage = null;
        if (r.mode === 'label_lifecycle_history_observe') {
            const cursor = r.cursor == null ? null : supportObject(r.cursor, ['lastId']).lastId;
            if (cursor !== null && !docId(cursor))
                throw new HttpsError('invalid-argument', 'Curseur invalide.');
            let q: FirebaseFirestore.Query = entries(c).orderBy('__name__').limit(21);
            if (cursor)
                q = q.startAfter(cursor);
            const page = await tx.get(q), inspected = page.docs.slice(0, 20);
            for (const row of inspected) {
                const pr = await proof(tx, c, { id: row.id, contentHash: row.data().contentHash });
                if (!parcel && pr?.command.parcelAmendmentCapability !== undefined) continue;
                list.push(pr ? { qualification: 'native_route_entry', entry: entryView(pr, admin) } : { qualification: 'unknown', entryId: row.id, entry: null });
            }
            nextCursor = page.size > 20 ? { lastId: inspected.at(-1)!.id } : null;
            coverage = { inspected: inspected.length, limit: 20, hasMore: page.size > 20, exhaustiveHistoryVerified: false };
        }
        let nativeRequest = null;
        try { nativeRequest = s.root?.request ? await proof(tx, c, reference(s.root.request)) : null; }
        catch { /* An unqualified pointer cannot grant a new permission. */ }
        const hiddenParcel = !parcel && (nativeRequest?.command.parcelAmendmentCapability !== undefined || p?.command.parcelAmendmentCapability !== undefined);
        const consent: {
            buyer: string;
            seller: string;
        } = { buyer: 'unrecorded', seller: 'unrecorded' };
        for (const role of ['buyer', 'seller'] as const) {
            const value = s.root?.acceptances?.[role];
            if (value) {
                let a = null;
                try {
                    a = await proof(tx, c, reference(value));
                }
                catch { }
                consent[role] = p && a?.command.action === 'accept_route' && a.document.actorId === s.order[`${role}Id`] && supportHash(a.command.reference) === supportHash(p.reference) && a.document.sourceCapture.baseHash === s.capture.baseHash ? 'native_accepted' : 'unknown';
            }
        }
        const { readLabelRouteAmendmentRoutes } = await import('./labelLifecycle');
        const routeSources = await readLabelRouteAmendmentRoutes(tx, c.transactionId, s.order, c.leg);
        const measurements = parcel ? await parcelSource(tx, c, s.order) : null;
        return { protocol: r.mode === 'label_lifecycle_history_observe' ? 'label_route_amendment_history_v1' : 'label_route_amendment_preview_v1', actorId: uid, scope: r.scope, transactionId: c.transactionId, leg: c.leg,
            source: { ...s.capture, sourceHash: s.sourceHash, qualification: s.qualified && !hiddenParcel ? 'native_order_parties' : 'unknown' }, ...routeSources, state: s.root?.state ?? 'unrecorded', request: nativeRequest && !hiddenParcel ? entryView(nativeRequest, admin) : null, proposal: p && !hiddenParcel ? entryView(p, admin) : null,
            acceptances: hiddenParcel ? { buyer: 'unknown', seller: 'unknown' } : consent, senderHandoverDeclaration: await readRouteAmendmentSenderDeclaration(tx, c, s.order),
            options: s.qualified && !hiddenParcel && LABEL_ROUTE_AMENDMENT_ENABLED && (!parcel || LABEL_PARCEL_AMENDMENT_ENABLED) ? admin ? ['request_details', 'refuse_route', 'propose_route'] : ['request_route', ...(parcel ? ['request_parcel'] : []), 'accept_route', 'withdraw_route'] : [],
            ...(measurements ? { parcelAmendment: { capability: LABEL_PARCEL_AMENDMENT_CAPABILITY, enabled: LABEL_PARCEL_AMENDMENT_ENABLED,
                previousParcel: measurements.previousParcel, previousMeasurements: measurements.previousMeasurements,
                physicalMeasurementsVerified: false, unitConversionApplied: false, previousSourcePreserved: true } } : {}),
            entries: list, nextCursor, coverage, ...(noticeReference ? { notice } : {}), ...effects };
    });
}
