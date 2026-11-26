import {establishIdentityFixture} from '@/tests/jest/helpers/identityFixture';
beforeEach(() => establishIdentityFixture('u1'));
/**
 * swapService — comportement MÉTIER du service d'échange.
 *
 * Périmètre :
 *  - getSwapItems : résolution des items avec rétro-compat (arrays multi-articles
 *    vs ancien format single-item `initiatorItem`/`receiverItem`).
 *  - proposeSwap : délègue à la callable `proposeMultiSwap`, applique le default
 *    de partyId (zone généraliste) et convertit le payload tel quel ; renvoie le
 *    swapId.
 *  - acceptSwap : remonte le couple {status, requiresPayment} (cas complément →
 *    payment_pending, cas sans complément → accepted).
 *  - getActiveSwaps : ne garde que les statuts "en cours" (filtre métier).
 *
 * Placé sous tests/jest/ (et non services/) pour rester dans le périmètre Jest :
 * Vitest possède les tests de services mais exclut explicitement tests/jest/.
 */

import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, getDocs } from 'firebase/firestore';

import {
  getPartyItemsExtended,
  getSwapItems,
  proposeSwap,
  acceptSwap,
  getActiveSwaps,
  openSwapDispute,
  resolveSwapDispute,
  GENERALIST_ZONE_ID,
} from '@/services/swapService';
import type { Swap, SwapItemInfo, SwapStatus } from '@/types';
import { auth } from '@/config/firebaseConfig';
import { useAuthStore } from '@/store/authStore';
const agreementAcknowledgement = {expectedUid: 'u1', agreementProtocol: 'swap_exchange_agreement_v1' as const, expectedSourceHash: 'a'.repeat(64)};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const item = (id: string, price: number): SwapItemInfo => ({
  articleId: id,
  title: `Article ${id}`,
  price,
});

/** Build a minimal Swap with the fields we assert on. */
function makeSwap(partial: Partial<Swap>): Swap {
  return {
    id: 'swap-x',
    initiatorId: 'u1',
    initiatorName: 'Alice',
    receiverId: 'u2',
    receiverName: 'Bob',
    initiatorItems: [],
    receiverItems: [],
    initiatorTotalValue: 0,
    receiverTotalValue: 0,
    status: 'proposed',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...partial,
  } as Swap;
}

/** Mock a Firestore getDocs snapshot from an array of Swaps. */
function snapshotOf(swaps: Swap[]) {
  return {
    docs: swaps.map((s) => ({
      id: s.id,
      data: () => ({
        ...s,
        // The service calls .toDate() on timestamp fields; emulate it.
        createdAt: { toDate: () => s.createdAt },
        updatedAt: { toDate: () => s.updatedAt },
      }),
    })),
  };
}

describe('swapService — getSwapItems (rétro-compat)', () => {
  it('renvoie le tableau multi-articles quand il est présent', () => {
    const swap = makeSwap({
      initiatorItems: [item('a', 10), item('b', 20)],
      receiverItems: [item('c', 30)],
    });

    expect(getSwapItems(swap, 'initiator')).toHaveLength(2);
    expect(getSwapItems(swap, 'receiver')).toEqual([item('c', 30)]);
  });

  it('retombe sur le champ single-item legacy quand le tableau est absent', () => {
    // Ancien swap : pas de *Items, seulement le champ historique *Item.
    const legacy = makeSwap({
      initiatorItems: undefined as unknown as SwapItemInfo[],
      receiverItems: undefined as unknown as SwapItemInfo[],
      initiatorItem: item('legacy-i', 40),
      receiverItem: item('legacy-r', 50),
    });

    expect(getSwapItems(legacy, 'initiator')).toEqual([item('legacy-i', 40)]);
    expect(getSwapItems(legacy, 'receiver')).toEqual([item('legacy-r', 50)]);
  });

  it('renvoie un tableau vide quand aucune source n’existe', () => {
    const empty = makeSwap({
      initiatorItems: undefined as unknown as SwapItemInfo[],
      receiverItems: undefined as unknown as SwapItemInfo[],
    });

    expect(getSwapItems(empty, 'initiator')).toEqual([]);
    expect(getSwapItems(empty, 'receiver')).toEqual([]);
  });

  it('privilégie le tableau multi-articles même si le champ legacy coexiste', () => {
    const swap = makeSwap({
      initiatorItems: [item('new', 99)],
      initiatorItem: item('old', 1),
    });

    expect(getSwapItems(swap, 'initiator')).toEqual([item('new', 99)]);
  });
});

