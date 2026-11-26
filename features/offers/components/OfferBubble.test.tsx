jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => 1, useAuthStore: create(() => ({user: null, authenticatedUid: null}))};
});
/**
 * Test de CARACTÉRISATION de <OfferBubble />.
 *
 * Ce composant fait plus de mille lignes et n'avait, jusqu'ici, aucune assertion
 * de rendu. Ces tests décrivent ce qu'il affiche AUJOURD'HUI, état par état, et
 * servent de filet au dégraissage : après extraction des handlers, ils doivent
 * passer sans être modifiés. Un test de caractérisation ne juge pas le
 * comportement, il le fige.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import type {Transaction} from '@/types/transaction';

let mockLinkedOrder: Transaction | null = null;
const mockPush = jest.fn(), mockBeginPayment = jest.fn();

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Ionicons: ({ name, ...props }: { name: string }) =>
      React.createElement(View, { ...props, testID: `icon-${name}` }),
  };
});
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: View };
});
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({useLabelLifecycleContext: () => ({capture: () => ({}), isCurrent: () => true})}));
// Le vrai `useOfferTransaction` appelle deux `useState` et un `useEffect`. Un
// bouchon qui n'appelle AUCUN hook change la nature du composant pour React :
// une bulle qui rendrait zéro hook puis N passerait par le chemin de MONTAGE
// plutôt que par celui de mise à jour, et le contrôle du nombre de hooks ne
// s'appliquerait jamais. Le bouchon doit donc consommer les mêmes emplacements
// que l'original, sinon il rend indétectable toute violation des règles des
// hooks placée après lui.
jest.mock('@/features/offers/components/offer-bubble/useOfferTransaction', () => {
  const { useEffect, useState } = require('react');
  return {
    useOfferTransaction: () => {
      const [transactionId] = useState(null as string | null);
      const [isLoading] = useState(false);
      useEffect(() => {}, []);
      return { transactionId, isLoading, transaction: mockLinkedOrder, beginPayment: mockBeginPayment };
    },
  };
});

import OfferBubble, {type OfferBubbleProps} from './OfferBubble';
import {OfferProgressMessage} from './OfferProgressMessage';
import type { Message } from '@/types';

const SELLER = 'alice';
const BUYER = 'bob';
beforeEach(() => {mockLinkedOrder = null; mockBeginPayment.mockReturnValue({});});

const meetup = {
  location: {
    name: 'Café Olympico',
    category: 'cafe',
    neighborhood: { id: 'mile-end', name: 'Mile End', borough: 'Le Plateau' },
  },
  proposedBy: 'buyer',
};

function offerMessage(over: Record<string, unknown> = {}): Message {
  return {
    id: 'm1',
    chatId: 'c1',
    senderId: BUYER,
    receiverId: SELLER,
    type: 'offer',
    content: 'Offre de 40 $',
    timestamp: new Date('2026-06-12T14:30:00'),
    status: 'sent',
    isRead: false,
    offer: { amount: 40, status: 'pending', meetup, ...over },
  } as unknown as Message;
}

/** La bulle du point de vue demandé, avec tous les handlers branchés. */
function bubble(message: Message, viewerId: string, over: Record<string, unknown> = {}, Component: React.ComponentType<OfferBubbleProps> = OfferBubble) {
  return (
    <Component
      message={message}
      isOwnMessage={message.senderId === viewerId}
      chatId="c1"
      currentUserId={viewerId}
      sellerId={SELLER}
      articleId="a1"
      articlePrice={60}
      onAcceptOffer={jest.fn()}
      onRejectOffer={jest.fn()}
      onCounterPrice={jest.fn()}
      onCounterLocation={jest.fn()}
      onCounterTime={jest.fn()}
      onConfirmMeetup={jest.fn()}
      onReportNoShow={jest.fn()}
      onCompleteMeetup={jest.fn()}
      onCancelMeetup={jest.fn()}
      {...over}
    />
  );
}

/** Rend la bulle du point de vue demandé. */
function renderBubble(message: Message, viewerId: string, over: Record<string, unknown> = {}) {
  return render(bubble(message, viewerId, over, ['accepted', 'completed'].includes(message.offer?.status ?? '') ? OfferProgressMessage : OfferBubble));
}

