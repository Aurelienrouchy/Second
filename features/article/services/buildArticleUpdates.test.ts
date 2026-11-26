import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArticleImage, MeetupNeighborhood } from '@/types';

const flags = vi.hoisted(() => ({ shipping: false }));
vi.mock('@/config/featureFlags', () => ({
  SHIPPING_ENABLED: false,
  get SHIPPING_LISTINGS_ENABLED() {
    return flags.shipping;
  },
}));

import {
  buildArticleUpdates,
  resolveTrackedDelivery,
  type ArticleUpdateFields,
} from './buildArticleUpdates';

const plateau: MeetupNeighborhood = { id: 'plateau', name: 'Le Plateau', borough: 'Le Plateau-Mont-Royal' };
const images: ArticleImage[] = [{ url: 'https://storage/1.jpg' }, { url: 'https://storage/2.jpg' }];

const base: ArticleUpdateFields = {
  title: '  Robe fleurie  ',
  description: '  Portée deux fois  ',
  categoryIds: ['women', 'women_clothing'],
  categoryDisplay: { name: 'Robes' },
  condition: 'très bon état',
  colors: ['rouge', 'noir'],
  materials: ['coton'],
  size: 'M',
  sizeSystem: 'EU',
  brand: 'Zara',
  price: 25,
  isHandDelivery: true,
  isShipping: false,
  neighborhoods: [plateau],
  packageSize: null,
};

beforeEach(() => {
  flags.shipping = false;
});

describe('buildArticleUpdates', () => {
  it('nettoie les textes et recopie la vitrine de catégorie', () => {
    const updates = buildArticleUpdates(base, images);
    expect(updates.title).toBe('Robe fleurie');
    expect(updates.description).toBe('Portée deux fois');
    expect(updates.category).toBe('Robes');
    expect(updates.images).toEqual(images);
  });

  it('ne reprend aucun ancien questionnaire défauts dans une nouvelle modification', () => {
    const oldFields = { hasKnownDefects: true, defectsDescription: 'Une tache', defectsChanged: true,
      defectReviewSource: 'ancienne description', defectsReviewedFor: 'ancien état' };
    const updates = buildArticleUpdates({ ...base, ...oldFields }, images);
    expect(updates).not.toHaveProperty('hasKnownDefects');
    expect(updates).not.toHaveProperty('defectsDescription');
    expect(updates.description).toBe('Portée deux fois');
  });

  it('marque vidée : on écrit null, jamais undefined', () => {
    const updates = buildArticleUpdates({ ...base, brand: '   ' }, images);
    expect(updates.brand).toBeNull();
    expect('brand' in updates).toBe(true);
  });

  it('taille vidée : on écrit null ; taille gardée : son système la suit', () => {
    expect(buildArticleUpdates({ ...base, size: null }, images).size).toBeNull();
    expect(buildArticleUpdates({ ...base, size: '9', sizeSystem: 'US' }, images).size).toEqual({
      value: '9',
      system: 'US',
    });
  });

  it('couleur et matière principales tombent à null quand la liste est vide', () => {
    const updates = buildArticleUpdates({ ...base, colors: [], materials: [] }, images);
    expect(updates.color).toBeNull();
    expect(updates.material).toBeNull();
  });

  it('F138 — expédition coupée : on ne touche NI isShipping NI isHandDelivery NI packageSize', () => {
    const updates = buildArticleUpdates({ ...base, packageSize: 'medium' }, images);
    expect('isShipping' in updates).toBe(false);
    expect('isHandDelivery' in updates).toBe(false);
    expect('packageSize' in updates).toBe(false);
  });

  it('expédition rouverte : le formulaire fait foi sur les trois champs', () => {
    flags.shipping = true;
    const updates = buildArticleUpdates(
      { ...base, isHandDelivery: false, isShipping: true, packageSize: 'medium' },
      images,
    );
    expect(updates.isShipping).toBe(true);
    expect(updates.isHandDelivery).toBe(false);
    expect(updates.packageSize).toBe('medium');
  });

  it('les quartiers restent modifiables, drapeau éteint compris', () => {
    const updates = buildArticleUpdates(base, images);
    expect(updates.neighborhoods).toEqual([plateau]);
    expect(updates.neighborhood).toEqual(plateau);
  });

  it('sans quartier choisi, on n\'écrase pas ceux de l\'annonce', () => {
    const updates = buildArticleUpdates({ ...base, neighborhoods: [] }, images);
    expect('neighborhoods' in updates).toBe(false);
    expect('neighborhood' in updates).toBe(false);
  });
});

describe('resolveTrackedDelivery', () => {
  it('expédition coupée : on rapporte ce que l\'annonce porte, pas ce que le formulaire affiche', () => {
    const stored = { isHandDelivery: false, isShipping: true };
    const updates = buildArticleUpdates({ ...base, isHandDelivery: true, isShipping: false }, images);
    expect(resolveTrackedDelivery(updates, stored)).toEqual({
      is_hand_delivery: false,
      is_shipping: true,
    });
  });

  it('expédition rouverte : on rapporte ce qui vient d\'être écrit', () => {
    flags.shipping = true;
    const updates = buildArticleUpdates({ ...base, isHandDelivery: false, isShipping: true }, images);
    expect(resolveTrackedDelivery(updates, { isHandDelivery: true, isShipping: false })).toEqual({
      is_hand_delivery: false,
      is_shipping: true,
    });
  });

  it('rien d\'écrit (refus de validation, erreur serveur) : on rapporte l\'état stocké', () => {
    expect(resolveTrackedDelivery({}, { isHandDelivery: true, isShipping: false })).toEqual({
      is_hand_delivery: true,
      is_shipping: false,
    });
  });

  it('annonce ancienne sans champ de livraison : rapportée comme non expédiable', () => {
    expect(resolveTrackedDelivery({}, {})).toEqual({
      is_hand_delivery: false,
      is_shipping: false,
    });
  });
});
