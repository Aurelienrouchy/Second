/**
 * `recordPriceDrop` — une seconde porte d'écriture du prix, sans aucune garde.
 *
 * Aucun code de l'app ne l'appelle (seul son export dans index.ts la nomme),
 * mais elle est déployée et appelable par tout compte connecté. Elle écrivait
 * `price` sans borne, sans verrou « vendu », « désactivé » ni « transaction
 * en cours », et fabriquait une baisse à partir d'un `oldPrice` fourni par
 * l'appelant. `updateArticle` couvre intégralement son usage.
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

import { recordPriceDrop } from './home';

const call = recordPriceDrop as unknown as (r: {
  auth?: { uid: string } | null;
  data?: unknown;
}) => Promise<unknown>;

beforeEach(() => {
  fs.reset();
  fs.setDoc('articles/a1', { sellerId: 'u1', price: 100, isActive: true, isSold: true });
});

describe('recordPriceDrop', () => {
  it('ne réécrit plus le prix d’un article, même vendu, même à un centime', async () => {
    await expect(
      call({ auth: { uid: 'u1' }, data: { productId: 'a1', oldPrice: 100, newPrice: 0.001 } }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('articles/a1')!.price).toBe(100);
  });
});