describe('swapService — proposeSwap (callable proposeMultiSwap)', () => {
  beforeEach(() => { Object.defineProperty(auth, 'currentUser', {value: {uid: 'u1'}, configurable: true, writable: true}); useAuthStore.setState({authenticatedUid: 'u1'}); });
  it('applique la zone généraliste par défaut et renvoie le swapId', async () => {
    const callable = jest.fn((..._args: unknown[]) => Promise.resolve({ data: { swapId: 'swap-123', success: true } }));
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    const swapId = await proposeSwap({
      ...agreementAcknowledgement, exchangeMode: 'hand_delivery', arrangements: 'Lieu et heure convenus.',
      initiatorId: 'u1',
      initiatorName: 'Alice',
      initiatorItems: [item('a', 10)],
      receiverId: 'u2',
      receiverName: 'Bob',
      receiverItems: [item('c', 30)],
    });

    expect(swapId).toBe('swap-123');
    // partyId absent → default GENERALIST_ZONE_ID injecté dans le payload.
    expect(callable).toHaveBeenCalledTimes(1);
    expect(callable.mock.calls[0][0]).toMatchObject({ partyId: GENERALIST_ZONE_ID });
  });

  it('respecte un partyId explicite et transmet le complément en argent', async () => {
    const callable = jest.fn((..._args: unknown[]) => Promise.resolve({ data: { swapId: 'swap-9', success: true } }));
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await proposeSwap({
      ...agreementAcknowledgement, exchangeMode: 'hand_delivery', arrangements: 'Lieu et heure convenus.',
      initiatorId: 'u1',
      initiatorName: 'Alice',
      initiatorItems: [item('a', 10)],
      receiverId: 'u2',
      receiverName: 'Bob',
      receiverItems: [item('c', 30)],
      cashTopUp: { amount: 2000, payerId: 'u1' },
      partyId: 'autre-zone',
    });

    const payload = callable.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.partyId).toBe('autre-zone');
    expect(payload.cashTopUp).toEqual({ amount: 2000, payerId: 'u1' });
  });
});

describe('swapService — acceptSwap', () => {
  beforeEach(() => { Object.defineProperty(auth, 'currentUser', {value: {uid: 'u1'}, configurable: true, writable: true}); useAuthStore.setState({authenticatedUid: 'u1'}); });
  it('remonte payment_pending + requiresPayment quand un complément est dû', async () => {
    const callable = jest.fn((..._args: unknown[]) =>
      Promise.resolve({ data: { success: true, status: 'payment_pending', requiresPayment: true, replay: false } })
    );
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    const res = await acceptSwap('swap-1', agreementAcknowledgement);

    expect(res).toEqual({ status: 'payment_pending', requiresPayment: true, replay: false });
    expect(callable).toHaveBeenCalledWith({ swapId: 'swap-1', ...agreementAcknowledgement });
  });

  it('remonte accepted sans paiement requis pour un échange sans complément', async () => {
    const callable = jest.fn((..._args: unknown[]) =>
      Promise.resolve({ data: { success: true, status: 'accepted', requiresPayment: false, replay: false } })
    );
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    const res = await acceptSwap('swap-2', agreementAcknowledgement);

    expect(res).toEqual({ status: 'accepted', requiresPayment: false, replay: false });
  });
});

describe('swapService — getActiveSwaps (filtre statut)', () => {
  it('ne conserve que les statuts en cours et écarte proposed/declined/completed', async () => {
    establishIdentityFixture('me');
    const swaps: Swap[] = [
      makeSwap({ id: 's-proposed', initiatorId: 'me', status: 'proposed' }),
      makeSwap({ id: 's-accepted', initiatorId: 'me', status: 'accepted' }),
      makeSwap({ id: 's-shipping', initiatorId: 'me', status: 'shipping' }),
      makeSwap({ id: 's-payment', initiatorId: 'me', status: 'payment_pending' }),
      makeSwap({ id: 's-photos', initiatorId: 'me', status: 'photos_pending' }),
      makeSwap({ id: 's-declined', initiatorId: 'me', status: 'declined' }),
      makeSwap({ id: 's-completed', initiatorId: 'me', status: 'completed' }),
    ];

    // getActiveSwaps → getUserSwaps fait 2 requêtes (initiator + receiver).
    // 1er appel : tous nos swaps en tant qu'initiateur. 2e : aucun en receiver.
    (getDocs as jest.Mock)
      .mockResolvedValueOnce(snapshotOf(swaps))
      .mockResolvedValueOnce(snapshotOf([]));

    const active = await getActiveSwaps('me');
    const ids = active.map((s) => s.id).sort();
    const statuses = active.map((s) => s.status as SwapStatus);

    expect(ids).toEqual(['s-accepted', 's-payment', 's-photos', 's-shipping']);
    expect(statuses).not.toContain('proposed');
    expect(statuses).not.toContain('declined');
    expect(statuses).not.toContain('completed');
  });
});

describe('swapService — openSwapDispute (F48/F51)', () => {
  it('délègue à la callable openSwapDispute avec swapId + reason', async () => {
    const callable = jest.fn((..._args: unknown[]) =>
      Promise.resolve({ data: { success: true } }),
    );
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await openSwapDispute('swap-1', "Je n'ai pas reçu l'article");

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'openSwapDispute');
    expect(callable).toHaveBeenCalledWith({
      swapId: 'swap-1', expectedUid: 'u1',
      reason: "Je n'ai pas reçu l'article",
    });
  });
});

