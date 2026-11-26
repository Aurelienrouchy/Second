import {qualifiedShippingTransportLeg, shipmentTransportMatches, shippingTransportHash, type ShippingTransportLeg} from '../config/shippingTransportPolicy';
/** Complete CAD rates. Provider echoes stay private and never replace our sources. */
export interface PurchaseRate {
  rateId: string; shipmentId: string; carrierId: string; carrierCode: string;
  carrierFriendlyName: string; serviceCode: string; serviceType: string;
  componentsCents: { shipping: number; insurance: number; confirmation: number; other: number };
  shippingCents: number; estimatedDeliveryDays: number | null;
}
export interface PurchaseRateContext {
  /** Caller-owned shipping leg; omitted retains the forward-only contract. */
  isReturn?: boolean;
  transport?: ShippingTransportLeg;
  shipFrom: { name: string; addressLine1: string; addressLine2?: string; cityLocality: string; stateProvince: string; postalCode: string; countryCode: string; phone?: string; email?: string };
  shipTo: PurchaseRateContext['shipFrom'];
  parcel: { weight: { value: number; unit: 'kilogram' }; dimensions: { length: number; width: number; height: number; unit: 'centimeter' } };
}
type OptionalProof<T> = { state: 'absent' | 'null' } | { state: 'provided'; value: T };
export interface RateDetailsProof { rateId: string; state: 'absent' | 'null' | 'empty' | 'provided'; entries: { type: string; cents: number }[] }
export interface RateQualification {
  version: 3;
  contexts: { location: 'root' | 'group'; shipmentId: OptionalProof<string>; shipFrom: OptionalProof<Record<string, string>>;
    shipTo: OptionalProof<Record<string, string>>; packages: OptionalProof<PurchaseRateContext['parcel'][]>;
    totalWeight: OptionalProof<number>; isReturn: OptionalProof<boolean> }[];
  details: RateDetailsProof[];
}
export interface PurchaseRates { shipmentId: string; rates: PurchaseRate[]; providerCreatedAt: string | null; qualification: RateQualification;
  transport?:{protocol:'shipment_transport_observation_v1';shipmentId:string;captureHash:string;optionsHash:string} }
