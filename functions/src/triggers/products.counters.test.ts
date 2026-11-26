/**
 * `updateShopArticlesCount` — le compteur d'articles d'une boutique (T05).
 *
 * Le jumeau vendeur (`updateSellerArticlesCount`) borne sa décrémentation à 0
 * et sort si le document porteur n'existe plus ; la boutique, elle, appliquait
 * un `increment(-1)` brut sur un document qui pouvait avoir disparu ou dont le
 * compteur était déjà à 0.
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
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));
vi.mock('../utils/debounce', () => ({ debounceUpdate: () => {} }));

import { updateShopArticlesCount } from './products';

const run = updateShopArticlesCount as unknown as (event: unknown) => Promise<void>;

const LISTED = { sellerId: 's1', shopId: 'shop1', isActive: true, isSold: false };

function removal(shopId = 'shop1') {
  return run({
    params: { articleId: 'a1' },
    data: {
      before: { exists: true, data: () => ({ ...LISTED, shopId }) },
      after: { exists: false, data: () => undefined },
    },
  });
}

beforeEach(() => {
  fs.reset();
});

describe('updateShopArticlesCount — décrémentation (T05)', () => {
  it('ne descend jamais le compteur sous zéro', async () => {
    fs.setDoc('shops/shop1', { articlesCount: 0 });
    await removal();
    expect(fs.getDoc('shops/shop1')!.articlesCount).toBe(0);
  });

  it('n’écrit pas sur une boutique supprimée', async () => {
    await removal('ghost');
    expect(fs.countWrites((op) => op.path === 'shops/ghost')).toBe(0);
  });

  it('décrémente normalement une boutique qui a des articles', async () => {
    fs.setDoc('shops/shop1', { articlesCount: 3 });
    await removal();
    expect(fs.getDoc('shops/shop1')!.articlesCount).toBe(2);
  });

  it('incrémente à la mise en ligne', async () => {
    fs.setDoc('shops/shop1', { articlesCount: 3 });
    await run({
      params: { articleId: 'a1' },
      data: {
        before: { exists: false, data: () => undefined },
        after: { exists: true, data: () => LISTED },
      },
    });
    expect(fs.getDoc('shops/shop1')!.articlesCount).toBe(4);
  });
});
