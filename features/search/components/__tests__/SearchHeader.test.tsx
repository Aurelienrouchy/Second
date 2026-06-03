/**
 * SearchHeader — barre de recherche (input + clear + caméra + OK).
 *
 * Domaine : recherche-decouverte. On vérifie le comportement MÉTIER visible :
 *  - le bouton "clear" (X) n'apparaît que lorsqu'il y a du texte saisi.
 *  - le bouton OK ne s'affiche que quand `showOk` est vrai, et déclenche la
 *    soumission (commit immédiat de la recherche).
 *  - la frappe remonte via onChangeQuery ; clear vide le champ.
 *  - le bouton caméra ouvre la recherche visuelle.
 *
 * Composant nommé + React.memo → testé via son interface publique (props).
 */

import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

// Import direct du composant source (et non du barrel) : le barrel ré-exporte
// useSearchScreen, qui tire toute la chaîne authStore → queryClient →
// expo-network (module ESM non transpilé sous Jest). On reste intra-feature.
import { SearchHeader } from '../SearchHeader';

function setup(overrides: Partial<React.ComponentProps<typeof SearchHeader>> = {}) {
  const props = {
    inputRef: React.createRef<any>(),
    searchQuery: '',
    showOk: false,
    onChangeQuery: jest.fn(),
    onClear: jest.fn(),
    onSubmit: jest.fn(),
    onClose: jest.fn(),
    onOpenVisualSearch: jest.fn(),
    ...overrides,
  };
  const utils = render(<SearchHeader {...props} />);
  return { ...utils, props };
}

describe('SearchHeader', () => {
  it('ne montre pas le bouton clear quand le champ est vide', () => {
    const { queryByTestId } = setup({ searchQuery: '' });
    expect(queryByTestId('search-clear-button')).toBeNull();
  });

  it('montre le bouton clear dès qu’il y a du texte et le câble sur onClear', () => {
    const { getByTestId, props } = setup({ searchQuery: 'robe' });
    const clear = getByTestId('search-clear-button');
    fireEvent.press(clear);
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('propage la frappe via onChangeQuery', () => {
    const { getByTestId, props } = setup({ searchQuery: '' });
    fireEvent.changeText(getByTestId('search-input'), 'manteau');
    expect(props.onChangeQuery).toHaveBeenCalledWith('manteau');
  });

  it('soumet la recherche au submit du champ (Enter/search)', () => {
    const { getByTestId, props } = setup({ searchQuery: 'jean' });
    fireEvent(getByTestId('search-input'), 'submitEditing');
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('n’affiche le bouton OK que lorsque showOk est vrai', () => {
    const { queryByTestId, rerender, props } = setup({ showOk: false });
    expect(queryByTestId('search-submit-button')).toBeNull();

    rerender(<SearchHeader {...props} showOk />);
    expect(queryByTestId('search-submit-button')).not.toBeNull();
  });

  it('le bouton OK déclenche la soumission immédiate', () => {
    const { getByTestId, props } = setup({ showOk: true, searchQuery: 'sac' });
    fireEvent.press(getByTestId('search-submit-button'));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('le bouton caméra ouvre la recherche visuelle', () => {
    const { getByTestId, props } = setup();
    fireEvent.press(getByTestId('search-visual-button'));
    expect(props.onOpenVisualSearch).toHaveBeenCalledTimes(1);
  });
});