const own = (v: any, k: string) => v != null && Object.prototype.hasOwnProperty.call(v, k);
const invalid = (): never => { throw new Error('Contradictory or ambiguous shipment rate evidence'); };
function signedCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) < 1e-7 ? cents : null;
}
export function exactCents(value: unknown): number | null {
  if (typeof value !== 'number' || value < 0) return null;
  const cents = signedCents(value); return cents !== null && cents >= 0 ? cents : null;
}
export const providerId = (id: unknown): id is string => typeof id === 'string' && /^se-[a-zA-Z0-9-]+$/.test(id);
const text = (s: unknown) => typeof s === 'string' ? s.normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase() : invalid();
function addressProof(value: any, expected?: PurchaseRateContext['shipFrom']): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !expected) return invalid();
  const result: Record<string, string> = {};
  const keys = { name: 'name', address_line1: 'addressLine1', city_locality: 'cityLocality', state_province: 'stateProvince', postal_code: 'postalCode', country_code: 'countryCode' } as const;
  for (const [key, sourceKey] of Object.entries(keys)) {
    const normalize = key === 'postal_code' ? (v: unknown) => text(v).replace(/\s/g, '') : text;
    const normalized = normalize(value[key]);
    if (!normalized || normalized !== normalize(expected[sourceKey as keyof typeof expected])) return invalid();
    result[key] = normalized;
  }
  // Omitted contacts are unobserved. Empty/null optional values carry no invented contact.
  for (const [key, sourceKey] of Object.entries({ address_line2: 'addressLine2', phone: 'phone', email: 'email' } as const)) {
    if (!own(value, key)) continue;
    const normalize = key === 'phone' ? (v: unknown) => text(v).replace(/[\s()+.-]/g, '') : text;
    const normalized = value[key] === null ? '' : normalize(value[key]);
    const source = expected[sourceKey as keyof typeof expected];
    if (normalized !== (source == null ? '' : normalize(source))) return invalid();
    result[key] = normalized;
  }
  // No unrequested third line or company may quietly change the recipient/address.
  for (const key of ['address_line3', 'company_name']) if (own(value, key) && value[key] !== null && text(value[key])) return invalid();
  return result;
}
function positive(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : invalid(); }
const equalMeasure = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
function weightProof(value: any, expected?: number): number {
  const factors: Record<string, number> = { kilogram: 1, gram: 0.001, pound: 0.45359237, ounce: 0.028349523125 };
  const factor = factors[value?.unit]; if (!factor || expected === undefined) return invalid();
  const weight = positive(value.value) * factor;
  if (!Number.isFinite(weight) || !equalMeasure(weight, expected)) return invalid();
  return weight;
}
function packagesProof(value: any, expected?: PurchaseRateContext['parcel']): PurchaseRateContext['parcel'][] {
  if (!Array.isArray(value) || value.length !== 1 || !expected) return invalid();
  const p = value[0];
  const dimensionFactors: Record<string, number> = { centimeter: 1, inch: 2.54 };
  const df = dimensionFactors[p?.dimensions?.unit];
  if (!df) return invalid();
  const weight = weightProof(p.weight, expected.weight.value);
  const dimensions = { length: positive(p.dimensions.length) * df, width: positive(p.dimensions.width) * df, height: positive(p.dimensions.height) * df, unit: 'centimeter' as const };
  if (!Number.isFinite(weight) || !equalMeasure(weight, expected.weight.value) ||
    !(['length', 'width', 'height'] as const).every(k => Number.isFinite(dimensions[k]) && equalMeasure(dimensions[k], expected.dimensions[k]))) return invalid();
  return [{ weight: { value: weight, unit: 'kilogram' }, dimensions }];
}
/** Exact provider shipment evidence, used for a return's GET-only recovery. */
export function purchaseShipmentMatches(raw: any, context: PurchaseRateContext): boolean {
  try {
    if (raw?.is_return !== (context.isReturn === true)) return false;
    addressProof(raw.ship_from, context.shipFrom); addressProof(raw.ship_to, context.shipTo);
    packagesProof(raw.packages, context.parcel);
    if(own(context,'transport')&&!shipmentTransportMatches(raw,context.transport,context))return false;
    return true;
  } catch { return false; }
}
function optional<T>(object: any, key: string, parse: (value: any) => T): OptionalProof<T> {
  if (!own(object, key)) return { state: 'absent' };
  if (object[key] === null) return { state: 'null' };
  return { state: 'provided', value: parse(object[key]) };
}
function contextProof(object: any, location: 'root' | 'group', shipmentId: string, context?: PurchaseRateContext): RateQualification['contexts'][number] {
  const identity = own(object, 'shipment_id') ? (providerId(object.shipment_id) && object.shipment_id === shipmentId ?
    { state: 'provided' as const, value: object.shipment_id } : invalid()) : { state: 'absent' as const };
  return { location, shipmentId: identity,
    shipFrom: optional(object, 'ship_from', v => addressProof(v, context?.shipFrom)),
    shipTo: optional(object, 'ship_to', v => addressProof(v, context?.shipTo)),
    packages: optional(object, 'packages', v => packagesProof(v, context?.parcel)),
    totalWeight: optional(object, 'total_weight', v => weightProof(v, context?.parcel.weight.value)),
    isReturn: optional(object, 'is_return', v => v === (context?.isReturn === true) ? v as boolean : invalid()) };
}
const detailTypes = new Set(['uncategorized','shipping','insurance','confirm','discount','fuel_charge','additional_fees','tariff','tax','delivery','handling','special_goods','pickup','location_fee','oversize','returns','notifications','tip','duties_and_taxes','brokerage_fee','admin_fee','adjustment']);
/** Stored proofs are requalified, never repaired from a newer GET response. */
const plain = (value: any): value is Record<string, any> => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function shape(value: any, required: string[], optionalKeys: string[] = []): boolean {
  return plain(value) && required.every(k => own(value, k)) && Object.keys(value).every(k => required.includes(k) || optionalKeys.includes(k));
}
function storedOptional(proof: any, validate: (value: any) => boolean): boolean {
  if (!plain(proof)) return false;
  if (proof.state === 'absent' || proof.state === 'null') return shape(proof, ['state']);
  return proof.state === 'provided' && shape(proof, ['state', 'value']) && validate(proof.value);
}
function storedAddress(value: any, expected?: PurchaseRateContext['shipFrom']): boolean {
  if (!shape(value, ['name','address_line1','city_locality','state_province','postal_code','country_code'], ['address_line2','phone','email']) ||
    !Object.values(value).every(v => typeof v === 'string')) return false;
  addressProof(value, expected); return true;
}
function storedPackages(value: any, expected?: PurchaseRateContext['parcel']): boolean {
  if (!Array.isArray(value) || value.length !== 1 || !shape(value[0], ['weight','dimensions']) ||
    !shape(value[0].weight, ['value','unit']) || value[0].weight.unit !== 'kilogram' ||
    !shape(value[0].dimensions, ['length','width','height','unit']) || value[0].dimensions.unit !== 'centimeter') return false;
  packagesProof(value, expected); return true;
}
function storedContext(value: any, shipmentId: string, context?: PurchaseRateContext): boolean {
  if (!shape(value, ['location','shipmentId','shipFrom','shipTo','packages','totalWeight','isReturn']) ||
    (value.location !== 'root' && value.location !== 'group')) return false;
  // Every group has its actual ID. An absent root ID is allowed; null is never an identity.
  const identity = value.shipmentId;
  if (!plain(identity) || identity.state === 'null' ||
    (value.location === 'group' && identity.state !== 'provided') ||
    !storedOptional(identity, id => providerId(id) && id === shipmentId)) return false;
  return storedOptional(value.shipFrom, v => storedAddress(v, context?.shipFrom)) &&
    storedOptional(value.shipTo, v => storedAddress(v, context?.shipTo)) &&
    storedOptional(value.packages, v => storedPackages(v, context?.parcel)) &&
    storedOptional(value.totalWeight, v => { if (typeof v !== 'number') return false; weightProof({ value: v, unit: 'kilogram' }, context?.parcel.weight.value); return true; }) &&
    storedOptional(value.isReturn, v => v === (context?.isReturn === true));
}
/** Ready private source validation, bound to the same canonical request as its quote. */
export function hasCurrentRateQualification(value: any, context?: PurchaseRateContext): value is PurchaseRates {
  try {
    if (!shape(value, ['shipmentId','rates','providerCreatedAt','qualification'], ['transport']) || !providerId(value.shipmentId) ||
      (value.providerCreatedAt !== null && typeof value.providerCreatedAt !== 'string')) return false;
    if(own(context,'transport')) {
      const leg=qualifiedShippingTransportLeg(context!.transport,context),p=value.transport;
      if(!shape(p,['protocol','shipmentId','captureHash','optionsHash'])||p.protocol!=='shipment_transport_observation_v1'||p.shipmentId!==value.shipmentId||
        p.captureHash!==leg.hash||p.optionsHash!==shippingTransportHash([leg.admission.coverage.insuranceProvider,leg.admission.coverage.declaredValueCents,leg.admission[leg.leg].confirmation]))return false;
    }else if(own(value,'transport'))return false;
    const q = value.qualification;
    if (!shape(q, ['version','contexts','details']) || q.version !== 3 || !Array.isArray(q.contexts) ||
      q.contexts.length < 1 || q.contexts.length > 2 ||
      q.contexts.filter((c: any) => c?.location === 'group').length !== 1 ||
      q.contexts.filter((c: any) => c?.location === 'root').length > 1 ||
      !q.contexts.every((c: any) => storedContext(c, value.shipmentId, context)) ||
      !Array.isArray(value.rates) || !value.rates.length || !Array.isArray(q.details) || q.details.length !== value.rates.length) return false;
    const ids = new Set<string>();
    return value.rates.every((rate: any) => {
      if (!shape(rate, ['rateId','shipmentId','carrierId','carrierCode','carrierFriendlyName','serviceCode','serviceType','componentsCents','shippingCents','estimatedDeliveryDays']) ||
        !providerId(rate.rateId) || !providerId(rate.carrierId) || rate.shipmentId !== value.shipmentId || ids.has(rate.rateId) ||
        !['carrierCode','carrierFriendlyName','serviceCode','serviceType'].every(k => typeof rate[k] === 'string' && rate[k].trim()) ||
        (rate.estimatedDeliveryDays !== null && (!Number.isSafeInteger(rate.estimatedDeliveryDays) || rate.estimatedDeliveryDays < 0)) ||
        !shape(rate.componentsCents, ['shipping','insurance','confirmation','other'])) return false;
      ids.add(rate.rateId);
      const components = Object.values(rate.componentsCents) as unknown[];
      if (!components.every(c => typeof c === 'number' && Number.isSafeInteger(c) && c >= 0)) return false;
      const total = (components as number[]).reduce((sum, c) => sum + c, 0);
      if (!Number.isSafeInteger(total) || !Number.isSafeInteger(rate.shippingCents) || total !== rate.shippingCents) return false;
      const matches = q.details.filter((d: any) => d?.rateId === rate.rateId);
      if (matches.length !== 1) return false;
      const d = matches[0];
      if (!shape(d, ['rateId','state','entries']) || !['absent','null','empty','provided'].includes(d.state) || !Array.isArray(d.entries)) return false;
      if (d.state !== 'provided') return d.entries.length === 0;
      if (!d.entries.length) return false;
      let sum = 0;
      for (const e of d.entries) {
        if (!shape(e, ['type','cents']) || !detailTypes.has(e.type) || !Number.isSafeInteger(e.cents)) return false;
        sum += e.cents; if (!Number.isSafeInteger(sum)) return false;
      }
      return sum === rate.shippingCents;
    });
  } catch { return false; }
}
function detailsProof(rate: any, total: number): RateDetailsProof {
  if (!own(rate, 'rate_details')) return { rateId: rate.rate_id, state: 'absent', entries: [] };
  if (rate.rate_details === null) return { rateId: rate.rate_id, state: 'null', entries: [] };
  if (!Array.isArray(rate.rate_details)) return invalid();
  if (!rate.rate_details.length) return { rateId: rate.rate_id, state: 'empty', entries: [] };
  const entries: RateDetailsProof['entries'] = [];
  let sum = 0;
  for (const detail of rate.rate_details) {
    if (!detailTypes.has(detail?.rate_detail_type) || typeof detail?.amount?.currency !== 'string' || detail.amount.currency.toUpperCase() !== 'CAD') return invalid();
    const cents = signedCents(detail.amount.amount); if (cents === null) return invalid();
    sum += cents; if (!Number.isSafeInteger(sum)) return invalid();
    entries.push({ type: detail.rate_detail_type, cents });
  }
  // Preserve the explicit sign; a "discount" label is never a sign convention.
  if (sum !== total) return invalid();
  return { rateId: rate.rate_id, state: 'provided', entries };
}
/** Compare evidence only when both responses actually provide that optional breakdown. */
export function consistentRateDetails(before: RateQualification, after: RateQualification, id: string): boolean {
  const a = before.details.find(d => d.rateId === id), b = after.details.find(d => d.rateId === id);
  if (!a || !b) return false;
  if (a.state !== 'provided' || b.state !== 'provided') return true;
  const canonical = (entries: RateDetailsProof['entries']) => entries.map(e => `${e.type}:${e.cents}`).sort().join('|');
  return canonical(a.entries) === canonical(b.entries);
}
export function parsePurchaseRates(raw: any, expectedShipmentId?: string, context?: PurchaseRateContext): PurchaseRates {
  const wrapped = !Array.isArray(raw) && own(raw, 'rate_response');
  const candidates = Array.isArray(raw) ? raw : wrapped ? [raw.rate_response] : [raw];
  const matching = candidates.filter(g => providerId(g?.shipment_id) && (!expectedShipmentId || g.shipment_id === expectedShipmentId));
  if (matching.length !== 1) throw new Error('Unqualified shipment rate response');
  const group = matching[0];
  const contexts = [...(wrapped ? [contextProof(raw, 'root', group.shipment_id, context)] : []), contextProof(group, 'group', group.shipment_id, context)];
  if (group.status !== 'completed' || (group.errors !== null && (!Array.isArray(group.errors) || group.errors.length)) || !Array.isArray(group.rates)) throw new Error('Incomplete shipment rates');
  const rates: PurchaseRate[] = [], details: RateDetailsProof[] = [];
  const ids = new Set<string>();
  for (const rate of group.rates) {
    if (own(rate, 'shipment_id') && rate.shipment_id !== group.shipment_id) return invalid();
    if (!providerId(rate?.rate_id) || rate.rate_type !== 'shipment' || rate.validation_status !== 'valid' ||
      !Array.isArray(rate.warning_messages) || rate.warning_messages.length || !Array.isArray(rate.error_messages) || rate.error_messages.length ||
      !['carrier_id', 'carrier_code', 'carrier_friendly_name', 'service_code', 'service_type'].every(k => typeof rate[k] === 'string' && rate[k].trim())) continue;
    const components = ['shipping_amount', 'insurance_amount', 'confirmation_amount', 'other_amount'].map(k => {
      const money = rate[k]; return typeof money?.currency === 'string' && money.currency.toUpperCase() === 'CAD' ? exactCents(money.amount) : null;
    });
    if (components.some(c => c === null)) continue;
    if (ids.has(rate.rate_id)) throw new Error('Ambiguous rate identity');
    ids.add(rate.rate_id);
    const [shipping, insurance, confirmation, other] = components as number[];
    const shippingCents = shipping + insurance + confirmation + other;
    if (!Number.isSafeInteger(shippingCents)) continue;
    details.push(detailsProof(rate, shippingCents));
    const days = own(rate, 'delivery_days') ? rate.delivery_days : rate.estimated_delivery_days;
    rates.push({ rateId: rate.rate_id, shipmentId: group.shipment_id, carrierId: rate.carrier_id, carrierCode: rate.carrier_code,
      carrierFriendlyName: rate.carrier_friendly_name, serviceCode: rate.service_code, serviceType: rate.service_type,
      componentsCents: { shipping, insurance, confirmation, other }, shippingCents,
      estimatedDeliveryDays: Number.isSafeInteger(days) && days >= 0 ? days : null });
  }
  if (!rates.length) throw new Error('No complete valid CAD shipment rate');
  return { shipmentId: group.shipment_id, rates, providerCreatedAt: typeof group.created_at === 'string' ? group.created_at : null,
    qualification: { version: 3, contexts, details } };
}
