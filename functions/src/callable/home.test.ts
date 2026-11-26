/**
 * « Marques tendance » (H01, NB01).
 *
 * H01 : `_getTrendingBrands` relit jusqu'à 500 documents articles COMPLETS à
 * chaque appel, sans projection et sans cache serveur.
 * NB01 : la marque affichée était recalculée depuis la clé normalisée, donc
 * « MSGM » ressortait « Msgm » sur l'accueil.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));
vi.mock('firebase-functions/v2/https', () => {
  class _HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { onCall: (_opts: unknown, handler: unknown) => handler, HttpsError: _HttpsError };
});

import { getTrendingBrands } from './home';

const call = getTrendingBrands as unknown as () => Promise<
  Array<{ name: string; articleCount: number }>
>;

// Le cache serveur vit dans le module : chaque test repart d'une horloge
// au-delà de son TTL pour ne pas hériter du test précédent.
let clock = Date.UTC(2026, 0, 1);

beforeEach(() => {
  vi.useFakeTimers();
  clock += 6 * 60 * 60 * 1000;
  vi.setSystemTime(clock);
  fs.reset();
  fs.setDoc('articles/a1', { isActive: true, isSold: false, brand: 'MSGM' });
  fs.setDoc('articles/a2', { isActive: true, isSold: false, brand: 'msgm' });
  fs.setDoc('articles/a3', { isActive: true, isSold: false, brand: 'Zara' });
});

afterAll(() => {
  vi.useRealTimers();
});

describe('getTrendingBrands', () => {
  it('affiche la marque telle qu’elle est écrite sur les articles (NB01)', async () => {
    const brands = await call();
    expect(brands[0]).toEqual({ name: 'MSGM', articleCount: 2 });
  });

  it('ne relit pas le catalogue à chaque appel (H01)', async () => {
    const first = await call();
    fs.reset();
    expect(await call()).toEqual(first);
  });

  it('relit le catalogue une fois le cache périmé', async () => {
    await call();
    fs.reset();
    vi.setSystemTime(clock + 2 * 60 * 60 * 1000);
    expect(await call()).toEqual([]);
  });

  it('ignore les articles sans marque', async () => {
    fs.setDoc('articles/a4', { isActive: true, isSold: false });
    fs.setDoc('articles/a5', { isActive: false, isSold: false, brand: 'Gucci' });
    const brands = await call();
    expect(brands.map((b) => b.name)).toEqual(['MSGM', 'Zara']);
  });
});
