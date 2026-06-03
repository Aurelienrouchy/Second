/**
 * FilterChipsRow — rangée de chips de filtres (catégorie, couleur, taille…).
 *
 * Domaine : recherche-decouverte. Comportement MÉTIER couvert :
 *  - taper un chip ouvre/applique le filtre (onPress).
 *  - le bouton X (remove) n'apparaît QUE quand le chip est actif ET qu'un
 *    handler onRemove est fourni (L3).
 *  - taper le X retire le filtre SANS rouvrir le sheet (onRemove appelé,
 *    onPress du chip NON appelé) — régression UX clé.
 *  - un chip actif sans onRemove n'affiche pas de X.
 *
 * Composant nommé + React.memo → testé via ses props (chips[]).
 */

import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

// Import direct du composant source (et non du barrel) : le barrel ré-exporte
// useSearchScreen, qui tire toute la chaîne authStore → queryClient →
// expo-network (module ESM non transpilé sous Jest). On reste intra-feature.
import { FilterChipsRow, type FilterChip } from '../FilterChipsRow';

describe('FilterChipsRow', () => {
  it('déclenche onPress quand on tape un chip', () => {
    const onPress = jest.fn();
    const chips: FilterChip[] = [
      { key: 'category', label: 'Catégorie', active: false, onPress },
    ];
    const { getByTestId } = render(<FilterChipsRow chips={chips} />);

    fireEvent.press(getByTestId('filter-chip-category'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('n’affiche pas le X de retrait sur un chip inactif', () => {
    const chips: FilterChip[] = [
      { key: 'color', label: 'Couleur', active: false, onPress: jest.fn(), onRemove: jest.fn() },
    ];
    const { queryByTestId } = render(<FilterChipsRow chips={chips} />);
    expect(queryByTestId('filter-chip-remove-color')).toBeNull();
  });

  it('n’affiche pas le X quand le chip est actif mais sans handler onRemove', () => {
    const chips: FilterChip[] = [
      { key: 'sort', label: 'Tri auto', active: true, onPress: jest.fn() },
    ];
    const { queryByTestId } = render(<FilterChipsRow chips={chips} />);
    expect(queryByTestId('filter-chip-remove-sort')).toBeNull();
  });

  it('affiche le X sur un chip actif avec onRemove', () => {
    const chips: FilterChip[] = [
      { key: 'color', label: 'Noir', active: true, onPress: jest.fn(), onRemove: jest.fn() },
    ];
    const { getByTestId } = render(<FilterChipsRow chips={chips} />);
    expect(getByTestId('filter-chip-remove-color')).not.toBeNull();
  });

  it('taper le X retire le filtre sans rouvrir le sheet (onRemove sans onPress)', () => {
    const onPress = jest.fn();
    const onRemove = jest.fn();
    const chips: FilterChip[] = [
      { key: 'color', label: 'Noir', active: true, onPress, onRemove },
    ];
    const { getByTestId } = render(<FilterChipsRow chips={chips} />);

    fireEvent.press(getByTestId('filter-chip-remove-color'));

    expect(onRemove).toHaveBeenCalledTimes(1);
    // Régression : taper le X ne doit PAS déclencher l'ouverture du chip.
    expect(onPress).not.toHaveBeenCalled();
  });

  it('rend tous les chips fournis', () => {
    const chips: FilterChip[] = [
      { key: 'category', label: 'Catégorie', active: false, onPress: jest.fn() },
      { key: 'color', label: 'Couleur', active: false, onPress: jest.fn() },
      { key: 'price', label: 'Prix', active: false, onPress: jest.fn() },
    ];
    const { getByTestId } = render(<FilterChipsRow chips={chips} />);
    expect(getByTestId('filter-chip-category')).not.toBeNull();
    expect(getByTestId('filter-chip-color')).not.toBeNull();
    expect(getByTestId('filter-chip-price')).not.toBeNull();
  });
});
