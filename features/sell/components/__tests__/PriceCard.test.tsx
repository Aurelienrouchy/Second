/**
 * <PriceCard /> — saisie du prix de vente (écran Prix & livraison).
 *
 * Comportement MÉTIER : reflète la valeur du prix contrôlée par l'écran et
 * remonte chaque frappe via onPriceChange (l'écran applique ensuite le
 * nettoyage : virgule -> point, max 2 décimales, etc.). Le composant ne
 * transforme rien lui-même : il est un champ contrôlé.
 */

import React, { createRef } from 'react';
import { TextInput } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PriceCard } from '@/features/sell';

describe('<PriceCard />', () => {
  it('affiche le label, le symbole monétaire et la valeur contrôlée', () => {
    const ref = createRef<TextInput>();
    render(<PriceCard price="25" onPriceChange={jest.fn()} inputRef={ref} />);

    expect(screen.getByText('Prix de vente')).toBeOnTheScreen();
    expect(screen.getByText('$')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('25')).toBeOnTheScreen();
  });

  it('remonte la saisie brute via onPriceChange', () => {
    const ref = createRef<TextInput>();
    const onPriceChange = jest.fn();
    render(
      <PriceCard price="" onPriceChange={onPriceChange} inputRef={ref} />,
    );

    fireEvent.changeText(screen.getByPlaceholderText('0'), '19,99');
    expect(onPriceChange).toHaveBeenCalledWith('19,99');
  });
});
