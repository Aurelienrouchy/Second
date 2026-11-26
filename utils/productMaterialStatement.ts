import type { ProductMaterialAttributes, ProductMaterialDateDraft, ProductMaterialObservation, ProductMaterialObservationDraft,
  ProductMaterialObservationKey, ProductMaterialReason, ProductMaterialSources, ProductMaterialStatement, ProductMaterialStatementDraft } from '@/types/productMaterialReview';
export const PRODUCT_MATERIAL_REASONS: readonly ProductMaterialReason[] = ['wrong_item', 'size_or_label', 'attribute_mismatch', 'undisclosed_defect',
  'disclosed_wear_difference', 'post_receipt_intervention', 'contradictory_evidence'];
export const PRODUCT_MATERIAL_REASON_LABELS: Record<ProductMaterialReason, string> = {wrong_item: 'Le produit reçu semble différent', size_or_label: 'Taille ou étiquette à comparer',
  attribute_mismatch: 'Couleur, matière ou autre attribut à comparer', undisclosed_defect: 'Défaut que je ne retrouve pas dans les renseignements annoncés',
  disclosed_wear_difference: 'Usure reçue différente de l’usure décrite', post_receipt_intervention: 'Lavage, réparation ou utilisation après réception',
  contradictory_evidence: 'Déclarations ou pièces qui semblent se contredire'};
export const PRODUCT_MATERIAL_OBSERVATION_LIMITS: Record<ProductMaterialObservationKey, number> = {identity: 1000, brand: 300, model: 300, sizeLabel: 300,
  labelText: 2000, condition: 1000, defects: 2000, alterations: 2000, odour: 1000, fitObserved: 1000};
export const PRODUCT_MATERIAL_OBSERVATION_LABELS: Record<ProductMaterialObservationKey, string> = {identity: 'Identification du produit', brand: 'Marque', model: 'Modèle', sizeLabel: 'Taille écrite sur l’étiquette',
  labelText: 'Mentions de l’étiquette', condition: 'État et usure', defects: 'Défauts décrits ou observés', alterations: 'Retouches décrites ou observées', odour: 'Odeur décrite ou observée', fitObserved: 'Comment le vêtement va, selon votre observation'};
export const PRODUCT_MATERIAL_INTERVENTION_LABELS = {washing: 'Lavage', cleaning: 'Nettoyage', repair: 'Réparation', alteration: 'Retouche', use: 'Utilisation', other: 'Autre intervention'} as const;
export const PRODUCT_MATERIAL_QUALIFICATION = {physicalIdentityVerified: false, colorOrMaterialVerified: false, odourVerified: false, measurementsVerified: false,
  sizeConversionVerified: false, faultEstablished: false, chronologyQualification: 'actor_declaration_or_unknown', nativeRecordedAtIsReceiptTime: false} as const;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.trim() === v && v.length <= max;
