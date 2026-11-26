import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { Swap } from '@/types/swap';

import { queryKeys } from './queryKeys';

// These roots mirror the feature/core keys without importing their hooks (and
// their Firebase dependencies) into a shared cache utility.
const HOME_ROOT = 'home';
const FAVORITES_ROOT = 'favorites';
const HOME_ARTICLE_LISTS = new Set(['new-arrivals', 'price-drops', 'discover', 'pour-toi']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Retain cursors, page parameters and untouched references while pruning lists. */
function withoutItems(data: unknown, matches: (item: Record<string, unknown>) => boolean, listField: 'articles' | 'items'): unknown {
  if (Array.isArray(data)) {
    const filtered = data.filter(item => !isRecord(item) || !matches(item));
    return filtered.length === data.length ? data : filtered;
  }
  if (!isRecord(data)) return data;
  if (Array.isArray(data.pages)) {
    const previousPages = data.pages;
    const pages = previousPages.map(page => withoutItems(page, matches, listField));
    return pages.every((page, index) => page === previousPages[index]) ? data : { ...data, pages };
  }
  if (Array.isArray(data[listField])) {
    const items = withoutItems(data[listField], matches, listField);
    return items === data[listField] ? data : { ...data, [listField]: items };
  }
  return data;
}

/** Apply a confirmed owner withdrawal to already loaded catalogue lists. */
async function reconcileCatalogueCache(
  client: QueryClient,
  articleOwners: ReadonlyMap<string, string>,
  assertCurrent: () => void,
  options: { prune: boolean; partyId?: string; allParties?: boolean; preserveOwnerLists?: boolean },
): Promise<void> {
  const owners = new Set(articleOwners.values());
  const isOwnerArticles = (key: QueryKey) => key.length === 3 && key[0] === 'users' &&
    key[1] === 'articles' && typeof key[2] === 'string' && owners.has(key[2]);
  const isParty = (key: QueryKey) => key[0] === queryKeys.swapParties.all[0] &&
    (options.allParties === true || (!!options.partyId && key[1] === options.partyId));
  const isHomeParty = (key: QueryKey) => key[0] === HOME_ROOT && key[1] === 'swap-zone-items' &&
    (options.allParties === true || (!!options.partyId && key[2] === options.partyId));
  const affected = ({ queryKey: key }: { queryKey: QueryKey }) =>
    key[0] === queryKeys.articles.all[0] ||
    (key[0] === HOME_ROOT && (!options.partyId || key[1] !== 'swap-zone-items' || isHomeParty(key))) ||
    key[0] === FAVORITES_ROOT || isOwnerArticles(key) || isParty(key);
  const articleList = ({ queryKey: key }: { queryKey: QueryKey }) =>
    (key[0] === queryKeys.articles.all[0] && ((!options.preserveOwnerLists && key[1] === 'user') || key[1] === 'search')) ||
    (key[0] === HOME_ROOT && typeof key[1] === 'string' && HOME_ARTICLE_LISTS.has(key[1])) ||
    (key[0] === FAVORITES_ROOT && key[1] === 'list') || isOwnerArticles(key);

  assertCurrent();
  // Firebase reads need not consume AbortSignal: cancelling the Query still
  // prevents their old response from restoring a card after our local purge.
  await client.cancelQueries({ predicate: affected });
  assertCurrent();
  if (options.prune) {
    client.setQueriesData({ predicate: articleList }, data => {
      assertCurrent();
      return withoutItems(data, item => typeof item.id === 'string' && articleOwners.has(item.id), 'articles');
    });
    client.setQueriesData({ predicate: ({ queryKey }) => isParty(queryKey) || isHomeParty(queryKey) }, data => {
      assertCurrent();
      return withoutItems(data, item => (options.allParties === true || item.partyId === options.partyId) && typeof item.articleId === 'string' &&
        articleOwners.get(item.articleId) === item.sellerId, 'items');
    });
  }
  assertCurrent();
  // Refetch active readers and mark inactive lists stale, including Home's
  // separate root. Do not wait for network before finishing the owner action.
  void client.invalidateQueries({ predicate: affected });
}

/** Apply a confirmed owner withdrawal to already loaded catalogue lists. */
export async function removeWithdrawnArticleFromCache(
  client: QueryClient,
  articleId: string,
  ownerUid: string,
  assertCurrent: () => void,
): Promise<void> {
  await reconcileCatalogueCache(client, new Map([[articleId, ownerUid]]), assertCurrent, { prune: true, allParties: true });
}

/** A sold card disappears from discovery, but stays in its owner's inventory. */
export async function reconcileOwnerArticleAvailability(
  client: QueryClient,
  articleId: string,
  ownerUid: string,
  isSold: boolean,
  assertCurrent: () => void,
): Promise<void> {
  await reconcileCatalogueCache(client, new Map([[articleId, ownerUid]]), assertCurrent, {
    prune: isSold, allParties: true, preserveOwnerLists: true,
  });
}

/** One reconciler belongs to one current, server-authorized swap subscription. */
export function createCompletedSwapCacheReconciler(client: QueryClient, participantUid: string, assertCurrent: () => void) {
  let previous: { source: string; status: Swap['status'] } | null = null;
  let completion: { source: string; token: symbol } | null = null;
  return async (swap: Swap | null): Promise<void> => {
    assertCurrent();
    if (!swap || (swap.initiatorId !== participantUid && swap.receiverId !== participantUid)) {
      previous = null; completion = null; return;
    }
    // Match the service's legacy object fallback. Deprecated *ItemId values
    // identify zone documents, not public articles, and are never used here.
    const initiatorItems = swap.initiatorItems ?? (swap.initiatorItem ? [swap.initiatorItem] : []);
    const receiverItems = swap.receiverItems ?? (swap.receiverItem ? [swap.receiverItem] : []);
    const articleOwners = new Map([
      ...initiatorItems.map(item => [item.articleId, swap.initiatorId] as const),
      ...receiverItems.map(item => [item.articleId, swap.receiverId] as const),
    ]);
    const source = JSON.stringify([swap.id, swap.partyId ?? null, swap.initiatorId, swap.receiverId,
      initiatorItems.map(item => item.articleId).sort(), receiverItems.map(item => item.articleId).sort(),
      swap.exchangeAgreement?.sourceHash ?? null]);
    const observedCompletion = previous?.source === source &&
      ['accepted', 'photos_pending', 'shipping'].includes(previous.status);
    previous = { source, status: swap.status };
    if (swap.status !== 'completed') { completion = null; return; }
    if (completion?.source === source) return;
    const receipt = { source, token: Symbol() }; completion = receipt;
    try {
      // An initial historical completion cannot prove that its articles are
      // unavailable today. Refresh it without deleting cards from that archive.
      await reconcileCatalogueCache(client, articleOwners, assertCurrent, {
        prune: observedCompletion, ...(swap.partyId ? { partyId: swap.partyId } : {}),
      });
    } catch (error) {
      if (completion === receipt) completion = null;
      throw error;
    }
  };
}
