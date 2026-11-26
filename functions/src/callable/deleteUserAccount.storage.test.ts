/**
 * La suppression de compte efface les photos que l'utilisateur a téléversées.
 *
 * Le parcours de vente dépose les photos sous `drafts/{uid}/…` pendant
 * l'analyse IA, et la publication réutilise ces URL : c'est là que vivent les
 * photos de la plupart des articles. La purge ne visait que `avatars/`,
 * `users/` et `articles/{id}/` — un compte effacé laissait ses photos
 * téléchargeables (Loi 25, art. 28).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  purgedPrefixes: [] as string[],
  failPrefix: null as string | null,
}));

const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
  auth: { deleteUser: async () => {} },
  storage: {
    bucket: () => ({
      deleteFiles: async (opts: { prefix: string }) => {
        if (holder.failPrefix && opts.prefix.startsWith(holder.failPrefix)) throw new Error('storage down');
        holder.purgedPrefixes.push(opts.prefix);
      },
    }),
  },
}));

vi.mock('../config/stripe', () => ({ getStripe: () => null }));
vi.mock('./privacyIncidents', () => ({ recordPrivacyIncident: async () => {} }));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
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

import { deleteUserAccount } from './users';

const callDelete = deleteUserAccount as unknown as (request: {
  auth?: { uid: string } | null;
}) => Promise<Record<string, unknown>>;

const UID = 'user1';

function url(path: string): string {
  return (
    'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/' +
    `${encodeURIComponent(path)}?alt=media&token=t`
  );
}

beforeEach(() => {
  fs.reset();
  holder.purgedPrefixes.length = 0;
  holder.failPrefix = null;
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  fs.setDoc(`users/${UID}`, { username: null });
  fs.setDoc(`wallets/${UID}`, { balance: 0, pendingBalance: 0, heldBalance: 0, sellerDebt: 0 });
});

describe('deleteUserAccount — photos téléversées', () => {
  it("efface le dossier de brouillons de l'utilisateur, où vivent les photos de ses articles", async () => {
    fs.setDoc('articles/a1', {
      sellerId: UID,
      images: [{ url: url(`drafts/${UID}/draftA/draftA_0_1.jpg`) }],
    });

    await callDelete({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: UID } });

    expect(holder.purgedPrefixes).toContain(`drafts/${UID}/`);
  });

  it('une purge qui échoue n’empêche pas les suivantes (ST02)', async () => {
    holder.failPrefix = `users/${UID}/`;
    await callDelete({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: UID } });
    expect(holder.purgedPrefixes).toContain(`drafts/${UID}/`);
  });

  it("ne dérive jamais un dossier à effacer d'une URL écrite par le client", async () => {
    // Une URL d'image n'est pas une preuve de propriété : un article peut
    // pointer vers le dossier d'un autre. Effacer d'après elle permettrait de
    // détruire les photos d'autrui en supprimant son propre compte.
    fs.setDoc('articles/a1', {
      sellerId: UID,
      images: [{ url: url('articles/victim-article/image_0_1.jpg') }],
    });

    await callDelete({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: UID } });

    expect(holder.purgedPrefixes).not.toContain('articles/victim-article/');
    expect(holder.purgedPrefixes.every((p) => p.includes(UID) || p === 'articles/a1/')).toBe(true);
  });
});
