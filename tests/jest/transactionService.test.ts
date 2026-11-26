import {auth} from '@/config/firebaseConfig';
import NativeStorage from '@react-native-async-storage/async-storage';
import {createHash} from 'node:crypto';
import {establishIdentityFixture, clearIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {historicalAdminPreview, historicalAdminAttempt, historicalAdminFinancialDecision} from '@/tests/jest/helpers/historicalServiceFinancialFixture';
import {readAdminFinancialAttempts, type AdminFinancialAttempt} from '@/services/adminFinancialDecisionJournal';
import {readDisputeResolutionAttempts, type DisputeResolutionAttempt} from '@/services/disputeResolutionJournal';
beforeEach(async () => {await NativeStorage.clear(); establishIdentityFixture('buyer');});
afterEach(clearIdentityFixture);
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
import { getDocs, limit, where, updateDoc } from 'firebase/firestore';

import { TransactionService, mapTransaction, sortTransactions } from '@/services/transactionService';
import type { MeetupSpot, ShippingAddress } from '@/types';

// Les modules firebase sont déjà mockés globalement (jest.setup.js) ; on les
// récupère en tant que mocks pour piloter les retours et inspecter les appels.
const mockHttpsCallable = httpsCallable as jest.Mock;
const mockUpdateDoc = updateDoc as jest.Mock;

describe('TransactionService — production readiness regressions', () => {
  const snapshot = (items: Array<{ id: string; data: Record<string, unknown> }>) => ({
    docs: items.map(item => ({ id: item.id, data: () => item.data })),
  });
  it('keeps return/refund history and uses participant-bounded reads', async () => {
    (getDocs as jest.Mock).mockResolvedValue(snapshot([{ id: 'return', data: {
      chatId: 'chat', buyerId: 'buyer', sellerId: 'seller', status: 'return_requested',
      createdAt: { toDate: () => new Date('2026-10-01') }, returnLabelUrl: 'https://example.test/label.pdf',
    } }]));
    const tx = await TransactionService.getTransactionByChat('chat', 'buyer');
    expect(tx?.returnLabelUrl).toContain('label.pdf');
    expect(where).not.toHaveBeenCalledWith('status', 'in', expect.anything());
    expect(where).toHaveBeenCalledWith('buyerId', '==', 'buyer');
    expect(where).toHaveBeenCalledWith('sellerId', '==', 'buyer');
    expect(limit).toHaveBeenCalled();
  });
  it('breaks equal creation dates by descending ID and deduplicates', async () => {
    const date = { toDate: () => new Date('2026-10-02') };
    (getDocs as jest.Mock).mockResolvedValue(snapshot([
      { id: 'a', data: { createdAt: date, status: 'cancelled' } },
      { id: 'z', data: { createdAt: date, status: 'refund_in_progress' } },
    ]));
    expect((await TransactionService.getTransactionByChat('chat', 'buyer'))?.id).toBe('z');
    const sorted = sortTransactions([mapTransaction('unknown', {status: 'refunded'}), mapTransaction('known', {createdAt: date}), mapTransaction('known', {createdAt: date})]);
    expect(sorted.map(tx => tx.id)).toEqual(['known', 'unknown']);
  });
  it('does not infer real funds release from a past deadline', async () => {
    (getDocs as jest.Mock).mockResolvedValue(snapshot([{ id: 'held', data: {
      status: 'delivered', fundsReleaseAt: { toDate: () => new Date('2020-01-01') },
    } }]));
    expect((await TransactionService.getActiveTransactionsForUser('buyer')).map(tx => tx.id)).toContain('held');
  });
  it('normalizes nested refund/bank/return/counter dates without inventing creation chronology', () => {
    const date = new Date('2026-10-02');
    const stamp = {toDate: () => date};
    const tx = mapTransaction('legacy', {refund: {fundsAppliedAt: stamp}, bankDispute: {closedAt: stamp}, returnDeliveredAt: stamp, counterReport: {reportedAt: stamp}});
    expect(tx.createdAtKnown).toBe(false);
    expect(tx.refund?.fundsAppliedAt).toEqual(date);
    expect(tx.bankDispute?.closedAt).toEqual(date);
    expect(tx.returnDeliveredAt).toEqual(date);
    expect(tx.counterReport?.reportedAt).toEqual(date);
  });
  it('rejects ambiguous duplicate offer bindings rather than selecting an arbitrary agreement', async () => {
    (getDocs as jest.Mock).mockResolvedValue(snapshot([{id: 'one', data: {}}, {id: 'two', data: {}}]));
    const proof = await TransactionService.getTransactionForOffer('chat', 'buyer', 'message');
    expect(proof).toEqual({transaction: null, canStartCheckout: false, ambiguous: true});
    expect(where).toHaveBeenCalledWith('offerMessageId', '==', 'message');
    expect(limit).toHaveBeenCalledWith(2);
  });
  it('lets the seller read the exact native order link without using buyer discovery', async () => {
    const native = mapTransaction('linked', {chatId: 'chat', buyerId: 'buyer', sellerId: 'seller',
      offerMessageId: 'message', articleId: 'article', deliveryType: 'shipping', status: 'paid'});
    const read = jest.spyOn(TransactionService, 'getTransaction').mockResolvedValueOnce(native);
    await expect(TransactionService.getTransactionForOffer('chat', 'seller', 'message', 'linked')).resolves.toEqual({
      transaction: native, canStartCheckout: false, ambiguous: false,
    });
    expect(getDocs).not.toHaveBeenCalled();
    read.mockRestore();
  });
  it('does not reuse an unrelated legacy purchase as the accepted offer payment', async () => {
    (getDocs as jest.Mock).mockResolvedValueOnce(snapshot([])).mockResolvedValue(snapshot([{id: 'old-unlinked', data: {status: 'pending_payment', createdAt: new Date('2026-10-02')}}]));
    const proof = await TransactionService.getTransactionForOffer('chat', 'buyer', 'new-message');
    expect(proof).toEqual({transaction: null, canStartCheckout: false, ambiguous: true});
  });
  const cancelledOffer = () => ({chatId: 'chat', buyerId: 'buyer', sellerId: 'seller', articleId: 'article', deliveryType: 'shipping',
    offerMessageId: 'old-message', status: 'cancelled', createdAt: new Date('2026-10-02'),
    shippingOffer: {protocol: 'shipping_price_agreement_v1', messageId: 'old-message', chatId: 'chat', articleId: 'article',
      buyerId: 'buyer', sellerId: 'seller', hash: 'a'.repeat(64)},
    pendingCancellation: {schemaVersion: 1, state: 'committed', transactionId: 'old-order', buyerId: 'buyer', sellerId: 'seller',
      source: 'participant_cancel_pending', requestedBy: 'buyer', walletRefundCents: 0, purchaseDebitLedgerId: null,
      walletRefundLedgerId: null, cardCapabilityNeutralized: true, committedAt: new Date('2026-10-03')},
  });
  it('permits quoting a new native offer after a different order is provably cancelled, without reusing it', async () => {
    (getDocs as jest.Mock).mockResolvedValueOnce(snapshot([])).mockResolvedValue(snapshot([{id: 'old-order', data: cancelledOffer()}]));
    await expect(TransactionService.getTransactionForOffer('chat', 'buyer', 'new-message')).resolves.toEqual({
      transaction: null, canStartCheckout: true, ambiguous: false,
    });
  });
  it.each([
    {status: 'paid'}, {shippingOffer: undefined}, {offerMessageId: 'new-message'},
    {pendingCancellation: {...cancelledOffer().pendingCancellation, state: 'reconciliation_required'}},
    {pendingCancellation: {...cancelledOffer().pendingCancellation, cardCapabilityNeutralized: false}},
    {pendingCancellation: {...cancelledOffer().pendingCancellation, walletRefundCents: 500}},
    {bankDispute: {id: 'dp', state: 'open'}},
  ])('keeps an old active, ambiguous or unsettled agreement blocked: %p', async changes => {
    (getDocs as jest.Mock).mockResolvedValueOnce(snapshot([])).mockResolvedValue(snapshot([{id: 'old-order', data: {...cancelledOffer(), ...changes}}]));
    await expect(TransactionService.getTransactionForOffer('chat', 'buyer', 'new-message')).resolves.toEqual({
      transaction: null, canStartCheckout: false, ambiguous: true,
    });
  });
  it('does not infer latest from an ID page when a malformed date blocks the ordered query', async () => {
    (getDocs as jest.Mock).mockResolvedValue(snapshot([{id: 'malformed-date', data: {createdAt: 'not-a-timestamp'}}]));
    await expect(TransactionService.getTransactionByChat('chat', 'buyer')).rejects.toThrow('date');
  });
});

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
    expect(callable).toHaveBeenCalledWith({ transactionId: 'tx_123', expectedUid: 'buyer' });
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

describe('TransactionService.sellerCancelTransaction (F74)', () => {
  it('délègue à la callable sellerCancelTransaction avec le bon contrat', async () => {
    const callable = jest.fn().mockResolvedValue({ data: { success: true } });
    mockHttpsCallable.mockReturnValue(callable);

    const result = await TransactionService.sellerCancelTransaction('tx_1', 'item_lost');

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'sellerCancelTransaction',
    );
    expect(callable).toHaveBeenCalledWith({ transactionId: 'tx_1', reason: 'item_lost' });
    expect(result.success).toBe(true);
  });

  it('omet reason quand non fourni (jamais undefined dans le payload)', async () => {
    const callable = jest.fn().mockResolvedValue({ data: { success: true } });
    mockHttpsCallable.mockReturnValue(callable);

    await TransactionService.sellerCancelTransaction('tx_1');

    const payload = callable.mock.calls[0][0];
    expect(payload).toEqual({ transactionId: 'tx_1' });
    expect('reason' in payload).toBe(false);
  });

  it('remonte alreadyRefunded (idempotence) du backend', async () => {
    mockHttpsCallable.mockReturnValue(
      jest.fn().mockResolvedValue({ data: { success: true, alreadyRefunded: true } }),
    );

    const result = await TransactionService.sellerCancelTransaction('tx_1');
    expect(result.alreadyRefunded).toBe(true);
  });

  it('propage l\'erreur de précondition (commande déjà expédiée)', async () => {
    mockHttpsCallable.mockReturnValue(
      jest.fn().mockRejectedValue(new Error('Cette commande ne peut plus être annulée')),
    );

    await expect(
      TransactionService.sellerCancelTransaction('tx_1'),
    ).rejects.toThrow(/ne peut plus être annulée/i);
  });
});

