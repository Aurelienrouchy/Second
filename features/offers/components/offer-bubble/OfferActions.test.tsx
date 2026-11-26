/**
 * Tests métier — <OfferActions /> (components/offer-bubble/OfferActions.tsx).
 *
 * Règles métier des actions sur une offre reçue :
 *  - Accepter / Refuser notifient le parent.
 *  - Pendant un accept/reject en cours, les deux boutons sont désactivés
 *    (un spinner remplace le contenu) pour éviter le double-tap.
 *  - Le bouton « Contre-offre » n'apparaît que si autorisé.
 *  - Contre-offre sur une offre NON-meetup → on ouvre directement la
 *    contre-offre de prix (pas de menu).
 *  - Contre-offre sur une offre meetup → un menu Alert propose prix / lieu /
 *    horaire selon les callbacks fournis.
 */

import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

// @expo/vector-icons tire expo-font (ESM non transpilé sous jest-expo) ; on le
// neutralise localement par un stub View sans toucher au setup partagé.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Ionicons: (props: Record<string, unknown>) => React.createElement(View, props) };
});

import { OfferActions, type OfferActionsProps } from './OfferActions';

const baseProps: OfferActionsProps = {
  isAccepting: false,
  isRejecting: false,
  showCounterOfferButton: true,
  isMeetupOffer: false,
  onAccept: jest.fn(),
  onReject: jest.fn(),
  onOpenCounterPrice: jest.fn(),
};

function renderActions(overrides: Partial<OfferActionsProps> = {}) {
  const props = { ...baseProps, ...overrides };
  return { props, ...render(<OfferActions {...props} />) };
}

describe('<OfferActions />', () => {
  it('notifie onAccept au tap sur Accepter', () => {
    const onAccept = jest.fn();
    renderActions({ onAccept });

    fireEvent.press(screen.getByText('Accepter'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('notifie onReject au tap sur Refuser', () => {
    const onReject = jest.fn();
    renderActions({ onReject });

    fireEvent.press(screen.getByText('Refuser'));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('accept en cours : le libellé Accepter laisse place au spinner et Refuser est bloqué', () => {
    const onAccept = jest.fn();
    const onReject = jest.fn();
    renderActions({ isAccepting: true, onAccept, onReject });

    // Le bouton actif (Accepter) montre un spinner → son libellé disparaît.
    expect(screen.queryByText('Accepter')).toBeNull();
    // Refuser reste rendu mais désactivé : un tap ne doit rien déclencher.
    fireEvent.press(screen.getByText('Refuser'));
    expect(onReject).not.toHaveBeenCalled();
  });

  it('reject en cours : le libellé Refuser laisse place au spinner et Accepter est bloqué', () => {
    const onAccept = jest.fn();
    const onReject = jest.fn();
    renderActions({ isRejecting: true, onAccept, onReject });

    expect(screen.queryByText('Refuser')).toBeNull();
    fireEvent.press(screen.getByText('Accepter'));
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('n’affiche pas le bouton Contre-offre quand non autorisé', () => {
    renderActions({ showCounterOfferButton: false });
    expect(screen.queryByText('Contre-offre')).toBeNull();
  });

  it('offre NON-meetup : Contre-offre ouvre directement le prix (sans menu)', () => {
    const onOpenCounterPrice = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderActions({ isMeetupOffer: false, onOpenCounterPrice });

    fireEvent.press(screen.getByText('Contre-offre'));

    expect(onOpenCounterPrice).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('offre meetup : Contre-offre ouvre un menu prix / lieu / horaire', () => {
    const onOpenCounterPrice = jest.fn();
    const onCounterLocation = jest.fn();
    const onCounterTime = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    renderActions({
      isMeetupOffer: true,
      onOpenCounterPrice,
      onCounterLocation,
      onCounterTime,
    });

    fireEvent.press(screen.getByText('Contre-offre'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress: () => void }>;
    const labels = buttons.map((b) => b.text);
    expect(labels).toEqual([
      'Modifier le prix',
      'Proposer un autre lieu',
      'Proposer un autre horaire',
      'Annuler',
    ]);

    // Chaque entrée du menu route vers le bon callback.
    buttons.find((b) => b.text === 'Modifier le prix')!.onPress();
    buttons.find((b) => b.text === 'Proposer un autre lieu')!.onPress();
    buttons.find((b) => b.text === 'Proposer un autre horaire')!.onPress();

    expect(onOpenCounterPrice).toHaveBeenCalledTimes(1);
    expect(onCounterLocation).toHaveBeenCalledTimes(1);
    expect(onCounterTime).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  it('offre meetup sans callbacks lieu/horaire : menu réduit à prix + annuler', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderActions({ isMeetupOffer: true });

    fireEvent.press(screen.getByText('Contre-offre'));

    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string }>;
    expect(buttons.map((b) => b.text)).toEqual(['Modifier le prix', 'Annuler']);
    alertSpy.mockRestore();
  });
});
