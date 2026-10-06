import {
  collection, getDocs, limit, orderBy, query, startAfter, where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

jest.mock('@/utils/imageUtils', () => ({ processImageWithBlurhash: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({}));
import { ArticlesService } from '@/services/articlesService';

type Constraint = { kind: string; field?: string; op?: string; value?: unknown; count?: number; id?: string };
type SearchQuery = { path: string; constraints: Constraint[] };
let documents: QueryDocumentSnapshot[];
let reads: number;

function articleDoc(index: number, matches = true): QueryDocumentSnapshot {
  return {
    id: `article-${index}`,
    data: () => ({
      title: `Robe ${index}`, price: index, sellerId: index % 2 ? 'buyer' : 'owner',
      colors: matches ? ['bleu'] : ['rouge'], keywords: ['robe'],
      isActive: true, isSold: false, images: [], createdAt: { toDate: () => new Date(index) },
    }),
  } as unknown as QueryDocumentSnapshot;
}

beforeEach(() => {
  documents = []; reads = 0;
  (collection as jest.Mock).mockImplementation((_db, path: string) => ({ path }));
  (where as jest.Mock).mockImplementation((field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }));
  (orderBy as jest.Mock).mockImplementation(() => ({ kind: 'order' }));
  (limit as jest.Mock).mockImplementation((count: number) => ({ kind: 'limit', count }));
  (startAfter as jest.Mock).mockImplementation((doc: QueryDocumentSnapshot) => ({ kind: 'cursor', id: doc.id }));
  (query as jest.Mock).mockImplementation((ref: { path: string }, ...constraints: Constraint[]) => ({ path: ref.path, constraints }));
  (getDocs as jest.Mock).mockImplementation(async (q: SearchQuery) => {
    const cursorId = q.constraints.find((c) => c.kind === 'cursor')?.id;
    const cursorIndex = cursorId ? documents.findIndex((d) => d.id === cursorId) + 1 : 0;
    const fetchLimit = q.constraints.find((c) => c.kind === 'limit')!.count!;
    const docs = documents.slice(cursorIndex).filter((doc) => q.constraints.every((c) => {
      if (c.kind !== 'where') return true;
      const value = doc.data()[c.field!];
      if (c.op === 'array-contains') return Array.isArray(value) && value.includes(c.value);
      return value === c.value;
    })).slice(0, fetchLimit);
    reads += docs.length;
    return { docs, forEach: (callback: (d: QueryDocumentSnapshot) => void) => docs.forEach(callback) };
  });
});

describe.each([undefined, 'robe'] as const)('search pagination (term %s)', (term) => {
  it('returns every retained match exactly once, including a short final batch', async () => {
    documents = Array.from({ length: 17 }, (_, i) => articleDoc(i));
    const ids: string[] = [];
    let cursor: QueryDocumentSnapshot | undefined;
    let pages = 0;
    do {
      const page = await ArticlesService.searchArticles(term, { colors: ['bleu'] }, 3, cursor);
      ids.push(...page.articles.map((a) => a.id)); pages++;
      if (!page.hasMore) break;
      expect(page.lastVisible).not.toBeNull();
      cursor = page.lastVisible!;
    } while (pages < 20);
    expect(ids).toEqual(documents.map((d) => d.id));
    expect(new Set(ids).size).toBe(17);
    expect(pages).toBe(6);
  });

  it('keeps continuation when a selective filter reaches the bounded refill cap', async () => {
    documents = Array.from({ length: 62 }, (_, i) => articleDoc(i, i >= 60));
    const first = await ArticlesService.searchArticles(term, { colors: ['bleu'] }, 2);
    expect(first.articles).toEqual([]);
    expect(first.hasMore).toBe(true);
    expect(first.lastVisible?.id).toBe('article-49');
    expect(reads).toBe(50); // five batches, ten reads each
    const second = await ArticlesService.searchArticles(term, { colors: ['bleu'] }, 2, first.lastVisible!);
    expect(second.articles.map((a) => a.id)).toEqual(['article-60', 'article-61']);
    expect(second.hasMore).toBe(false);
  });

  it('reports exhaustion for an exact final page and counts only bounded lookahead reads', async () => {
    documents = Array.from({ length: 3 }, (_, i) => articleDoc(i));
    const page = await ArticlesService.searchArticles(term, undefined, 3);
    expect(page.articles).toHaveLength(3);
    expect(page.hasMore).toBe(false);
    expect(reads).toBe(3);
  });

  it('continues past filtered own articles instead of ending on a sparse page', async () => {
    documents = Array.from({ length: 15 }, (_, i) => articleDoc(i));
    const page = await ArticlesService.searchArticles(term, { excludeUserId: 'owner' }, 3);
    expect(page.articles.map((a) => a.id)).toEqual(['article-1', 'article-3', 'article-5']);
    expect(page.hasMore).toBe(true);
    const second = await ArticlesService.searchArticles(term, { excludeUserId: 'owner' }, 3, page.lastVisible!);
    expect(second.articles.map((a) => a.id)).toEqual(['article-7', 'article-9', 'article-11']);
  });
});
