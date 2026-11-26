/**
 * <SuccessModal /> — confirmation affichée après chaque publication réussie.
 *
 * Comportement RÉDACTION : la phrase collait le titre de l'annonce derrière
 * « Ton », ce qui donnait « Ton Robe fleurie Zara taille M est… » — accord faux
 * dès que le titre est féminin ou pluriel, et majuscule en milieu de phrase à
 * chaque fois, puisque les titres produits par l'IA commencent par une majuscule.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import SuccessModal from '../shared/SuccessModal';

function renderModal(articleTitle: string) {
  return render(
    <SuccessModal
      visible
      articleTitle={articleTitle}
      onViewArticle={jest.fn()}
      onReturnHome={jest.fn()}
    />,
  );
}

describe('<SuccessModal /> — la phrase de confirmation reste grammaticale', () => {
  it('cite le titre au lieu de l’accorder avec « Ton »', () => {
    renderModal('Robe fleurie Zara taille M');
    expect(
      screen.getByText(
        'Ton annonce « Robe fleurie Zara taille M » est maintenant visible par tous les acheteurs.',
      ),
    ).toBeOnTheScreen();
  });

  it('reste grammaticale sur un titre pluriel', () => {
    renderModal('Bottines en cuir');
    expect(
      screen.getByText(
        'Ton annonce « Bottines en cuir » est maintenant visible par tous les acheteurs.',
      ),
    ).toBeOnTheScreen();
  });

  it('se passe du titre quand il manque, sans laisser de guillemets vides', () => {
    renderModal('');
    expect(
      screen.getByText('Ton annonce est maintenant visible par tous les acheteurs.'),
    ).toBeOnTheScreen();
  });
});
