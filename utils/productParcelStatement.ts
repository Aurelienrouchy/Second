import type { ProductParcelAssessment, ProductParcelCorpusReview, ProductParcelOperatorRoutes, ProductParcelReason, ProductParcelSources, ProductParcelStatement, ProductParcelStatementDraft } from '@/types/productParcelReview';
import { isProductRoutingStatementDraft, buildProductRoutingStatement } from '@/utils/productRoutingStatement';
import type { ProductRoutingStatement } from '@/types/productRoutingReview';
import type {ProductMixedOrderStatement} from '@/types/productMixedOrders';
import {isProductMixedOrderDraft,buildProductMixedOrderStatement} from '@/utils/productMixedOrderStatement';
import { productReviewDeclaredDate } from '@/utils/productMaterialStatement';
export const PRODUCT_PARCEL_REASONS = ['loss_document', 'parcel_damage', 'return_parcel_integrity', 'delivery_not_received', 'delivery_location', 'third_party_delivery', 'deposit_disappearance'] as const;
export const PRODUCT_PARCEL_MIXED_REASON='mixed_order_observation' as const;
export const PRODUCT_PARCEL_REASON_LABELS: Record<ProductParcelReason, string> = {loss_document: 'Document de perte déclaré', parcel_damage: 'Colis endommagé', return_parcel_integrity: 'Intégrité ou contenu du colis de retour', delivery_not_received: 'Remise annoncée mais colis non reçu', delivery_location: 'Lieu de livraison contesté', third_party_delivery: 'Remise déclarée à un tiers', deposit_disappearance: 'Dépôt puis disparition déclarée',mixed_order_observation:'Observation de contenu mélangé ou d’étiquettes échangées'};
export const PRODUCT_PARCEL_QUALIFICATION = {parcelPossessionVerified: false, packageContentsVerified: false, massVerified: false, weightConversionApplied: false, recipientAuthorizationVerified: false, signatureIsAgreement: false, officialLossVerified: false, responsibilityEstablished: false, insurancePaymentPromised: false, recoveryOrInventoryPermissionGranted: false} as const;
export const PARCEL_CHOICES = {
  leg: ['forward', 'return'], receipt: ['received', 'not_received', 'unknown'], seal: ['intact_declared', 'broken_declared', 'absent_declared', 'unknown'], opening: ['opened_declared', 'unopened_declared', 'unknown'],
  unit: ['g', 'kg', 'lb', 'oz', 'unknown'], source: ['actor_measurement', 'carrier_document', 'other_document', 'unknown'], phase: ['before_shipping', 'at_handover', 'at_receipt', 'after_opening', 'unknown'],
  party: ['sender', 'carrier', 'recipient', 'third_party', 'unknown'], recipient: ['declared_third_party', 'unknown'], authorization: ['affirmed', 'denied', 'unknown'], signature: ['declared_present', 'declared_absent', 'unknown'],
  deposit: ['admitted', 'contested', 'unknown'], issuerRole: ['carrier', 'insurer', 'other', 'unknown'], conclusion: ['loss_declared', 'investigation_pending', 'other', 'unknown'], evidenceAvailability: ['available', 'unavailable', 'unknown'],
  deliveryFinding: ['receipt_declared', 'nonreceipt_declared', 'contested', 'unknown'], locationComparison: ['difference_documented', 'no_difference_documented', 'unknown'], lossDocumentFinding: ['document_examined', 'not_provided', 'unknown'],
  parcelContentsFinding: ['observations_examined', 'contested', 'unknown'], responsibility: ['not_determined', 'separate_assessment_required'], costTreatment: ['no_cost_decision', 'separate_financial_decision_required', 'unknown'],
} as const;
export const PARCEL_CHOICE_LABELS: Record<string, string> = {forward: 'Trajet aller', return: 'Trajet retour', received: 'Réception déclarée', not_received: 'Non-réception déclarée', unknown: 'Inconnu',
  intact_declared: 'Scellé déclaré intact', broken_declared: 'Scellé déclaré brisé', absent_declared: 'Absence de scellé déclarée', opened_declared: 'Ouverture déclarée', unopened_declared: 'Colis déclaré non ouvert',
  g: 'g', kg: 'kg', lb: 'lb', oz: 'oz', actor_measurement: 'Mesure personnelle déclarée', carrier_document: 'Document de transporteur déclaré', other_document: 'Autre document déclaré',
  before_shipping: 'Avant expédition', at_handover: 'À la remise', at_receipt: 'À la réception', after_opening: 'Après ouverture', sender: 'Expéditeur', carrier: 'Transporteur', recipient: 'Destinataire', third_party: 'Tiers',
  declared_third_party: 'Remise à un tiers déclarée', affirmed: 'Autorisation affirmée', denied: 'Autorisation contestée', declared_present: 'Signature déclarée présente', declared_absent: 'Signature déclarée absente',
  admitted: 'Dépôt admis selon ma déclaration', contested: 'Contesté', insurer: 'Assureur', other: 'Autre', loss_declared: 'Perte déclarée dans le document', investigation_pending: 'Enquête en cours déclarée',
  available: 'Pièces disponibles selon moi', unavailable: 'Pièces indisponibles selon moi', receipt_declared: 'Réception déclarée', nonreceipt_declared: 'Non-réception déclarée', difference_documented: 'Différence documentée', no_difference_documented: 'Aucune différence documentée',
  document_examined: 'Document examiné', not_provided: 'Document non fourni', observations_examined: 'Observations examinées', not_determined: 'Responsabilité non déterminée', separate_assessment_required: 'Appréciation distincte nécessaire',
  no_cost_decision: 'Aucune décision sur les frais', separate_financial_decision_required: 'Décision financière distincte nécessaire'};
