import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from './queryKeys';
import { createCompletedSwapCacheReconciler, reconcileOwnerArticleAvailability, removeWithdrawnArticleFromCache } from './withdrawnArticleCache';
import type { Swap } from '@/types/swap';

const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 600_000 } } });
  clients.push(client);
  return client;
}
afterEach(() => { clients.splice(0).forEach(client => client.clear()); });

const target = { id: 'withdrawn', title: 'Retirée' };
const other = { id: 'remaining', title: 'Conservée' };
const homeKey = ['home', 'new-arrivals'] as const;

describe('confirmed article withdrawal cache', () => {
  it('removes only the withdrawn card from cached owner, Home, search and favorite lists', async () => {
    const client = setup();
    const ownerKey = queryKeys.articles.userList('owner');
    const profileKey = queryKeys.users.articles('owner');
    const lists = [ownerKey, profileKey, homeKey, ['home', 'price-drops'], ['home', 'pour-toi', 'owner', 10]];
    for (const key of lists) client.setQueryData(key, [target, other]);
    const lastVisible = { cursor: 'preserved' };
    const pageParams = [null, 'next'];
    const emptyPage = { articles: [], lastDocId: null };
    const discover = { pages: [{ articles: [target, other], lastDocId: 'next' }, emptyPage], pageParams };
    client.setQueryData(['home', 'discover'], discover);
    client.setQueryData(['articles', 'search', { query: 'Retirée' }], { pages: [{ articles: [target, other], lastVisible, hasMore: true }], pageParams: [null] });
    client.setQueryData(['favorites', 'list', 'owner'], { pages: [{ articles: [target, other], nextCursor: 2, orphanedCount: 0 }], pageParams: [0] });

    await removeWithdrawnArticleFromCache(client, target.id, 'owner', () => undefined);

    for (const key of lists) {
      expect(client.getQueryData(key)).toEqual([other]);
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
    const pruned = client.getQueryData<typeof discover>(['home', 'discover'])!;
    expect(pruned.pages).toEqual([{ articles: [other], lastDocId: 'next' }, emptyPage]);
    expect(pruned.pages[1]).toBe(emptyPage);
    expect(pruned.pageParams).toBe(pageParams);
    expect(client.getQueryState(['home', 'discover'])?.isInvalidated).toBe(true);
    expect(client.getQueryData(['articles', 'search', { query: 'Retirée' }])).toEqual({ pages: [{ articles: [other], lastVisible, hasMore: true }], pageParams: [null] });
    expect(client.getQueryData(['favorites', 'list', 'owner'])).toEqual({ pages: [{ articles: [other], nextCursor: 2, orphanedCount: 0 }], pageParams: [0] });
  });

  it('does not treat seller, brand, swap-item, preference or unrelated IDs as article IDs', async () => {
    const client = setup();
    const preservedKeys = [
      ['home', 'trending-brands'], ['home', 'featured-sellers'],
      ['home', 'swap-zone-items', 'zone'], ['orders', 'owner'],
      queryKeys.users.articles('another-owner'),
    ];
    for (const key of preservedKeys) client.setQueryData(key, [target]);
    client.setQueryData(['favorites', 'ids', 'owner'], ['withdrawn', 'remaining']);
    const article = { ...target, sellerId: 'owner' };
    client.setQueryData(queryKeys.articles.detail(target.id), article);
    client.setQueryData(homeKey, [other]);
    const previous = client.getQueryData(homeKey);

    await removeWithdrawnArticleFromCache(client, target.id, 'owner', () => undefined);

    for (const key of preservedKeys) expect(client.getQueryData(key)).toEqual([target]);
    expect(client.getQueryData(['favorites', 'ids', 'owner'])).toEqual(['withdrawn', 'remaining']);
    expect(client.getQueryData(queryKeys.articles.detail(target.id))).toBe(article);
    expect(client.getQueryData(homeKey)).toBe(previous);
    expect(client.getQueryState(['orders', 'owner'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(queryKeys.users.articles('another-owner'))?.isInvalidated).toBe(false);
    expect(client.getQueryState(queryKeys.articles.detail(target.id))?.isInvalidated).toBe(true);
  });

  it('cancels an actual in-flight read so its ignored AbortSignal cannot resurrect the card', async () => {
    const client = setup();
    client.setQueryData(homeKey, [target, other]);
    let finish!: (data: typeof target[]) => void;
    const started = vi.fn();
    const pending = client.fetchQuery({ queryKey: homeKey, staleTime: 0, queryFn: () => {
      started();
      return new Promise<typeof target[]>(resolve => { finish = resolve; });
    } }).catch(error => error);
    expect(started).toHaveBeenCalledOnce();
    await removeWithdrawnArticleFromCache(client, target.id, 'owner', () => undefined);
    finish([target, other]);
    await pending;
    await Promise.resolve();
    expect(client.getQueryData(homeKey)).toEqual([other]);
    expect(client.getQueryState(homeKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(homeKey)?.fetchStatus).toBe('idle');
  });

  it('does nothing for an already obsolete session', async () => {
    const client = setup();
    client.setQueryData(homeKey, [target, other]);
    const cancel = vi.spyOn(client, 'cancelQueries');
    await expect(removeWithdrawnArticleFromCache(client, target.id, 'owner', () => { throw new Error('stale'); })).rejects.toThrow('stale');
    expect(cancel).not.toHaveBeenCalled();
    expect(client.getQueryData(homeKey)).toEqual([target, other]);
    expect(client.getQueryState(homeKey)?.isInvalidated).toBe(false);
  });

  it('does not purge or invalidate a replacement session after query cancellation yields', async () => {
    const client = setup();
    client.setQueryData(homeKey, [target]);
    let generation = 1;
    const current = () => { if (generation !== 1) throw new Error('stale'); };
    const pending = removeWithdrawnArticleFromCache(client, target.id, 'owner', current);
    generation = 2;
    client.setQueryData(homeKey, [target, other]);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await expect(pending).rejects.toThrow('stale');
    expect(client.getQueryData(homeKey)).toEqual([target, other]);
    expect(client.getQueryState(homeKey)?.isInvalidated).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

const coat = { id: 'coat', sellerId: 'A' };
const dress = { id: 'dress', sellerId: 'B' };
function agreement(status: Swap['status'] = 'shipping'): Swap {
  return { id: 'swap-1', partyId: 'generalist', initiatorId: 'A', receiverId: 'B', initiatorName: 'A', receiverName: 'B',
    initiatorItems: [{ articleId: 'coat', title: 'Manteau', price: 12 }], receiverItems: [{ articleId: 'dress', title: 'Robe', price: 12 }],
    initiatorItemId: 'zone-doc-not-an-article', receiverItemId: 'another-zone-doc',
    initiatorTotalValue: 12, receiverTotalValue: 12, status, createdAt: new Date(0), updatedAt: new Date(0) };
}
function seedCompleted(client: QueryClient) {
  client.setQueryData(homeKey, [coat, dress, other]);
  client.setQueryData(['home', 'discover'], { pages: [{ articles: [coat, dress, other], lastDocId: 'cursor' }], pageParams: [null] });
  client.setQueryData(queryKeys.articles.userList('A'), [coat]);
  client.setQueryData(queryKeys.articles.userList('B'), [dress]);
  const items = [
    { id: 'zone-coat', articleId: 'coat', sellerId: 'A', partyId: 'generalist' },
    { id: 'zone-dress', articleId: 'dress', sellerId: 'B', partyId: 'generalist' },
    // Document-id collisions and other owners/parties are not consumption receipts.
    { id: 'coat', articleId: 'unrelated', sellerId: 'A', partyId: 'generalist' },
    { id: 'wrong-seller', articleId: 'coat', sellerId: 'C', partyId: 'generalist' },
    { id: 'other-party', articleId: 'coat', sellerId: 'A', partyId: 'another-party' },
  ];
  const party = { id: 'generalist', itemsCount: 5, swapsCount: 3 };
  client.setQueryData(queryKeys.swapParties.detail('generalist'), { party, items });
  client.setQueryData(['home', 'swap-zone-items', 'generalist'], items);
  client.setQueryData(queryKeys.swapParties.detail('another-party'), { party: { id: 'another-party' }, items });
  client.setQueryData(['home', 'swap-zone-items', 'another-party'], items);
  client.setQueryData(queryKeys.swaps.detail('swap-1'), agreement());
  return { items, party };
}

describe('current completed swap catalogue', () => {
  it.each(['A', 'B'])('participant %s prunes both consumed articles only after an observed same-source completion', async uid => {
    const client = setup(); const { items, party } = seedCompleted(client);
    const reconcile = createCompletedSwapCacheReconciler(client, uid, () => undefined);
    await reconcile(agreement());
    expect(client.getQueryData(homeKey)).toEqual([coat, dress, other]);
    await reconcile(agreement('completed'));
    expect(client.getQueryData(homeKey)).toEqual([other]);
    expect(client.getQueryData(['home', 'discover'])).toEqual({ pages: [{ articles: [other], lastDocId: 'cursor' }], pageParams: [null] });
    expect(client.getQueryData(queryKeys.articles.userList('A'))).toEqual([]);
    expect(client.getQueryData(queryKeys.articles.userList('B'))).toEqual([]);
    expect(client.getQueryData(queryKeys.swapParties.detail('generalist'))).toEqual({ party, items: items.slice(2) });
    expect(client.getQueryData(['home', 'swap-zone-items', 'generalist'])).toEqual(items.slice(2));
    expect(client.getQueryState(queryKeys.swapParties.detail('generalist'))?.isInvalidated).toBe(true);
    expect(client.getQueryData(queryKeys.swapParties.detail('another-party'))).toEqual({ party: { id: 'another-party' }, items });
    expect(client.getQueryState(['home', 'swap-zone-items', 'another-party'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(queryKeys.swapParties.detail('another-party'))?.isInvalidated).toBe(false);
    expect(client.getQueryData(queryKeys.swaps.detail('swap-1'))).toEqual(agreement());
    expect(client.getQueryState(queryKeys.swaps.detail('swap-1'))?.isInvalidated).toBe(false);
  });

  it('refreshes an initial completed archive without assuming its cards are unavailable today', async () => {
    const client = setup(); const { items } = seedCompleted(client);
    const reconcile = createCompletedSwapCacheReconciler(client, 'A', () => undefined);
    await reconcile(agreement('completed'));
    expect(client.getQueryData(homeKey)).toEqual([coat, dress, other]);
    expect(client.getQueryData(['home', 'swap-zone-items', 'generalist'])).toEqual(items);
    expect(client.getQueryState(homeKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.swapParties.detail('generalist'))?.isInvalidated).toBe(true);
  });

  it('does not reconcile pending or nonparticipant deliveries, and deduplicates completion rating updates', async () => {
    const client = setup(); seedCompleted(client);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await createCompletedSwapCacheReconciler(client, 'outsider', () => undefined)(agreement('completed'));
    const reconcile = createCompletedSwapCacheReconciler(client, 'A', () => undefined);
    await reconcile(agreement('proposed'));
    expect(invalidate).not.toHaveBeenCalled();
    await reconcile(agreement('completed'));
    await reconcile({ ...agreement('completed'), updatedAt: new Date(100), initiatorRating: { score: 5 } });
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it.each(['article', 'participants', 'party', 'source', 'null'] as const)('a changed %s breaks the observed transition and refreshes without eviction', async changed => {
    const client = setup(); seedCompleted(client);
    const reconcile = createCompletedSwapCacheReconciler(client, 'A', () => undefined);
    await reconcile(agreement());
    const completed = agreement('completed');
    if (changed === 'article') completed.initiatorItems = [{ articleId: 'new-coat', title: 'Autre', price: 12 }];
    if (changed === 'participants') completed.receiverId = 'C';
    if (changed === 'party') completed.partyId = 'another-party';
    if (changed === 'source') completed.exchangeAgreement = { sourceHash: 'changed' } as NonNullable<Swap['exchangeAgreement']>;
    if (changed === 'null') await reconcile(null);
    await reconcile(completed);
    expect(client.getQueryData(homeKey)).toEqual([coat, dress, other]);
    expect(client.getQueryState(homeKey)?.isInvalidated).toBe(true);
  });

  it('uses legacy item.articleId rather than deprecated zone document IDs', async () => {
    const client = setup(); seedCompleted(client);
    const legacy = { ...agreement(), initiatorItems: undefined, receiverItems: undefined,
      initiatorItem: agreement().initiatorItems[0], receiverItem: agreement().receiverItems[0] } as unknown as Swap;
    const reconcile = createCompletedSwapCacheReconciler(client, 'B', () => undefined);
    await reconcile(legacy); await reconcile({ ...legacy, status: 'completed' });
    expect(client.getQueryData(homeKey)).toEqual([other]);
  });

  it('cancels old Home and zone reads, preventing late results from restoring consumed cards', async () => {
    const client = setup(); seedCompleted(client);
    const reconcile = createCompletedSwapCacheReconciler(client, 'A', () => undefined);
    await reconcile(agreement());
    let finishHome!: (value: unknown) => void, finishZone!: (value: unknown) => void;
    const zoneKey = queryKeys.swapParties.detail('generalist');
    const oldZone = client.getQueryData(zoneKey);
    const home = client.fetchQuery({ queryKey: homeKey, staleTime: 0, queryFn: () => new Promise(resolve => { finishHome = resolve; }) }).catch(error => error);
    const zone = client.fetchQuery({ queryKey: zoneKey, staleTime: 0, queryFn: () => new Promise(resolve => { finishZone = resolve; }) }).catch(error => error);
    await reconcile(agreement('completed'));
    finishHome([coat, dress, other]); finishZone(oldZone);
    await Promise.all([home, zone]);
    expect(client.getQueryData(homeKey)).toEqual([other]);
    expect(client.getQueryData<{ items: unknown[] }>(zoneKey)?.items).toHaveLength(3);
  });

  it('does not modify a replacement session after cancellation yields', async () => {
    const client = setup(); seedCompleted(client);
    let current = true;
    const reconcile = createCompletedSwapCacheReconciler(client, 'A', () => { if (!current) throw new Error('stale'); });
    await reconcile(agreement());
    const pending = reconcile(agreement('completed'));
    current = false;
    client.setQueryData(homeKey, [coat, dress, other]);
    await expect(pending).rejects.toThrow('stale');
    expect(client.getQueryData(homeKey)).toEqual([coat, dress, other]);
    expect(client.getQueryState(homeKey)?.isInvalidated).toBe(false);
  });
});

describe('adopted manual availability', () => {
  it('sold removes public cards but preserves the adopted sold owner inventory and detail', async () => {
    const client = setup(); seedCompleted(client);
    const sold = { ...coat, isSold: true };
    client.setQueryData(queryKeys.articles.userList('A'), [sold]);
    client.setQueryData(queryKeys.articles.detail('coat'), sold);
    await reconcileOwnerArticleAvailability(client, 'coat', 'A', true, () => undefined);
    expect(client.getQueryData(homeKey)).toEqual([dress, other]);
    expect(client.getQueryData(queryKeys.articles.userList('A'))).toEqual([sold]);
    expect(client.getQueryData(queryKeys.articles.detail('coat'))).toEqual(sold);
    expect(client.getQueryData<unknown[]>(['home', 'swap-zone-items', 'generalist'])).toHaveLength(3);
  });

  it('relisting refreshes availability without removing any current public or zone cards', async () => {
    const client = setup(); const { items } = seedCompleted(client);
    await reconcileOwnerArticleAvailability(client, 'coat', 'A', false, () => undefined);
    expect(client.getQueryData(homeKey)).toEqual([coat, dress, other]);
    expect(client.getQueryData(['home', 'swap-zone-items', 'generalist'])).toEqual(items);
    expect(client.getQueryState(homeKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.swapParties.detail('generalist'))?.isInvalidated).toBe(true);
  });
});
