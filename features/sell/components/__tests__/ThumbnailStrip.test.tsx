/**
 * <ThumbnailStrip ownerUid="uid" /> — bande de vignettes sous le viseur.
 *
 * ACCESSIBILITÉ : le bouton galerie et les croix de suppression n'ont pour tout
 * contenu qu'un glyphe Ionicons, donc aucun nom au lecteur d'écran.
 *
 * CIBLE TACTILE : la croix débordait de sa vignette (top/right -6) avec un
 * hitSlop de 6. Sur Android la part de hitSlop qui sort de l'overflowInset du
 * parent est perdue : seul le cadre propre du bouton répond vraiment. C'est
 * donc ce cadre, hitSlop exclu, que l'on mesure ici.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

jest.mock('@/components/PrivateStorageImage', () => ({ PrivateStorageImage: () => null }));

import { ThumbnailStrip } from '../capture/ThumbnailStrip';

const PHOTOS = ['file:///a.jpg', 'file:///b.jpg'];

function renderStrip(canAddMore = true) {
  return render(
    <ThumbnailStrip ownerUid="uid"
      photos={PHOTOS}
      onRemovePhoto={jest.fn()}
      onGalleryPress={jest.fn()}
      canAddMore={canAddMore}
    />,
  );
}

describe('<ThumbnailStrip ownerUid="uid" /> — les boutons-icônes sont nommés', () => {
  it('le bouton galerie s’annonce « Ajouter depuis la galerie »', () => {
    renderStrip();
    expect(screen.getByLabelText('Ajouter depuis la galerie').props.accessibilityRole).toBe(
      'button',
    );
  });

  it('chaque croix dit quelle photo elle retire', () => {
    renderStrip();
    expect(screen.getByLabelText('Retirer la photo 1').props.accessibilityRole).toBe('button');
    expect(screen.getByLabelText('Retirer la photo 2')).toBeOnTheScreen();
  });
});

describe('<ThumbnailStrip ownerUid="uid" /> — la croix reste atteignable au doigt', () => {
  it('le cadre propre de la croix fait au moins 28 dp, hitSlop exclu', () => {
    renderStrip();
    const style = StyleSheet.flatten(
      screen.getByTestId('sell-thumbnail-remove-0').props.style,
    );
    expect(style.width).toBeGreaterThanOrEqual(28);
    expect(style.height).toBeGreaterThanOrEqual(28);
  });
});
