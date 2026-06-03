/**
 * <FormErrors /> — récapitulatif des erreurs de validation (écran Prix).
 *
 * Comportement MÉTIER : ne rend rien quand il n'y a pas d'erreur (aucun bruit
 * visuel), et affiche chaque message de validation quand le formulaire est
 * incomplet (prix invalide, livraison manquante, quartier manquant...).
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { FormErrors } from '@/features/sell';

describe('<FormErrors />', () => {
  it('ne rend rien quand il n’y a aucune erreur', () => {
    const { toJSON } = render(<FormErrors errors={[]} />);
    expect(toJSON()).toBeNull();
  });

  it('affiche chaque message d’erreur de validation', () => {
    render(
      <FormErrors
        errors={[
          'Entrez un prix valide',
          'Sélectionnez au moins une option de livraison',
        ]}
      />,
    );
    expect(screen.getByText('Entrez un prix valide')).toBeOnTheScreen();
    expect(
      screen.getByText('Sélectionnez au moins une option de livraison'),
    ).toBeOnTheScreen();
  });

  it('affiche une seule erreur sans en inventer d’autres', () => {
    render(<FormErrors errors={['Sélectionnez une taille de colis']} />);
    expect(
      screen.getByText('Sélectionnez une taille de colis'),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Entrez un prix valide')).toBeNull();
  });
});
