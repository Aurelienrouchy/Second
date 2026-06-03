/**
 * <RejectionModal /> — bottom sheet de rejet / suspension d'une boutique.
 *
 * Comportement MÉTIER du formulaire de motif (admin) :
 *  - Le modal est monté à l'ouverture seulement (mount-on-open) : tant que
 *    show() n'est pas appelé, rien n'est rendu (perf + voile Android).
 *  - Confirmer est BLOQUÉ tant que le motif est vide ou ne contient que des
 *    espaces (on n'envoie jamais un rejet sans raison à la callable).
 *  - Choisir un motif prédéfini remplit le champ et débloque la confirmation.
 *  - À la confirmation, onConfirm reçoit le motif TRIMMÉ (pas d'espaces
 *    parasites stockés dans verificationDetails).
 *  - Le nom de la boutique est affiché pour éviter une erreur de cible.
 *
 * On remplace @gorhom/bottom-sheet par un rendu inline des enfants : on teste
 * la logique du formulaire, pas l'animation native de la feuille.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  const passthrough = (props: Record<string, unknown>) =>
    React.createElement(View, props, props.children as React.ReactNode);
  return {
    __esModule: true,
    default: React.forwardRef((props: Record<string, unknown>, _ref: unknown) =>
      React.createElement(View, props, props.children as React.ReactNode),
    ),
    BottomSheetView: passthrough,
    BottomSheetBackdrop: passthrough,
  };
});

import RejectionModal, { type RejectionModalRef } from './RejectionModal';

const PREDEFINED = 'Photos insuffisantes ou de mauvaise qualité';

function renderModal(shopName = 'Friperie du Plateau') {
  const onConfirm = jest.fn(() => Promise.resolve());
  const ref = React.createRef<RejectionModalRef>();
  const utils = render(
    <RejectionModal ref={ref} shopName={shopName} onConfirm={onConfirm} />,
  );
  return { onConfirm, ref, ...utils };
}

describe('<RejectionModal /> — mount-on-open', () => {
  it('ne rend rien tant que show() n\'a pas été appelé', () => {
    renderModal();
    expect(screen.queryByText('Rejeter la boutique')).toBeNull();
  });

  it('rend le formulaire et le nom de la boutique après show()', () => {
    const { ref } = renderModal('Vintage Mile-End');

    act(() => ref.current?.show());

    expect(screen.getByText('Rejeter la boutique')).toBeOnTheScreen();
    expect(screen.getByText('Vintage Mile-End')).toBeOnTheScreen();
  });
});

describe('<RejectionModal /> — validation du motif', () => {
  it('ignore la confirmation quand aucun motif n\'est saisi', () => {
    const { ref, onConfirm } = renderModal();
    act(() => ref.current?.show());

    fireEvent.press(screen.getByText('Rejeter', { exact: true }));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ignore la confirmation pour un motif fait uniquement d\'espaces', () => {
    const { ref, onConfirm } = renderModal();
    act(() => ref.current?.show());

    fireEvent.changeText(
      screen.getByPlaceholderText('Expliquez la raison du rejet...'),
      '   ',
    );
    fireEvent.press(screen.getByText('Rejeter', { exact: true }));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('sélectionner un motif prédéfini remplit le champ et permet de confirmer', async () => {
    const { ref, onConfirm } = renderModal();
    act(() => ref.current?.show());

    fireEvent.press(screen.getByText(PREDEFINED));
    fireEvent.press(screen.getByText('Rejeter', { exact: true }));

    await screen.findByText('Rejeter', { exact: true });
    expect(onConfirm).toHaveBeenCalledWith(PREDEFINED);
  });

  it('transmet à onConfirm le motif TRIMMÉ (pas d\'espaces parasites)', async () => {
    const { ref, onConfirm } = renderModal();
    act(() => ref.current?.show());

    fireEvent.changeText(
      screen.getByPlaceholderText('Expliquez la raison du rejet...'),
      '  Adresse non valide  ',
    );
    fireEvent.press(screen.getByText('Rejeter', { exact: true }));

    await screen.findByText('Rejeter', { exact: true });
    expect(onConfirm).toHaveBeenCalledWith('Adresse non valide');
  });
});
