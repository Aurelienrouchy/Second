/**
 * SwapActions — machine à états du cycle de vie d'un échange.
 *
 * SwapActions rend l'UI d'action en fonction de (status, rôle de l'utilisateur,
 * progression). On vérifie le comportement MÉTIER de chaque transition :
 *  - proposed : le receveur voit Accepter/Refuser ; l'initiateur voit Annuler.
 *  - payment_pending : le payeur du complément voit "Régler le complément" ;
 *    l'autre voit l'attente du paiement.
 *  - accepted (sans mode) : sélection du mode d'échange.
 *  - photos_pending : upload puis attente.
 *  - shipping : confirmer l'envoi puis la réception ; litige disponible.
 *  - completed : notation + litige (fenêtre de protection).
 *
 * Les callbacks sont fournis par l'écran ; on s'assure qu'ils sont câblés au
 * bon bouton et neutralisés pendant le traitement (isProcessing).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

// Le barrel @/components/ui ré-exporte des composants natifs lourds
// (ThemedBottomSheet → @expo/ui → expo-asset, OfflineBanner → expo-network…)
// non transformés par le preset. SwapActions n'en consomme que Text/Caption :
// on réduit le barrel à ces primitives (texte RN).
jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');
  const Text = (props: Record<string, unknown>) => React.createElement(RNText, props);
  const Caption = (props: Record<string, unknown>) => React.createElement(RNText, props);
  return { Text, Caption };
});

// Le mock global d'expo-router expose useLocalSearchParams comme simple fonction
// (pas un jest.fn). Le bouton litige de SwapActions en a besoin pour résoudre le
// swapId → on le re-mocke en jest.fn paramétrable.
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({ id: 'swap-1' })),
}));

// La callable de litige est appelée par le bouton "Ouvrir un litige" ; on la
// neutralise (le rendu/affichage du bouton suffit pour ce test métier).
jest.mock('@/services/swapService', () => ({
  openSwapDispute: jest.fn(() => Promise.resolve()),
}));

import { SwapActions } from '@/features/swap/components/SwapActions';
import type { SwapActionHandlers, SwapParticipantContext } from '@/features/swap/types';
import type { SwapStatus } from '@/types';

// useLocalSearchParams est mocké global ({}). Le bouton litige résout swapId
// depuis la route ; on le surcharge ici pour les scénarios shipping/completed.
import { useLocalSearchParams } from 'expo-router';

function makeHandlers(): SwapActionHandlers {
  return {
    onAccept: jest.fn(),
    onDecline: jest.fn(),
    onCancel: jest.fn(),
    onPayTopUp: jest.fn(),
    onSetExchangeMode: jest.fn(),
    onUploadPhotos: jest.fn(),
    onConfirmShipping: jest.fn(),
    onConfirmReception: jest.fn(),
    onRate: jest.fn(),
  };
}

function makeParticipant(over: Partial<SwapParticipantContext> = {}): SwapParticipantContext {
  return {
    isInitiator: false,
    isReceiver: false,
    senderName: 'Alice',
    senderImage: undefined,
    senderItems: [],
    myItems: [],
    hasUploadedPhotos: false,
    hasConfirmedShipping: false,
    hasConfirmedReception: false,
    hasRated: false,
    isTopUpPayer: false,
    topUpPayerName: 'Alice',
    ...over,
  };
}

function renderActions(opts: {
  status: SwapStatus;
  participant?: Partial<SwapParticipantContext>;
  handlers?: SwapActionHandlers;
  isProcessing?: boolean;
  exchangeMode?: string;
}) {
  const handlers = opts.handlers ?? makeHandlers();
  render(
    <SwapActions
      status={opts.status}
      participant={makeParticipant(opts.participant)}
      handlers={handlers}
      isProcessing={opts.isProcessing ?? false}
      exchangeMode={opts.exchangeMode}
    />
  );
  return handlers;
}

describe('SwapActions — statut proposed', () => {
  it('le receveur peut accepter ou refuser', () => {
    const handlers = renderActions({ status: 'proposed', participant: { isReceiver: true } });

    fireEvent.press(screen.getByText('Accepter'));
    expect(handlers.onAccept).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText('Refuser'));
    expect(handlers.onDecline).toHaveBeenCalledTimes(1);
    // L'initiateur ne doit pas voir le bouton Annuler ici.
    expect(screen.queryByText('Annuler la proposition')).toBeNull();
  });

  it('l’initiateur ne voit que l’annulation, pas accepter/refuser', () => {
    const handlers = renderActions({ status: 'proposed', participant: { isInitiator: true } });

    expect(screen.queryByText('Accepter')).toBeNull();
    fireEvent.press(screen.getByText('Annuler la proposition'));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it('neutralise accepter pendant le traitement (isProcessing)', () => {
    const handlers = renderActions({
      status: 'proposed',
      participant: { isReceiver: true },
      isProcessing: true,
    });

    // En cours : le label disparaît au profit du spinner, donc onAccept reste à 0.
    expect(screen.queryByText('Accepter')).toBeNull();
    expect(handlers.onAccept).not.toHaveBeenCalled();
  });
});

describe('SwapActions — statut payment_pending (complément)', () => {
  it('le payeur du complément peut régler', () => {
    const handlers = renderActions({
      status: 'payment_pending',
      participant: { isTopUpPayer: true },
    });

    fireEvent.press(screen.getByText('Régler le complément'));
    expect(handlers.onPayTopUp).toHaveBeenCalledTimes(1);
  });

  it('le non-payeur voit l’attente du paiement et n’a aucun bouton de règlement', () => {
    renderActions({
      status: 'payment_pending',
      participant: { isTopUpPayer: false, topUpPayerName: 'Alice' },
    });

    expect(screen.getByText('En attente du paiement de Alice')).toBeOnTheScreen();
    expect(screen.queryByText('Régler le complément')).toBeNull();
  });
});

describe('SwapActions — statut accepted', () => {
  it('propose le choix du mode d’échange tant qu’aucun mode n’est défini', () => {
    const handlers = renderActions({ status: 'accepted', exchangeMode: undefined });

    fireEvent.press(screen.getByText('En main propre'));
    expect(handlers.onSetExchangeMode).toHaveBeenCalledWith('hand_delivery');

    fireEvent.press(screen.getByText('Envoi postal'));
    expect(handlers.onSetExchangeMode).toHaveBeenCalledWith('shipping');
  });

  it('masque le sélecteur de mode une fois le mode choisi', () => {
    renderActions({ status: 'accepted', exchangeMode: 'shipping' });

    expect(screen.queryByText('En main propre')).toBeNull();
  });

  it('expose l’ouverture de litige dès accepted (F51 — payeur coincé)', () => {
    renderActions({ status: 'accepted', exchangeMode: 'shipping' });

    expect(screen.getByText('Ouvrir un litige')).toBeOnTheScreen();
  });
});

describe('SwapActions — statut photos_pending', () => {
  it('propose l’upload tant que les photos ne sont pas envoyées', () => {
    const handlers = renderActions({
      status: 'photos_pending',
      participant: { hasUploadedPhotos: false },
    });

    fireEvent.press(screen.getByText('Ajouter des photos'));
    expect(handlers.onUploadPhotos).toHaveBeenCalledTimes(1);
  });

  it('affiche l’attente de l’autre participant une fois ses photos envoyées', () => {
    renderActions({ status: 'photos_pending', participant: { hasUploadedPhotos: true } });

    expect(screen.getByText("En attente des photos de l'autre participant")).toBeOnTheScreen();
    expect(screen.queryByText('Ajouter des photos')).toBeNull();
  });

  it('expose l’ouverture de litige dès photos_pending (F51)', () => {
    renderActions({ status: 'photos_pending', participant: { hasUploadedPhotos: true } });

    expect(screen.getByText('Ouvrir un litige')).toBeOnTheScreen();
  });
});

describe('SwapActions — statut shipping', () => {
  beforeEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'swap-1' });
  });

  it('demande d’abord la confirmation d’envoi', () => {
    const handlers = renderActions({
      status: 'shipping',
      participant: { hasConfirmedShipping: false },
    });

    fireEvent.press(screen.getByText("J'ai envoyé mon article"));
    expect(handlers.onConfirmShipping).toHaveBeenCalledTimes(1);
    // Pas encore la réception.
    expect(screen.queryByText("J'ai reçu l'article")).toBeNull();
  });

  it('demande la réception une fois l’envoi confirmé', () => {
    const handlers = renderActions({
      status: 'shipping',
      participant: { hasConfirmedShipping: true, hasConfirmedReception: false },
    });

    fireEvent.press(screen.getByText("J'ai reçu l'article"));
    expect(handlers.onConfirmReception).toHaveBeenCalledTimes(1);
  });

  it('expose toujours l’ouverture de litige pendant l’envoi', () => {
    renderActions({ status: 'shipping', participant: { hasConfirmedShipping: false } });

    expect(screen.getByText('Ouvrir un litige')).toBeOnTheScreen();
  });
});

describe('SwapActions — statut completed', () => {
  beforeEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'swap-1' });
  });

  it('propose la notation tant que l’échange n’a pas été noté', () => {
    const handlers = renderActions({ status: 'completed', participant: { hasRated: false } });

    // 5 étoiles cliquables → on note 5.
    const fives = screen.getByText('5');
    fireEvent.press(fives);
    expect(handlers.onRate).toHaveBeenCalledWith(5);
  });

  it('laisse la fenêtre de litige ouverte après complétion', () => {
    renderActions({ status: 'completed', participant: { hasRated: true } });

    expect(screen.getByText('Ouvrir un litige')).toBeOnTheScreen();
    // Déjà noté → la section de notation disparaît.
    expect(screen.queryByText("Comment s'est passé l'échange ?")).toBeNull();
  });
});
