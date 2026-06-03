/**
 * <ChipSelector /> — sélection multi-valeurs (couleurs/matières) écran Détails.
 *
 * Comportement MÉTIER :
 *  - rend les chips suggérées par l'IA puis les chips choisies par l'utilisateur
 *    qui ne font pas partie des suggestions ;
 *  - taper une chip remonte son id exact via onToggle (pas son label) ;
 *  - le bouton "Toutes" ouvre la liste complète (onViewAll) ;
 *  - resolveLabel a priorité pour afficher un libellé humain ;
 *  - le badge IA n'apparaît que si hasAiConfidence.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ChipSelector } from '@/features/sell';

const items = [
  { value: 'bleu-marine', label: 'Bleu marine' },
  { value: 'blanc', label: 'Blanc' },
  { value: 'rouge', label: 'Rouge' },
];

describe('<ChipSelector />', () => {
  it('rend les suggestions IA et les sélections utilisateur hors suggestions', () => {
    render(
      <ChipSelector
        label="Couleurs"
        selectedValues={['blanc']}
        aiSuggestedIds={['bleu-marine']}
        allItems={items}
        onToggle={jest.fn()}
        onViewAll={jest.fn()}
      />,
    );
    // Suggestion IA rendue.
    expect(screen.getByText('Bleu marine')).toBeOnTheScreen();
    // Sélection utilisateur hors suggestions également rendue.
    expect(screen.getByText('Blanc')).toBeOnTheScreen();
  });

  it('remonte l’id (pas le label) au tap sur une chip', () => {
    const onToggle = jest.fn();
    render(
      <ChipSelector
        label="Couleurs"
        selectedValues={[]}
        aiSuggestedIds={['bleu-marine']}
        allItems={items}
        onToggle={onToggle}
        onViewAll={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByText('Bleu marine'));
    expect(onToggle).toHaveBeenCalledWith('bleu-marine');
  });

  it('ouvre la liste complète via "Toutes"', () => {
    const onViewAll = jest.fn();
    render(
      <ChipSelector
        label="Matières"
        selectedValues={[]}
        aiSuggestedIds={[]}
        allItems={items}
        onToggle={jest.fn()}
        onViewAll={onViewAll}
      />,
    );
    fireEvent.press(screen.getByText('Toutes'));
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('utilise resolveLabel en priorité pour le libellé affiché', () => {
    render(
      <ChipSelector
        label="Couleurs"
        selectedValues={[]}
        aiSuggestedIds={['bleu-marine']}
        allItems={items}
        onToggle={jest.fn()}
        onViewAll={jest.fn()}
        resolveLabel={(id) => `#${id}`}
      />,
    );
    expect(screen.getByText('#bleu-marine')).toBeOnTheScreen();
  });

  it('n’affiche le badge IA que si hasAiConfidence', () => {
    const { rerender } = render(
      <ChipSelector
        label="Couleurs"
        selectedValues={[]}
        aiSuggestedIds={['bleu-marine']}
        allItems={items}
        onToggle={jest.fn()}
        onViewAll={jest.fn()}
      />,
    );
    expect(screen.queryByText('IA')).toBeNull();

    rerender(
      <ChipSelector
        label="Couleurs"
        selectedValues={[]}
        aiSuggestedIds={['bleu-marine']}
        allItems={items}
        hasAiConfidence
        onToggle={jest.fn()}
        onViewAll={jest.fn()}
      />,
    );
    expect(screen.getByText('IA')).toBeOnTheScreen();
  });
});