export const PARCEL_CLOCK_LABELS = {shippedAt: 'Expédition déclarée', deliveredAt: 'Remise annoncée selon la déclaration', receivedAt: 'Réception déclarée', openedAt: 'Ouverture déclarée', observedAt: 'Constat déclaré', reportedAt: 'Signalement déclaré'};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const count = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const draftDate = (v: unknown) => object(v) && exact(v, ['precision', 'value']) && (v.precision === null || ['unknown', 'civil_day', 'instant'].includes(String(v.precision))) && typeof v.value === 'string' && v.value.length <= 24;
function statement(v: unknown, draft: boolean,nativeMixedStatementPresent=false): boolean {
  const routing = draft && object(v) && Object.hasOwn(v, 'routingStatement');
  const mixed = draft && object(v) && Object.hasOwn(v,'mixedOrderStatement');
  const choice = (s: unknown, options: readonly string[]) => draft && s === null || options.includes(String(s));
  const text = (s: unknown, max: number) => s === null || typeof s === 'string' && s.length <= max && (draft || !!s.trim() && s.trim() === s);
  const date = (s: unknown) => draft ? draftDate(s) : s === null || iso(s) && Date.parse(s) <= Date.now();
  const key = (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(s);
  if (!object(v) || !exact(v, ['reason', 'leg', 'labelId', 'receipt', 'packaging', 'parcel', 'contents', 'seal', 'opening', 'weights', 'handover', 'location', 'thirdParty', 'deposit', 'chronology', 'lossDocument', 'evidenceAvailability', 'evidenceLimitations', draft ? 'statement' : 'protocol', ...(routing ? ['routingStatement'] : []),...(mixed?['mixedOrderStatement']:[])]) ||
    (draft ? typeof v.statement !== 'string' || v.statement.length > 2500 : v.protocol !== 'product_parcel_statement_v1') || !(choice(v.reason, PRODUCT_PARCEL_REASONS)||(draft?mixed&&isProductMixedOrderDraft(v.mixedOrderStatement):nativeMixedStatementPresent)&&v.reason===PRODUCT_PARCEL_MIXED_REASON) || !choice(v.leg, PARCEL_CHOICES.leg) ||
    !(v.labelId === null || draft && v.labelId === '' || id(v.labelId)) || !choice(v.receipt, PARCEL_CHOICES.receipt) || !choice(v.seal, PARCEL_CHOICES.seal) || !choice(v.opening, PARCEL_CHOICES.opening) ||
    !text(v.packaging, 2000) || !text(v.parcel, 2000) || !text(v.contents, 3000) || !text(v.location, 2000) || !text(v.evidenceLimitations, 2000) || !choice(v.evidenceAvailability, PARCEL_CHOICES.evidenceAvailability) ||
    !Array.isArray(v.weights) || v.weights.length > 10 || !Array.isArray(v.handover) || v.handover.length > 20 || !object(v.thirdParty) || !exact(v.thirdParty, ['recipient', 'authorization', 'signature', 'reference']) ||
    !choice(v.thirdParty.recipient, PARCEL_CHOICES.recipient) || !choice(v.thirdParty.authorization, PARCEL_CHOICES.authorization) || !choice(v.thirdParty.signature, PARCEL_CHOICES.signature) || !text(v.thirdParty.reference, 500) ||
    !object(v.deposit) || !exact(v.deposit, ['state', 'location', 'disappearanceAt']) || !choice(v.deposit.state, PARCEL_CHOICES.deposit) || !text(v.deposit.location, 1000) || !date(v.deposit.disappearanceAt) ||
    !object(v.chronology) || !exact(v.chronology, Object.keys(PARCEL_CLOCK_LABELS)) || !Object.values(v.chronology).every(date)) return false;
  if (routing && !isProductRoutingStatementDraft(v.routingStatement)) return false;
  if (mixed && !isProductMixedOrderDraft(v.mixedOrderStatement)) return false;
  if (!v.weights.every(w => object(w) && exact(w, ['value', 'unit', 'method', 'source', 'occurredAt', 'phase', ...(draft ? ['draftId'] : [])]) && (!draft || key(w.draftId)) &&
    text(w.value, 100) && text(w.method, 1000) && choice(w.unit, PARCEL_CHOICES.unit) && choice(w.source, PARCEL_CHOICES.source) && choice(w.phase, PARCEL_CHOICES.phase) && date(w.occurredAt)) ||
    !v.handover.every(h => object(h) && exact(h, ['from', 'to', 'occurredAt', 'observation', 'reference', ...(draft ? ['draftId'] : [])]) && (!draft || key(h.draftId)) &&
      choice(h.from, PARCEL_CHOICES.party) && choice(h.to, PARCEL_CHOICES.party) && date(h.occurredAt) && text(h.observation, 1000) && text(h.reference, 500))) return false;
  if (draft && (new Set(v.weights.map(w => w.draftId)).size !== v.weights.length || new Set(v.handover.map(h => h.draftId)).size !== v.handover.length)) return false;
  const loss = v.lossDocument;
  return loss === null || object(loss) && exact(loss, ['issuer', 'issuerRole', 'reference', 'issuedAt', 'labelId', 'conclusion']) && text(loss.issuer, 500) && choice(loss.issuerRole, PARCEL_CHOICES.issuerRole) &&
    text(loss.reference, 500) && date(loss.issuedAt) && text(loss.labelId, 200) && choice(loss.conclusion, PARCEL_CHOICES.conclusion);
}
export const isProductParcelStatement = (v: unknown,nativeMixedStatementPresent=false): v is ProductParcelStatement => statement(v, false,nativeMixedStatementPresent);
export const isProductParcelStatementDraft = (v: unknown): v is ProductParcelStatementDraft => statement(v, true);
export const productParcelRoleMatches = (s: ProductParcelStatement, role: string) => s.receipt === 'unknown' || role === (s.leg === 'forward' ? 'buyer' : 'seller');
export function isProductParcelAssessment(v: unknown): v is ProductParcelAssessment {
  return object(v) && exact(v, ['protocol', 'leg', 'labelId', 'deliveryFinding', 'locationComparison', 'lossDocumentFinding', 'parcelContentsFinding', 'responsibility', 'costTreatment', 'motivation', 'evidenceLimitations', 'availableSourcesOnlyAcknowledged']) &&
    v.protocol === 'product_parcel_assessment_v1' && PARCEL_CHOICES.leg.includes(v.leg as 'forward') && (v.labelId === null || id(v.labelId)) &&
    (['deliveryFinding', 'locationComparison', 'lossDocumentFinding', 'parcelContentsFinding', 'responsibility', 'costTreatment'] as const).every(k => (PARCEL_CHOICES[k] as readonly string[]).includes(String(v[k]))) &&
    ['motivation', 'evidenceLimitations'].every(k => typeof v[k] === 'string' && !!v[k].trim() && v[k].trim() === v[k] && v[k].length <= 4000) && v.availableSourcesOnlyAcknowledged === true;
}
export function isProductParcelCorpusReview(v: unknown): v is ProductParcelCorpusReview {
  return object(v) && exact(v, ['protocol', 'integrityQualified', 'availableEvidenceComplete', 'evidenceAvailability', 'photoAbsenceDoesNotProveNonreceipt', 'observationsRemainUnverified']) && v.protocol === 'product_parcel_corpus_review_v1' &&
    typeof v.integrityQualified === 'boolean' && typeof v.availableEvidenceComplete === 'boolean' && (!v.availableEvidenceComplete || v.integrityQualified) && v.photoAbsenceDoesNotProveNonreceipt === true && v.observationsRemainUnverified === true &&
    Array.isArray(v.evidenceAvailability) && v.evidenceAvailability.length <= 100 && v.evidenceAvailability.every(r => object(r) && exact(r, ['contributionId', 'declared', 'nativeFileReceived']) &&
      typeof r.contributionId === 'string' && !!r.contributionId && !r.contributionId.includes('/') && PARCEL_CHOICES.evidenceAvailability.includes(r.declared as 'unknown') && typeof r.nativeFileReceived === 'boolean') && new Set(v.evidenceAvailability.map(r => r.contributionId)).size === v.evidenceAvailability.length;
}
export function isProductParcelSources(v: unknown): v is ProductParcelSources {
  const address = (a: unknown) => a === null || object(a) && exact(a, ['city', 'province', 'country']) && Object.values(a).every(x => x === null || typeof x === 'string' && x.length <= 500);
  const nonnegative = (n: unknown) => n === null || typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const time = (n: unknown) => n === null || count(n) && n <= Date.now();
  const route = (r: unknown, expected: string) => object(r) && exact(r, ['qualification', 'origin', 'destination', 'parcel', 'sourceHash', 'exactAddressPrivate', 'profileAddressUsed']) &&
    [expected, 'unknown'].includes(String(r.qualification)) && r.exactAddressPrivate === true && r.profileAddressUsed === false && address(r.origin) && address(r.destination) &&
    (r.qualification === 'unknown' ? r.origin === null && r.destination === null && r.parcel === null && r.sourceHash === null : hash(r.sourceHash) && object(r.parcel) && exact(r.parcel, ['weight', 'dimensions', 'measurementVerified']) &&
      object(r.parcel.weight) && exact(r.parcel.weight, ['value', 'unit']) && nonnegative(r.parcel.weight.value) && (r.parcel.weight.unit === null || ['gram', 'kilogram', 'ounce', 'pound'].includes(String(r.parcel.weight.unit))) &&
      object(r.parcel.dimensions) && exact(r.parcel.dimensions, ['length', 'width', 'height', 'unit']) && ['length', 'width', 'height'].every(k => nonnegative((r.parcel as {dimensions: Record<string, unknown>}).dimensions[k])) &&
      (r.parcel.dimensions.unit === null || ['centimeter', 'inch'].includes(String(r.parcel.dimensions.unit))) && r.parcel.measurementVerified === false);
  if (!object(v) || !exact(v, ['protocol', 'contractRoute', 'returnRoute', 'legs', ...Object.keys(PRODUCT_PARCEL_QUALIFICATION)]) || v.protocol !== 'product_parcel_sources_v1' ||
    !Object.entries(PRODUCT_PARCEL_QUALIFICATION).every(([k, value]) => v[k] === value) || !route(v.contractRoute, 'native_contract_snapshot') || !route(v.returnRoute, 'native_frozen_return_source') || !Array.isArray(v.legs) || v.legs.length !== 2) return false;
  return v.legs.every((l, index) => {
    if (!object(l) || !exact(l, ['leg', 'qualification', 'identity', 'labelHistoryReference', 'tracking', 'observation']) || l.leg !== PARCEL_CHOICES.leg[index] || !['native_current_label', 'unknown'].includes(String(l.qualification))) return false;
    const i = l.identity, t = l.tracking, o = l.observation, h = l.labelHistoryReference;
    if (l.qualification === 'native_current_label' ? !object(i) || !exact(i, ['labelId', 'trackingNumber', 'carrierCode', 'shipmentId', 'carrierId', 'serviceCode', 'sourceHash', 'leg']) || !id(i.labelId) || i.leg !== l.leg || !hash(i.sourceHash) ||
      typeof i.trackingNumber !== 'string' || !i.trackingNumber.trim() || i.trackingNumber.length > 200 || typeof i.carrierCode !== 'string' || !/^[a-z0-9_]{1,100}$/.test(i.carrierCode) || !['shipmentId', 'carrierId', 'serviceCode'].every(k => i[k] === null || typeof i[k] === 'string' && !!i[k] && i[k].length <= 200) : i !== null) return false;
    if (!(h === null || object(h) && exact(h, ['caseId', 'entryId', 'contentHash']) && ['caseId', 'entryId'].every(k => h[k] === null || typeof h[k] === 'string' && !!h[k] && !h[k].includes('/')) && (h.contentHash === null || hash(h.contentHash))) || !object(t) || !object(o)) return false;
    return (t.qualification === 'unknown' ? exact(t, ['qualification']) : t.qualification === 'native_current_capture' && exact(t, ['qualification', 'captureId', 'displayHash', 'sourceHash', 'readVersion', 'providerStatusCode', 'providerEventAtMs', 'observedAt', 'suppliedHistoryOnly', 'recipientReceiptVerified']) &&
      object(i) && t.sourceHash === i.sourceHash && typeof t.captureId === 'string' && /^tracking_[a-f0-9]{64}$/.test(t.captureId) && hash(t.displayHash) && count(t.readVersion) && t.readVersion > 0 && typeof t.providerStatusCode === 'string' && t.providerStatusCode.length <= 64 && time(t.providerEventAtMs) && iso(t.observedAt) && t.suppliedHistoryOnly === true && t.recipientReceiptVerified === false) &&
      (o.qualification === 'unknown' ? exact(o, ['qualification']) : o.qualification === 'native_current_observation' && exact(o, ['qualification', 'statusCode', 'sourceHash', 'observedContentHash', 'providerEventAtMs']) && object(i) && o.sourceHash === i.sourceHash && typeof o.statusCode === 'string' && o.statusCode.length <= 64 && hash(o.observedContentHash) && time(o.providerEventAtMs));
  });
}
const emptyDate = () => ({precision: null, value: ''} as const);
export function isProductParcelOperatorRoutes(v: unknown, source: ProductParcelSources, sourceHash: string, corpusHash: string, routeAmendment = false): v is ProductParcelOperatorRoutes {
  if (!object(v) || !exact(v, ['protocol', 'sourceHash', 'corpusHash', 'contractRoute', 'returnRoute', 'destinationQualification', 'exactAddressSource', 'profileAddressUsed', 'thirdPartyContactsSupplied', 'comparisonPermissionGranted', 'financialEffectAuthorized', 'inventoryEffectAuthorized', 'shippingPermissionGranted', ...(routeAmendment ? ['currentRoutes'] : [])]) ||
    v.protocol !== 'product_parcel_operator_routes_v1' || v.sourceHash !== sourceHash || v.corpusHash !== corpusHash || v.exactAddressSource !== 'private_native_route_capture' ||
    !['profileAddressUsed', 'thirdPartyContactsSupplied', 'comparisonPermissionGranted', 'financialEffectAuthorized', 'inventoryEffectAuthorized', 'shippingPermissionGranted'].every(k => v[k] === false) ||
    !object(v.destinationQualification) || !exact(v.destinationQualification, ['forward', 'return'])) return false;
  const destinationQualification = v.destinationQualification;
  const address = (a: unknown) => a === null || object(a) && exact(a, ['street', 'line2', 'city', 'province', 'postalCode', 'country']) && Object.values(a).every(value => value === null || typeof value === 'string' && value.length <= 500);
  const completeDestination = (r: unknown) => object(r) && r.qualification !== 'unknown' && object(r.destination) && ['street', 'city', 'province', 'postalCode', 'country'].every(k => typeof (r.destination as Record<string, unknown>)[k] === 'string' && !!(r.destination as Record<string, unknown>)[k]);
  if (!( ['contractRoute', 'returnRoute'] as const).every((key) => {
    const route = v[key], publicRoute = source[key];
    if (!object(route) || !exact(route, ['qualification', 'origin', 'destination', 'parcel', 'sourceHash']) || route.qualification !== publicRoute.qualification || route.sourceHash !== publicRoute.sourceHash || JSON.stringify(route.parcel) !== JSON.stringify(publicRoute.parcel)) return false;
    for (const endpoint of ['origin', 'destination'] as const) {
      const address = route[endpoint], publicAddress = publicRoute[endpoint];
      if (address === null ? publicAddress !== null : !object(address) || !exact(address, ['street', 'line2', 'city', 'province', 'postalCode', 'country']) || !Object.values(address).every(value => value === null || typeof value === 'string' && value.length <= 500) ||
        !publicAddress || ['city', 'province', 'country'].some(field => address[field] !== publicAddress[field as keyof typeof publicAddress])) return false;
    }
    return true;
  })) return false;
  if (routeAmendment) {
    if (!Array.isArray(v.currentRoutes) || v.currentRoutes.length !== 2 || !v.currentRoutes.every((row, index) => {
      if (!object(row) || !exact(row, ['leg', 'route', 'legacyContractSuppliesCurrentRoute']) || row.leg !== PARCEL_CHOICES.leg[index] || row.legacyContractSuppliesCurrentRoute !== false) return false;
      const r = row.route; if (r === null) return true;
      if (!object(r) || !exact(r, ['qualification', 'origin', 'destination', 'parcel', 'sourceHash', 'labelId']) || !address(r.origin) || !address(r.destination)) return false;
      if (r.qualification === 'unknown') return r.origin === null && r.destination === null && r.parcel === null && r.sourceHash === null && r.labelId === null;
      if (r.qualification !== 'native_current_label_route' || !hash(r.sourceHash) || !id(r.labelId) || r.labelId !== source.legs[index]?.identity?.labelId || !object(r.parcel) || !exact(r.parcel, ['weight', 'dimensions', 'measurementVerified']) || r.parcel.measurementVerified !== false) return false;
      const w = r.parcel.weight, d = r.parcel.dimensions, number = (n: unknown) => n === null || typeof n === 'number' && Number.isFinite(n) && n >= 0;
      return object(w) && exact(w, ['value', 'unit']) && number(w.value) && (w.unit === null || ['gram', 'kilogram', 'ounce', 'pound'].includes(String(w.unit))) && object(d) && exact(d, ['length', 'width', 'height', 'unit']) && ['length', 'width', 'height'].every(k => number(d[k])) && (d.unit === null || ['centimeter', 'inch'].includes(String(d.unit)));
    })) return false;
  }
  return PARCEL_CHOICES.leg.every((leg, index) => {
    const declared = destinationQualification[leg];
    if (declared === 'unknown') return true;
    const current = routeAmendment && Array.isArray(v.currentRoutes) ? v.currentRoutes[index]?.route : null;
    return declared === 'native_exact_destination' && completeDestination(current ?? v[index === 0 ? 'contractRoute' : 'returnRoute']);
  });
}
export function emptyProductParcelStatementDraft(): ProductParcelStatementDraft {
  return {reason: null, leg: null, labelId: '', receipt: null, packaging: '', parcel: '', contents: '', seal: null, opening: null, weights: [], handover: [], location: '',
    thirdParty: {recipient: null, authorization: null, signature: null, reference: ''}, deposit: {state: null, location: '', disappearanceAt: emptyDate()},
    chronology: {shippedAt: emptyDate(), deliveredAt: emptyDate(), receivedAt: emptyDate(), openedAt: emptyDate(), observedAt: emptyDate(), reportedAt: emptyDate()}, lossDocument: null, evidenceAvailability: null, evidenceLimitations: '', statement: ''};
}
export function buildProductParcelStatement(draft: ProductParcelStatementDraft, nowMs = Date.now()): {statement: string; parcelStatement: ProductParcelStatement; routingStatement?: ProductRoutingStatement;mixedOrderStatement?:ProductMixedOrderStatement} {
  if (!isProductParcelStatementDraft(draft)) throw new Error('Le brouillon de constat doit être relu.');
  const notes: string[] = [], text = (v: string | null) => v?.trim() || null;
  const date = (d: import('@/types/productMaterialReview').ProductMaterialDateDraft, label: string) => {const result = productReviewDeclaredDate(d, label, nowMs); if (result.note) notes.push(result.note); return result.instant;};
  const {statement: narrative, routingStatement: routingDraft,mixedOrderStatement:mixedDraft, ...fields} = draft;
  const value = {...fields, protocol: 'product_parcel_statement_v1', labelId: text(draft.labelId), packaging: text(draft.packaging), parcel: text(draft.parcel), contents: text(draft.contents), location: text(draft.location), evidenceLimitations: text(draft.evidenceLimitations),
    thirdParty: {...draft.thirdParty, reference: text(draft.thirdParty.reference)}, deposit: {...draft.deposit, location: text(draft.deposit.location), disappearanceAt: date(draft.deposit.disappearanceAt, 'Disparition déclarée')},
    chronology: Object.fromEntries(Object.entries(draft.chronology).map(([key, value]) => [key, date(value, PARCEL_CLOCK_LABELS[key as keyof typeof PARCEL_CLOCK_LABELS])])),
    weights: draft.weights.map(({draftId: _draftId, ...w}, index) => ({...w, value: text(w.value), method: text(w.method), occurredAt: date(w.occurredAt, `Pesée déclarée ${index + 1}`)})),
    handover: draft.handover.map(({draftId: _draftId, ...h}, index) => ({...h, observation: text(h.observation), reference: text(h.reference), occurredAt: date(h.occurredAt, `Remise déclarée ${index + 1}`)})),
    lossDocument: draft.lossDocument ? {...draft.lossDocument, issuer: text(draft.lossDocument.issuer), reference: text(draft.lossDocument.reference), labelId: text(draft.lossDocument.labelId), issuedAt: date(draft.lossDocument.issuedAt, 'Document de perte déclaré')} : null};
  const statement = [narrative.trim(), ...notes].filter(Boolean).join('\n');
  if (!statement || statement.length > 4000 || !isProductParcelStatement(value,!!mixedDraft)) throw new Error('Choisissez chaque qualification, y compris « Inconnu », et complétez le récit dans les limites affichées.');
  const routing = routingDraft ? buildProductRoutingStatement(routingDraft, value.leg, value.labelId, nowMs) : null;
  const mixed=mixedDraft?buildProductMixedOrderStatement(mixedDraft,value.leg,value.labelId,nowMs):null;
  const textWithRoutingDate = [statement, routing?.dateNote,mixed?.dateNote].filter(Boolean).join('\n');
  if (textWithRoutingDate.length > 4000) throw new Error('Le récit et ses précisions de dates dépassent la limite.');
  return {statement: textWithRoutingDate, parcelStatement: value, ...(routing ? {routingStatement: routing.routingStatement} : {}),...(mixed?{mixedOrderStatement:mixed.mixedOrderStatement}:{})};
}
