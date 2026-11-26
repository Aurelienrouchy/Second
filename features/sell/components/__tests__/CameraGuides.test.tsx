/**
 * <CameraGuides /> — texte de guidage posé sur le flux caméra en direct.
 *
 * Comportement LISIBILITÉ : le fond n'est pas maîtrisé, c'est l'image filmée.
 * Le sous-texte était en crème à 35 % sans ombre ni voile : illisible dès que
 * l'utilisateur cadre un vêtement clair. On remonte au jeton crème 60 % et on
 * ajoute une ombre portée sombre sur les deux lignes.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import CameraGuides from '../shared/CameraGuides';
import { colors } from '@/constants/theme';

const MESSAGE = 'Cadre ton article';
const SOUS_MESSAGE = 'Photo principale face avant';

function styleDe(texte: string) {
  return StyleSheet.flatten(screen.getByText(texte).props.style);
}

describe('<CameraGuides /> — le guidage reste lisible sur le flux caméra', () => {
  it('le sous-texte utilise au moins le jeton crème 60 %', () => {
    render(<CameraGuides message={MESSAGE} subMessage={SOUS_MESSAGE} />);
    expect(styleDe(SOUS_MESSAGE).color).toBe(colors.creamTranslucent60);
  });

  it('les deux lignes portent une ombre sombre qui les détache du fond clair', () => {
    render(<CameraGuides message={MESSAGE} subMessage={SOUS_MESSAGE} />);
    for (const texte of [MESSAGE, SOUS_MESSAGE]) {
      const style = styleDe(texte);
      expect(style.textShadowColor).toBe(colors.overlay);
      expect(style.textShadowRadius).toBeGreaterThan(0);
    }
  });
});
