/**
 * TransactionService — création / mise à jour de transactions d'achat.
 *
 * Domaine achat-paiement : ce service est le SEUL point d'entrée client pour
 * créer une transaction (livraison ou meetup) et pour en changer le statut.
 * Toute la logique financière sensible vit côté Cloud Function ; le service
 * client se contente d'appeler les callables avec le bon contrat et de garder
 * deux invariants métier critiques :
 *
 *   1. Une transaction de LIVRAISON exige un rateId ShipEngine non vide — sinon
 *      le backend ne peut pas acheter d'étiquette réelle → on échoue tôt, AVANT
 *      tout appel réseau, avec un message actionnable pour l'acheteur.
 *   2. L'annulation ('cancelled') passe par une Cloud Function dédiée
 *      (cancelPendingTransaction) qui re-vérifie l'identité — JAMAIS un
 *      updateDoc client. Les autres statuts non sensibles passent par updateDoc.
 *
 * Placé dans tests/jest/ pour rester côté Jest (le harness Vitest exclut
 * tests/jest/**), sans collision entre les deux runners.
 */

import { httpsCallable } from 'firebase/functions';
import { updateDoc } from 'firebase/firestore';

import { TransactionService } from '@/services/transactionService';
import type { MeetupSpot, ShippingAddress } from '@/types';

// Les modules firebase sont déjà mockés globalement (jest.setup.js) ; on les
// récupère en tant que mocks pour piloter les retours et inspecter les appels.
const mockHttpsCallable = httpsCallable as jest.Mock;
const mockUpdateDoc = updateDoc as jest.Mock;

const SHIPPING_ADDRESS: ShippingAddress = {
  name: 'Jean Dupont',
  street: '123 rue Exemple',
  city: 'Montréal',
  province: 'QC',
  postalCode: 'H2J 2K1',
  country: 'CA',
};

const MEETUP_SPOT: MeetupSpot = {
  name: 'Café du coin',
  category: 'cafe',
  neighborhood: { id: 'nb1', name: 'Plateau', borough: 'Le Plateau-Mont-Royal' },
};

describe('TransactionService.createShippingTransaction', () => {
  it('refuse de créer une livraison sans tarif ShipEngine (avant tout appel réseau)', async () => {
    await expect(
      TransactionService.createShippingTransaction(
        'art1', 'buyer1', 'seller1', 45, 8.5, SHIPPING_ADDRESS,
        '', // rateId manquant
        'chat1', 4.5,
      ),
    ).rejects.toThrow(/tarif de livraison est manquant/i);

    // Garde-fou tôt : aucune callable n'est appelée si le rate manque.
    expect(mockHttpsCallable).not.toHaveBeenCalled();
  });

  it('appelle createTransaction avec le contrat livraison complet et renvoie l\'id', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: { success: true, transactionId: 'tx_123' },
    });
    mockHttpsCallable.mockReturnValue(callable);

    const id = await TransactionService.createShippingTransaction(
      'art1', 'buyer1', 'seller1', 45, 8.5, SHIPPING_ADDRESS,
      'se_rate_abc', 'chat1', 4.5,
    );

    expect(id).toBe('tx_123');
    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'createTransaction');
    expect(callable).toHaveBeenCalledWith(
      expect.objectContaining({
        articleId: 'art1',
        deliveryType: 'shipping',
        amount: 45,
        shippingCost: 8.5,
        serviceFee: 4.5,
        shippingAddress: SHIPPING_ADDRESS,
        chatId: 'chat1',
        shipEngineRateId: 'se_rate_abc',
      }),
    );
  });

  it('normalise serviceFee absent à 0 et chatId absent à null', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: { success: true, transactionId: 'tx_456' },
    });
    mockHttpsCallable.mockReturnValue(callable);

    await TransactionService.createShippingTransaction(
      'art1', 'buyer1', 'seller1', 30, 8.5, SHIPPING_ADDRESS,
      'se_rate_abc', // pas de chatId ni serviceFee
    );

    const payload = callable.mock.calls[0][0];
    expect(payload.serviceFee).toBe(0);
    expect(payload.chatId).toBeNull();
  });

  it('lève une erreur quand le backend renvoie success=false', async () => {
    mockHttpsCallable.mockReturnValue(
      jest.fn().mockResolvedValue({ data: { success: false } }),
    );

    await expect(
      TransactionService.createShippingTransaction(
        'art1', 'buyer1', 'seller1', 45, 8.5, SHIPPING_ADDRESS, 'se_rate_abc',
      ),
    ).rejects.toThrow(/création de la transaction/i);
  });

  it('propage l\'erreur métier de la Cloud Function (article déjà vendu)', async () => {
    mockHttpsCallable.mockReturnValue(
      jest.fn().mockRejectedValue(new Error('Cet article a deja ete vendu')),
    );

    await expect(
      TransactionService.createShippingTransaction(
        'art1', 'buyer1', 'seller1', 45, 8.5, SHIPPING_ADDRESS, 'se_rate_abc',
      ),
    ).rejects.toThrow('Cet article a deja ete vendu');
  });
});

