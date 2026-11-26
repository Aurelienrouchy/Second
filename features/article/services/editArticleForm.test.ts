import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeetupNeighborhood } from '@/types';

const flags = vi.hoisted(() => ({ shipping: false }));
vi.mock('@/config/featureFlags', () => ({
  SHIPPING_ENABLED: false,
  get SHIPPING_LISTINGS_ENABLED() {
    return flags.shipping;
  },
}));

import {
  resolveDeliveryFromArticle,
  resolveSizeAfterCategoryChange,
  validateArticleEditForm,
  type ArticleEditFormFields,
} from './editArticleForm';

const plateau: MeetupNeighborhood = { id: 'plateau', name: 'Le Plateau', borough: 'Le Plateau-Mont-Royal' };

const ROBE = ['women', 'women_clothing', 'women_clothing_dresses'];
const CHAUSSURES = ['women', 'women_shoes', 'women_shoes_boots'];

const base: ArticleEditFormFields = {
  title: 'Robe fleurie',
  description: 'Portée deux fois',
  categoryIds: ROBE,
  price: 25,
  isHandDelivery: true,
  isShipping: false,
  neighborhoods: [plateau],
  packageSize: null,
};

beforeEach(() => {
  flags.shipping = false;
});

describe('resolveDeliveryFromArticle', () => {
  it('expédition coupée : une annonce en main propre reste en main propre', () => {
    expect(resolveDeliveryFromArticle({ isHandDelivery: true, isShipping: false })).toEqual({
      isHandDelivery: true,
      isShipping: false,
    });
  });

  it('expédition coupée : une annonce historique en expédition n\'est pas basculée de force en main propre', () => {
    expect(resolveDeliveryFromArticle({ isHandDelivery: false, isShipping: true })).toEqual({
      isHandDelivery: false,
      isShipping: false,
    });
  });

  it('expédition rouverte : les options stockées font foi', () => {
    flags.shipping = true;
    expect(resolveDeliveryFromArticle({ isHandDelivery: false, isShipping: true })).toEqual({
      isHandDelivery: false,
      isShipping: true,
    });
  });

  it('annonces avec livraison Dev : ne présélectionne pas la livraison quand les options sont absentes', () => {
    flags.shipping = true;
    expect(resolveDeliveryFromArticle({})).toEqual({ isHandDelivery: true, isShipping: false });
  });
});

describe('resolveSizeAfterCategoryChange', () => {
  it('efface une pointure devenue impossible sur un vêtement', () => {
    expect(resolveSizeAfterCategoryChange('35.5', ROBE)).toBeNull();
  });

  it('garde une taille qui existe toujours dans la nouvelle catégorie', () => {
    expect(resolveSizeAfterCategoryChange('M', ROBE)).toBe('M');
  });

  it('efface « Unique » quand on passe des accessoires aux chaussures', () => {
    expect(resolveSizeAfterCategoryChange('Unique', CHAUSSURES)).toBeNull();
  });

  it('sans taille, il n\'y a rien à effacer', () => {
    expect(resolveSizeAfterCategoryChange(null, ROBE)).toBeNull();
  });
});

describe('validateArticleEditForm', () => {
  it('une annonce complète passe', () => {
    expect(validateArticleEditForm(base, 3)).toBeNull();
  });

  it('refuse un titre trop court', () => {
    expect(validateArticleEditForm({ ...base, title: 'Ro' }, 3)?.error).toBe('title_too_short');
  });

  it('refuse une annonce sans catégorie, au lieu de figer le bouton sans un mot', () => {
    expect(validateArticleEditForm({ ...base, categoryIds: [] }, 3)).toEqual({
      error: 'category_required',
      message: 'Sélectionnez une catégorie',
    });
  });

  it('refuse la main propre sans quartier', () => {
    expect(validateArticleEditForm({ ...base, neighborhoods: [] }, 3)?.error).toBe(
      'neighborhoods_required',
    );
  });

  it('refuse une annonce sans photo', () => {
    expect(validateArticleEditForm(base, 0)?.error).toBe('images_required');
  });

  it('expédition coupée : une annonce historique en expédition reste enregistrable', () => {
    expect(
      validateArticleEditForm(
        { ...base, isHandDelivery: false, isShipping: false, neighborhoods: [] },
        3,
      ),
    ).toBeNull();
  });

  it('expédition rouverte : une annonce sans aucun mode de remise est refusée', () => {
    flags.shipping = true;
    expect(
      validateArticleEditForm(
        { ...base, isHandDelivery: false, isShipping: false, neighborhoods: [] },
        3,
      )?.error,
    ).toBe('no_delivery');
  });

  it('expédition rouverte : une expédition sans format de colis est refusée', () => {
    flags.shipping = true;
    expect(
      validateArticleEditForm(
        { ...base, isHandDelivery: false, isShipping: true, neighborhoods: [], packageSize: null },
        3,
      )?.error,
    ).toBe('package_size_required');
  });
});
