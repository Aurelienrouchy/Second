import { expect, it } from 'vitest';
import { getCategoryPath } from '../shared/categories';
import { automaticShippingParcel, automaticParcelSource, parcelProvenanceHash, qualifiedAutomaticParcelSource,
  qualifiedShippingParcelSnapshot, shippingParcelRecommendation } from './automaticShippingParcel';
import {automaticShippingEstimate, automaticShippingFamilyProfile} from '../shared/automaticShippingEstimate';

it('preserves every exact historical V1 geometry and source', () => {
  for (const [profileSize, weight] of [['small', 0.5], ['medium', 1], ['large', 2]] as const) {
    const parcel = automaticShippingParcel(profileSize);
    expect(qualifiedAutomaticParcelSource(automaticParcelSource(profileSize), parcel)).toEqual(automaticParcelSource(profileSize));
    expect(parcel.weight.value).toBe(weight);
    parcel.weight.value = 99;
    expect(automaticShippingParcel(profileSize).weight.value).toBe(weight);
  }
});
it('uses the final native product category rather than a stale AI enum or draft format', () => {
  const tshirt = shippingParcelRecommendation({packageSize: 'large', categoryIds: getCategoryPath('women_clothing_tops_tshirts')});
  expect(tshirt).toMatchObject({profileVersion: 2, profileFamily: 'light_clothing', recommendationBasis: 'category_family',
    parcel: {weight: {value: 0.35}, dimensions: {length: 28, width: 22, height: 4}}});
  const coat = shippingParcelRecommendation({packageSize: 'small', categoryIds: getCategoryPath('women_clothing_coats_coats_trench')});
  expect(coat.profileFamily).toBe('outerwear');
  expect(coat.parcel).not.toEqual(tshirt.parcel);
  expect(shippingParcelRecommendation({categoryIds: getCategoryPath('women_accessories_hats_beanies')})).toMatchObject({profileFamily: 'accessory'});
});
it('keeps unknown, non-leaf and forged category paths explicitly unknown regardless of title/old size', () => {
  for (const categoryIds of [undefined, ['women_clothing_tops_invented'], ['women', 'women_clothing'], ['men', 'women_clothing_tops_tshirts']]) {
    expect(shippingParcelRecommendation({packageSize: 'small', title: 'lampe', categoryIds})).toMatchObject({
      profileVersion: 2, profileFamily: 'unknown', recommendationBasis: 'conservative_default'});
  }
});
it.each([
  ['women_clothing_tops_jackets', 'outerwear'],
  ['women_clothing_maternity_hoodies', 'knitwear'],
  ['women_clothing_sport_hoodies', 'knitwear'],
  ['kids_girls_baby_bodysuits', 'light_clothing'],
  ['kids_boys_baby_onesies', 'light_clothing'],
  ['kids_boys_baby_sleepers', 'light_clothing'],
  ['kids_girls_bottoms_shorts', 'light_clothing'],
])('uses the actual specific article rather than its broad parent for %s', (leaf, family) => {
  const categoryIds = getCategoryPath(leaf);
  expect(categoryIds.at(-1)).toBe(leaf);
  expect(automaticShippingEstimate({categoryIds}).profileFamily).toBe(family);
});
it('qualifies frozen V2 geometry by its own immutable family, never a current article or cross-family metadata', () => {
  const estimate = automaticShippingEstimate({categoryIds: getCategoryPath('women_clothing_tops_tshirts')});
  const {source, profileSize, profileVersion, profileFamily} = estimate;
  expect(qualifiedAutomaticParcelSource(estimate, estimate.parcel)).toEqual({source, profileSize, profileVersion, profileFamily});
  expect(qualifiedAutomaticParcelSource({...estimate, profileFamily: 'unknown'}, estimate.parcel)).toBeNull();
  expect(qualifiedAutomaticParcelSource({...estimate, profileVersion: 1}, estimate.parcel)).toBeNull();
  expect(qualifiedShippingParcelSnapshot({...estimate, measurementSource: source, measurementVerified: false})).toBe(true);
  estimate.parcel.weight.value = 99;
  expect(automaticShippingFamilyProfile(profileFamily).parcel.weight.value).toBe(0.35);
});
it('rejects altered dimensions, false verification and future unknown versions without upgrading a snapshot', () => {
  const source = automaticParcelSource('medium'), parcel = automaticShippingParcel('medium');
  expect(qualifiedAutomaticParcelSource(source, parcel)).toEqual(source);
  expect(qualifiedAutomaticParcelSource({ ...source, profileVersion: 2 }, parcel)).toBeNull();
  expect(qualifiedAutomaticParcelSource(source, { ...parcel, dimensions: { ...parcel.dimensions, height: 99 } })).toBeNull();
  const snapshot = { ...source, measurementSource: source.source, measurementVerified: false, parcel };
  expect(qualifiedShippingParcelSnapshot(snapshot)).toBe(true);
  expect(qualifiedShippingParcelSnapshot({ ...snapshot, measurementVerified: true })).toBe(false);
  expect(qualifiedShippingParcelSnapshot({ ...snapshot, measurementSource: 'seller_declared' })).toBe(false);
});
it('leaves historical manual hashes untouched and binds the new source metadata independently of dimensions', () => {
  const base = 'historical-source-hash';
  expect(parcelProvenanceHash(base)).toBe(base);
  expect(parcelProvenanceHash(base, automaticParcelSource('small'))).not.toBe(base);
  expect(parcelProvenanceHash(base, automaticParcelSource('small'))).not.toBe(parcelProvenanceHash(base, automaticParcelSource('large')));
  expect(qualifiedShippingParcelSnapshot({ measurementSource: 'seller_declared', measurementVerified: false })).toBe(true);
});