describe('TransactionService.createMeetupTransaction', () => {
  it('appelle createTransaction en mode meetup avec le spot choisi', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: { success: true, transactionId: 'tx_meet' },
    });
    mockHttpsCallable.mockReturnValue(callable);

    const id = await TransactionService.createMeetupTransaction(
      'art1', 'buyer1', 'seller1', 40, MEETUP_SPOT, 'chat1',
    );

    expect(id).toBe('tx_meet');
    expect(callable).toHaveBeenCalledWith(
      expect.objectContaining({
        articleId: 'art1',
        deliveryType: 'meetup',
        amount: 40,
        meetupSpot: MEETUP_SPOT,
        chatId: 'chat1',
      }),
    );
  });

  it('accepte un meetup "à convenir" (spot null) et normalise chatId absent', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: { success: true, transactionId: 'tx_meet2' },
    });
    mockHttpsCallable.mockReturnValue(callable);

    await TransactionService.createMeetupTransaction(
      'art1', 'buyer1', 'seller1', 40, null,
    );

    const payload = callable.mock.calls[0][0];
    expect(payload.meetupSpot).toBeNull();
    expect(payload.chatId).toBeNull();
  });

  it('lève une erreur dédiée meetup quand le backend échoue', async () => {
    mockHttpsCallable.mockReturnValue(
      jest.fn().mockResolvedValue({ data: { success: false } }),
    );

    await expect(
      TransactionService.createMeetupTransaction(
        'art1', 'buyer1', 'seller1', 40, MEETUP_SPOT,
      ),
    ).rejects.toThrow(/transaction meetup/i);
  });
});

describe('TransactionService.updateTransactionStatus', () => {
  it('délègue l\'annulation à la Cloud Function (jamais d\'updateDoc client)', async () => {
    const callable = jest.fn().mockResolvedValue({ data: { success: true } });
    mockHttpsCallable.mockReturnValue(callable);

    await TransactionService.updateTransactionStatus('tx_123', 'cancelled');

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'cancelPendingTransaction',
    );
    expect(callable).toHaveBeenCalledWith({ transactionId: 'tx_123' });
    // Invariant sécurité : pas d'écriture Firestore directe pour 'cancelled'.
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('met à jour un statut non sensible via updateDoc et horodate meetup_confirmed', async () => {
    mockUpdateDoc.mockResolvedValue(undefined);

    await TransactionService.updateTransactionStatus('tx_123', 'meetup_confirmed');

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const updatePayload = mockUpdateDoc.mock.calls[0][1];
    expect(updatePayload.status).toBe('meetup_confirmed');
    // Un horodatage serveur est ajouté pour ce statut.
    expect(updatePayload.meetupConfirmedAt).toBeDefined();
    // L'annulation n'est jamais empruntée ici.
    expect(mockHttpsCallable).not.toHaveBeenCalledWith(
      expect.anything(),
      'cancelPendingTransaction',
    );
  });

  it('fusionne additionalData dans la mise à jour de statut', async () => {
    mockUpdateDoc.mockResolvedValue(undefined);

    await TransactionService.updateTransactionStatus('tx_123', 'meetup_completed', {
      meetupSpot: MEETUP_SPOT,
    } as any);

    const updatePayload = mockUpdateDoc.mock.calls[0][1];
    expect(updatePayload.status).toBe('meetup_completed');
    expect(updatePayload.meetupCompletedAt).toBeDefined();
    expect(updatePayload.meetupSpot).toEqual(MEETUP_SPOT);
  });
});

describe('TransactionService — stubs serveur-only (sécurité)', () => {
  it('updatePaymentInfo refuse d\'écrire côté client', async () => {
    await expect(
      TransactionService.updatePaymentInfo('tx_123', 'pi_abc'),
    ).rejects.toThrow(/server-side only/i);
  });

  it('updateShippingInfo refuse d\'écrire côté client', async () => {
    await expect(
      TransactionService.updateShippingInfo('tx_123', 'b', 'url', 'trk'),
    ).rejects.toThrow(/server-side only/i);
  });
});
