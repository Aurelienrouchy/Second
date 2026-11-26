/** Declared parcel observations, not possession, fault, loss or indemnity certificates. */
import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {trackingIdentity, trackingProofMatches, trackingObservationDisposition} from '../config/shipEngine';
import {supportDeclaredDate, supportObject, supportSourceHash, supportText} from './supportRequest';
import {qualifiedReturnRequest, qualifiedReturnQuote} from './returnRequest';

export const PRODUCT_PARCEL_REVIEW_ENABLED: boolean = true;
export const PRODUCT_PARCEL_REASONS = ['loss_document', 'parcel_damage', 'return_parcel_integrity', 'delivery_not_received',
  'delivery_location', 'third_party_delivery', 'deposit_disappearance'] as const;
/** Additive F11 reason. Never part of the legacy/default seven-reason contract. */
export const PRODUCT_PARCEL_MIXED_REASON = 'mixed_order_observation' as const;
export function productParcelRequested(raw: any) {
  if (raw.parcelCapability !== undefined && raw.parcelCapability !== 'product_review_parcel_v1') throw new HttpsError('invalid-argument', 'Version colis explicite requise.');
  return raw.parcelCapability === 'product_review_parcel_v1';
}
export function assertProductParcelNewOpen(parcel: boolean) {
  if (parcel && !PRODUCT_PARCEL_REVIEW_ENABLED) throw new HttpsError('failed-precondition', 'Le parcours de constat colis est en préparation.',
    {reason: 'product_parcel_review_not_exposed', capability: 'product_review_parcel_v1'});
}
const text = (v: unknown, max = 1000) => v == null ? null : supportText(v, 'Observation déclarée', max);
const date = (v: unknown) => supportDeclaredDate(v, Date.now());
function choice<T extends string>(v: unknown, choices: readonly T[]): T {
  if (!choices.includes(v as T)) throw new HttpsError('invalid-argument', 'Qualification déclarée explicite requise.'); return v as T;
}
export function parseProductParcelStatement(value: unknown, nativeMixedStatementPresent = false) {
  const p = supportObject(value, ['protocol', 'reason', 'leg', 'labelId', 'receipt', 'packaging', 'parcel', 'contents', 'seal', 'opening',
    'weights', 'handover', 'location', 'thirdParty', 'deposit', 'chronology', 'lossDocument', 'evidenceAvailability', 'evidenceLimitations']);
  if (p.protocol !== 'product_parcel_statement_v1' ||
      (!PRODUCT_PARCEL_REASONS.includes(p.reason) && !(nativeMixedStatementPresent && p.reason === PRODUCT_PARCEL_MIXED_REASON)) ||
      p.labelId !== null && (typeof p.labelId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(p.labelId)) ||
      !Array.isArray(p.weights) || p.weights.length > 10 || !Array.isArray(p.handover) || p.handover.length > 20)
    throw new HttpsError('invalid-argument', 'Constat colis borné et référence déclarée requis.');
  const third = supportObject(p.thirdParty, ['recipient', 'authorization', 'signature', 'reference']);
  const deposit = supportObject(p.deposit, ['state', 'location', 'disappearanceAt']);
  const clock = supportObject(p.chronology, ['shippedAt', 'deliveredAt', 'receivedAt', 'openedAt', 'observedAt', 'reportedAt']);
  const loss = p.lossDocument == null ? null : supportObject(p.lossDocument, ['issuer', 'issuerRole', 'reference', 'issuedAt', 'labelId', 'conclusion']);
  return {protocol: 'product_parcel_statement_v1' as const, reason: p.reason as typeof PRODUCT_PARCEL_REASONS[number] | typeof PRODUCT_PARCEL_MIXED_REASON,
    leg: choice(p.leg, ['forward', 'return'] as const), labelId: p.labelId as string | null,
    receipt: choice(p.receipt, ['received', 'not_received', 'unknown'] as const), packaging: text(p.packaging, 2000), parcel: text(p.parcel, 2000), contents: text(p.contents, 3000),
    seal: choice(p.seal, ['intact_declared', 'broken_declared', 'absent_declared', 'unknown'] as const),
    opening: choice(p.opening, ['opened_declared', 'unopened_declared', 'unknown'] as const),
    weights: p.weights.map((v: unknown) => {const w = supportObject(v, ['value', 'unit', 'method', 'source', 'occurredAt', 'phase']);
      return {value: text(w.value, 100), unit: choice(w.unit, ['g', 'kg', 'lb', 'oz', 'unknown'] as const), method: text(w.method),
        source: choice(w.source, ['actor_measurement', 'carrier_document', 'other_document', 'unknown'] as const), occurredAt: date(w.occurredAt),
        phase: choice(w.phase, ['before_shipping', 'at_handover', 'at_receipt', 'after_opening', 'unknown'] as const)};}),
    handover: p.handover.map((v: unknown) => {const h = supportObject(v, ['from', 'to', 'occurredAt', 'observation', 'reference']);
      return {from: choice(h.from, ['sender', 'carrier', 'recipient', 'third_party', 'unknown'] as const),
        to: choice(h.to, ['sender', 'carrier', 'recipient', 'third_party', 'unknown'] as const), occurredAt: date(h.occurredAt), observation: text(h.observation), reference: text(h.reference, 500)};}),
    location: text(p.location, 2000), thirdParty: {recipient: choice(third.recipient, ['declared_third_party', 'unknown'] as const),
      authorization: choice(third.authorization, ['affirmed', 'denied', 'unknown'] as const), signature: choice(third.signature, ['declared_present', 'declared_absent', 'unknown'] as const),
      reference: text(third.reference, 500)}, deposit: {state: choice(deposit.state, ['admitted', 'contested', 'unknown'] as const),
      location: text(deposit.location), disappearanceAt: date(deposit.disappearanceAt)},
    chronology: Object.fromEntries(['shippedAt', 'deliveredAt', 'receivedAt', 'openedAt', 'observedAt', 'reportedAt'].map(k => [k, date(clock[k])])) as Record<'shippedAt'|'deliveredAt'|'receivedAt'|'openedAt'|'observedAt'|'reportedAt', string|null>,
    lossDocument: loss ? {issuer: text(loss.issuer, 500), issuerRole: choice(loss.issuerRole, ['carrier', 'insurer', 'other', 'unknown'] as const),
      reference: text(loss.reference, 500), issuedAt: date(loss.issuedAt), labelId: text(loss.labelId, 200),
      conclusion: choice(loss.conclusion, ['loss_declared', 'investigation_pending', 'other', 'unknown'] as const)} : null,
    evidenceAvailability: choice(p.evidenceAvailability, ['available', 'unavailable', 'unknown'] as const), evidenceLimitations: text(p.evidenceLimitations, 2000)};
}
export type ProductParcelStatement = ReturnType<typeof parseProductParcelStatement>;
export function parseProductParcelAssessment(value: unknown) {
  const a = supportObject(value, ['protocol', 'leg', 'labelId', 'deliveryFinding', 'locationComparison', 'lossDocumentFinding', 'parcelContentsFinding',
    'responsibility', 'costTreatment', 'motivation', 'evidenceLimitations', 'availableSourcesOnlyAcknowledged']);
  if (a.protocol !== 'product_parcel_assessment_v1' || a.availableSourcesOnlyAcknowledged !== true ||
      a.labelId !== null && (typeof a.labelId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(a.labelId))) throw new HttpsError('invalid-argument', 'Examen opérateur explicite du colis requis.');
  return {protocol: 'product_parcel_assessment_v1' as const, leg: choice(a.leg, ['forward', 'return'] as const), labelId: a.labelId as string|null,
    deliveryFinding: choice(a.deliveryFinding, ['receipt_declared', 'nonreceipt_declared', 'contested', 'unknown'] as const),
    locationComparison: choice(a.locationComparison, ['difference_documented', 'no_difference_documented', 'unknown'] as const),
    lossDocumentFinding: choice(a.lossDocumentFinding, ['document_examined', 'not_provided', 'unknown'] as const),
    parcelContentsFinding: choice(a.parcelContentsFinding, ['observations_examined', 'contested', 'unknown'] as const),
    responsibility: choice(a.responsibility, ['not_determined', 'separate_assessment_required'] as const),
    costTreatment: choice(a.costTreatment, ['no_cost_decision', 'separate_financial_decision_required', 'unknown'] as const),
    motivation: supportText(a.motivation, 'Motivation documentaire', 4000), evidenceLimitations: supportText(a.evidenceLimitations, 'Limites examinées', 4000), availableSourcesOnlyAcknowledged: true as const};
}
export const PRODUCT_PARCEL_QUALIFICATION = {parcelPossessionVerified: false, packageContentsVerified: false, massVerified: false,
  weightConversionApplied: false, recipientAuthorizationVerified: false, signatureIsAgreement: false, officialLossVerified: false,
  responsibilityEstablished: false, insurancePaymentPromised: false, recoveryOrInventoryPermissionGranted: false} as const;
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const plain = (v: any) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
function address(raw: any) {
  const a = plain(raw), read = (v: any) => typeof v === 'string' && v.length <= 500 ? v : null;
  return {street: read(a.street ?? a.addressLine1), line2: read(a.line2 ?? a.addressLine2), city: read(a.city ?? a.cityLocality),
    province: read(a.province ?? a.stateProvince), postalCode: read(a.postalCode), country: read(a.country ?? a.countryCode)};
}
function parcelContent(raw: any) {
  const p = plain(raw), value = (v: any) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  return {weight: {value: value(p.weight?.value), unit: ['gram', 'kilogram', 'ounce', 'pound'].includes(p.weight?.unit) ? p.weight.unit : null},
    dimensions: {length: value(p.dimensions?.length), width: value(p.dimensions?.width), height: value(p.dimensions?.height),
      unit: ['centimeter', 'inch'].includes(p.dimensions?.unit) ? p.dimensions.unit : null}, measurementVerified: false};
}
/** Private immutable route capture. No live profile, name, phone or email. */
export async function readProductParcelSources(tx: FirebaseFirestore.Transaction, transactionId: string, order: FirebaseFirestore.DocumentData) {
  const snapshot = order.shippingSnapshot, returned = order.returnRequest?.quote?.context;
  const route = snapshot?.schemaVersion === 1 ? {qualification: 'native_contract_snapshot', origin: address(snapshot.origin), destination: address(snapshot.destination),
    parcel: parcelContent(snapshot.parcel), sourceHash: supportSourceHash(snapshot)} : {qualification: 'unknown', origin: null, destination: null, parcel: null, sourceHash: null};
  const returnRoute = returned && qualifiedReturnRequest(transactionId, order) && qualifiedReturnQuote(transactionId, order) ? {qualification: 'native_frozen_return_source', origin: address(returned.shipFrom), destination: address(returned.shipTo),
    parcel: parcelContent(returned.parcel), sourceHash: supportSourceHash(returned)} : {qualification: 'unknown', origin: null, destination: null, parcel: null, sourceHash: null};
  const legs = [];
  for (const leg of ['forward', 'return'] as const) {
    // Lazy load avoids a source/physical-instruction initialization cycle;
    // this helper performs only native reads, never carrier IO.
    const {labelLifecycleIdentityQualified} = await import('./labelLifecycle');
    const qualified = await labelLifecycleIdentityQualified(tx, transactionId, order, leg), identity = qualified ? trackingIdentity(transactionId, order, leg) : null;
    const pointer = leg === 'forward' ? order.trackingHistoryCapture : order.returnTrackingHistoryCapture;
    const record = pointer?.protocol === 'tracking_history_v1' && /^tracking_[a-f0-9]{64}$/.test(pointer.captureId ?? '')
      ? (await tx.get(db.collection('transactions').doc(transactionId).collection('tracking_history').doc(pointer.captureId))).data() : null;
    const info = record?.info, read = leg === 'forward' ? order.trackingRead : order.returnTrackingRead;
    const captureQualified = identity && record?.protocol === 'tracking_history_v1' && record.captureId === pointer.captureId &&
      record.buyerId === order.buyerId && record.sellerId === order.sellerId && native(record.recordedAt) && native(pointer.recordedAt) && pointer.recordedAt.isEqual(record.recordedAt) &&
      info?.transactionId === transactionId && info.leg === leg && info.sourceHash === identity.sourceHash && pointer.sourceHash === identity.sourceHash &&
      hash(record.displayHash) && pointer.displayHash === record.displayHash && Array.isArray(record.pageHashes) && record.pageHashes.length <= 20 && record.pageHashes.every(hash) &&
      record.displayHash === digest(['tracking_history_v1', info, record.pageHashes]) && pointer.readVersion === info.readVersion &&
      Number.isSafeInteger(info.readVersion) && info.readVersion > 0 && Number.isSafeInteger(info.totalEvents) && info.totalEvents >= 0 && info.totalEvents <= 1000 &&
      typeof info.providerStatusCode === 'string' && info.providerStatusCode.length <= 64 && hash(info.sourceContentHash) &&
      read?.readId === info.readId && read.version === info.readVersion && read.sourceHash === identity.sourceHash && native(read.authorizedAt) &&
      Number.isSafeInteger(info.providerRequestedAtMs) && info.providerRequestedAtMs >= read.authorizedAt.toMillis() &&
      Number.isSafeInteger(info.providerObservedAtMs) && info.providerObservedAtMs >= info.providerRequestedAtMs && info.providerObservedAtMs <= Date.now() &&
      (info.providerEventAtMs === null || Number.isSafeInteger(info.providerEventAtMs) && info.providerEventAtMs >= 0 && info.providerEventAtMs <= info.providerObservedAtMs);
    const observation = leg === 'forward' ? order.trackingObservation : order.returnTrackingObservation;
    const observationQualified = identity && trackingProofMatches(transactionId, order, observation, leg) &&
      ['accept', 'replay', 'snapshot'].includes(trackingObservationDisposition(order, observation, leg));
    let currentRoute = null;
    const amended = Object.prototype.hasOwnProperty.call(order.operationalRoutes??{},leg) || Object.prototype.hasOwnProperty.call(order.labelRouteReview??{},leg) ||
      leg === 'return' && Object.prototype.hasOwnProperty.call(order.returnRequest??{},'routeAmendmentCapture');
    if (amended) {
      const {readLabelLifecycleCurrentRoute} = await import('./labelLifecycle');
      const actual = await readLabelLifecycleCurrentRoute(tx,transactionId,order,leg);
      currentRoute = actual ? {qualification:'native_current_label_route',origin:address(actual.context.shipFrom),destination:address(actual.context.shipTo),
        parcel:parcelContent(actual.context.parcel),sourceHash:actual.sourceHash,labelId:actual.labelId} : {qualification:'unknown',origin:null,destination:null,parcel:null,sourceHash:null,labelId:null};
    }
    legs.push({...(amended ? {currentRoute} : {}),leg, qualification: identity ? 'native_current_label' : 'unknown', identity, labelHistoryReference: !identity || order.labelLifecycleCurrent?.[leg] == null ? null :
      {caseId: order.labelLifecycleCurrent[leg].caseId ?? null, entryId: order.labelLifecycleCurrent[leg].entryId ?? null, contentHash: order.labelLifecycleCurrent[leg].contentHash ?? null},
      tracking: captureQualified ? {qualification: 'native_current_capture', captureId: pointer.captureId, displayHash: record.displayHash,
        sourceHash: info.sourceHash, readVersion: info.readVersion, providerStatusCode: info.providerStatusCode, providerEventAtMs: info.providerEventAtMs,
        observedAt: new Date(info.providerObservedAtMs).toISOString(), suppliedHistoryOnly: true, recipientReceiptVerified: false} : {qualification: 'unknown'},
      observation: observationQualified ? {qualification: 'native_current_observation', statusCode: observation.statusCode, sourceHash: observation.sourceHash,
        observedContentHash: observation.observedContentHash, providerEventAtMs: observation.providerEventAtMs} : {qualification: 'unknown'}});
  }
  return {protocol: 'product_parcel_sources_v1', contractRoute: route, returnRoute, legs, ...PRODUCT_PARCEL_QUALIFICATION};
}
export function publicProductParcelSources(value: Awaited<ReturnType<typeof readProductParcelSources>>) {
  const route = (r: any) => ({...r, origin: r.origin ? {city: r.origin.city, province: r.origin.province, country: r.origin.country} : null,
    destination: r.destination ? {city: r.destination.city, province: r.destination.province, country: r.destination.country} : null,
    exactAddressPrivate: true, profileAddressUsed: false});
  return {...value, legs:value.legs.map(l=>{const {currentRoute:_privateCurrentRoute,...body}=l;return body;}), contractRoute: route(value.contractRoute), returnRoute: route(value.returnRoute)};
}
/** Caller must qualify current operator authority before returning this view. */
export function operatorProductParcelSources(value: Awaited<ReturnType<typeof readProductParcelSources>>, sourceHash: string, corpusHash: string, routeOptIn = false) {
  return {protocol: 'product_parcel_operator_routes_v1', sourceHash, corpusHash, contractRoute: value.contractRoute, returnRoute: value.returnRoute,
    destinationQualification: {forward: (routeOptIn || !value.legs.some(l=>l.leg==='forward'&&Object.prototype.hasOwnProperty.call(l,'currentRoute'))) && parcelLocationComparisonQualified(value, 'forward') ? 'native_exact_destination' : 'unknown',
      return: (routeOptIn || !value.legs.some(l=>l.leg==='return'&&Object.prototype.hasOwnProperty.call(l,'currentRoute'))) && parcelLocationComparisonQualified(value, 'return') ? 'native_exact_destination' : 'unknown'},
    ...(routeOptIn ? {currentRoutes:value.legs.map(l=>({leg:l.leg,route:Object.prototype.hasOwnProperty.call(l,'currentRoute')?l.currentRoute:null,legacyContractSuppliesCurrentRoute:false}))} : {}),
    exactAddressSource: 'private_native_route_capture', profileAddressUsed: false, thirdPartyContactsSupplied: false,
    comparisonPermissionGranted: false, financialEffectAuthorized: false, inventoryEffectAuthorized: false, shippingPermissionGranted: false};
}
export function parcelLocationComparisonQualified(value: Awaited<ReturnType<typeof readProductParcelSources>>, leg: 'forward'|'return') {
  const current=value.legs.find(l=>l.leg===leg);
  const route = current && Object.prototype.hasOwnProperty.call(current,'currentRoute') ? current.currentRoute : leg === 'forward' ? value.contractRoute : value.returnRoute, d = route?.destination;
  return !!route && route.qualification !== 'unknown' && !!d && ['street', 'city', 'province', 'postalCode', 'country'].every(k =>
    typeof d[k as keyof typeof d] === 'string' && !!d[k as keyof typeof d]);
}
