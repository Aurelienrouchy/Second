import {CryptoDigestAlgorithm, digestStringAsync} from 'expo-crypto';
import {normalizeCanadianAddress} from '@/functions/src/shared/canadianAddress';
import type {OrdinaryShippingAddressDeclaration, OrdinaryShippingAddressKind, OrdinaryShippingAddressUse} from '@/types/shippingPurchase';
export const ORDINARY_SHIPPING_ADDRESS_POLICY = 'ordinary_address_2026_01' as const;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const isOrdinaryShippingAddressKind = (v: unknown): v is OrdinaryShippingAddressKind => v === 'ordinary_residential' || v === 'ordinary_business';
export function ordinaryPhysicalAddress(raw: unknown) {
  return normalizeCanadianAddress(raw);
}
/** Fixed key insertion order exactly matches the NEW-only server contract. */
export async function ordinaryShippingAddressHash(raw: unknown): Promise<string> {
  const a = normalizeCanadianAddress(raw); if (!a) throw new Error('Complétez une adresse canadienne cohérente avant de confirmer son type.');
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify({street: a.street, line2: a.line2 ?? null, city: a.city, province: a.province, postalCode: a.postalCode, country: a.country}));
}
function hasStructuredContradiction(raw: unknown) {
  if (!object(raw)) return true;
  if (['pickupPointId', 'servicePointId', 'pudoId', 'flexDeliveryId', 'poBoxId'].some(k => raw[k] !== undefined && raw[k] !== null && raw[k] !== '')) return true;
  if (['isPOBox', 'isPickupPoint'].some(k => raw[k] !== undefined && raw[k] !== null && raw[k] !== false)) return true;
  return ['deliveryType', 'addressType'].some(k => raw[k] !== undefined && raw[k] !== null && (typeof raw[k] !== 'string' ||
    ['pickuppoint', 'servicepoint', 'pudo', 'locker', 'flexdelivery', 'pobox'].includes(String(raw[k]).trim().toLowerCase().replace(/[_ -]/g, ''))));
}
export async function ordinaryShippingAddressDeclaration(raw: unknown, kind: OrdinaryShippingAddressKind): Promise<OrdinaryShippingAddressDeclaration> {
  if (!isOrdinaryShippingAddressKind(kind) || hasStructuredContradiction(raw)) throw new Error('Seules les adresses résidentielles et professionnelles ordinaires sont admises pour une nouvelle livraison.');
  return {schemaVersion: 1, policyVersion: ORDINARY_SHIPPING_ADDRESS_POLICY, kind, accepted: true, addressHash: await ordinaryShippingAddressHash(raw)};
}
export async function hasCurrentOrdinaryShippingDeclaration(raw: unknown): Promise<boolean> {
  if (!object(raw) || hasStructuredContradiction(raw)) return false;
  const d = raw.shippingUseDeclaration;
  return object(d) && exact(d, ['schemaVersion', 'policyVersion', 'kind', 'accepted', 'addressHash']) && d.schemaVersion === 1 &&
    d.policyVersion === ORDINARY_SHIPPING_ADDRESS_POLICY && isOrdinaryShippingAddressKind(d.kind) && d.accepted === true &&
    typeof d.addressHash === 'string' && /^[a-f0-9]{64}$/.test(d.addressHash) && d.addressHash === await ordinaryShippingAddressHash(raw);
}
export function isOrdinaryShippingAddressUse(v: unknown): v is OrdinaryShippingAddressUse {
  if (!object(v) || !exact(v, ['protocol', 'policyVersion', 'origin', 'destination']) || v.protocol !== 'ordinary_shipping_address_use_v1' || v.policyVersion !== ORDINARY_SHIPPING_ADDRESS_POLICY) return false;
  return (['origin', 'destination'] as const).every(k => {const part = v[k]; return object(part) && exact(part, ['kind', 'source', 'physicalSiteVerified', 'deliverabilityVerified']) &&
    isOrdinaryShippingAddressKind(part.kind) && part.source === (k === 'origin' ? 'seller_declared' : 'buyer_declared') && part.physicalSiteVerified === false && part.deliverabilityVerified === false;});
}
export const ordinaryAddressKindLabel = (kind: OrdinaryShippingAddressKind) => kind === 'ordinary_residential' ? 'Adresse résidentielle ordinaire' : 'Adresse professionnelle ordinaire';
export function createOrdinaryAddressInteraction() {
  let revision = 0;
  const guardAt = (expected: number) => () => {if (expected !== revision) throw new Error('L’adresse ou sa déclaration a changé.');};
  let guard = guardAt(revision);
  return {invalidate: () => {revision++; guard = guardAt(revision);}, capture: () => guard};
}
