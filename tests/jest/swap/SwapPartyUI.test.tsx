/**
 * Composants UI Swap Zone / détail d'échange — comportements MÉTIER ciblés.
 *
 *  - MultiSelectBar (swap-party) : barre de sélection multiple. Le compte pilote
 *    le pluriel, le bouton "Proposer" n'apparaît que si la proposition est
 *    autorisée (canPropose), et la barre disparaît à 0 sélection.
 *  - SwapStatusView (swap) : mappe chaque statut vers son libellé FR et n'affiche
 *    le résumé (SwapSummaryBox) que pour les statuts pertinents.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

// Le barrel @/components/ui ré-exporte des composants natifs lourds
// (ThemedBottomSheet → @expo/ui → expo-asset, OfflineBanner → expo-network…)
// non transformés par le preset. MultiSelectBar / SwapSummaryBox n'en
// consomment que Text/Caption : on réduit le barrel à ces primitives.
jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');
  const Text = (props: Record<string, unknown>) => React.createElement(RNText, props);
  const Caption = (props: Record<string, unknown>) => React.createElement(RNText, props);
  return { Text, Caption };
});

// Import direct (et non via le barrel @/features/swap-party) pour ne pas tirer
// AddItemSheet et sa dépendance bottom-sheet dans un test isolé de composant.
import { MultiSelectBar } from '@/features/swap-party/components/MultiSelectBar';
import { SwapStatusView } from '@/features/swap/components/SwapStatusView';
import type { SwapItemInfo, SwapStatus } from '@/types';

describe('<MultiSelectBar /> — sélection multiple (swap-party)', () => {
  it('ne rend rien quand aucune sélection', () => {
    const { toJSON } = render(
      <MultiSelectBar
        selectedCount={0}
        canPropose={false}
        onCancel={jest.fn()}
        onPropose={jest.fn()}
      />
    );

    expect(toJSON()).toBeNull();
  });

  it('accorde le pluriel selon le nombre sélectionné', () => {
    const { rerender } = render(
      <MultiSelectBar
        selectedCount={1}
        canPropose={false}
        onCancel={jest.fn()}
        onPropose={jest.fn()}
      />
    );
    expect(screen.getByText('1 sélectionné')).toBeOnTheScreen();

    rerender(
      <MultiSelectBar
        selectedCount={3}
        canPropose={false}
        onCancel={jest.fn()}
        onPropose={jest.fn()}
      />
    );
    expect(screen.getByText('3 sélectionnés')).toBeOnTheScreen();
  });

  it('masque "Proposer" tant que canPropose est faux', () => {
    render(
      <MultiSelectBar
        selectedCount={2}
        canPropose={false}
        onCancel={jest.fn()}
        onPropose={jest.fn()}
      />
    );

    expect(screen.queryByText('Proposer')).toBeNull();
  });

  it('affiche "Proposer" et déclenche onPropose quand autorisé', () => {
    const onPropose = jest.fn();
    const onCancel = jest.fn();
    render(
      <MultiSelectBar
        selectedCount={2}
        canPropose
        onCancel={onCancel}
        onPropose={onPropose}
      />
    );

    fireEvent.press(screen.getByText('Proposer'));
    expect(onPropose).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText('Annuler'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('<SwapStatusView /> — libellés de statut + résumé', () => {
  const senderItems: SwapItemInfo[] = [{ articleId: 'a', title: 'Robe noire', price: 40 }];
  const myItems: SwapItemInfo[] = [{ articleId: 'b', title: 'Veste', price: 50 }];

  const baseProps = {
    senderName: 'Alice',
    senderImage: undefined,
    senderItems,
    myItems,
    cashTopUpAmount: undefined,
  };

  it.each<[SwapStatus, string]>([
    ['accepted', 'Accepté'],
    ['declined', 'Refusé'],
    ['cancelled', 'Annulé'],
    ['shipping', "En cours d'envoi"],
    ['completed', 'Terminé'],
    ['disputed', 'Litige'],
    ['payment_pending', 'Paiement en attente'],
  ])('mappe le statut %s vers le libellé "%s"', (status: SwapStatus, label: string) => {
    render(<SwapStatusView status={status} {...baseProps} />);
    expect(screen.getByText(label)).toBeOnTheScreen();
  });

  it('affiche les titres des articles de chaque côté', () => {
    // En statut "shipping" le résumé n'inclut pas de doublon de titres autre que
    // la carte article (le récap concatène les mêmes titres) → on tolère >= 1.
    render(<SwapStatusView status="accepted" {...baseProps} />);

    expect(screen.getAllByText('Robe noire').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Veste').length).toBeGreaterThanOrEqual(1);
  });

  it('montre le résumé (SwapSummaryBox) pour un statut en cours (accepted)', () => {
    render(<SwapStatusView status="accepted" {...baseProps} />);
    // Toujours la section items + le récapitulatif propre aux statuts actifs.
    expect(screen.getByText("Éléments de l'échange")).toBeOnTheScreen();
    expect(screen.getByText("Récapitulatif de l'échange")).toBeOnTheScreen();
    expect(screen.getByText('Tu reçois')).toBeOnTheScreen();
    expect(screen.getByText('Tu cèdes')).toBeOnTheScreen();
  });

  it('n’affiche PAS le récapitulatif pour un statut terminal (declined)', () => {
    render(<SwapStatusView status="declined" {...baseProps} />);
    // SwapSummaryBox n'est rendu que pour payment_pending/accepted/photos_pending/
    // shipping/completed → le récapitulatif et ses libellés doivent être absents.
    expect(screen.queryByText("Récapitulatif de l'échange")).toBeNull();
    expect(screen.queryByText('Tu reçois')).toBeNull();
    expect(screen.queryByText('Tu cèdes')).toBeNull();
  });
});