it('keeps a proposal free of status and preparation buttons after acceptance', () => {
  render(bubble(offerMessage({status: 'accepted', meetup: undefined, deliveryType: 'shipping'}), SELLER));
  expect(screen.getByText('40 $')).toBeTruthy();
  expect(screen.queryByText('Acceptée')).toBeNull();
  expect(screen.queryByText('En attente du paiement')).toBeNull();
  expect(screen.queryByText('Préparer mon colis')).toBeNull();
});

it('takes the seller from an accepted postal offer to its own shipping preparation', () => {
  renderBubble(offerMessage({status: 'accepted', meetup: undefined, deliveryType: 'shipping'}), SELLER);
  expect(screen.getByText('En attente du paiement')).toBeTruthy();
  fireEvent.press(screen.getByText('Préparer mon colis'));
  expect(mockPush).toHaveBeenCalledWith({pathname: '/article/shipping/[id]', params: {id: 'a1', returnChatId: 'c1'}});
});

it('opens the exact paid postal order for shipment tracking instead of proposing payment', () => {
  mockLinkedOrder = {id: 'paid-order', buyerId: BUYER, sellerId: SELLER, deliveryType: 'shipping', status: 'label_created', shipEngineLabelId: 'label'} as Transaction;
  renderBubble(offerMessage({status: 'accepted', meetup: undefined, deliveryType: 'shipping', transactionId: 'paid-order'}), SELLER);
  expect(screen.getByText('Préparation de l’envoi')).toBeTruthy();
  expect(screen.queryByText('Étiquette prête')).toBeNull();
  expect(screen.queryByText('Payer maintenant')).toBeNull();
  fireEvent.press(screen.getByText('Préparer l’envoi'));
  expect(mockPush).toHaveBeenCalledWith({pathname: '/orders/[id]', params: {id: 'paid-order'}});
});

describe('<OfferBubble /> — en-tête et corps', () => {
  it('offre reçue : en-tête, badge meetup, montant, prix affiché, lieu', () => {
    renderBubble(offerMessage(), SELLER);

    expect(screen.getByText('OFFRE RECUE')).toBeTruthy();
    expect(screen.getByText('Meetup')).toBeTruthy();
    expect(screen.getByText('40 $')).toBeTruthy();
    expect(screen.getByText('sur un prix affiche de 60 $')).toBeTruthy();
    expect(screen.getByText('Café Olympico')).toBeTruthy();
    expect(screen.getByText(/Mile End/)).toBeTruthy();
  });

  it('offre émise : l’en-tête change de camp', () => {
    renderBubble(offerMessage(), BUYER);
    expect(screen.getByText('VOTRE OFFRE')).toBeTruthy();
    expect(screen.queryByText('OFFRE RECUE')).toBeNull();
  });

  it('affiche l’horaire convenu quand il existe', () => {
    renderBubble(
      offerMessage({ meetup: { ...meetup, dateTime: new Date('2026-06-20T18:30:00') } }),
      SELLER,
    );
    expect(screen.getByText(/^le /)).toBeTruthy();
  });

  it('affiche le message de l’auteur entre guillemets', () => {
    renderBubble(offerMessage({ message: 'Je peux passer ce soir' }), SELLER);
    expect(screen.getByText(/Je peux passer ce soir/)).toBeTruthy();
  });

  it('le statut est réservé aux messages de progression distincts', () => {
    renderBubble(offerMessage(), SELLER);
    expect(screen.queryByText('En attente')).toBeNull();
  });
});

