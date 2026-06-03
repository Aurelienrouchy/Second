/**
 * ShippingEstimateList — sélection du tarif de livraison au checkout.
 *
 * Couvre le comportement MÉTIER (article → checkout, frais) :
 * - liste les tarifs (transporteur + service + délai + prix formaté) ;
 * - sélectionner un tarif notifie onSelect avec l'estimation exacte ;
 * - état de calcul (loading) : indicateur "Calcul des frais...", aucune carte ;
 * - aucun tarif + code postal complet : invite à entrer le code postal ;
 * - aucun tarif tant que le code postal est incomplet (<6) : pas d'invite.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ShippingEstimateList } from '@/features/checkout-shipping/components/ShippingEstimateList';
import type { ShippingEstimate } from '@/features/checkout-shipping/types';

const RATES: ShippingEstimate[] = [
  {
    rateId: 'se_standard',
    carrier: 'Postes Canada',
    carrierCode: 'canada_post',
    serviceName: 'Standard',
    amount: 8.5,
    deliveryDays: '3-5 jours ouvrables',
    deliveryType: 'home',
  },
  {
    rateId: 'se_express',
    carrier: 'Postes Canada',
    carrierCode: 'canada_post',
    serviceName: 'Express',
    amount: 14.5,
    deliveryDays: '1-2 jours ouvrables',
    deliveryType: 'home',
  },
];

describe('<ShippingEstimateList />', () => {
  it('liste les tarifs avec transporteur, service, délai et prix', () => {
    render(
      <ShippingEstimateList
        estimates={RATES}
        selectedEstimate={RATES[0]}
        onSelect={jest.fn()}
        loading={false}
        postalCodeLength={6}
      />,
    );

    expect(screen.getByText('Postes Canada Standard')).toBeOnTheScreen();
    expect(screen.getByText('3-5 jours ouvrables')).toBeOnTheScreen();
    expect(screen.getByText('8,50 $')).toBeOnTheScreen();

    expect(screen.getByText('Postes Canada Express')).toBeOnTheScreen();
    expect(screen.getByText('14,50 $')).toBeOnTheScreen();
  });

  it('notifie onSelect avec l\'estimation choisie au tap', () => {
    const onSelect = jest.fn();
    render(
      <ShippingEstimateList
        estimates={RATES}
        selectedEstimate={RATES[0]}
        onSelect={onSelect}
        loading={false}
        postalCodeLength={6}
      />,
    );

    fireEvent.press(screen.getByText('Postes Canada Express'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(RATES[1]);
  });

  it('affiche le calcul des frais et masque les cartes pendant le chargement', () => {
    render(
      <ShippingEstimateList
        estimates={RATES}
        selectedEstimate={null}
        onSelect={jest.fn()}
        loading
        postalCodeLength={6}
      />,
    );

    expect(screen.getByText('Calcul des frais...')).toBeOnTheScreen();
    // Tant qu'on calcule, on ne montre pas de tarifs périmés.
    expect(screen.queryByText('Postes Canada Standard')).not.toBeOnTheScreen();
  });

  it('invite à entrer le code postal quand aucun tarif et code postal complet', () => {
    render(
      <ShippingEstimateList
        estimates={[]}
        selectedEstimate={null}
        onSelect={jest.fn()}
        loading={false}
        postalCodeLength={6}
      />,
    );

    expect(
      screen.getByText(
        'Entrez votre code postal pour voir les options de livraison',
      ),
    ).toBeOnTheScreen();
  });

  it('n\'affiche pas l\'invite tant que le code postal est incomplet', () => {
    render(
      <ShippingEstimateList
        estimates={[]}
        selectedEstimate={null}
        onSelect={jest.fn()}
        loading={false}
        postalCodeLength={3}
      />,
    );

    expect(
      screen.queryByText(
        'Entrez votre code postal pour voir les options de livraison',
      ),
    ).not.toBeOnTheScreen();
  });
});
