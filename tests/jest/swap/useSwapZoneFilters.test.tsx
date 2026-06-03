/**
 * useSwapZoneFilters — filtrage/tri CÔTÉ CLIENT du stock de la Swap Zone.
 *
 * Le hook filtre un stock borné déjà chargé (SwapPartyItemExtended) sans
 * requête Firestore. On vérifie le comportement MÉTIER de chaque facette
 * (catégorie, taille, couleur, marque, matière, état), les combinaisons,
 * le tri prix/récence, les flags d'activité et le reset.
 *
 * `.tsx` (renderHook RNTL) → périmètre Jest.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useSwapZoneFilters } from '@/features/swap-party/hooks/useSwapZoneFilters';
import type { SwapPartyItemExtended } from '@/types';

// ---------------------------------------------------------------------------
// Fixtures — un stock varié pour exercer chaque facette.
// ---------------------------------------------------------------------------

function makeItem(over: Partial<SwapPartyItemExtended>): SwapPartyItemExtended {
  return {
    id: over.id ?? 'i',
    partyId: 'generalist',
    articleId: over.articleId ?? over.id ?? 'art',
    sellerId: 's1',
    sellerName: 'Seller',
    title: over.title ?? 'Item',
    price: over.price ?? 10,
    isSwapped: false,
    addedAt: over.addedAt ?? new Date('2026-01-01'),
    ...over,
  } as SwapPartyItemExtended;
}

const robe = makeItem({
  id: 'robe',
  price: 30,
  categoryIds: ['women', 'women_dresses'],
  size: { value: 'M', system: 'EU' },
  color: 'noir',
  brand: 'Zara',
  material: 'coton',
  condition: 'bon état',
  addedAt: new Date('2026-03-01'),
});

const veste = makeItem({
  id: 'veste',
  price: 80,
  categoryIds: ['men', 'men_jackets'],
  size: { value: 'L', system: 'EU' },
  color: 'bleu',
  brand: 'Levi’s',
  material: 'cuir',
  condition: 'neuf',
  addedAt: new Date('2026-02-01'),
});

const tshirt = makeItem({
  id: 'tshirt',
  price: 5,
  categoryIds: ['men', 'men_tops'],
  size: { value: 'M', system: 'EU' },
  color: 'noir',
  brand: 'Zara',
  material: 'coton',
  condition: 'satisfaisant',
  addedAt: new Date('2026-04-01'),
});

const STOCK = [robe, veste, tshirt];

const idsOf = (items: SwapPartyItemExtended[]) => items.map((i) => i.id).sort();

describe('useSwapZoneFilters — sans filtre', () => {
  it('renvoie tout le stock trié par récence (addedAt desc) par défaut', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    expect(result.current.hasActiveFilters).toBe(false);
    // Ordre récence : tshirt (avril) > robe (mars) > veste (février).
    expect(result.current.filteredItems.map((i) => i.id)).toEqual(['tshirt', 'robe', 'veste']);
  });
});

describe('useSwapZoneFilters — facette catégorie', () => {
  it('ne garde que les items dont un categoryId est dans le chemin sélectionné', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    act(() => result.current.handleCategorySelect(['men']));

    expect(idsOf(result.current.filteredItems)).toEqual(['tshirt', 'veste']);
    expect(result.current.isCategoryActive).toBe(true);
    expect(result.current.hasActiveFilters).toBe(true);
    expect(result.current.getCategoryLabel()).not.toBe('Catégorie');
  });
});

describe('useSwapZoneFilters — facette taille', () => {
  it('matche sur value ET system de la taille', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    act(() =>
      result.current.handleSizesConfirm([{ value: 'M', system: 'EU' }])
    );

    expect(idsOf(result.current.filteredItems)).toEqual(['robe', 'tshirt']);
    expect(result.current.isSizeActive).toBe(true);
  });

  it('ne matche pas si le system diffère', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    act(() =>
      result.current.handleSizesConfirm([{ value: 'M', system: 'US' }])
    );

    expect(result.current.filteredItems).toHaveLength(0);
  });
});

describe('useSwapZoneFilters — facette couleur', () => {
  it('garde les items dont la couleur fait partie de la sélection', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    act(() => result.current.handleColorSelect('noir'));

    expect(idsOf(result.current.filteredItems)).toEqual(['robe', 'tshirt']);
    expect(result.current.isColorActive).toBe(true);
  });

  it('un second tap sur la même couleur la dé-sélectionne (toggle)', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    act(() => result.current.handleColorSelect('noir'));
    act(() => result.current.handleColorSelect('noir'));

    expect(result.current.isColorActive).toBe(false);
    expect(result.current.filteredItems).toHaveLength(STOCK.length);
  });
});

describe('useSwapZoneFilters — facette marque (insensible à la casse)', () => {
  it('matche la marque sans tenir compte de la casse', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    act(() => result.current.handleBrandsConfirm(['zara']));

    expect(idsOf(result.current.filteredItems)).toEqual(['robe', 'tshirt']);
    expect(result.current.getBrandLabel()).toBe('zara');
  });
});

describe('useSwapZoneFilters — facette matière + état', () => {
  it('filtre par matière', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    act(() => result.current.handleMaterialSelect('cuir'));

    expect(idsOf(result.current.filteredItems)).toEqual(['veste']);
  });

  it('filtre par état et toggle off au second tap', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    act(() => result.current.handleConditionSelect('neuf'));
    expect(idsOf(result.current.filteredItems)).toEqual(['veste']);
    expect(result.current.isConditionActive).toBe(true);

    act(() => result.current.handleConditionSelect('neuf'));
    expect(result.current.isConditionActive).toBe(false);
    expect(result.current.filteredItems).toHaveLength(STOCK.length);
  });
});

describe('useSwapZoneFilters — combinaison de facettes', () => {
  it('applique les filtres en ET logique (couleur noir + matière coton + catégorie men)', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    act(() => result.current.handleColorSelect('noir'));
    act(() => result.current.handleMaterialSelect('coton'));
    act(() => result.current.handleCategorySelect(['men']));

    // robe (women) éliminée par catégorie ; veste (bleu/cuir) éliminée ;
    // seul le t-shirt men/noir/coton survit.
    expect(idsOf(result.current.filteredItems)).toEqual(['tshirt']);
  });
});

describe('useSwapZoneFilters — tri', () => {
  it('trie par prix croissant', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    act(() => result.current.handleSortSelect('price_asc'));

    expect(result.current.filteredItems.map((i) => i.price)).toEqual([5, 30, 80]);
    expect(result.current.isSortActive).toBe(true);
    expect(result.current.getSortLabel()).toBe('Prix croissant');
  });

  it('trie par prix décroissant', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    act(() => result.current.handleSortSelect('price_desc'));

    expect(result.current.filteredItems.map((i) => i.price)).toEqual([80, 30, 5]);
    expect(result.current.getSortLabel()).toBe('Prix décroissant');
  });
});

describe('useSwapZoneFilters — reset', () => {
  it('clearFilters remet tout le stock et baisse les flags', () => {
    const { result } = renderHook(() => useSwapZoneFilters(STOCK));

    act(() => result.current.handleColorSelect('noir'));
    act(() => result.current.handleSortSelect('price_asc'));
    act(() => result.current.handleCategorySelect(['men']));
    expect(result.current.hasActiveFilters).toBe(true);

    act(() => result.current.clearFilters());

    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.filteredItems).toHaveLength(STOCK.length);
    expect(result.current.getSortLabel()).toBe('Trier');
    expect(result.current.getColorLabel()).toBe('Couleur');
    expect(result.current.getCategoryLabel()).toBe('Catégorie');
  });
});