describe('<OfferBubble /> — boutons selon l’état', () => {
  it('offre en attente reçue : accepter, refuser, contre-offre', () => {
    renderBubble(offerMessage(), SELLER);
    expect(screen.getByText('Accepter')).toBeTruthy();
    expect(screen.getByText('Refuser')).toBeTruthy();
    expect(screen.getByText('Contre-offre')).toBeTruthy();
  });

  it('offre en attente émise : aucun bouton de réponse', () => {
    renderBubble(offerMessage(), BUYER);
    expect(screen.queryByText('Accepter')).toBeNull();
    expect(screen.queryByText('Refuser')).toBeNull();
    expect(screen.queryByText('Contre-offre')).toBeNull();
  });

  it('rencontre acceptée, non confirmée : le VENDEUR confirme le rendez-vous', () => {
    renderBubble(offerMessage({ status: 'accepted' }), SELLER);
    expect(screen.getByText('Confirmer le rendez-vous')).toBeTruthy();
    expect(screen.queryByText('Signaler une absence')).toBeNull();
    expect(screen.queryByText('Annuler la rencontre')).toBeNull();
    fireEvent.press(screen.getByText('Options de la rencontre'));
    expect(screen.getByText('Signaler une absence')).toBeTruthy();
    expect(screen.getByText('Annuler la rencontre')).toBeTruthy();
  });

  it('rencontre acceptée, non confirmée : l’ACHETEUR a son recours mais pas la confirmation', () => {
    renderBubble(offerMessage({ status: 'accepted' }), BUYER);
    expect(screen.queryByText('Confirmer le rendez-vous')).toBeNull();
    expect(screen.queryByText('Signaler une absence')).toBeNull();
    fireEvent.press(screen.getByText('Options de la rencontre'));
    expect(screen.getByText('Signaler une absence')).toBeTruthy();
    expect(screen.getByText('Annuler la rencontre')).toBeTruthy();
  });

  it('rencontre confirmée : les deux parties peuvent clôturer', () => {
    const m = offerMessage({
      status: 'accepted',
      meetup: { ...meetup, confirmedAt: new Date('2026-06-13T10:00:00') },
    });
    renderBubble(m, BUYER);
    expect(screen.getByText('Rencontre effectuée')).toBeTruthy();
    renderBubble(m, SELLER);
    expect(screen.getAllByText('Rencontre effectuée').length).toBeGreaterThan(0);
  });

  it('absence signalée : le cycle s’éteint, la partie visée peut répondre', () => {
    renderBubble(
      offerMessage({
        status: 'accepted',
        meetup: { ...meetup, noShow: { reportedBy: SELLER } },
      }),
      BUYER,
    );
    expect(screen.queryByText('Confirmer le rendez-vous')).toBeNull();
    expect(screen.queryByText('Annuler la rencontre')).toBeNull();
    expect(screen.getByText('Donner ma version')).toBeTruthy();
  });

  it('le signaleur ne voit pas « Donner ma version »', () => {
    renderBubble(
      offerMessage({
        status: 'accepted',
        meetup: { ...meetup, noShow: { reportedBy: SELLER } },
      }),
      SELLER,
    );
    expect(screen.queryByText('Donner ma version')).toBeNull();
  });

  it('rencontre finalisée : badge « Transaction terminée » et plus aucun bouton', () => {
    renderBubble(
      offerMessage({
        status: 'accepted',
        meetup: { ...meetup, confirmedAt: new Date(), completedAt: new Date() },
      }),
      SELLER,
    );
    expect(screen.getByText('Transaction terminée')).toBeTruthy();
    expect(screen.queryByText('Rencontre effectuée')).toBeNull();
    expect(screen.queryByText('Annuler la rencontre')).toBeNull();
  });

  it('offre refusée : aucun bouton de réponse', () => {
    renderBubble(offerMessage({ status: 'rejected' }), SELLER);
    expect(screen.queryByText('Refusée')).toBeNull();
    expect(screen.queryByText('Accepter')).toBeNull();
  });

  it('handlers absents (interlocuteur bloqué) : les boutons disparaissent', () => {
    renderBubble(offerMessage(), SELLER, {
      onAcceptOffer: undefined,
      onCounterPrice: undefined,
      onCounterLocation: undefined,
      onCounterTime: undefined,
    });
    expect(screen.queryByText('Accepter')).toBeNull();
    expect(screen.queryByText('Contre-offre')).toBeNull();
    // Le refus, lui, reste ouvert : c'est une sortie.
    expect(screen.getByText('Refuser')).toBeTruthy();
  });
});

describe('<OfferBubble /> — le champ `offer` va et vient', () => {
  it('une bulle qui PERD son offre se retire sans abattre le fil', () => {
    const sansOffre = offerMessage();
    delete (sansOffre as unknown as Record<string, unknown>).offer;

    const { rerender } = renderBubble(offerMessage(), SELLER);
    expect(screen.getByText('OFFRE RECUE')).toBeTruthy();

    expect(() => rerender(bubble(sansOffre, SELLER))).not.toThrow();
    expect(screen.toJSON()).toBeNull();
  });

  it('une bulle qui GAGNE son offre s’affiche', () => {
    const sansOffre = offerMessage();
    delete (sansOffre as unknown as Record<string, unknown>).offer;

    const { rerender } = renderBubble(sansOffre, SELLER);
    expect(screen.toJSON()).toBeNull();

    expect(() => rerender(bubble(offerMessage(), SELLER))).not.toThrow();
    expect(screen.getByText('OFFRE RECUE')).toBeTruthy();
  });
});