describe('swapService — resolveSwapDispute (F48, admin)', () => {
  it('transmet refund_payer avec note mais refuse un ancien succès sans reçu qualifié', async () => {
    const callable = jest.fn((..._args: unknown[]) =>
      Promise.resolve({ data: { success: true } }),
    );
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(resolveSwapDispute('swap-1', 'refund_payer', 'remboursement payeur')).rejects.toThrow('Résultat non qualifié');

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'resolveSwapDispute');
    expect(callable).toHaveBeenCalledWith({
      swapId: 'swap-1',
      issue: 'refund_payer', mode: 'resolve', expectedAdminUid: 'u1',
      note: 'remboursement payeur',
    });
  });

  it('délègue release_payee et omet note quand absente (jamais undefined)', async () => {
    const callable = jest.fn((..._args: unknown[]) =>
      Promise.resolve({ data: { success: true } }),
    );
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(resolveSwapDispute('swap-2', 'release_payee')).rejects.toThrow('Résultat non qualifié');

    const payload = callable.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({ swapId: 'swap-2', issue: 'release_payee', mode: 'resolve', expectedAdminUid: 'u1' });
    expect('note' in payload).toBe(false);
  });
});

/**
 * FR15 — la Swap Zone montrait l'article d'autrui déposé par un squatteur :
 * le document d'item porte son propre `sellerId`, que rien ne confrontait au
 * vendeur réel de l'article.
 */
describe('getPartyItemsExtended — dépôt squatté (FR15)', () => {
  function itemsSnapshot(items: Record<string, unknown>[]) {
    return {
      docs: items.map((it) => ({
        id: it.id as string,
        data: () => ({ ...it, addedAt: { toDate: () => new Date('2026-01-01') } }),
      })),
    };
  }

  it('écarte un item dont l’article appartient à quelqu’un d’autre', async () => {
    (getDocs as jest.Mock).mockResolvedValueOnce(
      itemsSnapshot([
        { id: 'i1', articleId: 'a1', sellerId: 'u1', title: 'Robe', price: 20 },
        { id: 'i2', articleId: 'a2', sellerId: 'mallory', title: 'Veste', price: 50 },
      ]),
    );
    (doc as jest.Mock).mockImplementation((_db: unknown, _col: string, id: string) => ({ id }));
    (getDoc as jest.Mock).mockImplementation(async (ref: { id: string }) => ({
      exists: () => true,
      data: () =>
        ref.id === 'a1'
          ? { sellerId: 'u1', isActive: true, isSold: false }
          : { sellerId: 'victime', isActive: true, isSold: false },
    }));

    const items = await getPartyItemsExtended('zone-1');

    expect(items.map((i) => i.id)).toEqual(['i1']);
  });
});

// A native decision receipt binds the instruction and notices; it never certifies a refund.
function disputeReceipt(issue: 'refund_payer' | 'release_payee', note: string | null) {
  const hash = (value: unknown) => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex') as string;
  const sourceHash = 'a'.repeat(64), decisionKey = hash([sourceHash, 'u1', issue, note]);
  const eventKey = `swap_dispute_decision:swap-1:${decisionKey}`;
  return {mode: 'resolve', swapId: 'swap-1', adminUid: 'u1', issue, noteHash: hash(note), observationState: 'recorded',
    protocol: 'swap_dispute_notice_v1', sourceHash, decisionKey, initiatorId: 'u1', receiverId: 'u2',
    committedAt: '2026-11-25T18:00:00.000Z', notificationIds: ['u1', 'u2'].map(uid => `operational_${hash([eventKey, uid])}`),
    movedCents: 0, financialInstruction: issue, success: true, decisionCommitted: true, notificationCommitted: true,
    refundConfirmed: false, deviceDeliveryVerified: false, readingVerified: false, nonExecutionVerified: false, replay: false};
}
it.each(['refund_payer', 'release_payee'] as const)('qualifies the exact native %s instruction without claiming refunded funds or delivered notices', async issue => {
  const receipt = disputeReceipt(issue, null); const rpc = jest.fn(async () => ({data: receipt}));
  (httpsCallable as jest.Mock).mockReturnValue(rpc);
  await expect(resolveSwapDispute('swap-1', issue)).resolves.toEqual(receipt);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(receipt.refundConfirmed).toBe(false); expect(receipt.deviceDeliveryVerified).toBe(false); expect(receipt.readingVerified).toBe(false);
});
it('rejects another instruction’s notice reference without retrying the mutation', async () => {
  const rpc = jest.fn(async () => ({data: {...disputeReceipt('refund_payer', null), notificationIds: ['another-notice', 'another-notice']}}));
  (httpsCallable as jest.Mock).mockReturnValue(rpc);
  await expect(resolveSwapDispute('swap-1', 'refund_payer')).rejects.toThrow('Résultat non qualifié');
  expect(rpc).toHaveBeenCalledTimes(1);
});
