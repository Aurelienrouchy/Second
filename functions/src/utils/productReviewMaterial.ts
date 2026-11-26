/** Declared comparisons. No conversion, diagnosis or physical certification. */
import {HttpsError} from 'firebase-functions/v2/https';
import {supportDeclaredDate, supportObject, supportText} from './supportRequest';
export const PRODUCT_MATERIAL_REVIEW_ENABLED: boolean = true;
/** Call only after exact native servicing, before any NEW source or IO. */
export function assertProductMaterialNewOpen(material: boolean) {
  if (material && !PRODUCT_MATERIAL_REVIEW_ENABLED) throw new HttpsError('failed-precondition', 'Le parcours de comparaison matérielle est en préparation.',
    {reason: 'product_material_review_not_exposed', capability: 'product_review_material_v1'});
}

export const PRODUCT_MATERIAL_REASONS = ['wrong_item', 'size_or_label', 'attribute_mismatch', 'undisclosed_defect',
  'disclosed_wear_difference', 'post_receipt_intervention', 'contradictory_evidence'] as const;
const OBSERVATION_TEXT = {identity: 1000, brand: 300, model: 300, sizeLabel: 300, labelText: 2000,
  condition: 1000, defects: 2000, alterations: 2000, odour: 1000, fitObserved: 1000} as const;
