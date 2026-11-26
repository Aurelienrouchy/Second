/** Pure LOCAL fixture planner. No Firebase SDK, IO, timestamps or notifications.
 * Requires a complete canonical snapshot: a partial read would undercount.
 * NEVER apply this snapshot plan to production. A future adapter must re-read
 * canonical sources and destination versions transactionally for each scope.
 */
export interface FavoriteSnapshot {
  canonicalComplete: true;
  favorites: readonly { userId: string; articleIds: unknown }[];
  memberships: readonly { articleId: string; userId: string; counted?: unknown }[];
  articles: readonly { articleId: string; likes?: unknown; favoritesCount?: unknown }[];
  searchIndex: readonly { articleId: string; likes?: unknown }[];
}
export interface FavoriteReconciliationPlan {
  kind: 'local-fixture-only';
  memberships: { articleId: string; userId: string; counted: boolean }[];
  articles: { articleId: string; likes: number; favoritesCount: number }[];
  searchIndex: { articleId: string; likes: number }[];
}

/** Same document ID policy as favorites trigger, including UTF-8 byte limit. */
export function validFavoriteId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 &&
    Buffer.byteLength(id, 'utf8') <= 1500 && !id.includes('/') &&
    id !== '.' && id !== '..' && !/^__[\s\S]*__$/.test(id);
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const key = (articleId: string, userId: string): string => JSON.stringify([articleId, userId]);
function checkedId(id: string): void {
  if (!validFavoriteId(id)) throw new Error('Invalid snapshot document ID');
}
function unique<T>(rows: readonly T[], getKey: (row: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const id = getKey(row);
    if (result.has(id)) throw new Error('Ambiguous duplicate snapshot document');
    result.set(id, row);
  }
  return result;
}

export function planFavoriteReconciliation(snapshot: FavoriteSnapshot): FavoriteReconciliationPlan {
  if (snapshot.canonicalComplete !== true) throw new Error('Complete canonical fixture required');
  const canonical = unique(snapshot.favorites, row => { checkedId(row.userId); return row.userId; });
  const members = unique(snapshot.memberships, row => {
    checkedId(row.articleId); checkedId(row.userId); return key(row.articleId, row.userId);
  });
  const articles = unique(snapshot.articles, row => { checkedId(row.articleId); return row.articleId; });
  const index = unique(snapshot.searchIndex, row => { checkedId(row.articleId); return row.articleId; });
  const desired = new Map<string, { articleId: string; userId: string }>();
  const counts = new Map<string, number>();
  for (const row of canonical.values()) {
    // Unlike the live trigger's tolerance for legacy events, a repair must
    // stop on malformed canonical data rather than silently undercount.
    if (!Array.isArray(row.articleIds) || row.articleIds.some(id => !validFavoriteId(id))) {
      throw new Error('Invalid canonical articleIds; inspect fixture before repair');
    }
    const ids = new Set(row.articleIds as string[]);
    for (const articleId of ids) {
      desired.set(key(articleId, row.userId), { articleId, userId: row.userId });
      counts.set(articleId, (counts.get(articleId) ?? 0) + 1);
    }
  }
  const plan: FavoriteReconciliationPlan = {
    kind: 'local-fixture-only', memberships: [], articles: [], searchIndex: [],
  };
  const allMembers = new Map([...members, ...desired]);
  for (const [id, row] of allMembers) {
    const counted = desired.has(id);
    if (!members.has(id) || members.get(id)?.counted !== counted) {
      plan.memberships.push({ articleId: row.articleId, userId: row.userId, counted });
    }
  }
  // Explicit existing document lists allow zero repair with no source/member.
  // Never synthesize article/search documents for dangling canonical favorites.
  for (const row of articles.values()) {
    const count = counts.get(row.articleId) ?? 0;
    if (row.likes !== count || row.favoritesCount !== count) {
      plan.articles.push({ articleId: row.articleId, likes: count, favoritesCount: count });
    }
  }
  for (const row of index.values()) {
    const count = counts.get(row.articleId) ?? 0;
    if (row.likes !== count) plan.searchIndex.push({ articleId: row.articleId, likes: count });
  }
  plan.memberships.sort((a, b) => compare(a.articleId, b.articleId) || compare(a.userId, b.userId));
  plan.articles.sort((a, b) => compare(a.articleId, b.articleId));
  plan.searchIndex.sort((a, b) => compare(a.articleId, b.articleId));
  return plan;
}