const nullable = (v: unknown, max: number) => v === null || text(v, max);
const iso = (v: unknown) => v === null || typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const strings = (v: unknown) => v === null || Array.isArray(v) && v.length <= 20 && v.every(s => text(s, 200));
export function isProductMaterialObservation(v: unknown): v is ProductMaterialObservation {
  if (!object(v) || !exact(v, [...Object.keys(PRODUCT_MATERIAL_OBSERVATION_LIMITS), 'sizeSystem', 'colors', 'materials', 'measurements']) ||
    !Object.entries(PRODUCT_MATERIAL_OBSERVATION_LIMITS).every(([k, max]) => nullable(v[k], max)) ||
    v.sizeSystem !== null && !['EU', 'US', 'unknown'].includes(String(v.sizeSystem)) || !strings(v.colors) || !strings(v.materials)) return false;
  return v.measurements === null || Array.isArray(v.measurements) && v.measurements.length <= 20 && v.measurements.every(m => object(m) &&
    exact(m, ['name', 'value', 'unit', 'method']) && text(m.name, 200) && text(m.value, 100) && ['cm', 'mm', 'in', 'unknown'].includes(String(m.unit)) && nullable(m.method, 1000));
}
export function isProductMaterialStatement(v: unknown): v is ProductMaterialStatement {
  const scoped = object(v) && Object.prototype.hasOwnProperty.call(v, 'receivedScope');
  return object(v) && exact(v, ['protocol', 'reason', 'promised', 'received', 'chronology', 'interventions', ...(scoped ? ['receivedScope'] : [])]) &&
    (!scoped || ['purchase_received', 'return_received', 'offered_item', 'unknown'].includes(String(v.receivedScope))) && v.protocol === 'product_material_statement_v1' &&
    PRODUCT_MATERIAL_REASONS.includes(v.reason as ProductMaterialReason) && isProductMaterialObservation(v.promised) && isProductMaterialObservation(v.received) &&
    object(v.chronology) && exact(v.chronology, ['receivedAt', 'inspectedAt', 'complainedAt']) && Object.values(v.chronology).every(iso) &&
    object(v.interventions) && exact(v.interventions, ['state', 'entries']) && ['none_declared', 'declared', 'unknown'].includes(String(v.interventions.state)) &&
    Array.isArray(v.interventions.entries) && v.interventions.entries.length <= 10 && (v.interventions.state === 'declared' ? v.interventions.entries.length > 0 : v.interventions.entries.length === 0) &&
    v.interventions.entries.every(i => object(i) && exact(i, ['kind', 'description', 'occurredAt', 'beforeObservation', 'afterObservation']) &&
      Object.keys(PRODUCT_MATERIAL_INTERVENTION_LABELS).includes(String(i.kind)) && text(i.description, 2000) && iso(i.occurredAt) && nullable(i.beforeObservation, 2000) && nullable(i.afterObservation, 2000));
}
export function productMaterialScopeMatchesRole(statement: ProductMaterialStatement, role: string): boolean {
  return (statement.receivedScope !== 'return_received' || role === 'seller') && (statement.receivedScope !== 'purchase_received' || role === 'buyer');
}
export function isProductMaterialAttributes(v: unknown): v is ProductMaterialAttributes {
  const recordedText = (s: unknown, max: number) => s === null || typeof s === 'string' && !!s.trim() && s.length <= max;
  const recordedStrings = (s: unknown) => s === null || Array.isArray(s) && s.length <= 20 && s.every(value => recordedText(value, 200) && value !== null);
  return object(v) && exact(v, ['brand', 'brandStatus', 'model', 'size', 'colors', 'materials', 'hasKnownDefects', 'defectsDescription', 'hasAlterations', 'alterationsDescription', 'physicalFactsVerified']) &&
    recordedText(v.brand, 300) && recordedText(v.brandStatus, 100) && recordedText(v.model, 300) && object(v.size) && exact(v.size, ['value', 'system', 'conversionVerified']) &&
    recordedText(v.size.value, 300) && (v.size.system === null || ['EU', 'US'].includes(String(v.size.system))) && v.size.conversionVerified === false && recordedStrings(v.colors) && recordedStrings(v.materials) &&
    (v.hasKnownDefects === null || typeof v.hasKnownDefects === 'boolean') && recordedText(v.defectsDescription, 4000) &&
    (v.hasAlterations === null || typeof v.hasAlterations === 'boolean') && recordedText(v.alterationsDescription, 4000) && v.physicalFactsVerified === false;
}
export function isProductMaterialSources(v: unknown): v is ProductMaterialSources {
  return object(v) && exact(v, ['protocol', 'contract', 'currentListing', 'received', 'currentListingSuppliesMissingContract', 'comparisonsCertified']) && v.protocol === 'product_material_sources_v1' &&
    object(v.contract) && exact(v.contract, ['qualification', 'content']) && ['native_order_snapshot_recorded', 'unknown'].includes(String(v.contract.qualification)) && isProductMaterialAttributes(v.contract.content) &&
    object(v.currentListing) && exact(v.currentListing, ['qualification', 'content']) && ['current_listing_recorded', 'unknown'].includes(String(v.currentListing.qualification)) && isProductMaterialAttributes(v.currentListing.content) &&
    object(v.received) && exact(v.received, ['qualification', 'source', 'physicalFactsVerified']) && v.received.qualification === 'unknown' && v.received.source === 'separate_participant_declaration' && v.received.physicalFactsVerified === false &&
    v.currentListingSuppliesMissingContract === false && v.comparisonsCertified === false;
}
const emptyDate = (): ProductMaterialDateDraft => ({precision: null, value: ''});
export function emptyProductMaterialObservation(): ProductMaterialObservationDraft {
  return {identity: '', brand: '', model: '', sizeLabel: '', labelText: '', condition: '', defects: '', alterations: '', odour: '', fitObserved: '',
    sizeSystem: null, colors: '', materials: '', measurements: []};
}
export function emptyProductMaterialStatementDraft(): ProductMaterialStatementDraft {
  return {reason: null, statement: '', promised: emptyProductMaterialObservation(), received: emptyProductMaterialObservation(),
    chronology: {receivedAt: emptyDate(), inspectedAt: emptyDate(), complainedAt: emptyDate()}, interventions: {state: null, entries: []}, receivedScope: null};
}
export function isProductMaterialStatementDraft(v: unknown): v is ProductMaterialStatementDraft {
  const rawText = (s: unknown, max: number) => typeof s === 'string' && s.length <= max;
  const draftId = (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(s);
  const draftDate = (s: unknown) => object(s) && exact(s, ['precision', 'value']) && (s.precision === null || ['unknown', 'civil_day', 'instant'].includes(String(s.precision))) && rawText(s.value, 24);
  const observation = (s: unknown) => object(s) && exact(s, [...Object.keys(PRODUCT_MATERIAL_OBSERVATION_LIMITS), 'sizeSystem', 'colors', 'materials', 'measurements']) &&
    Object.entries(PRODUCT_MATERIAL_OBSERVATION_LIMITS).every(([key, max]) => rawText(s[key], max)) &&
    (s.sizeSystem === null || ['EU', 'US', 'unknown'].includes(String(s.sizeSystem))) && rawText(s.colors, 4200) && rawText(s.materials, 4200) &&
    Array.isArray(s.measurements) && s.measurements.length <= 20 && new Set(s.measurements.map(m => object(m) ? m.draftId : null)).size === s.measurements.length && s.measurements.every(m => object(m) &&
      exact(m, ['draftId', 'name', 'value', 'unit', 'method']) && draftId(m.draftId) && rawText(m.name, 200) && rawText(m.value, 100) &&
      (m.unit === null || ['cm', 'mm', 'in', 'unknown'].includes(String(m.unit))) && rawText(m.method, 1000));
  const scoped = object(v) && Object.prototype.hasOwnProperty.call(v, 'receivedScope');
  return object(v) && exact(v, ['reason', 'statement', 'promised', 'received', 'chronology', 'interventions', ...(scoped ? ['receivedScope'] : [])]) &&
    (!scoped || v.receivedScope === null || ['purchase_received', 'return_received', 'offered_item', 'unknown'].includes(String(v.receivedScope))) &&
    (v.reason === null || PRODUCT_MATERIAL_REASONS.includes(v.reason as ProductMaterialReason)) && rawText(v.statement, 3000) && observation(v.promised) && observation(v.received) &&
    object(v.chronology) && exact(v.chronology, ['receivedAt', 'inspectedAt', 'complainedAt']) && Object.values(v.chronology).every(draftDate) &&
    object(v.interventions) && exact(v.interventions, ['state', 'entries']) && (v.interventions.state === null || ['none_declared', 'declared', 'unknown'].includes(String(v.interventions.state))) &&
    Array.isArray(v.interventions.entries) && v.interventions.entries.length <= 10 && new Set(v.interventions.entries.map(i => object(i) ? i.draftId : null)).size === v.interventions.entries.length &&
    v.interventions.entries.every(i => object(i) && exact(i, ['draftId', 'kind', 'description', 'date', 'beforeObservation', 'afterObservation']) && draftId(i.draftId) &&
      (i.kind === null || Object.keys(PRODUCT_MATERIAL_INTERVENTION_LABELS).includes(String(i.kind))) && rawText(i.description, 1700) && draftDate(i.date) &&
      rawText(i.beforeObservation, 2000) && rawText(i.afterObservation, 2000));
}
const normalize = (value: string) => value.trim() || null;
function observations(d: ProductMaterialObservationDraft): ProductMaterialObservation {
  const list = (value: string) => value.trim() ? value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : null;
  return {identity: normalize(d.identity), brand: normalize(d.brand), model: normalize(d.model), sizeLabel: normalize(d.sizeLabel), labelText: normalize(d.labelText),
    condition: normalize(d.condition), defects: normalize(d.defects), alterations: normalize(d.alterations), odour: normalize(d.odour), fitObserved: normalize(d.fitObserved),
    sizeSystem: d.sizeSystem, colors: list(d.colors), materials: list(d.materials), measurements: d.measurements.length ? d.measurements.map(m => {
      if (!m.unit) throw new Error('Choisissez une unité pour chaque mesure, ou indiquez que vous ne la connaissez pas.');
      return {name: m.name.trim(), value: m.value.trim(), unit: m.unit, method: normalize(m.method)};
    }) : null};
}
/** Civil-day knowledge remains a narrative; no midnight or timezone is manufactured. */
function declaredDate(d: ProductMaterialDateDraft, label: string, nowMs: number): {instant: string | null; note: string | null} {
  if (d.precision === null || d.precision === 'unknown') return {instant: null, note: null};
  if (d.precision === 'instant') {
    const value = d.value.trim(); if (!iso(value) || !value || Date.parse(value) > nowMs) throw new Error(`${label} : une date et heure réelles, non futures, sont requises.`);
    return {instant: value, note: null};
  }
  const value = d.value.trim(), day = new Date(`${value}T00:00:00.000Z`), now = new Date(nowMs);
  const today = `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value || value > today)
    throw new Error(`${label} : indiquez un jour civil réel et non futur.`);
  return {instant: null, note: `${label} : jour déclaré ${value} ; heure et fuseau non déclarés. La date structurée reste inconnue.`};
}
export {declaredDate as productReviewDeclaredDate};
export function buildProductMaterialStatement(d: ProductMaterialStatementDraft, nowMs = Date.now()): {statement: string; materialStatement: ProductMaterialStatement} {
  if (!d.reason || !d.interventions.state || !d.receivedScope) throw new Error('Choisissez un motif, l’étape du produit observé et renseignez les interventions, y compris si vous ne les connaissez pas.');
  const received = declaredDate(d.chronology.receivedAt, 'Réception', nowMs), inspected = declaredDate(d.chronology.inspectedAt, 'Inspection', nowMs), complained = declaredDate(d.chronology.complainedAt, 'Première contestation', nowMs);
  const statement = [d.statement.trim(), received.note, inspected.note, complained.note].filter(Boolean).join('\n');
  const materialStatement: ProductMaterialStatement = {protocol: 'product_material_statement_v1', reason: d.reason, promised: observations(d.promised), received: observations(d.received),
    chronology: {receivedAt: received.instant, inspectedAt: inspected.instant, complainedAt: complained.instant},
    receivedScope: d.receivedScope, interventions: {state: d.interventions.state, entries: d.interventions.state === 'declared' ? d.interventions.entries.map(entry => {
      if (!entry.kind) throw new Error('Choisissez le type de chaque intervention.'); const date = declaredDate(entry.date, 'Intervention', nowMs);
      return {kind: entry.kind, description: [entry.description.trim(), date.note].filter(Boolean).join('\n'), occurredAt: date.instant,
        beforeObservation: normalize(entry.beforeObservation), afterObservation: normalize(entry.afterObservation)};
    }) : []}};
  if (!text(statement, 4000) || !isProductMaterialStatement(materialStatement)) throw new Error('Complétez les renseignements requis et respectez les limites affichées.');
  return {statement, materialStatement};
}
