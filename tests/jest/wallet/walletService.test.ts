/**
 * WalletService — porte-monnaie virtuel (3 poches + retrait).
 *
 * Domaine wallet : ce service est l'unique point d'entrée client vers les
 * callables financières du porte-monnaie. Toute la logique d'argent vit côté
 * Cloud Function ; le service client se contente d'appeler la bonne callable
 * avec le bon contrat et de normaliser la réponse pour l'UI.
 *
 * Comportement MÉTIER couvert (pas de tautologie) :
 *   - getWalletInfo cible la callable `getWalletInfo` et renvoie le payload tel
 *     quel (3 poches : balance/pending/held + sellerDebt) — l'argent reste en
 *     cents, le formatage est laissé à l'UI.
 *   - activateWallet cible `activateWallet` et ne fuit QUE `success` (la balance
 *     et le status bruts ne sont pas re-propagés tels quels par le service).
 *   - withdrawFromWallet cible `walletWithdraw` avec un MONTANT EN CENTS dans le
 *     contrat (invariant central : jamais de dollars) et renvoie le newBalance.
 *   - payWithWallet cible `payWithWallet` avec le transactionId et renvoie le
 *     newBalance.
 *   - une erreur de la callable (ex. failed-precondition : litige / dette /
 *     solde insuffisant) remonte telle quelle à l'appelant (l'UI mappe la copy).
 *
 * Les modules firebase sont mockés globalement (jest.setup.js) ; on pilote
 * httpsCallable pour inspecter le NOM de la callable et le payload envoyés.
 * Vit dans tests/jest/ → ramassé par Jest, ignoré par Vitest.
 */

import { httpsCallable } from 'firebase/functions';

import { WalletService } from '@/services/walletService';
import type { WalletInfo } from '@/types';

const mockHttpsCallable = httpsCallable as jest.Mock;

/**
 * Helper : enregistre un retour pour la callable et capture, par appel, le nom
 * de la callable (2e arg de httpsCallable) et le payload (arg du callable).
 */
function stubCallable(returnData: unknown) {
  const callable = jest.fn().mockResolvedValue({ data: returnData });
  mockHttpsCallable.mockReturnValue(callable);
  return callable;
}

/** Nom de la callable ciblée au dernier appel de httpsCallable. */
function lastCallableName(): string {
  const calls = mockHttpsCallable.mock.calls;
  return calls[calls.length - 1][1] as string;
}

const ACTIVE_WALLET: WalletInfo = {
  hasWallet: true,
  balance: 12000, // 120,00 $
  pendingBalance: 4500, // 45,00 $
  heldBalance: 3000, // 30,00 $
  heldReleaseAt: '2026-06-10T00:00:00.000Z',
  sellerDebt: 0,
  status: 'active',
  ledger: [
    {
      id: 'l1',
      type: 'sale_credit',
      amount: 12000,
      balanceAfter: 12000,
      description: 'Vente Robe en lin',
      createdAt: '2026-06-01T10:00:00.000Z',
    },
  ],
};

describe('WalletService.getWalletInfo', () => {
  it('cible la callable getWalletInfo et renvoie les 3 poches + sellerDebt tels quels (cents)', async () => {
    const callable = stubCallable(ACTIVE_WALLET);

    const info = await WalletService.getWalletInfo();

    expect(lastCallableName()).toBe('getWalletInfo');
    // Pas d'argument métier requis (utilise l'auth context côté serveur).
    expect(callable).toHaveBeenCalledWith({});
    // Le service ne transforme rien : les montants restent en cents.
    expect(info.balance).toBe(12000);
    expect(info.pendingBalance).toBe(4500);
    expect(info.heldBalance).toBe(3000);
    expect(info.sellerDebt).toBe(0);
    expect(info.hasWallet).toBe(true);
    expect(info.status).toBe('active');
    expect(info.ledger).toHaveLength(1);
  });

  it('propage un porte-monnaie non activé (hasWallet: false) sans le réécrire', async () => {
    stubCallable({
      hasWallet: false,
      balance: 0,
      pendingBalance: 0,
      status: 'inactive',
      ledger: [],
    } as WalletInfo);

    const info = await WalletService.getWalletInfo();

    expect(info.hasWallet).toBe(false);
    expect(info.status).toBe('inactive');
    expect(info.ledger).toEqual([]);
  });
});

describe('WalletService.activateWallet', () => {
  it('cible la callable activateWallet et ne renvoie QUE success (pas balance/status bruts)', async () => {
    const callable = stubCallable({ success: true, balance: 0, status: 'active' });

    const res = await WalletService.activateWallet();

    expect(lastCallableName()).toBe('activateWallet');
    expect(callable).toHaveBeenCalledWith({});
    // Contrat du service : surface réduite à { success }.
    expect(res).toEqual({ success: true });
    expect(res).not.toHaveProperty('balance');
    expect(res).not.toHaveProperty('status');
  });
});

describe('WalletService.withdrawFromWallet', () => {
  it('cible walletWithdraw avec le MONTANT EN CENTS (jamais en dollars) et renvoie newBalance', async () => {
    const callable = stubCallable({ success: true, newBalance: 5000 });

    // 70,00 $ = 7000 cents ; on retire ce montant d'un solde fictif.
    const res = await WalletService.withdrawFromWallet(7000);

    expect(lastCallableName()).toBe('walletWithdraw');
    // Invariant central : le contrat envoie des cents bruts, pas de division.
    expect(callable).toHaveBeenCalledWith({ amount: 7000 });
    expect(res).toEqual({ success: true, newBalance: 5000 });
  });

  it('laisse remonter une erreur de garde serveur (litige / dette / solde) à l’appelant', async () => {
    // failed-precondition est le code renvoyé par le backend pour les gardes
    // financières (litige actif, sellerDebt, solde insuffisant) ; l'UI mappe la
    // copy à partir du message — le service ne doit ni avaler ni transformer.
    const err = Object.assign(new Error('Un litige est en cours.'), {
      code: 'functions/failed-precondition',
    });
    const callable = jest.fn().mockRejectedValue(err);
    mockHttpsCallable.mockReturnValue(callable);

    await expect(WalletService.withdrawFromWallet(2000)).rejects.toMatchObject({
      code: 'functions/failed-precondition',
      message: 'Un litige est en cours.',
    });
  });
});

describe('WalletService.payWithWallet', () => {
  it('cible payWithWallet avec le transactionId et renvoie le newBalance', async () => {
    const callable = stubCallable({ success: true, newBalance: 8000 });

    const res = await WalletService.payWithWallet('tx_42');

    expect(lastCallableName()).toBe('payWithWallet');
    expect(callable).toHaveBeenCalledWith({ transactionId: 'tx_42' });
    expect(res).toEqual({ success: true, newBalance: 8000 });
  });

  it('laisse remonter une erreur (ex. solde insuffisant) à l’appelant', async () => {
    const err = Object.assign(new Error('Solde insuffisant.'), {
      code: 'functions/failed-precondition',
    });
    const callable = jest.fn().mockRejectedValue(err);
    mockHttpsCallable.mockReturnValue(callable);

    await expect(WalletService.payWithWallet('tx_99')).rejects.toThrow(
      /solde insuffisant/i,
    );
  });
});
