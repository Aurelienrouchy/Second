/**
 * `onArticleSoftDeleted` — un article retiré de la vente quitte les favoris.
 *
 * La vente conclue retirait l'article des favoris de tous ; le retrait de la
 * vente, lui, le laissait en place : il occupait l'un des 500 emplacements de
 * chaque acheteur jusqu'à ce que celui-ci fasse défiler sa liste.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentUpdated: (_opts: unknown, handler: unknown) => handler,
  onDocumentCreated: (_opts: unknown, handler: unknown) => handler,
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));

import { onArticleSoftDeleted } from './articles';

const run = onArticleSoftDeleted as unknown as (event: unknown) => Promise<void>;

function update(after: Record<string, unknown>) {
  const article = { sellerId: 's1', title: 'Robe', isSold: false, isActive: true };
  fs.setDoc('articles/a1', { ...article, ...after });
  return run({
    params: { articleId: 'a1' },
    data: {
      before: { data: () => article },
      after: { data: () => ({ ...article, ...after }) },
    },
  });
}

beforeEach(() => {
  fs.reset();
  fs.setDoc('favorites/buyer1', { articleIds: ['a1', 'a2'] });
  fs.setDoc('favorites/buyer2', { articleIds: ['a1'] });
  fs.setDoc('favorites/buyer3', { articleIds: ['a3'] });
});

describe('onArticleSoftDeleted — favoris (TA01)', () => {
  it('retire l’article retiré de la vente des favoris de tous', async () => {
    await update({ isActive: false });
    expect(fs.getDoc('favorites/buyer1')!.articleIds).toEqual(['a2']);
    expect(fs.getDoc('favorites/buyer2')!.articleIds).toEqual([]);
    expect(fs.getDoc('favorites/buyer3')!.articleIds).toEqual(['a3']);
  });

  it('traite tous les favoris, au-delà d’un lot', async () => {
    for (let i = 0; i < 45; i++) fs.setDoc(`favorites/fan${i}`, { articleIds: ['a1', 'b'] });
    await update({ isActive: false });
    for (let i = 0; i < 45; i++) expect(fs.getDoc(`favorites/fan${i}`)!.articleIds).toEqual(['b']);
  });

  it('ne touche à aucun favori tant que l’article reste en vente', async () => {
    await update({ title: 'Robe longue' });
    expect(fs.getDoc('favorites/buyer1')!.articleIds).toEqual(['a1', 'a2']);
  });
});
