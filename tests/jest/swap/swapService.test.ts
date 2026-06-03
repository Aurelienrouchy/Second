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
import { getDocs } from 'firebase/firestore';

import {
  getSwapItems,
  proposeSwap,
  acceptSwap,
  getActiveSwaps,
  GENERALIST_ZONE_ID,
} from '@/services/swapService';
import type { Swap, SwapItemInfo, SwapStatus } from '@/types';

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
  it('applique la zone généraliste par défaut et renvoie le swapId', async () => {
    const callable = jest.fn((..._args: unknown[]) => Promise.resolve({ data: { swapId: 'swap-123', success: true } }));
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    const swapId = await proposeSwap({
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
  it('remonte payment_pending + requiresPayment quand un complément est dû', async () => {
    const callable = jest.fn((..._args: unknown[]) =>
      Promise.resolve({ data: { success: true, status: 'payment_pending', requiresPayment: true } })
    );
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    const res = await acceptSwap('swap-1');

    expect(res).toEqual({ status: 'payment_pending', requiresPayment: true });
    expect(callable).toHaveBeenCalledWith({ swapId: 'swap-1' });
  });

  it('remonte accepted sans paiement requis pour un échange sans complément', async () => {
    const callable = jest.fn((..._args: unknown[]) =>
      Promise.resolve({ data: { success: true, status: 'accepted', requiresPayment: false } })
    );
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    const res = await acceptSwap('swap-2');

    expect(res).toEqual({ status: 'accepted', requiresPayment: false });
  });
});

describe('swapService — getActiveSwaps (filtre statut)', () => {
  it('ne conserve que les statuts en cours et écarte proposed/declined/completed', async () => {
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