describe('TransactionService — résolution admin de litige (F27/F88)', () => {
  beforeEach(() => {
    establishIdentityFixture('admin');
    Object.defineProperty(auth.currentUser, 'getIdTokenResult', {configurable: true, value: async () => ({claims: {
      admin: true, auth_time: Math.floor(Date.now() / 1000), firebase: {sign_in_provider: 'password'},
    }})});
  });
  const guard = () => {const session = captureTradeSession('admin'); return () => assertTradeSessionCurrent(session);};

  it('adminRefundTransaction délègue la même intention native, le montant en cents et la note après preview, sans annoncer un remboursement pending comme terminé', async () => {
    const assertCurrent = guard(), preview = historicalAdminPreview('admin');
    let attempt!: AdminFinancialAttempt;
    const callable = jest.fn(async (input: {mode: string}) => {
      if (input.mode === 'preview') return {data: preview};
      expect(await readAdminFinancialAttempts('admin', assertCurrent)).toEqual([attempt]);
      return {data: historicalAdminFinancialDecision(attempt)};
    });
    mockHttpsCallable.mockReturnValue(callable);

    const confirmedPreview = await TransactionService.previewAdminFinancialDecision('tx_1', 'dispute_1', 'admin', 'refund_without_return', assertCurrent);
    attempt = historicalAdminAttempt(confirmedPreview, {note: 'admin_dispute_refund'});
    const receipt = await TransactionService.adminRefundTransaction(attempt, assertCurrent, 'confirm');

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'adminRefundTransaction',
    );
    expect(callable).toHaveBeenCalledWith({
      transactionId: 'tx_1', expectedDisputeId: 'dispute_1', expectedAdminUid: 'admin', requestId: attempt.requestId,
      previewId: preview.previewId, expectedSourceHash: preview.sourceHash, expectedTotalCents: 5000, expectedCardCents: 4000,
      expectedWalletCents: 1000, expectedSellerDebitCents: 5000, decisionType: 'refund_without_return', note: 'admin_dispute_refund', mode: 'confirm', accepted: true,
    });
    expect(receipt).toMatchObject({outcome: 'reserved', disputesClosed: 0, financial: {success: false, status: 'pending', outstandingCardCents: 4000}});
    expect(await readAdminFinancialAttempts('admin', assertCurrent)).toEqual([attempt]);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('resolveDispute (faveur vendeur) délègue et remonte la forme de retour', async () => {
    const assertCurrent = guard(), preview = historicalAdminPreview('admin', 'dismissed');
    let attempt!: DisputeResolutionAttempt;
    const callable = jest.fn(async (input: {mode: string}) => {
      if (input.mode === 'preview') return {data: preview};
      expect(await readDisputeResolutionAttempts('admin', assertCurrent)).toEqual([attempt]);
      return {data: resolutionReceipt(attempt)};
    });
    mockHttpsCallable.mockReturnValue(callable);

    const confirmedPreview = await TransactionService.previewAdminFinancialDecision('tx_1', 'dispute_1', 'admin', 'dismissed', assertCurrent);
    attempt = {version: 1, adminUid: 'admin', transactionId: 'tx_1', disputeId: 'dispute_1', requestId: 'historical_dismiss_request_0001',
      note: 'Classement documentaire synthétique en faveur du vendeur.', previewId: confirmedPreview.previewId,
      expectedSourceHash: confirmedPreview.sourceHash, previewMonetaryContext: 'new_instruction', expectedSettledRefundIntentId: null};
    const result = await TransactionService.resolveDispute(attempt, assertCurrent, 'confirm');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'resolveDispute');
    expect(callable).toHaveBeenCalledWith({transactionId: 'tx_1', requestId: attempt.requestId, expectedAdminUid: 'admin', expectedDisputeId: 'dispute_1',
      note: attempt.note, mode: 'confirm', accepted: true, previewId: attempt.previewId, expectedSourceHash: attempt.expectedSourceHash});
    expect(result.outcome).toBe('dismissed');
    if (result.outcome !== 'dismissed') throw new Error('A qualified dismissal receipt was expected.');
    expect(result.restored).toBe('delivered');
    expect(result.releasedCents).toBe(1200);
    expect(result.disputesClosed).toBe(1);
    expect(result.deviceDeliveryVerified).toBe(false); expect(result.readingVerified).toBe(false);
    expect(await readDisputeResolutionAttempts('admin', assertCurrent)).toEqual([attempt]); expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('refuse une décision financière sans claim admin courant avant RPC et sans journaliser une permission', async () => {
    Object.defineProperty(auth.currentUser, 'getIdTokenResult', {configurable: true, value: async () => ({claims: {}})});
    const assertCurrent = guard(), attempt = historicalAdminAttempt(historicalAdminPreview('admin'));
    await expect(TransactionService.adminRefundTransaction(attempt, assertCurrent, 'confirm')).rejects.toThrow('administrateur');
    expect(mockHttpsCallable).not.toHaveBeenCalled(); expect(await readAdminFinancialAttempts('admin', assertCurrent)).toEqual([]);
  });

  it('conserve l’intention financière lorsque le reçu retour appartient à un autre opérateur', async () => {
    const assertCurrent = guard(), attempt = historicalAdminAttempt(historicalAdminPreview('admin'));
    mockHttpsCallable.mockReturnValue(jest.fn(async () => ({data: {...historicalAdminFinancialDecision(attempt), actorUid: 'foreign-admin'}})));
    await expect(TransactionService.adminRefundTransaction(attempt, assertCurrent, 'confirm')).rejects.toThrow('doit être relue');
    expect(await readAdminFinancialAttempts('admin', assertCurrent)).toEqual([attempt]); expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

function resolutionReceipt(attempt: DisputeResolutionAttempt) {
  const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {protocol: 'commercial_dispute_resolution_v1', success: true, decisionCommitted: true, transactionId: attempt.transactionId,
    expectedDisputeId: attempt.disputeId, requestId: attempt.requestId, decisionId: sha([attempt.transactionId, attempt.adminUid, attempt.requestId]),
    actorUid: attempt.adminUid, outcome: 'dismissed', note: attempt.note, restored: 'delivered', currentOrderStatus: 'delivered', releasedCents: 1200,
    disputesClosed: 1, disputeIds: [attempt.disputeId], orderResolutionCommitted: true, remainingOpenDisputeIds: [], remainingDisputesOpen: 0,
    retainedObligations: [], resolvedAt: '2026-11-25T20:00:00.000Z', replay: false, notificationCommitted: true,
    notificationDelivery: 'in_app_committed', deviceDeliveryVerified: false, readingVerified: false,
    financialSettlementRetained: false, settledRefundIntentId: null};
}

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
