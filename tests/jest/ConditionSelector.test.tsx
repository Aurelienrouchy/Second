import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import ConditionSelector from '@/components/ConditionSelector';
import { CONDITIONS } from '@/data/conditions';

describe('ConditionSelector', () => {
  it('ouvre un menu explicite au lieu de faire défiler silencieusement les états', () => {
    const onChange = jest.fn();
    render(<ConditionSelector value="très bon état" onChange={onChange} />);

    fireEvent.press(screen.getByTestId('condition-selector'));

    expect(screen.getByText("État de l'article")).toBeOnTheScreen();
    expect(screen.getByText('Neuf avec étiquette')).toBeOnTheScreen();
    expect(screen.getByText('Neuf sans étiquette')).toBeOnTheScreen();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sélectionne et renvoie « neuf sans étiquette »', () => {
    const onChange = jest.fn();
    render(<ConditionSelector value="bon état" onChange={onChange} />);

    fireEvent.press(screen.getByTestId('condition-selector'));
    fireEvent.press(screen.getByText('Neuf sans étiquette'));

    expect(onChange).toHaveBeenCalledWith('neuf sans étiquette');
  });

  it('expose les cinq états depuis la source de vérité', () => {
    expect(CONDITIONS.map(({ value }) => value)).toEqual([
      'neuf',
      'neuf sans étiquette',
      'très bon état',
      'bon état',
      'satisfaisant',
    ]);
  });
});
