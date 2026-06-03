/**
 * ArticleCTABar — sticky bottom CTA bar of the article detail screen.
 *
 * Couvre le comportement MÉTIER de la barre d'action (page article → CTA) :
 * - état "achetable" : double CTA Offre + Acheter (avec prix formaté CA),
 *   et chaque bouton notifie le bon handler ;
 * - feature flag livraison désactivée : le bouton d'achat devient une simple
 *   PROPOSITION d'achat (pas de paiement), libellé "PROPOSER UN ACHAT" ;
 * - article vendu / réservé : la barre verrouille l'achat et affiche l'état,
 *   aucun CTA d'achat n'est rendu ;
 * - contexte d'échange (SwapZone) : un unique CTA "PROPOSER UN ÉCHANGE" ;
 * - article du vendeur lui-même : message "C'est votre article", pas d'achat.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ArticleCTABar } from '@/features/article/components/ArticleCTABar';

const noop = () => {};

function renderBar(overrides: Partial<React.ComponentProps<typeof ArticleCTABar>> = {}) {
  const props: React.ComponentProps<typeof ArticleCTABar> = {
    isOwnArticle: false,
    isSold: false,
    isReserved: false,
    isSwapContext: false,
    shippingEnabled: true,
    price: 45,
    bottomInset: 0,
    onBuy: jest.fn(),
    onMakeOffer: jest.fn(),
    onProposeSwap: jest.fn(),
    ...overrides,
  };
  render(<ArticleCTABar {...props} />);
  return props;
}

describe('<ArticleCTABar />', () => {
  describe('article achetable (livraison active)', () => {
    it('affiche le prix formaté CA dans le bouton Acheter et notifie onBuy', () => {
      const onBuy = jest.fn();
      renderBar({ price: 45, onBuy });

      // Prix entier → "45 $" (convention formatPrice CA, sans décimales).
      expect(screen.getByText('ACHETER · 45 $')).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('article-buy-button'));
      expect(onBuy).toHaveBeenCalledTimes(1);
    });

    it('formate un prix décimal avec virgule (45,50 $)', () => {
      renderBar({ price: 45.5 });
      expect(screen.getByText('ACHETER · 45,50 $')).toBeOnTheScreen();
    });

    it('expose un CTA Offre distinct qui notifie onMakeOffer (pas onBuy)', () => {
      const onBuy = jest.fn();
      const onMakeOffer = jest.fn();
      renderBar({ onBuy, onMakeOffer });

      fireEvent.press(screen.getByTestId('article-make-offer-button'));
      expect(onMakeOffer).toHaveBeenCalledTimes(1);
      expect(onBuy).not.toHaveBeenCalled();
    });
  });

  describe('livraison désactivée (SHIPPING_ENABLED=false)', () => {
    it('transforme l\'achat en proposition (pas de prix, libellé dédié)', () => {
      renderBar({ shippingEnabled: false, price: 45 });

      expect(screen.getByText('PROPOSER UN ACHAT')).toBeOnTheScreen();
      expect(screen.queryByText('ACHETER · 45 $')).not.toBeOnTheScreen();
      // Le CTA reste fonctionnel : c'est le même bouton d'achat.
      expect(screen.getByTestId('article-buy-button')).toBeOnTheScreen();
    });
  });

  describe('article indisponible', () => {
    it('verrouille l\'achat quand l\'article est vendu', () => {
      renderBar({ isSold: true });

      expect(screen.getByText('Article vendu')).toBeOnTheScreen();
      expect(screen.queryByTestId('article-buy-button')).not.toBeOnTheScreen();
      expect(screen.queryByTestId('article-make-offer-button')).not.toBeOnTheScreen();
    });

    it('affiche "Réservé temporairement" quand une transaction est en cours', () => {
      renderBar({ isReserved: true });

      expect(screen.getByText('Réservé temporairement')).toBeOnTheScreen();
      expect(screen.queryByTestId('article-buy-button')).not.toBeOnTheScreen();
    });

    it('priorise l\'état vendu si l\'article est à la fois vendu et réservé', () => {
      renderBar({ isSold: true, isReserved: true });

      expect(screen.getByText('Article vendu')).toBeOnTheScreen();
      expect(screen.queryByText('Réservé temporairement')).not.toBeOnTheScreen();
    });
  });

  describe('contexte d\'échange (SwapZone)', () => {
    it('affiche un unique CTA d\'échange et notifie onProposeSwap', () => {
      const onProposeSwap = jest.fn();
      renderBar({ isSwapContext: true, onProposeSwap });

      expect(screen.getByText('PROPOSER UN ÉCHANGE')).toBeOnTheScreen();
      // En contexte swap, ni achat ni offre monétaire.
      expect(screen.queryByTestId('article-buy-button')).not.toBeOnTheScreen();
      expect(screen.queryByTestId('article-make-offer-button')).not.toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('article-propose-swap-button'));
      expect(onProposeSwap).toHaveBeenCalledTimes(1);
    });
  });

  describe('article du vendeur', () => {
    it('bloque l\'achat sur son propre article', () => {
      renderBar({ isOwnArticle: true });

      expect(screen.getByText("C'est votre article")).toBeOnTheScreen();
      expect(screen.queryByTestId('article-buy-button')).not.toBeOnTheScreen();
      expect(screen.queryByTestId('article-make-offer-button')).not.toBeOnTheScreen();
    });
  });
});
