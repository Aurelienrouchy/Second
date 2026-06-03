/**
 * PriceBreakdown — récapitulatif de prix du checkout livraison.
 *
 * Couvre le comportement MÉTIER du récap (article → checkout, frais) :
 * - ventile article + livraison + frais de protection, et affiche le total
 *   fourni avec la devise CA explicite (formatPriceWithCurrency) ;
 * - la ligne livraison n'apparaît QUE lorsqu'un tarif est sélectionné
 *   (sans estimation choisie, pas de ligne livraison) ;
 * - le libellé livraison reflète le transporteur + le service du tarif ;
 * - la mention de protection acheteur (séquestre 7 jours) est toujours présente.
 *
 * NB : le composant AFFICHE un total déjà calculé par l'écran. On vérifie ici
 * qu'il restitue fidèlement les montants métier (article + livraison + frais),
 * pas qu'il recalcule (la somme est testée côté écran/service).
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { PriceBreakdown } from '@/features/checkout-shipping/components/PriceBreakdown';
// Import direct depuis le module types (et non le barrel) : le barrel tire
// ShippingCheckoutSkeleton → Skeleton → expo-linear-gradient (ESM non
// transformé sous Jest). Le composant testé n'a besoin que de la copy + du type.
import { CHECKOUT_COPY } from '@/features/checkout-shipping/types';
import type { ShippingEstimate } from '@/features/checkout-shipping/types';

const ESTIMATE: ShippingEstimate = {
  rateId: 'se_rate_123',
  carrier: 'Postes Canada',
  carrierCode: 'canada_post',
  serviceName: 'Standard',
  amount: 8.5,
  deliveryDays: '3-5 jours ouvrables',
  deliveryType: 'home',
};

describe('<PriceBreakdown />', () => {
  it('ventile article + livraison + frais et affiche le total en devise CA', () => {
    // article 45 + livraison 8,50 + frais 4,50 = 58,00
    render(
      <PriceBreakdown
        articlePrice={45}
        selectedEstimate={ESTIMATE}
        serviceFee={4.5}
        totalAmount={58}
      />,
    );

    expect(screen.getByText('Article')).toBeOnTheScreen();
    expect(screen.getByText('45 $')).toBeOnTheScreen();

    // Ligne livraison libellée transporteur + service.
    expect(
      screen.getByText('Livraison (Postes Canada Standard)'),
    ).toBeOnTheScreen();
    expect(screen.getByText('8,50 $')).toBeOnTheScreen();

    expect(screen.getByText('Frais de protection Seconde')).toBeOnTheScreen();
    expect(screen.getByText('4,50 $')).toBeOnTheScreen();

    // Total : devise CA explicite, toujours 2 décimales.
    expect(screen.getByText('Total')).toBeOnTheScreen();
    expect(screen.getByText('58,00 $ CA')).toBeOnTheScreen();
  });

  it('masque la ligne livraison tant qu\'aucun tarif n\'est sélectionné', () => {
    render(
      <PriceBreakdown
        articlePrice={45}
        selectedEstimate={null}
        serviceFee={4.5}
        totalAmount={49.5}
      />,
    );

    expect(screen.getByText('Article')).toBeOnTheScreen();
    expect(screen.getByText('Frais de protection Seconde')).toBeOnTheScreen();
    // Pas de ligne livraison sans estimation.
    expect(screen.queryByText(/^Livraison \(/)).not.toBeOnTheScreen();
  });

  it('affiche un frais de protection à zéro sans masquer la ligne', () => {
    render(
      <PriceBreakdown
        articlePrice={20}
        selectedEstimate={ESTIMATE}
        serviceFee={0}
        totalAmount={28.5}
      />,
    );

    expect(screen.getByText('Frais de protection Seconde')).toBeOnTheScreen();
    // formatPrice(0) → "0 $" (entier).
    expect(screen.getByText('0 $')).toBeOnTheScreen();
    expect(screen.getByText('28,50 $ CA')).toBeOnTheScreen();
  });

  it('expose la promesse de protection acheteur (séquestre 7 jours)', () => {
    render(
      <PriceBreakdown
        articlePrice={45}
        selectedEstimate={ESTIMATE}
        serviceFee={4.5}
        totalAmount={58}
      />,
    );

    expect(
      screen.getByText(CHECKOUT_COPY.buyerProtectionTitle),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(CHECKOUT_COPY.buyerProtectionBody),
    ).toBeOnTheScreen();
  });
});
