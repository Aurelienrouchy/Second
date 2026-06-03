/**
 * PayButton — CTA de paiement du checkout livraison.
 *
 * Couvre le comportement MÉTIER du bouton payer (article → checkout → paiement) :
 * - libellé carte par défaut avec montant CA explicite ;
 * - porte-monnaie couvrant tout : libellé "PAYER AVEC LE PORTE-MONNAIE"
 *   (aucun passage par Stripe) ;
 * - porte-monnaie partiel : on paie le RESTE par carte (montant carte affiché) ;
 * - garde-fous de désactivation : champs incomplets (!canPay), soumission en
 *   cours (submitting) et feuille Stripe déjà présentée (disabled) bloquent
 *   tous le onPress et désactivent le bouton ;
 * - état soumission : spinner affiché à la place du libellé.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PayButton } from '@/features/checkout-shipping/components/PayButton';

function renderButton(overrides: Partial<React.ComponentProps<typeof PayButton>> = {}) {
  const props: React.ComponentProps<typeof PayButton> = {
    totalAmount: 58,
    canPay: true,
    submitting: false,
    onPress: jest.fn(),
    bottomInset: 0,
    walletCoversAll: false,
    useWallet: false,
    disabled: false,
    ...overrides,
  };
  render(<PayButton {...props} />);
  return props;
}

describe('<PayButton />', () => {
  it('affiche le montant carte CA par défaut et déclenche onPress', () => {
    const onPress = jest.fn();
    renderButton({ totalAmount: 58, onPress });

    expect(screen.getByText('PAYER 58,00 $ CA')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('checkout-pay-button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('bascule en paiement porte-monnaie quand le solde couvre tout', () => {
    renderButton({ walletCoversAll: true, useWallet: true, totalAmount: 0 });

    // Couverture totale → pas de montant carte, libellé porte-monnaie.
    expect(screen.getByText('PAYER AVEC LE PORTE-MONNAIE')).toBeOnTheScreen();
    expect(screen.queryByText(/PAR CARTE/)).not.toBeOnTheScreen();
  });

  it('affiche le reste à payer par carte en porte-monnaie partiel', () => {
    // Le reste à régler par carte est passé via totalAmount par l'écran.
    renderButton({ useWallet: true, walletCoversAll: false, totalAmount: 12.5 });

    expect(screen.getByText('PAYER 12,50 $ CA PAR CARTE')).toBeOnTheScreen();
  });

  it('désactive et bloque onPress quand les champs sont incomplets', () => {
    const onPress = jest.fn();
    renderButton({ canPay: false, onPress });

    fireEvent.press(screen.getByTestId('checkout-pay-button'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('checkout-pay-button')).toBeDisabled();
  });

  it('bloque le double-paiement pendant la soumission', () => {
    const onPress = jest.fn();
    renderButton({ submitting: true, onPress });

    // Pendant submitting le libellé disparaît au profit du spinner.
    expect(screen.queryByText(/PAYER/)).not.toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('checkout-pay-button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('bloque onPress quand la feuille Stripe est déjà présentée (disabled)', () => {
    const onPress = jest.fn();
    renderButton({ canPay: true, disabled: true, onPress });

    fireEvent.press(screen.getByTestId('checkout-pay-button'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('checkout-pay-button')).toBeDisabled();
  });
});
