import { describe, expect, it } from 'vitest';
import { planFavoriteReconciliation as plan, validFavoriteId, type FavoriteSnapshot } from './favoriteReconciliation';
const fixture = (changes: Partial<FavoriteSnapshot> = {}): FavoriteSnapshot => ({
  canonicalComplete: true, favorites: [], memberships: [],
  articles: [{ articleId: 'a', likes: 0, favoritesCount: 0 }],
  searchIndex: [{ articleId: 'a', likes: 0 }], ...changes,
});
describe('local pure favorite reconciliation', () => {
  it('repairs first favorite and both existing counter projections', () => {
    expect(plan(fixture({ favorites: [{ userId: 'u', articleIds: ['a'] }] }))).toEqual({
      kind: 'local-fixture-only', memberships: [{ articleId: 'a', userId: 'u', counted: true }],
      articles: [{ articleId: 'a', likes: 1, favoritesCount: 1 }], searchIndex: [{ articleId: 'a', likes: 1 }],
    });
  });
  it('counts distinct users, adds and removes memberships against live canonical fixture', () => {
    const result = plan(fixture({ favorites: [{ userId: 'u', articleIds: ['a', 'a'] }, { userId: 'v', articleIds: ['a'] }],
      memberships: [{ userId: 'old', articleId: 'a', counted: true }, { userId: 'v', articleId: 'a', counted: false }] }));
    expect(result.articles[0].likes).toBe(2);
    expect(result.memberships).toEqual([{ articleId: 'a', userId: 'old', counted: false },
      { articleId: 'a', userId: 'u', counted: true }, { articleId: 'a', userId: 'v', counted: true }]);
  });
  it('repairs deletion of complete favorites document and stale membership absent canonical list', () => {
    const result = plan(fixture({ memberships: [{ articleId: 'a', userId: 'deleted', counted: true }],
      articles: [{ articleId: 'a', likes: 9, favoritesCount: 8 }], searchIndex: [{ articleId: 'a', likes: 7 }] }));
    expect(result.memberships[0].counted).toBe(false);
    expect(result.articles[0]).toEqual({ articleId: 'a', likes: 0, favoritesCount: 0 });
    expect(result.searchIndex[0].likes).toBe(0);
  });
  it('normalizes absent counted and clears removed IDs from an existing empty favorites document', () => {
    const source = fixture({ favorites: [{ userId: 'u', articleIds: [] }], memberships: [{ articleId: 'a', userId: 'u', counted: true }, { articleId: 'b', userId: 'u' }] });
    const result = plan(source);
    expect(result.memberships).toEqual([{ articleId: 'a', userId: 'u', counted: false }, { articleId: 'b', userId: 'u', counted: false }]);
    expect(plan({ ...source, memberships: result.memberships }).memberships).toEqual([]);
  });
  it('repairs explicit orphan counters with no favorites or memberships', () => {
    expect(plan(fixture({ articles: [{ articleId: 'a', likes: 10, favoritesCount: 10 }] })).articles[0].likes).toBe(0);
  });
  it('is diff-only and idempotent after fixture application, preserving unrelated fields', () => {
    const source = fixture({ favorites: [{ userId: 'u', articleIds: ['a'] }],
      memberships: [{ articleId: 'b', userId: 'old', counted: false }] });
    const before = JSON.stringify(source);
    const first = plan(source);
    const updated = fixture({ ...source, memberships: [...source.memberships, ...first.memberships],
      articles: first.articles, searchIndex: first.searchIndex });
    expect(plan(updated)).toEqual({ kind: 'local-fixture-only', memberships: [], articles: [], searchIndex: [] });
    expect(JSON.stringify(source)).toBe(before);
  });
  it('is idempotent after replacing stale existing memberships and counters', () => {
    const source = fixture({ favorites: [{ userId: 'u', articleIds: ['a'] }],
      memberships: [{ articleId: 'a', userId: 'u', counted: false }, { articleId: 'a', userId: 'old', counted: true }],
      articles: [{ articleId: 'a', likes: 9, favoritesCount: 9 }], searchIndex: [{ articleId: 'a', likes: 9 }] });
    const first = plan(source);
    const updated = { ...source, memberships: source.memberships.map(row => ({ ...row,
      ...first.memberships.find(change => change.articleId === row.articleId && change.userId === row.userId) })),
      articles: first.articles, searchIndex: first.searchIndex };
    expect(plan(updated)).toEqual({ kind: 'local-fixture-only', memberships: [], articles: [], searchIndex: [] });
  });
  it('never creates missing article/index documents and has no notification action channel', () => {
    const result = plan(fixture({ favorites: [{ userId: 'u', articleIds: ['missing'] }], articles: [], searchIndex: [] }));
    expect(result.articles).toEqual([]); expect(result.searchIndex).toEqual([]);
    expect(Object.keys(result).sort()).toEqual(['articles', 'kind', 'memberships', 'searchIndex']);
  });
  it('rejects invalid canonical IDs and deduplicates valid IDs including UTF-8 byte boundary', () => {
    const invalid = ['', '/', '.', '..', '__x__', null, 42, {}, 'é'.repeat(751)];
    for (const id of invalid) expect(() => plan(fixture({ favorites: [{ userId: 'u', articleIds: [id, 'a'] }] }))).toThrow('Invalid canonical');
    expect(plan(fixture({ favorites: [{ userId: 'u', articleIds: ['a', 'a'] }] })).articles[0].likes).toBe(1);
    expect(validFavoriteId('é'.repeat(750))).toBe(true);
    expect(validFavoriteId('é'.repeat(751))).toBe(false);
    expect(() => plan(fixture({ favorites: [{ userId: 'u', articleIds: null }] }))).toThrow('Invalid canonical');
  });
  it('fails closed for incomplete canonical fixture and ambiguous duplicate documents', () => {
    expect(() => plan({ ...fixture(), canonicalComplete: false } as unknown as FavoriteSnapshot)).toThrow('Complete');
    expect(() => plan(fixture({ favorites: [{ userId: 'u', articleIds: [] }, { userId: 'u', articleIds: ['a'] }] }))).toThrow('duplicate');
    expect(() => plan(fixture({ memberships: [{ articleId: 'a/b', userId: 'u' }] }))).toThrow('Invalid');
  });
  it('orders plans deterministically regardless of snapshot ordering', () => {
    const source = fixture({ favorites: [{ userId: 'z', articleIds: ['b', 'a'] }, { userId: 'u', articleIds: ['a'] }] });
    expect(plan(source)).toEqual(plan({ ...source, favorites: [...source.favorites].reverse() }));
  });
});
