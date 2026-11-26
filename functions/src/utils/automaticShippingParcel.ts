import { createHash } from 'node:crypto';
import type { ShipEngineParcel } from '../config/shipEngine';
import {automaticShippingEstimate, automaticShippingFamilyProfile, isAutomaticShippingFamily,
  type AutomaticShippingFamily} from '../shared/automaticShippingEstimate';

export type ShippingProfileSize = 'small' | 'medium' | 'large';
interface AutomaticParcelSourceV1 {
  source: 'automatic_profile';
  profileSize: ShippingProfileSize;
  profileVersion: 1;
}
interface AutomaticParcelSourceV2 {
  source: 'automatic_profile'; profileSize: ShippingProfileSize; profileVersion: 2; profileFamily: AutomaticShippingFamily;
}
export type AutomaticParcelSource = AutomaticParcelSourceV1 | AutomaticParcelSourceV2;

/** Application estimates for one packaged listing, NOT measured dimensions,
 * carrier packaging products, negotiated rates or guaranteed maximum weights.
 * Never mutate version 1: a new calibration needs a new version, and historical
 * quotes/orders must keep their exact original estimate and provenance. */
const PROFILES_V1: Record<ShippingProfileSize, readonly [number, number, number, number]> = {
  small: [0.5, 30, 22, 6],
  medium: [1, 40, 30, 12],
  large: [2, 50, 40, 20],
};
export function isShippingProfileSize(value: unknown): value is ShippingProfileSize {
  return value === 'small' || value === 'medium' || value === 'large';
}
export function automaticShippingParcel(profileSize: ShippingProfileSize): ShipEngineParcel {
  const [weight, length, width, height] = PROFILES_V1[profileSize];
  return { weight: { value: weight, unit: 'kilogram' }, dimensions: { length, width, height, unit: 'centimeter' } };
}
export function automaticParcelSource(profileSize: ShippingProfileSize): AutomaticParcelSourceV1 {
  return { source: 'automatic_profile', profileSize, profileVersion: 1 };
}
export function automaticParcelFamilySource(profileFamily: AutomaticShippingFamily): AutomaticParcelSourceV2 {
  const {source, profileSize, profileVersion} = automaticShippingFamilyProfile(profileFamily);
  return {source, profileSize, profileVersion, profileFamily};
}
export function qualifiedAutomaticParcelSource(raw: any, parcel: any): AutomaticParcelSource | null {
  if (raw?.source !== 'automatic_profile' || !isShippingProfileSize(raw.profileSize)) return null;
  let source: AutomaticParcelSource, expected: ShipEngineParcel;
  if (raw.profileVersion === 1 && raw.profileFamily == null) {
    source = automaticParcelSource(raw.profileSize); expected = automaticShippingParcel(raw.profileSize);
  } else if (raw.profileVersion === 2 && isAutomaticShippingFamily(raw.profileFamily)) {
    source = automaticParcelFamilySource(raw.profileFamily);
    if (raw.profileSize !== source.profileSize) return null;
    expected = automaticShippingFamilyProfile(raw.profileFamily).parcel;
  } else return null;
  if (parcel?.weight?.unit !== expected.weight.unit || parcel?.weight?.value !== expected.weight.value ||
      parcel?.dimensions?.unit !== expected.dimensions!.unit ||
      parcel?.dimensions?.length !== expected.dimensions!.length || parcel?.dimensions?.width !== expected.dimensions!.width ||
      parcel?.dimensions?.height !== expected.dimensions!.height) return null;
  return source;
}
/** Older manual captures retain the byte-for-byte historical source hash. */
export function parcelProvenanceHash(baseHash: string, source?: AutomaticParcelSource): string {
  return source ? createHash('sha256').update(JSON.stringify([
    source.profileVersion === 1 ? 'automatic_shipping_parcel_v1' : 'automatic_shipping_parcel_v2', baseHash, source])).digest('hex') : baseHash;
}
export function shippingParcelRecommendation(article: any) {
  return automaticShippingEstimate({categoryIds: article?.categoryIds});
}
/** Reused by outbound retries and return readers. The frozen capture is
 * validated against its own version, never today's article recommendation. */
export function qualifiedShippingParcelSnapshot(snapshot: any): boolean {
  if (snapshot?.measurementVerified !== false) return false;
  if (snapshot.measurementSource === 'seller_declared') {
    return snapshot.profileSize == null && snapshot.profileVersion == null && snapshot.profileFamily == null && snapshot.parcelSource == null;
  }
  return snapshot.measurementSource === 'automatic_profile' &&
    !!qualifiedAutomaticParcelSource({ source: snapshot.measurementSource,
      profileSize: snapshot.profileSize, profileVersion: snapshot.profileVersion, profileFamily: snapshot.profileFamily }, snapshot.parcel);
}