const nullableText = (value: unknown, max: number) => value == null ? null : supportText(value, 'Observation déclarée', max);
function declaredStrings(value: unknown) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 20) throw new HttpsError('invalid-argument', 'Liste déclarée hors limite.');
  return value.map(v => supportText(v, 'Attribut déclaré', 200));
}
function observation(value: unknown) {
  const o = supportObject(value, [...Object.keys(OBSERVATION_TEXT), 'sizeSystem', 'colors', 'materials', 'measurements']);
  if (o.sizeSystem !== null && !['EU', 'US', 'unknown'].includes(o.sizeSystem)) throw new HttpsError('invalid-argument', 'Système de taille explicite ou inconnu requis.');
  if (o.measurements != null && (!Array.isArray(o.measurements) || o.measurements.length > 20)) throw new HttpsError('invalid-argument', 'Mesures déclarées hors limite.');
  const measurements = o.measurements == null ? null : o.measurements.map((value: unknown) => {
    const m = supportObject(value, ['name', 'value', 'unit', 'method']);
    if (!['cm', 'mm', 'in', 'unknown'].includes(m.unit)) throw new HttpsError('invalid-argument', 'Unité explicite ou inconnue requise.');
    return {name: supportText(m.name, 'Nom de mesure', 200), value: supportText(m.value, 'Valeur déclarée', 100),
      unit: m.unit as 'cm' | 'mm' | 'in' | 'unknown', method: nullableText(m.method, 1000)};
  });
  return {...Object.fromEntries(Object.entries(OBSERVATION_TEXT).map(([key, max]) => [key, nullableText(o[key], max)])),
    sizeSystem: o.sizeSystem as 'EU' | 'US' | 'unknown' | null, colors: declaredStrings(o.colors), materials: declaredStrings(o.materials), measurements};
}
export function parseProductMaterialStatement(value: unknown) {
  const d = supportObject(value, ['protocol', 'reason', 'promised', 'received', 'chronology', 'interventions', 'receivedScope']);
  if (d.protocol !== 'product_material_statement_v1' || !(PRODUCT_MATERIAL_REASONS as readonly unknown[]).includes(d.reason))
    throw new HttpsError('invalid-argument', 'Motif matériel déclaré explicite requis.');
  if (d.receivedScope !== undefined && !['purchase_received', 'return_received', 'offered_item', 'unknown'].includes(d.receivedScope))
    throw new HttpsError('invalid-argument', 'Contexte reçu déclaré ou inconnu requis.');
  const dates = supportObject(d.chronology, ['receivedAt', 'inspectedAt', 'complainedAt']);
  const i = supportObject(d.interventions, ['state', 'entries']);
  if (!['none_declared', 'declared', 'unknown'].includes(i.state) || !Array.isArray(i.entries) || i.entries.length > 10 ||
      (i.state === 'declared' ? i.entries.length === 0 : i.entries.length !== 0)) throw new HttpsError('invalid-argument', 'Interventions déclarées ou inconnues requises.');
  const entries = i.entries.map((value: unknown) => {
    const entry = supportObject(value, ['kind', 'description', 'occurredAt', 'beforeObservation', 'afterObservation']);
    if (!['washing', 'cleaning', 'repair', 'alteration', 'use', 'other'].includes(entry.kind)) throw new HttpsError('invalid-argument', 'Intervention déclarée invalide.');
    return {kind: entry.kind as 'washing' | 'cleaning' | 'repair' | 'alteration' | 'use' | 'other', description: supportText(entry.description, 'Intervention déclarée', 2000),
      occurredAt: supportDeclaredDate(entry.occurredAt, Date.now()), beforeObservation: nullableText(entry.beforeObservation, 2000), afterObservation: nullableText(entry.afterObservation, 2000)};
  });
  // Preserve chronology as declared, including contradictions. Native recordedAt
  // is a different clock; no receipt/inspection/fault is inferred from it.
  return {protocol: 'product_material_statement_v1' as const, reason: d.reason as typeof PRODUCT_MATERIAL_REASONS[number],
    promised: observation(d.promised), received: observation(d.received),
    ...(d.receivedScope !== undefined ? {receivedScope: d.receivedScope as 'purchase_received' | 'return_received' | 'offered_item' | 'unknown'} : {}),
    chronology: {receivedAt: supportDeclaredDate(dates.receivedAt, Date.now()), inspectedAt: supportDeclaredDate(dates.inspectedAt, Date.now()),
      complainedAt: supportDeclaredDate(dates.complainedAt, Date.now())}, interventions: {state: i.state as 'none_declared' | 'declared' | 'unknown', entries}};
}
export type ProductMaterialStatement = ReturnType<typeof parseProductMaterialStatement>;
export function productMaterialRequested(raw: any) {
  if (raw.materialCapability === undefined) return false;
  if (raw.materialCapability !== 'product_review_material_v1') throw new HttpsError('invalid-argument', 'Version explicite de comparaison matérielle requise.');
  return true;
}
export const PRODUCT_MATERIAL_QUALIFICATION = {physicalIdentityVerified: false, colorOrMaterialVerified: false,
  odourVerified: false, measurementsVerified: false, sizeConversionVerified: false, faultEstablished: false,
  chronologyQualification: 'actor_declaration_or_unknown', nativeRecordedAtIsReceiptTime: false} as const;
/** Only the supplied historical source. No current-listing fallback or unit conversion. */
export function productMaterialAttributes(value: unknown) {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && v.trim() ? v : null;
  const strings = (v: unknown) => Array.isArray(v) && v.length <= 20 && v.every(s => text(s, 200) !== null) ? v : null;
  const size = item.size && typeof item.size === 'object' && !Array.isArray(item.size) ? item.size : null;
  return {brand: text(item.brand, 300), brandStatus: text(item.brandStatus, 100), model: text(item.model, 300),
    size: {value: typeof item.size === 'string' ? text(item.size, 300) : text(size?.value, 300),
      system: size?.system === 'US' || size?.system === 'EU' ? size.system as 'US' | 'EU' : null, conversionVerified: false},
    colors: strings(item.colors), materials: strings(item.materials),
    hasKnownDefects: typeof item.hasKnownDefects === 'boolean' ? item.hasKnownDefects : null, defectsDescription: text(item.defectsDescription, 4000),
    hasAlterations: typeof item.hasAlterations === 'boolean' ? item.hasAlterations : null, alterationsDescription: text(item.alterationsDescription, 4000),
    physicalFactsVerified: false};
}
