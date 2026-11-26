import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { ShippingPurchaseParcel } from '@/types/shippingPurchase';
import { automaticShippingFamilyProfile, isAutomaticShippingFamily, type AutomaticShippingFamily,
  type automaticShippingEstimate } from '@/functions/src/shared/automaticShippingEstimate';

export type ShippingParcelProfileSize = 'small' | 'medium' | 'large';
export interface ShippingParcelRecommendationV1 {
  source: 'automatic_profile';
  profileSize: ShippingParcelProfileSize;
  profileVersion: 1;
  parcel: ShippingPurchaseParcel;
  recommendationBasis: 'listing_package_size' | 'category' | 'conservative_default';
}
export type ShippingParcelRecommendationV2 = ReturnType<typeof automaticShippingEstimate>;
export type ShippingParcelRecommendation = ShippingParcelRecommendationV1 | ShippingParcelRecommendationV2;
export type ShippingParcelAutomaticChoice = ShippingParcelProfileSize | Pick<ShippingParcelRecommendationV2, 'profileVersion' | 'profileFamily' | 'profileSize'>;
export interface ShippingParcelObservation {
  articleId: string;
  version: number;
  parcel: ShippingPurchaseParcel | null;
  status: 'missing' | 'declared' | 'estimated';
  measurementVerified: false;
  source: 'automatic_profile' | 'seller_declared' | null;
  profileSize: ShippingParcelProfileSize | null;
  profileVersion: 1 | 2 | null;
  profileFamily: AutomaticShippingFamily | null;
  /** Null only for a response from the previous, declared-measurements API. */
  recommendation: ShippingParcelRecommendation | null;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const profileSize = (value: unknown): value is ShippingParcelProfileSize => value === 'small' || value === 'medium' || value === 'large';
const unconfirmed = () => new Error('Le format du colis n’a pas pu être confirmé. Réessayez dans un instant.');
export function parseShippingParcel(value: unknown): ShippingPurchaseParcel | null {
  if (!record(value) || !record(value.weight) || !record(value.dimensions) ||
      value.weight.unit !== 'kilogram' || value.dimensions.unit !== 'centimeter' ||
      !positive(value.weight.value) || !positive(value.dimensions.length) || !positive(value.dimensions.width) || !positive(value.dimensions.height)) return null;
  return { weight: { value: value.weight.value, unit: 'kilogram' }, dimensions: {
    length: value.dimensions.length, width: value.dimensions.width, height: value.dimensions.height, unit: 'centimeter',
  } };
}

function matchesFamilyParcel(family: AutomaticShippingFamily, size: unknown, parcel: ShippingPurchaseParcel): boolean {
  const expected = automaticShippingFamilyProfile(family);
  return size === expected.profileSize && parcel.weight.value === expected.parcel.weight.value &&
    parcel.dimensions?.length === expected.parcel.dimensions.length && parcel.dimensions.width === expected.parcel.dimensions.width &&
    parcel.dimensions.height === expected.parcel.dimensions.height;
}

function observation(value: unknown, articleId: string, saved = false): ShippingParcelObservation {
  if (!record(value) || value.articleId !== articleId || !Number.isSafeInteger(value.version) || Number(value.version) < 0 || value.measurementVerified !== false) {
    throw unconfirmed();
  }
  let recommendation: ShippingParcelRecommendation | null = null;
  if (value.recommendation !== undefined) {
    const raw = value.recommendation, parcel = record(raw) ? parseShippingParcel(raw.parcel) : null;
    if (!record(raw) || raw.source !== 'automatic_profile' || !profileSize(raw.profileSize) || !parcel) throw unconfirmed();
    if (raw.profileVersion === 1 && raw.profileFamily == null &&
      ['listing_package_size', 'category', 'conservative_default'].includes(String(raw.recommendationBasis))) {
      recommendation = {source: 'automatic_profile', profileSize: raw.profileSize, profileVersion: 1, parcel,
        recommendationBasis: raw.recommendationBasis as ShippingParcelRecommendationV1['recommendationBasis']};
    } else if (raw.profileVersion === 2 && isAutomaticShippingFamily(raw.profileFamily) &&
      matchesFamilyParcel(raw.profileFamily, raw.profileSize, parcel) &&
      raw.recommendationBasis === (raw.profileFamily === 'unknown' ? 'conservative_default' : 'category_family')) {
      recommendation = {...automaticShippingFamilyProfile(raw.profileFamily),
        recommendationBasis: raw.profileFamily === 'unknown' ? 'conservative_default' : 'category_family'};
    } else throw unconfirmed();
  }
  if (!saved && value.status === 'missing' && value.version === 0 && value.parcel === null) {
    if (value.source != null || value.profileSize != null || value.profileVersion != null || value.profileFamily != null) throw unconfirmed();
    return { articleId, version: 0, parcel: null, status: 'missing', measurementVerified: false,
      source: null, profileSize: null, profileVersion: null, profileFamily: null, recommendation };
  }
  const parcel = parseShippingParcel(value.parcel);
  const source = value.source === undefined ? 'seller_declared' : value.source;
  if (!parcel || Number(value.version) < 1 || (!saved && value.status !== (source === 'automatic_profile' ? 'estimated' : 'declared')) ||
      (saved && typeof value.replay !== 'boolean')) {
    throw unconfirmed();
  }
  if (source !== 'seller_declared' && source !== 'automatic_profile') throw unconfirmed();
  if (source === 'automatic_profile') {
    if (!profileSize(value.profileSize) || !(value.profileVersion === 1 && value.profileFamily == null ||
      value.profileVersion === 2 && isAutomaticShippingFamily(value.profileFamily) && matchesFamilyParcel(value.profileFamily, value.profileSize, parcel))) throw unconfirmed();
  } else if (value.profileSize != null || value.profileVersion != null || value.profileFamily != null) throw unconfirmed();
  return { articleId, version: Number(value.version), parcel, status: source === 'automatic_profile' ? 'estimated' : 'declared', measurementVerified: false,
    source, profileSize: source === 'automatic_profile' ? value.profileSize as ShippingParcelProfileSize : null,
    profileVersion: source === 'automatic_profile' ? value.profileVersion as 1 | 2 : null,
    profileFamily: source === 'automatic_profile' && value.profileVersion === 2 ? value.profileFamily as AutomaticShippingFamily : null, recommendation };
}

export const ShippingParcelService = {
  async read(uid: string, articleId: string, guard: () => void): Promise<ShippingParcelObservation> {
    const session = captureTradeSession(uid), current = () => { assertTradeSessionCurrent(session); guard(); };
    current();
    const { data } = await httpsCallable<{ articleId: string }, unknown>(functions, 'getArticleShippingParcel')({ articleId });
    current();
    return observation(data, articleId);
  },
  async save(uid: string, articleId: string, expectedVersion: number, requestId: string, parcel: ShippingPurchaseParcel, guard: () => void): Promise<ShippingParcelObservation> {
    const session = captureTradeSession(uid), current = () => { assertTradeSessionCurrent(session); guard(); };
    current();
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !parseShippingParcel(parcel)) throw new Error('Vérifiez le poids et les trois dimensions du colis.');
    const { data } = await httpsCallable<{
      articleId: string; expectedVersion: number; requestId: string; parcel: ShippingPurchaseParcel;
    }, unknown>(functions, 'setArticleShippingParcel')({ articleId, expectedVersion, requestId, parcel });
    current();
    return observation(data, articleId, true);
  },
  async saveAutomatic(uid: string, articleId: string, expectedVersion: number, requestId: string, profile: ShippingParcelAutomaticChoice, guard: () => void): Promise<ShippingParcelObservation> {
    const session = captureTradeSession(uid), current = () => { assertTradeSessionCurrent(session); guard(); };
    current();
    const selected = typeof profile === 'string' ? {profileSize: profile} : profile;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !profileSize(selected.profileSize) ||
      typeof profile !== 'string' && (profile.profileVersion !== 2 || !isAutomaticShippingFamily(profile.profileFamily) ||
        automaticShippingFamilyProfile(profile.profileFamily).profileSize !== profile.profileSize)) throw unconfirmed();
    const { data } = await httpsCallable<{
      articleId: string; expectedVersion: number; requestId: string; profileSize: ShippingParcelProfileSize; profileVersion?: 2; profileFamily?: AutomaticShippingFamily;
    }, unknown>(functions, 'setArticleShippingParcel')({ articleId, expectedVersion, requestId,
      profileSize: selected.profileSize, ...(typeof profile === 'string' ? {} : {profileVersion: profile.profileVersion, profileFamily: profile.profileFamily}) });
    current();
    const result = observation(data, articleId, true);
    if (result.source !== 'automatic_profile' || result.profileSize !== selected.profileSize ||
      (typeof profile === 'string' ? result.profileVersion !== 1 : result.profileVersion !== 2 || result.profileFamily !== profile.profileFamily)) throw unconfirmed();
    return result;
  },
};
