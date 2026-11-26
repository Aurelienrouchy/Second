import {findCategoryById, getCategoryPath} from './categories';

export type AutomaticShippingFamily = 'light_clothing' | 'denim_trousers' | 'knitwear' | 'dress' |
  'outerwear' | 'footwear' | 'boots' | 'bag' | 'accessory' | 'beauty' | 'compact_electronics' | 'toy' | 'unknown';
export type AutomaticShippingSize = 'small' | 'medium' | 'large';
export type EstimatedShippingParcel = {weight: {value: number; unit: 'kilogram'};
  dimensions: {length: number; width: number; height: number; unit: 'centimeter'}};

/** Versioned application estimates for ONE packaged listing. These starting
 * assumptions are not observed measurements, calibrated model outputs, carrier
 * packaging, maximum weights or a promise of the carrier's final invoice.
 * Keep V2 immutable: historical labels/quotes retain their original family.
 * Unknown/bulky objects never inherit a textile estimate from a title or AI enum. */
const FAMILIES_V2: Record<AutomaticShippingFamily, {label: string; size: AutomaticShippingSize;
  packed: readonly [number, number, number, number]}> = {
  light_clothing: {label: 'Vêtement léger', size: 'small', packed: [0.35, 28, 22, 4]},
  denim_trousers: {label: 'Jean et pantalon', size: 'medium', packed: [0.9, 34, 26, 7]},
  knitwear: {label: 'Pull et maille', size: 'medium', packed: [0.8, 34, 28, 12]},
  dress: {label: 'Robe et jupe', size: 'medium', packed: [0.6, 34, 26, 8]},
  outerwear: {label: 'Manteau et veste', size: 'large', packed: [1.8, 48, 36, 18]},
  footwear: {label: 'Chaussures', size: 'large', packed: [1.2, 36, 24, 15]},
  boots: {label: 'Bottes', size: 'large', packed: [2, 42, 32, 20]},
  bag: {label: 'Sac', size: 'medium', packed: [0.9, 38, 30, 15]},
  accessory: {label: 'Accessoire', size: 'small', packed: [0.3, 24, 18, 6]},
  beauty: {label: 'Beauté', size: 'medium', packed: [0.65, 26, 20, 14]},
  compact_electronics: {label: 'Petit appareil protégé', size: 'medium', packed: [1, 32, 24, 18]},
  toy: {label: 'Jouet', size: 'large', packed: [1.5, 40, 30, 25]},
  unknown: {label: 'Objet à protéger', size: 'large', packed: [3, 55, 40, 35]},
};

export function isAutomaticShippingFamily(value: unknown): value is AutomaticShippingFamily {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FAMILIES_V2, value);
}
export function automaticShippingFamilyProfile(profileFamily: AutomaticShippingFamily) {
  const family = FAMILIES_V2[profileFamily], [weight, length, width, height] = family.packed;
  const parcel: EstimatedShippingParcel = {weight: {value: weight, unit: 'kilogram'},
    dimensions: {length, width, height, unit: 'centimeter'}};
  return {source: 'automatic_profile' as const, profileVersion: 2 as const, profileFamily,
    profileSize: family.size, label: family.label, parcel};
}

/** Only a complete canonical category path can choose a product family. No
 * photo, title, invalid category or stale draft packageSize certifies geometry. */
export function automaticShippingEstimate(input: {categoryIds?: unknown}) {
  const ids = input?.categoryIds;
  let family: AutomaticShippingFamily = 'unknown';
  if (Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string')) {
    const leaf = ids[ids.length - 1] as string, node = findCategoryById(leaf);
    const path = node && !node.children?.length ? getCategoryPath(leaf) : null;
    if (path && path.length === ids.length && path.every((id, index) => id === ids[index])) {
      if (/(?:^|_)shoes(?:_|$)/.test(leaf)) family = /(?:^|_)boots(?:_|$)/.test(leaf) ? 'boots' : 'footwear';
      else if (/(?:^|_)(?:coats|outerwear|blazers|suits|jackets)(?:_|$)/.test(leaf)) family = 'outerwear';
      else if (/(?:^|_)(?:sweaters|knitwear|hoodies|sweatshirts)(?:_|$)/.test(leaf)) family = 'knitwear';
      else if (/^kids_(?:girls|boys)_baby_(?:onesies|bodysuits|sleepers|sets)$/.test(leaf)) family = 'light_clothing';
      else if (/(?:^|_)shorts(?:_|$)/.test(leaf)) family = 'light_clothing';
      else if (/(?:^|_)(?:jeans|pants|bottoms)(?:_|$)/.test(leaf)) family = 'denim_trousers';
      else if (/(?:^|_)(?:dresses|skirts|jumpsuits)(?:_|$)/.test(leaf)) family = 'dress';
      else if (/(?:^|_)(?:tops|shirts|shorts|swimwear|lingerie|underwear|sleepwear)(?:_|$)/.test(leaf)) family = 'light_clothing';
      else if (/(?:^|_)bags(?:_|$)/.test(leaf)) family = 'bag';
      else if (/^(?:women|men|kids_(?:girls|boys))_accessories(?:_|$)/.test(leaf)) family = 'accessory';
      else if (/(?:^|_)beauty(?:_|$)/.test(leaf)) family = 'beauty';
      else if (/^electronics_(?:phones_(?:phones|accessories)|tablets_(?:tablets|accessories)|cameras_cameras)(?:_|$)/.test(leaf)) family = 'compact_electronics';
      else if (/^kids_toys_(?:figures|crafts|baby|dolls|costumes|educational|electronic|novelty|vehicles)(?:_|$)/.test(leaf)) family = 'toy';
    }
  }
  return {...automaticShippingFamilyProfile(family),
    recommendationBasis: family === 'unknown' ? 'conservative_default' as const : 'category_family' as const};
}
