/**
 * <TopControls /> — barre haute du viseur (fermer, flash, retourner).
 *
 * Comportement ACCESSIBILITÉ : ces trois boutons n'ont pour tout contenu qu'un
 * glyphe Ionicons, qui ne porte aucun nom lisible. Sans libellé explicite, le
 * lecteur d'écran annonce trois boutons anonymes à la première étape de la
 * mise en vente.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { TopControls } from '../capture/TopControls';

function renderControls(torchActive = false) {
  return render(
    <TopControls
      topInset={0}
      photoCount={0}
      maxPhotos={5}
      torchActive={torchActive}
      onClose={jest.fn()}
      onFlipCamera={jest.fn()}
      onToggleTorch={jest.fn()}
    />,
  );
}

describe('<TopControls /> — les boutons-icônes sont nommés', () => {
  it('le bouton de fermeture s’annonce « Fermer »', () => {
    renderControls();
    const bouton = screen.getByLabelText('Fermer');
    expect(bouton.props.accessibilityRole).toBe('button');
  });

  it('le bouton de bascule caméra s’annonce « Retourner la caméra »', () => {
    renderControls();
    const bouton = screen.getByLabelText('Retourner la caméra');
    expect(bouton.props.accessibilityRole).toBe('button');
  });

  it('le flash s’annonce et expose son état allumé/éteint', () => {
    const { rerender } = renderControls(false);
    expect(screen.getByLabelText('Flash').props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    );

    rerender(
      <TopControls
        topInset={0}
        photoCount={0}
        maxPhotos={5}
        torchActive
        onClose={jest.fn()}
        onFlipCamera={jest.fn()}
        onToggleTorch={jest.fn()}
      />,
    );
    expect(screen.getByLabelText('Flash').props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
  });
});
